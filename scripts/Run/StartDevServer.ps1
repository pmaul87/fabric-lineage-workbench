################################################
# Starting the DevServer
################################################
Write-Host ""
Write-Host "Starting the DevServer ..."
$workloadDir = Join-Path $PSScriptRoot "..\..\Workload"
Push-Location $workloadDir
try {
    # If running in Codespaces, use the low memory version by default to prevent OOM errors
    if ($env:CODESPACES -eq "true") {
        Write-Host "Running in Codespace environment - using low memory configuration to prevent OOM errors"
        $env:NODE_ENV = "codespace"
        npm run start:codespace
    } else {
        # Use regular start for non-codespace environments
        npm start
    }
} finally {
    Pop-Location
}
