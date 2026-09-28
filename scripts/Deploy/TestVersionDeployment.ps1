param(
    [Parameter(Mandatory = $true)]
    [string]$WorkloadName,

    [Parameter(Mandatory = $true)]
    [string]$TenantId,

    [string]$FrontendAppId = "",

    [string]$ApplicationName,

    [string]$WorkloadVersion = "1.0.0",

    [string]$Environment = "prod",

    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string]$WebAppName,

    [string]$Location = "eastus",

    [string]$AppServicePlanName = "",

    [string]$SubscriptionId = "",

    [switch]$Force,

    [ValidateSet("create", "reuse")]
    [string]$AppRegistrationMode = "create",

    [ValidateSet("create", "reuse")]
    [string]$WebAppMode = "create",

)

function Write-Info {
    param(
        [string]$Message,
        [string]$Color = "Green"
    )

    Write-Host $Message -ForegroundColor $Color
}

function Write-Warn {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
}

function Test-AzureCli {
    try {
        $null = az --version
    }
    catch {
        throw "Azure CLI is required. Install Azure CLI and try again."
    }

    $account = az account show 2>$null | ConvertFrom-Json
    if (-not $account) {
        Write-Warn "Azure CLI is not logged in. Launching az login..."
        az login --allow-no-subscriptions | Out-Null
    }

    if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
        az account set --subscription $SubscriptionId | Out-Null
    }
}

function New-AzureResourceGroup {
    param(
        [string]$Name,
        [string]$Region
    )

    $existing = az group show --name $Name 2>$null | ConvertFrom-Json
    if ($existing) {
        Write-Info "Resource group exists: $Name"
        return
    }

    Write-Info "Creating resource group: $Name"
    az group create --name $Name --location $Region | Out-Null
}

function New-AzureAppServicePlan {
    param(
        [string]$Name,
        [string]$GroupName,
        [string]$Region
    )

    $existing = az appservice plan show --name $Name --resource-group $GroupName 2>$null | ConvertFrom-Json
    if ($existing) {
        Write-Info "App Service plan exists: $Name"
        return
    }

    Write-Info "Creating App Service plan: $Name"
    az appservice plan create --name $Name --resource-group $GroupName --location $Region --sku B1 | Out-Null
}

function New-AzureWebApp {
    param(
        [string]$Name,
        [string]$GroupName,
        [string]$PlanName
    )

    $existing = az webapp show --name $Name --resource-group $GroupName 2>$null | ConvertFrom-Json
    if ($existing) {
        Write-Info "Web App exists: $Name"
        return
    }

    Write-Info "Creating Web App: $Name"
    az webapp create --name $Name --resource-group $GroupName --plan $PlanName | Out-Null
}

function Resolve-ScriptPath {
    param([string]$RelativePath)
    return (Join-Path $PSScriptRoot $RelativePath)
}

if ([string]::IsNullOrWhiteSpace($ApplicationName)) {
    $ApplicationName = $WorkloadName
}

if ([string]::IsNullOrWhiteSpace($AppServicePlanName)) {
    $sanitizedWorkloadName = ($WorkloadName -replace '[^a-zA-Z0-9-]', '-').ToLowerInvariant()
    $AppServicePlanName = "$sanitizedWorkloadName-plan"
}

$CreateAppRegistration = $AppRegistrationMode -eq "create"
$CreateWebApp = $WebAppMode -eq "create"

Write-Info "=== Test Version Deployment ===" "Cyan"
Write-Info "Workload Name: $WorkloadName"
Write-Info "Environment: $Environment"
Write-Info "Resource Group: $ResourceGroupName"
Write-Info "Web App Name: $WebAppName"
Write-Info "App Service Plan: $AppServicePlanName"
Write-Info ""

if (-not $Force) {
    $confirmation = Read-Host "Proceed with test-version deployment? (y/n)"
    if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
        Write-Info "Deployment cancelled."
        exit 0
    }
}

try {
    Test-AzureCli

    $createAppScript = Resolve-ScriptPath "..\Setup\CreateDevAADApp.ps1"
    if ($CreateAppRegistration) {
        if (-not (Test-Path $createAppScript)) {
            throw "CreateDevAADApp.ps1 not found: $createAppScript"
        }

        if ([string]::IsNullOrWhiteSpace($FrontendAppId)) {
            Write-Info "Creating frontend app registration..."
            $FrontendAppId = & $createAppScript -HostingType "FERemote" -ApplicationName $ApplicationName -WorkloadName $WorkloadName -TenantId $TenantId
        }
        else {
            Write-Info "Using existing frontend app registration: $FrontendAppId"
        }
    }
    elseif ([string]::IsNullOrWhiteSpace($FrontendAppId)) {
        throw "FrontendAppId is required when app registration creation is disabled."
    }

    $buildReleaseScript = Resolve-ScriptPath "..\Build\BuildRelease.ps1"
    if (-not (Test-Path $buildReleaseScript)) {
        throw "BuildRelease.ps1 not found: $buildReleaseScript"
    }

    Write-Info "Building release package..."
    & $buildReleaseScript `
        -WorkloadName $WorkloadName `
        -FrontendAppId $FrontendAppId `
        -WorkloadVersion $WorkloadVersion `
        -Environment $Environment

    $releaseAppPath = Resolve-ScriptPath "..\..\release\app"
    if (-not (Test-Path $releaseAppPath)) {
        throw "Release app folder not found: $releaseAppPath"
    }

    if ($CreateWebApp) {
        New-AzureResourceGroup -Name $ResourceGroupName -Region $Location
        New-AzureAppServicePlan -Name $AppServicePlanName -GroupName $ResourceGroupName -Region $Location
        New-AzureWebApp -Name $WebAppName -GroupName $ResourceGroupName -PlanName $AppServicePlanName
    }

    $deployScript = Resolve-ScriptPath "DeployToAzureWebApp.ps1"
    if (-not (Test-Path $deployScript)) {
        throw "DeployToAzureWebApp.ps1 not found: $deployScript"
    }

    Write-Info "Deploying release to Azure Web App..."
    & $deployScript `
        -WebAppName $WebAppName `
        -ResourceGroupName $ResourceGroupName `
        -ReleasePath "..\..\release\app" `
        -Force:$true `
        -DeployManifest:$true `
        -SubscriptionId $SubscriptionId `
        

    if ($LASTEXITCODE -ne 0) {
        throw "Deployment failed with exit code $LASTEXITCODE"
    }

    Write-Info ""
    Write-Info "=== Test Version Ready ===" "Green"
    Write-Info "Frontend App ID: $FrontendAppId" "Green"
    Write-Info "Web App: $WebAppName" "Green"
    Write-Info "Manifest package: release\$WorkloadName.$WorkloadVersion.nupkg" "Green"
    Write-Info "Next step: upload the validated manifest package in the Fabric Admin portal." "Green"
}
catch {
    Write-Fail $_.Exception.Message
    exit 1
}
