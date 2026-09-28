param(
    [switch]$InteractiveLogin
)

$runDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $runDir 'StartDevServer.ps1'
$gatewayScript = Join-Path $runDir 'StartDevGateway.ps1'

Write-Host ''
Write-Host '============================================================='
Write-Host 'Starting demo environment'
Write-Host '============================================================='
Write-Host 'This launches the DevGateway and DevServer in separate shells.'
Write-Host ''

if ($IsWindows) {
    $pwshExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
    if (-not $pwshExe) {
        $pwshExe = 'pwsh'
    }

    Start-Process $pwshExe -ArgumentList @(
        '-NoExit',
        '-ExecutionPolicy', 'Bypass',
        '-File', $gatewayScript,
        $(if ($InteractiveLogin) { '-InteractiveLogin' })
    ) | Out-Null

    Start-Process $pwshExe -ArgumentList @(
        '-NoExit',
        '-ExecutionPolicy', 'Bypass',
        '-File', $serverScript
    ) | Out-Null

    Write-Host 'DevGateway and DevServer are starting in separate PowerShell windows.'
    Write-Host 'If a window opens behind VS Code, bring it to the foreground.'
    return
}

Write-Host 'Non-Windows launch is not configured for parallel windows yet.'
Write-Host 'Run StartDevGateway.ps1 and StartDevServer.ps1 in separate terminals.'
