# Hosted-runner only: verifies the real NSIS hooks, broker lifetime, and rejection
# of an unrelated local client. No user configuration or TUN/network changes.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'This smoke test may only run on an ephemeral Windows Actions runner'
}
$installer = (Get-ChildItem target/release/bundle/nsis/*-setup.exe | Select-Object -First 1).FullName
if (-not $installer) { throw 'NSIS installer not found' }
function Install-Crossbow {
    $process = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru
    if (-not $process.WaitForExit(120000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw 'Installer timed out after 120 seconds'
    }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    $service = Get-Service CrossbowService
    $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(10))
}
try {
    Install-Crossbow
    $pipe = [IO.Pipes.NamedPipeClientStream]::new('.', 'crossbow-service', [IO.Pipes.PipeDirection]::InOut)
    try {
        $pipe.Connect(5000)
        $writer = [IO.StreamWriter]::new($pipe)
        $writer.AutoFlush = $true
        $reader = [IO.StreamReader]::new($pipe)
        $writer.WriteLine('{"cmd":"start","binary":"C:\\Windows\\System32\\cmd.exe","config":"not-opened","log":"not-opened"}')
        $reply = $reader.ReadLineAsync()
        if (-not $reply.Wait(5000)) { throw 'Service response timed out' }
        $value = $reply.Result | ConvertFrom-Json
        $writer.WriteLine('') # Reply ACK before the server disconnects.
        if ($value.ok -ne $false -or $value.error -notmatch 'only the installed Crossbow GUI') {
            throw 'Broker did not reject the foreign client before opening files'
        }
    } finally { $pipe.Dispose() }
    $idle = [IO.Pipes.NamedPipeClientStream]::new('.', 'crossbow-service', [IO.Pipes.PipeDirection]::InOut)
    $idle.Connect(5000)
    # A connected client that never writes must not block SCM stop.
    Stop-Service CrossbowService
    $idle.Dispose()
    (Get-Service CrossbowService).WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(10))
    Start-Service CrossbowService
    # Installing over the running service exercises stop-before-overwrite hooks.
    Install-Crossbow
    Write-Host 'Windows service installation, rejection, stop/restart and upgrade checks passed'
} catch {
    Get-CimInstance Win32_Service -Filter "Name='CrossbowService'" |
        Select-Object Name, State, PathName | Format-List
    throw
} finally {
    $service = Get-Service CrossbowService -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Stopped') { Stop-Service CrossbowService }
}
