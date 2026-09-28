param ( 
    # The name of the workload, used for the Entra App and the workload in the Fabric portal
    [String]$WorkloadName = "Org.MyWorkload",
    # The Entra Application ID for the frontend
    # If not provided, the user will be prompted to enter it or create a new one.
    [String]$FrontendAppId = "00000000-0000-0000-0000-000000000000",
    # Not used in the current setup, but can be used for future backend app configurations
    # If not provided, it will default to an empty string.
    [String]$BackendAppId,
    # The version of the workload, used for the manifest package
    [String]$WorkloadVersion = "1.0.0",
    # Environment that should be build
    [ValidateSet("dev", "test", "prod")]
    [String]$Environment = "prod"
)

function Assert-EnvironmentFile {
    param (
        [string]$WorkloadRoot,
        [string]$EnvironmentName
    )

    $envFile = Join-Path $WorkloadRoot ".env.$EnvironmentName"
    if (-not (Test-Path $envFile)) {
        Write-Host "Missing environment file: $envFile" -ForegroundColor Red
        Write-Host "Run scripts/Setup/SetupWorkload.ps1 first to generate environment files." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Using environment file: $envFile" -ForegroundColor Green
}

# Define key-value dictionary for replacements
$replacements = @{
    "WORKLOAD_NAME" = $WorkloadName
    "FRONTEND_APPID" = $FrontendAppId
    "BACKEND_APPID" = $BackendAppId
    "WORKLOAD_VERSION" = $WorkloadVersion
}

$releaseDir = Join-Path $PSScriptRoot "..\..\release"
if ((Test-Path $releaseDir)) {
    Write-Output "Release directory already exists at $releaseDir. Deleting it."
    Remove-Item -Path $releaseDir -Recurse -Force
} 
New-Item -ItemType Directory -Path $releaseDir | Out-Null
$releaseDir = Resolve-Path $releaseDir

###############################################################################
# Creating the release manifest
# 
###############################################################################
# Run BuildManifestPackage.ps1 with absolute path
$buildManifestPackageScript = Join-Path $PSScriptRoot "..\Build\BuildManifestPackage.ps1"
if (Test-Path $buildManifestPackageScript) {
    $buildManifestPackageScript = (Resolve-Path $buildManifestPackageScript).Path
    & $buildManifestPackageScript `
        -Environment $Environment `
        -WorkloadName $WorkloadName `
        -FrontendAppId $FrontendAppId `
        -BackendAppId $BackendAppId `
        -WorkloadVersion $WorkloadVersion
} else {
    Write-Host "BuildManifestPackage.ps1 not found at $buildManifestPackageScript"
    exit 1
}

# Copy the nuget package to the release directory
$buildManifestDir = Join-Path $PSScriptRoot "..\..\build\Manifest"
$releaseManifestDir = Join-Path $releaseDir ""

$expectedManifestPackageName = "$WorkloadName.$WorkloadVersion.nupkg"
$expectedManifestPackagePath = Join-Path $buildManifestDir $expectedManifestPackageName

if (-not (Test-Path $expectedManifestPackagePath)) {
    Write-Host "Expected manifest package not found at $expectedManifestPackagePath" -ForegroundColor Red
    exit 1
}

Move-Item -Path $expectedManifestPackagePath -Destination $releaseManifestDir -Force

Write-Host "✅ Moved $expectedManifestPackageName to $releaseManifestDir." -ForegroundColor Blue


###############################################################################
# Creating the app release
# 
###############################################################################

$releaseAppDir = Join-Path $releaseDir "app"

Write-Host "Building the app release ..."
$workloadDir = Join-Path $PSScriptRoot "..\..\Workload"
Assert-EnvironmentFile -WorkloadRoot $workloadDir -EnvironmentName $Environment
Push-Location $workloadDir
try {
    $originalWorkloadName = $env:WORKLOAD_NAME
    $originalFrontendAppId = $env:FRONTEND_APPID
    $originalBackendAppId = $env:BACKEND_APPID
    $originalWorkloadVersion = $env:WORKLOAD_VERSION

    if ($WorkloadName) {
        $env:WORKLOAD_NAME = $WorkloadName
    }
    if ($FrontendAppId) {
        $env:FRONTEND_APPID = $FrontendAppId
    }
    if ($PSBoundParameters.ContainsKey('BackendAppId')) {
        $env:BACKEND_APPID = $BackendAppId
    }
    if ($WorkloadVersion) {
        $env:WORKLOAD_VERSION = $WorkloadVersion
    }

    npm run build:$Environment
    if (!(Test-Path $releaseAppDir)) {
        New-Item -ItemType Directory -Path $releaseAppDir | Out-Null
    }

    # Copy the built files to the release directory
    $buildFrontendDir = Join-Path $PSScriptRoot "..\..\build\Frontend"
    if (Test-Path $buildFrontendDir) {
        Copy-Item -Path "$buildFrontendDir\*" -Destination $releaseAppDir -Recurse -Force
        Write-Host "✅ Copied app release files to $releaseAppDir" -ForegroundColor Blue
    } else {
        Write-Host "⚠️  Warning: Frontend build directory not found at $buildFrontendDir" -ForegroundColor Yellow
    }

} finally {
    $env:WORKLOAD_NAME = $originalWorkloadName
    $env:FRONTEND_APPID = $originalFrontendAppId
    $env:BACKEND_APPID = $originalBackendAppId
    $env:WORKLOAD_VERSION = $originalWorkloadVersion
    Pop-Location
}

Write-Host ""
Write-Host "All release information has been build an is available under the" -ForegroundColor Green
Write-Host "$releaseDir"
Write-Host ""
Write-Host "You can now upload the manifest package and the app release to the Fabric portal." 
Write-Host "The manifest package is located at $releaseManifestDir"
Write-Host ""
write-Host "To upload the app release, to Azure you can use the Deploy scripts."
Write-Host "The app release is located at $releaseAppDir"


