function Get-EnvironmentFilePaths {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkloadRoot,

        [Parameter(Mandatory = $true)]
        [string]$EnvironmentName
    )

    [pscustomobject]@{
        BasePath = Join-Path $WorkloadRoot ".env.$EnvironmentName"
        LocalPath = Join-Path $WorkloadRoot ".env.$EnvironmentName.local"
    }
}

function Read-DotEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $values = @{}
    if (-not (Test-Path $Path)) {
        return $values
    }

    Get-Content $Path | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') {
            return
        }

        if ($_ -match '^([^#=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            $values[$key] = $value
        }
    }

    return $values
}

function Get-MergedEnvironmentConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkloadRoot,

        [Parameter(Mandatory = $true)]
        [string]$EnvironmentName
    )

    $paths = Get-EnvironmentFilePaths -WorkloadRoot $WorkloadRoot -EnvironmentName $EnvironmentName
    $loadedFiles = @()
    $values = @{}

    foreach ($path in @($paths.BasePath, $paths.LocalPath)) {
        if (-not (Test-Path $path)) {
            continue
        }

        $loadedFiles += $path
        $fileValues = Read-DotEnvFile -Path $path
        foreach ($key in $fileValues.Keys) {
            $values[$key] = $fileValues[$key]
        }
    }

    if ($loadedFiles.Count -eq 0) {
        throw "No environment configuration found for '$EnvironmentName'. Expected $($paths.BasePath) and optional override $($paths.LocalPath)."
    }

    [pscustomobject]@{
        EnvironmentName = $EnvironmentName
        BasePath = $paths.BasePath
        LocalPath = $paths.LocalPath
        LoadedFiles = $loadedFiles
        Values = $values
    }
}

function Write-EnvironmentLoadSummary {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Config,

        [string]$Prefix = "Loaded environment configuration"
    )

    Write-Host "$Prefix from: $($Config.LoadedFiles -join ', ')" -ForegroundColor Green
}
