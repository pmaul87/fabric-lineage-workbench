param(
    [Parameter(Mandatory = $false)]
    [string]$AppId = "7c7d00e3-5752-455f-8d27-34415e95b54d",

    [Parameter(Mandatory = $true)]
    [string]$TenantId,

    [Parameter(Mandatory = $false)]
    [string[]]$AdditionalWorkloadSignInTenantIds = @(),

    [Parameter(Mandatory = $true)]
    [string]$WorkloadName,

    [Parameter(Mandatory = $false)]
    [string[]]$AdditionalWorkloadNames = @(),

    [Parameter(Mandatory = $true)]
    [string]$FrontendBaseUrl,

    [Parameter(Mandatory = $false)]
    [string[]]$AdditionalFrontendBaseUrls = @(),

    [Parameter(Mandatory = $false)]
    [ValidateSet("AzureADMyOrg", "AzureADMultipleOrgs")]
    [string]$SignInAudience = "AzureADMultipleOrgs",

    [Parameter(Mandatory = $false)]
    [switch]$IncludeMsitRedirects,

    [Parameter(Mandatory = $false)]
    [switch]$SkipAdminConsent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Normalize-StringArray {
    param(
        [AllowEmptyCollection()]
        [string[]]$Values
    )

    $items = @($Values) | Where-Object { $_ -and $_.Trim().Length -gt 0 } | ForEach-Object { $_.Trim() } | Select-Object -Unique
    return @($items)
}

function Get-CollectionCount {
    param($Value)

    if ($null -eq $Value) {
        return 0
    }

    $items = @($Value) | Where-Object { $null -ne $_ }
    return @($items).Count
}

function Invoke-GraphGet {
    param([string]$Url)
    $json = az rest --method GET --url "$Url"
    if (-not $json) {
        throw "Empty response from Graph GET $Url"
    }
    return ($json | ConvertFrom-Json)
}

function Invoke-GraphPatch {
    param(
        [string]$Url,
        [hashtable]$Body
    )

    $tempFile = [System.IO.Path]::GetTempFileName()
    try {
        $Body | ConvertTo-Json -Depth 20 | Out-File -FilePath $tempFile -Encoding utf8
        $patchOutput = az rest --method PATCH --url "$Url" --headers "Content-Type=application/json" --body "@$tempFile" 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Graph PATCH failed: $patchOutput"
        }
    }
    finally {
        if (Test-Path $tempFile) {
            Remove-Item $tempFile -Force
        }
    }
}

function Get-ScopeMapForResource {
    param([string]$ResourceAppId)

    $spUrl = "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId%20eq%20'$ResourceAppId'"
    $spResponse = Invoke-GraphGet -Url $spUrl
    $sp = $spResponse.value | Select-Object -First 1
    if (-not $sp) {
        throw "Service principal with appId $ResourceAppId was not found."
    }

    $map = @{}
    foreach ($scope in ($sp.oauth2PermissionScopes | Where-Object { $_.isEnabled -eq $true })) {
        if ($scope.value) {
            $map[$scope.value] = $scope.id
        }
    }

    return $map
}

function Ensure-ResourceScopes {
    param(
        [hashtable]$ScopeMap,
        [string[]]$ScopeValues,
        [string]$ResourceAppId,
        [string]$ResourceName
    )

    $resourceAccess = @()

    foreach ($scopeValue in $ScopeValues) {
        if ($ScopeMap.ContainsKey($scopeValue)) {
            $resourceAccess += @{
                id = $ScopeMap[$scopeValue]
                type = "Scope"
            }
        }
        else {
            Write-Warn "Scope '$scopeValue' was not found for $ResourceName ($ResourceAppId)."
        }
    }

    if ((Get-CollectionCount $resourceAccess) -eq 0) {
        throw "No valid scopes were resolved for resource $ResourceName ($ResourceAppId)."
    }

    return @{
        resourceAppId = $ResourceAppId
        resourceAccess = $resourceAccess
    }
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Azure CLI (az) is required. Install it and run 'az login'."
}

Write-Info "Checking Azure CLI sign-in status"
az account show | Out-Null

if ($TenantId -match "<your-tenant-guid>" -or $TenantId -match "YOUR_TENANT") {
    throw "Please replace the placeholder TenantId value with your real tenant GUID before running this script."
}

$frontends = Normalize-StringArray -Values (@($FrontendBaseUrl) + @($AdditionalFrontendBaseUrls))
$frontends = @($frontends | ForEach-Object { $_.Trim().TrimEnd("/") })
if ((Get-CollectionCount $frontends) -eq 0) {
    throw "At least one FrontendBaseUrl must be provided."
}

foreach ($frontendCandidate in $frontends) {
    if (-not ($frontendCandidate -match "^https://")) {
        throw "FrontendBaseUrl must start with https:// (example: https://your-app.azurestaticapps.net)."
    }
}

$workloadNames = Normalize-StringArray -Values (@($WorkloadName) + @($AdditionalWorkloadNames))
if ((Get-CollectionCount $workloadNames) -eq 0) {
    throw "At least one workload name must be provided."
}

foreach ($workloadNameCandidate in $workloadNames) {
    if (-not ($workloadNameCandidate -match "^[^.]+\.[^.]+$")) {
        throw "WorkloadName must have two segments (example: Contoso.LineageWorkbench)."
    }
}

$frontend = $frontends[0]

Write-Info "Loading target app registration $AppId"
$appUrl = "https://graph.microsoft.com/v1.0/applications?`$filter=appId%20eq%20'$AppId'"
$appResponse = Invoke-GraphGet -Url $appUrl
$app = $appResponse.value | Select-Object -First 1
$appObjectId = $app.id

if (-not $appObjectId) {
    throw "Could not resolve application object id for appId $AppId."
}

Write-Info "Resolving delegated scope IDs"
$powerBiResourceAppId = "00000009-0000-0000-c000-000000000000"
$graphResourceAppId = "00000003-0000-0000-c000-000000000000"
$storageResourceAppId = "e406a681-f3d4-42a8-90b6-c2b029497af1"

$powerBiScopeMap = Get-ScopeMapForResource -ResourceAppId $powerBiResourceAppId
$graphScopeMap = Get-ScopeMapForResource -ResourceAppId $graphResourceAppId
$storageScopeMap = Get-ScopeMapForResource -ResourceAppId $storageResourceAppId

$requiredPowerBiScopes = @(
    "Fabric.Extend",
    "Workspace.Read.All",
    "Item.Read.All",
    "Item.ReadWrite.All",
    "Item.Execute.All",
    "Item.Reshare.All",
    "Lakehouse.Read.All",
    "Eventhouse.Read.All",
    "KQLDatabase.ReadWrite.All",
    "Dataset.Read.All",
    "Report.Read.All"
)

$requiredGraphScopes = @(
    "User.Read"
)

$requiredStorageScopes = @(
    "user_impersonation"
)

$powerBiAccess = Ensure-ResourceScopes -ScopeMap $powerBiScopeMap -ScopeValues $requiredPowerBiScopes -ResourceAppId $powerBiResourceAppId -ResourceName "Power BI / Fabric"
$graphAccess = Ensure-ResourceScopes -ScopeMap $graphScopeMap -ScopeValues $requiredGraphScopes -ResourceAppId $graphResourceAppId -ResourceName "Microsoft Graph"
$storageAccess = Ensure-ResourceScopes -ScopeMap $storageScopeMap -ScopeValues $requiredStorageScopes -ResourceAppId $storageResourceAppId -ResourceName "Azure Storage"

$workloadSignInTenantIds = Normalize-StringArray -Values (@($TenantId) + @($AdditionalWorkloadSignInTenantIds))

$redirectUris = @()
foreach ($frontendUrl in $frontends) {
    $redirectUris += @(
        "$frontendUrl",
        "$frontendUrl/",
        "$frontendUrl/close"
    )
}

foreach ($workloadTenantId in $workloadSignInTenantIds) {
    foreach ($workloadNameValue in $workloadNames) {
        $redirectUris += @(
            "https://app.powerbi.com/workloadSignIn/$workloadTenantId/$workloadNameValue",
            "https://app.fabric.microsoft.com/workloadSignIn/$workloadTenantId/$workloadNameValue"
        )
    }
}

if ($IncludeMsitRedirects) {
    foreach ($workloadNameValue in $workloadNames) {
        $redirectUris += @(
            "https://msit.powerbi.com/workloadSignIn/$TenantId/$workloadNameValue",
            "https://msit.fabric.microsoft.com/workloadSignIn/$TenantId/$workloadNameValue"
        )
    }
}

$redirectUris = $redirectUris | Select-Object -Unique

$currentOtherResources = @()
foreach ($entry in @($app.requiredResourceAccess | Where-Object {
    $_.resourceAppId -ne $powerBiResourceAppId -and
    $_.resourceAppId -ne $graphResourceAppId -and
    $_.resourceAppId -ne $storageResourceAppId
})) {
    $currentOtherResources += $entry
}

$updatedRequiredResourceAccess = @(
    $powerBiAccess,
    $graphAccess,
    $storageAccess
) + $currentOtherResources

$patchBody = @{
    signInAudience = $SignInAudience
    spa = @{
        redirectUris = $redirectUris
    }
    optionalClaims = @{
        accessToken = @(
            @{
                essential = $false
                name = "idtyp"
            }
        )
    }
    requiredResourceAccess = $updatedRequiredResourceAccess
}

Write-Info "Updating app registration settings and API permissions"
Invoke-GraphPatch -Url "https://graph.microsoft.com/v1.0/applications/$appObjectId" -Body $patchBody

Write-Info "Update complete"
Write-Host ""
Write-Host "Updated App: $($app.displayName) ($AppId)" -ForegroundColor Green
Write-Host "SignInAudience: $SignInAudience" -ForegroundColor Green
Write-Host "Redirect URIs:" -ForegroundColor Green
$redirectUris | ForEach-Object { Write-Host "  - $_" -ForegroundColor Green }
Write-Host ""

if (-not $SkipAdminConsent) {
    Write-Info "Attempting admin consent (requires tenant admin rights)"
    try {
        az ad app permission admin-consent --id $AppId | Out-Null
        Write-Host "Admin consent granted successfully." -ForegroundColor Green
    }
    catch {
        Write-Warn "Admin consent command failed. Run manually with a tenant admin account:"
        Write-Host "  az ad app permission admin-consent --id $AppId" -ForegroundColor Yellow
        Write-Host "Or open: https://login.microsoftonline.com/$TenantId/adminconsent?client_id=$AppId" -ForegroundColor Yellow
    }
}
else {
    Write-Warn "Skipped admin consent by request."
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
