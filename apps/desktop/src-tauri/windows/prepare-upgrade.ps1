# Invoked by NSIS after Restart Manager closes the GUI and SCM stops the service.
# Open existing files without truncating them. A failed preflight must leave the
# old executable intact, rather than discovering a sharing violation in File.
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [ValidateRange(1, 60)][int]$TimeoutSeconds = 15
)
$ErrorActionPreference = 'Stop'
$files = @('crossbow-desktop.exe', 'crossbow-service.exe', 'mihomo.exe', 'wintun.dll')
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
    $handles = @()
    $failure = $null
    try {
        foreach ($name in $files) {
            $path = Join-Path $InstallDir $name
            if (Test-Path -LiteralPath $path) {
                $handles += [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            }
        }
    } catch { $failure = $_.Exception.Message }
    finally { foreach ($handle in $handles) { $handle.Dispose() } }
    if (-not $failure) { exit 0 }
    Start-Sleep -Milliseconds 200
} while ([DateTime]::UtcNow -lt $deadline)
[Console]::Error.WriteLine("Crossbow upgrade preflight failed: $failure")
exit 1
