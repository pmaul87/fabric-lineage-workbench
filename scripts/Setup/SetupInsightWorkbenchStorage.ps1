<#
.SYNOPSIS
    Creates the OneLake folder structure required by Insight Workbench's
    OneLake persistence feature.

.DESCRIPTION
    This script uses the Microsoft Fabric OneLake DFS REST API to create all
    subfolders that InsightWorkbenchStorageService.ts expects to exist before
    it can write snapshot data.

    Run this once per Fabric item (or whenever you change the root folder).
    It is safe to run multiple times — existing folders are left unchanged.

.PARAMETER WorkspaceId
    GUID of the Microsoft Fabric workspace that contains the target item.

.PARAMETER ItemId
    GUID of the Insight Workbench Fabric item.

.PARAMETER RootFolder
    Root folder name **relative to Files/**. Defaults to "insight-workbench-data".
    The script will always prefix with "Files/" automatically.

.PARAMETER FabricToken
    Bearer token for the Fabric / OneLake REST API.
    Obtain via: az account get-access-token --resource https://storage.azure.com --query accessToken -o tsv

.PARAMETER OneLakeHost
    OneLake DFS endpoint. Default is "onelake.dfs.fabric.microsoft.com".

.EXAMPLE
    # Get a token and create the folder structure
    $token = az account get-access-token --resource https://storage.azure.com --query accessToken -o tsv
    .\SetupInsightWorkbenchStorage.ps1 `
        -WorkspaceId "11111111-2222-3333-4444-555555555555" `
        -ItemId      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" `
        -FabricToken $token

.NOTES
    Required permissions: Workspace Contributor or above.
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')]
    [string] $WorkspaceId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')]
    [string] $ItemId,

    [Parameter(Mandatory = $false)]
    [string] $RootFolder = "insight-workbench-data",

    [Parameter(Mandatory = $true)]
    [string] $FabricToken,

    [Parameter(Mandatory = $false)]
    [string] $OneLakeHost = "onelake.dfs.fabric.microsoft.com"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Get-OneLakeUri {
    param([string] $RelativePath)
    # Format: https://<host>/<workspaceId>/<itemId>/<relativePath>
    return "https://$OneLakeHost/$WorkspaceId/$ItemId/$RelativePath"
}

function Invoke-OneLakeRequest {
    param(
        [string] $Method,
        [string] $Uri,
        [hashtable] $ExtraHeaders = @{}
    )
    $headers = @{
        "Authorization" = "Bearer $FabricToken"
        "x-ms-version"  = "2023-01-03"
    }
    foreach ($key in $ExtraHeaders.Keys) { $headers[$key] = $ExtraHeaders[$key] }

    try {
        $response = Invoke-WebRequest -Method $Method -Uri $Uri -Headers $headers -UseBasicParsing
        return $response
    } catch {
        $statusCode = $_.Exception.Response?.StatusCode?.value__
        if ($null -ne $statusCode) { return $statusCode }
        throw
    }
}

function Ensure-Folder {
    param([string] $RelativePath)

    $uri = Get-OneLakeUri -RelativePath "${RelativePath}?resource=directory"

    # HEAD — check existence
    $headResponse = Invoke-OneLakeRequest -Method HEAD -Uri $uri
    if ($headResponse -is [int] -and $headResponse -eq 404) {
        # PUT — create directory
        if ($PSCmdlet.ShouldProcess($RelativePath, "Create OneLake directory")) {
            $putUri = Get-OneLakeUri -RelativePath "${RelativePath}?resource=directory"
            $putResponse = Invoke-OneLakeRequest -Method PUT -Uri $putUri
            $statusCode = if ($putResponse -is [int]) { $putResponse } else { [int]$putResponse.StatusCode }
            if ($statusCode -in @(200, 201)) {
                Write-Host "  [CREATED]  $RelativePath" -ForegroundColor Green
            } else {
                Write-Warning "  [WARN]     $RelativePath — unexpected status $statusCode"
            }
        }
    } elseif ($headResponse -is [int]) {
        Write-Warning "  [WARN]     HEAD $RelativePath returned $headResponse"
    } else {
        Write-Host "  [EXISTS]   $RelativePath" -ForegroundColor Cyan
    }
}

function Ensure-EmptyJson {
    param([string] $RelativePath, [string] $Content = "{}")

    $uri = Get-OneLakeUri -RelativePath $RelativePath

    # HEAD check
    $headResponse = Invoke-OneLakeRequest -Method HEAD -Uri $uri
    if ($headResponse -is [int] -and $headResponse -eq 404) {
        if ($PSCmdlet.ShouldProcess($RelativePath, "Create OneLake file")) {
            # Step 1 — create file
            $createUri  = Get-OneLakeUri -RelativePath "${RelativePath}?resource=file"
            Invoke-OneLakeRequest -Method PUT -Uri $createUri | Out-Null

            # Step 2 — append content
            $contentBytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
            $length       = $contentBytes.Length
            $appendUri    = Get-OneLakeUri -RelativePath "${RelativePath}?action=append&position=0"
            $appendHeaders = @{
                "Authorization" = "Bearer $FabricToken"
                "x-ms-version"  = "2023-01-03"
                "Content-Type"  = "application/octet-stream"
                "Content-Length" = "$length"
            }
            Invoke-WebRequest -Method PATCH -Uri $appendUri -Headers $appendHeaders `
                -Body $contentBytes -UseBasicParsing | Out-Null

            # Step 3 — flush
            $flushUri = Get-OneLakeUri -RelativePath "${RelativePath}?action=flush&position=$length"
            Invoke-OneLakeRequest -Method PATCH -Uri $flushUri | Out-Null

            Write-Host "  [CREATED]  $RelativePath" -ForegroundColor Green
        }
    } else {
        Write-Host "  [EXISTS]   $RelativePath" -ForegroundColor Cyan
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "  Insight Workbench — OneLake Storage Setup" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "  Workspace : $WorkspaceId"
Write-Host "  Item      : $ItemId"
Write-Host "  Root      : Files/$RootFolder"
Write-Host "  Host      : $OneLakeHost"
Write-Host ""

$root   = "Files/$RootFolder"
$sections = @("metadata", "semantic", "lineage", "reports", "tickets")

Write-Host "Creating root folder..." -ForegroundColor White
Ensure-Folder -RelativePath $root

foreach ($section in $sections) {
    Write-Host "Creating section: $section" -ForegroundColor White
    Ensure-Folder -RelativePath "$root/$section"
    Ensure-Folder -RelativePath "$root/$section/snapshots"
}

Write-Host "Creating raw artifact snapshot folders..." -ForegroundColor White
Ensure-Folder -RelativePath "$root/semantic/tmdl-snapshots"
Ensure-Folder -RelativePath "$root/reports/def-snapshots"

Write-Host "Creating index file..." -ForegroundColor White
Ensure-EmptyJson -RelativePath "$root/index.json" -Content '{"schemaVersion":"1","snapshots":[]}'
Ensure-EmptyJson -RelativePath "$root/entity-snapshot-index.json" -Content '{"schemaVersion":"1","snapshots":[]}'

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "  Setup complete. Folder tree:" -ForegroundColor Green
Write-Host ""
Write-Host "  Files/$RootFolder/"
foreach ($section in $sections) {
    Write-Host "    ├─ $section/"
    Write-Host "    │    └─ snapshots/"
}
Write-Host "    ├─ semantic/tmdl-snapshots/"
Write-Host "    ├─ reports/def-snapshots/"
Write-Host "    ├─ index.json"
Write-Host "    └─ entity-snapshot-index.json"
Write-Host ""
Write-Host "  You can now enable OneLake persistence in the workbench" -ForegroundColor Green
Write-Host "  and set the root folder to: Files/$RootFolder" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
