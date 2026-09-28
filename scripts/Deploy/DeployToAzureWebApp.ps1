param (
    # The name of the Azure Web App to deploy to
    [Parameter(Mandatory = $true)]
    [string]$WebAppName,
    
    # The name of the resource group containing the Web App
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,
    
    # The path to the release directory (default: relative to script location)
    [string]$ReleasePath = "..\..\release\app",
    
    # The deployment method to use
    [ValidateSet("ZipDeploy", "FTP", "LocalGit")]
    [string]$DeploymentMethod = "ZipDeploy",
    
    # Force deployment without confirmation
    [boolean]$Force = $false,
    
    # Restart the Web App after deployment
    [boolean]$RestartAfterDeploy = $true,
    
    # Prepare and print instructions to publish manifest package to Fabric Admin portal
    [boolean]$DeployManifest = $false,

    # Optional explicit path to manifest package (.nupkg). If empty, newest release package is used.
    [string]$ManifestPath = "",

    # Deployment slot name (optional, for staging deployments)
    [string]$SlotName,
    
    # Subscription ID (optional, will use current subscription if not specified)
    [string]$SubscriptionId
)

<#
.SYNOPSIS
    Deploys the Microsoft Fabric Workload release to an Azure Web App.

.DESCRIPTION
    This script deploys the built application from the release directory to an Azure Web App.
    It supports multiple deployment methods and includes validation features.

.PARAMETER WebAppName
    The name of the Azure Web App to deploy to.

.PARAMETER ResourceGroupName
    The name of the resource group containing the Web App.

.PARAMETER ReleasePath
    The path to the release directory containing the built application.

.PARAMETER DeploymentMethod
    The deployment method to use (ZipDeploy, FTP, or LocalGit).

.PARAMETER Force
    Skip confirmation prompts and deploy immediately.

.PARAMETER RestartAfterDeploy
    Restart the Web App after successful deployment.

.PARAMETER DeployManifest
    Validate and print publication instructions for the manifest package in Fabric Admin portal.

.PARAMETER ManifestPath
    Optional explicit path to a manifest package (.nupkg). If omitted, newest package in release folder is used.

.PARAMETER SlotName
    The deployment slot name for staging deployments.

.PARAMETER SubscriptionId
    The Azure subscription ID to use.

.EXAMPLE
    .\DeployToAzureWebApp.ps1 -WebAppName "my-fabric-workload" -ResourceGroupName "fabric-workload-rg"

.EXAMPLE
    .\DeployToAzureWebApp.ps1 -WebAppName "my-fabric-workload" -ResourceGroupName "fabric-workload-rg" -SlotName "staging" -Force $true

.NOTES
    Requires Azure CLI to be installed and authenticated.
    The release directory must contain the built application files.
#>

# Function to print formatted information
function Write-Info {
    param (
        [string]$Message,
        [string]$Color = "Green"
    )
    Write-Host $Message -ForegroundColor $Color
}

# Function to print formatted warnings
function Write-Warning-Custom {
    param (
        [string]$Message
    )
    Write-Host $Message -ForegroundColor Yellow
}

# Function to print formatted errors
function Write-Error-Custom {
    param (
        [string]$Message
    )
    Write-Host $Message -ForegroundColor Red
}

# Function to check if Azure CLI is installed and user is logged in
function Test-AzureCLI {
    try {
        $null = az --version
        Write-Info "Azure CLI is installed."
    }
    catch {
        Write-Error-Custom "Azure CLI is not installed. Please install Azure CLI first."
        Write-Info "Download from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
        exit 1
    }

    try {
        $account = az account show 2>$null | ConvertFrom-Json
        if ($null -eq $account) {
            Write-Warning-Custom "Not logged in to Azure CLI. Attempting to login..."
            az login
        }
        else {
            Write-Info "Logged in to Azure as: $($account.user.name)"
            if (-not [string]::IsNullOrWhiteSpace($SubscriptionId) -and $account.id -ne $SubscriptionId) {
                Write-Info "Switching to subscription: $SubscriptionId"
                az account set --subscription $SubscriptionId
            }
            else {
                Write-Info "Using subscription: $($account.name) ($($account.id))"
            }
        }
    }
    catch {
        Write-Error-Custom "Failed to authenticate with Azure CLI."
        exit 1
    }
}

# Function to validate Web App exists
function Test-WebApp {
    param (
        [string]$WebAppName,
        [string]$ResourceGroupName,
        [string]$SlotName
    )
    
    Write-Info "Validating Web App '$WebAppName' exists..."
    
    try {
        if ([string]::IsNullOrWhiteSpace($SlotName)) {
            $webapp = az webapp show --name $WebAppName --resource-group $ResourceGroupName 2>$null | ConvertFrom-Json
        }
        else {
            $webapp = az webapp deployment slot show --name $WebAppName --resource-group $ResourceGroupName --slot $SlotName 2>$null | ConvertFrom-Json
        }
        
        if ($null -eq $webapp) {
            if ([string]::IsNullOrWhiteSpace($SlotName)) {
                Write-Error-Custom "Web App '$WebAppName' not found in resource group '$ResourceGroupName'."
            }
            else {
                Write-Error-Custom "Deployment slot '$SlotName' not found for Web App '$WebAppName' in resource group '$ResourceGroupName'."
            }
            return $false
        }
        
        Write-Info "Web App validated successfully."
        Write-Info "  Status: $($webapp.state)"
        Write-Info "  Location: $($webapp.location)"
        Write-Info "  URL: https://$($webapp.defaultHostName)"
        
        return $true
    }
    catch {
        Write-Error-Custom "Failed to validate Web App: $($_.Exception.Message)"
        return $false
    }
}

# Function to validate release directory
function Test-ReleaseDirectory {
    param (
        [string]$Path
    )
    
    $fullPath = Join-Path $PSScriptRoot $Path
    
    if (-not (Test-Path $fullPath)) {
        Write-Error-Custom "Release directory not found: $fullPath"
        Write-Info "Please build your application first using: .\scripts\Build\BuildRelease.ps1"
        return $false
    }
    
    # Check for essential files
    $indexHtml = Join-Path $fullPath "index.html"
    if (-not (Test-Path $indexHtml)) {
        Write-Error-Custom "index.html not found in release directory."
        return $false
    }
    
    Write-Info "Release directory validated: $fullPath"
    
    # List contents for verification
    $files = Get-ChildItem $fullPath -File | Select-Object -First 10
    Write-Info "Release contents (first 10 files):"
    foreach ($file in $files) {
        Write-Info "  $($file.Name) ($([math]::Round($file.Length / 1KB, 2)) KB)"
    }
    
    return $true
}

# Function to deploy using Zip Deploy
function Deploy-ZipDeploy {
    param (
        [string]$WebAppName,
        [string]$ResourceGroupName,
        [string]$ReleasePath,
        [string]$SlotName
    )
    
    Write-Info "Deploying using Zip Deploy method..."
    
    $fullPath = Join-Path $PSScriptRoot $ReleasePath
    $tempZip = [System.IO.Path]::GetTempFileName() + ".zip"
    
    try {
        # Create ZIP file
        Write-Info "Creating deployment package..."
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::CreateFromDirectory($fullPath, $tempZip)
        
        $zipSize = [math]::Round((Get-Item $tempZip).Length / 1MB, 2)
        Write-Info "Deployment package created: $zipSize MB"
        
        # Deploy ZIP file
        Write-Info "Uploading and deploying application..."
        
        if ([string]::IsNullOrWhiteSpace($SlotName)) {
            az webapp deployment source config-zip --name $WebAppName --resource-group $ResourceGroupName --src $tempZip
        }
        else {
            az webapp deployment source config-zip --name $WebAppName --resource-group $ResourceGroupName --slot $SlotName --src $tempZip
        }
        
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Deployment completed successfully!" "Green"
            return $true
        }
        else {
            Write-Error-Custom "Deployment failed with exit code: $LASTEXITCODE"
            return $false
        }
    }
    catch {
        Write-Error-Custom "Deployment failed: $($_.Exception.Message)"
        return $false
    }
    finally {
        # Clean up temporary ZIP file
        if (Test-Path $tempZip) {
            Remove-Item $tempZip -Force
        }
    }
}

# Function to restart Web App
function Restart-WebApp {
    param (
        [string]$WebAppName,
        [string]$ResourceGroupName,
        [string]$SlotName
    )
    
    if (-not $RestartAfterDeploy) {
        return $true
    }
    
    Write-Info "Restarting Web App..."
    
    try {
        if ([string]::IsNullOrWhiteSpace($SlotName)) {
            az webapp restart --name $WebAppName --resource-group $ResourceGroupName
        }
        else {
            az webapp restart --name $WebAppName --resource-group $ResourceGroupName --slot $SlotName
        }
        
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Web App restarted successfully."
            return $true
        }
        else {
            Write-Warning-Custom "Failed to restart Web App, but deployment may still be successful."
            return $true
        }
    }
    catch {
        Write-Warning-Custom "Failed to restart Web App: $($_.Exception.Message)"
        return $true
    }
}

# Function to validate deployment
function Test-Deployment {
    param (
        [string]$WebAppName,
        [string]$ResourceGroupName,
        [string]$SlotName
    )
    
    Write-Info "Validating deployment..."
    
    try {
        if ([string]::IsNullOrWhiteSpace($SlotName)) {
            $webapp = az webapp show --name $WebAppName --resource-group $ResourceGroupName | ConvertFrom-Json
            $url = "https://$($webapp.defaultHostName)"
        }
        else {
            $slot = az webapp deployment slot show --name $WebAppName --resource-group $ResourceGroupName --slot $SlotName | ConvertFrom-Json
            $url = "https://$($slot.defaultHostName)"
        }
        
        Write-Info "Testing application URL: $url"
        
        # Test HTTP response
        try {
            $response = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 30 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                Write-Info "✅ Application is responding successfully!" "Green"
                Write-Info "🌐 Your workload is available at: $url" "Green"
            }
            else {
                Write-Warning-Custom "Application responded with status code: $($response.StatusCode)"
            }
        }
        catch {
            Write-Warning-Custom "Unable to verify application response. It may still be starting up."
            Write-Info "Please check the application manually at: $url"
        }
        
        return $true
    }
    catch {
        Write-Warning-Custom "Failed to validate deployment: $($_.Exception.Message)"
        return $true
    }
}

# Resolve manifest package path from explicit input or newest release package.
function Resolve-ManifestPackagePath {
    param (
        [string]$ManifestPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ManifestPath)) {
        $explicitPath = Join-Path $PSScriptRoot $ManifestPath
        if (Test-Path $explicitPath) {
            return $explicitPath
        }
        return $null
    }

    $releaseRoot = Join-Path $PSScriptRoot "..\..\release"
    if (-not (Test-Path $releaseRoot)) {
        return $null
    }

    $manifestCandidates = Get-ChildItem -Path $releaseRoot -Filter "*.nupkg" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending

    if ($manifestCandidates.Count -eq 0) {
        return $null
    }

    return $manifestCandidates[0].FullName
}

# Function to prepare manifest publication information
function Deploy-Manifest {
    param (
        [string]$ManifestPath
    )
    
    Write-Info "Publishing Manifest to Fabric..." "Yellow"
    
    $manifestFile = Resolve-ManifestPackagePath -ManifestPath $ManifestPath
    
    if (-not [string]::IsNullOrWhiteSpace($manifestFile) -and (Test-Path $manifestFile)) {
        $manifestInfo = Get-Item $manifestFile
        $manifestSize = [math]::Round($manifestInfo.Length / 1KB, 2)
        
        Write-Info "✅ Manifest package found:" "Green"
        Write-Info "   📦 File: $($manifestInfo.FullName)" "Green"
        Write-Info "   📏 Size: $manifestSize KB" "Green"
        Write-Info "   📅 Modified: $($manifestInfo.LastWriteTime)" "Green"
        Write-Info ""
        
        Write-Warning-Custom "MANUAL ACTION REQUIRED"
        Write-Info "Publish the manifest package in Microsoft Fabric Admin portal:" "Cyan"
        Write-Info "      1. Open Microsoft Fabric Admin Portal" "Cyan"
        Write-Info "      2. Navigate to Workload Management" "Cyan"
        Write-Info "      3. Upload manifest: $($manifestInfo.FullName)" "Cyan"
        Write-Info "      4. Configure workload settings and permissions" "Cyan"
        Write-Info ""
    }
    else {
        Write-Error-Custom "❌ Manifest file not found in release folder."
        Write-Info "Please build the manifest first using: .\scripts\Build\BuildManifestPackage.ps1"
        Write-Info ""
        Write-Warning-Custom "Build and upload manifest package:"
        Write-Info "      1. Run: .\scripts\Build\BuildManifestPackage.ps1" "Cyan"
        Write-Info "      2. Go to Microsoft Fabric Admin Portal" "Cyan"
        Write-Info "      3. Upload the generated manifest package" "Cyan"
        return $false
    }
    
    return $true
}

# Run manifest preflight checks before printing publication instructions.
function Invoke-ManifestPreflight {
    param (
        [string]$ManifestPath
    )

    $preflightScript = Join-Path $PSScriptRoot "TestFabricManifestPackage.ps1"
    if (-not (Test-Path $preflightScript)) {
        Write-Error-Custom "Manifest preflight script not found: $preflightScript"
        return $false
    }

    try {
        if (-not [string]::IsNullOrWhiteSpace($ManifestPath)) {
            & $preflightScript -ManifestPath $ManifestPath
        }
        else {
            & $preflightScript
        }

        if ($LASTEXITCODE -ne 0) {
            Write-Error-Custom "Manifest preflight failed with exit code: $LASTEXITCODE"
            return $false
        }

        return $true
    }
    catch {
        Write-Error-Custom "Manifest preflight execution failed: $($_.Exception.Message)"
        return $false
    }
}

# Main execution
Write-Info "=== Microsoft Fabric Workload Deployment ===" "Cyan"
Write-Info ""

# Validate parameters
if ([string]::IsNullOrWhiteSpace($WebAppName)) {
    Write-Error-Custom "WebAppName parameter is required."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($ResourceGroupName)) {
    Write-Error-Custom "ResourceGroupName parameter is required."
    exit 1
}

# Display configuration
Write-Info "Deployment Configuration:" "Yellow"
Write-Info "  Web App Name: $WebAppName"
Write-Info "  Resource Group: $ResourceGroupName"
if (-not [string]::IsNullOrWhiteSpace($SlotName)) {
    Write-Info "  Deployment Slot: $SlotName"
}
Write-Info "  Release Path: $ReleasePath"
Write-Info "  Deployment Method: $DeploymentMethod"
Write-Info "  Restart After Deploy: $RestartAfterDeploy"
Write-Info "  Deploy Manifest: $DeployManifest"
if (-not [string]::IsNullOrWhiteSpace($ManifestPath)) {
    Write-Info "  Manifest Path: $ManifestPath"
}
Write-Info ""

# Confirm deployment unless Force is specified
if (-not $Force) {
    $confirmation = Read-Host "Do you want to proceed with the deployment? (y/n)"
    if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
        Write-Info "Deployment cancelled."
        exit 0
    }
}

$deploymentStartTime = Get-Date

try {
    # Validate prerequisites
    Write-Info "=== Validating Prerequisites ===" "Yellow"
    Test-AzureCLI
    
    if (-not (Test-ReleaseDirectory -Path $ReleasePath)) {
        exit 1
    }
    
    if (-not (Test-WebApp -WebAppName $WebAppName -ResourceGroupName $ResourceGroupName -SlotName $SlotName)) {
        exit 1
    }
    
    Write-Info ""
    
    # Deploy application
    Write-Info "=== Deploying Application ===" "Yellow"
    $deploySuccess = $false
    
    switch ($DeploymentMethod) {
        "ZipDeploy" {
            $deploySuccess = Deploy-ZipDeploy -WebAppName $WebAppName -ResourceGroupName $ResourceGroupName -ReleasePath $ReleasePath -SlotName $SlotName
        }
        "FTP" {
            Write-Error-Custom "FTP deployment method is not yet implemented. Please use ZipDeploy."
            exit 1
        }
        "LocalGit" {
            Write-Error-Custom "LocalGit deployment method is not yet implemented. Please use ZipDeploy."
            exit 1
        }
        default {
            Write-Error-Custom "Unknown deployment method: $DeploymentMethod"
            exit 1
        }
    }
    
    if (-not $deploySuccess) {
        Write-Error-Custom "Deployment failed!"
        exit 1
    }
    
    Write-Info ""
    
    # Restart Web App
    Write-Info "=== Restarting Web App ===" "Yellow"
    Restart-WebApp -WebAppName $WebAppName -ResourceGroupName $ResourceGroupName -SlotName $SlotName
    Write-Info ""
    
    # Validate deployment
    Write-Info "=== Validating Deployment ===" "Yellow"
    Test-Deployment -WebAppName $WebAppName -ResourceGroupName $ResourceGroupName -SlotName $SlotName
    Write-Info ""
    
    $resolvedManifestPath = $null
    if ($DeployManifest) {
        Write-Info "=== Manifest Preflight ===" "Yellow"
        if (-not (Invoke-ManifestPreflight -ManifestPath $ManifestPath)) {
            exit 1
        }
        Write-Info ""

        Write-Info "=== Manifest Publication Instructions ===" "Yellow"
        $resolvedManifestPath = Resolve-ManifestPackagePath -ManifestPath $ManifestPath
        Deploy-Manifest -ManifestPath $ManifestPath
        Write-Info ""
    }

    # Final summary
    $deploymentDuration = (Get-Date) - $deploymentStartTime
    Write-Info "=== Deployment Complete ===" "Green"
    Write-Info "✅ Successfully deployed to Azure Web App!" "Green"
    Write-Info "⏱️  Total deployment time: $($deploymentDuration.Minutes)m $($deploymentDuration.Seconds)s" "Green"
    
    if ([string]::IsNullOrWhiteSpace($SlotName)) {
        Write-Info "🌐 Your workload is available at: https://$WebAppName.azurewebsites.net" "Green"
    }
    else {
        Write-Info "🌐 Your workload is available at: https://$WebAppName-$SlotName.azurewebsites.net" "Green"
    }
    
    Write-Info ""
    Write-Info "Next steps:" "Yellow"
    Write-Info "1. Test your workload functionality in the browser"
    if ($DeployManifest) {
        Write-Info "2. Publish manifest in Fabric Admin portal using the package below:" "Yellow"
        if (-not [string]::IsNullOrWhiteSpace($resolvedManifestPath)) {
            Write-Info "   📦 Manifest location: $resolvedManifestPath" "Yellow"
        }
        else {
            Write-Info "   📦 Manifest location: (no .nupkg found in release folder)" "Yellow"
        }
    }
    if ($DeployManifest) {
        Write-Info "2. Test item creation and functionality in Microsoft Fabric"
    }
    else {
        Write-Info "2. Test item creation and functionality in Microsoft Fabric"
    }
    
}
catch {
    Write-Error-Custom "Deployment failed with error: $($_.Exception.Message)"
    exit 1
}