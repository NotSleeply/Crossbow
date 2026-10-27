# Windows Authenticode 签名（B 方案：自签证书，#82）。
# tauri signCommand 在打包期对每个产物调用（%1 = 待签文件路径）；
# 环境变量未配置时静默跳过（PR 构建/本地构建不签，零配置差异）。
# 签名发生在更新器 minisign 签名之前，Authenticode 后的字节即分发字节。
$ErrorActionPreference = "Stop"

$target = $args[0]
if (-not $target) { throw "usage: sign_windows.ps1 <file-to-sign>" }

$pfxPath = $env:WINDOWS_SIGN_PFX_PATH
$pfxPass = $env:WINDOWS_SIGN_PFX_PASSWORD
if (-not $pfxPath -or -not (Test-Path $pfxPath) -or -not $pfxPass) {
    Write-Host "sign_windows: WINDOWS_SIGN_PFX_* not set, skipping signing for $target"
    exit 0
}

# windows-latest 自带 Windows SDK；signtool 不在 PATH 时按版本目录兜底查找
$tool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $tool) {
    $candidate = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe |
        Where-Object { $_.FullName -match "x64" } |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $candidate) { throw "signtool.exe not found" }
    $toolPath = $candidate.FullName
} else {
    $toolPath = $tool.Source
}

& $toolPath sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com `
    /f $pfxPath /p $pfxPass $target
if ($LASTEXITCODE -ne 0) { throw "signtool failed for $target" }
Write-Host "sign_windows: signed $target"
