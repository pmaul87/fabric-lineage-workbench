param (
    # Optional explicit path to a manifest package (.nupkg). If omitted, newest package under release/ is used.
    [string]$ManifestPath = ""
)

<#!
.SYNOPSIS
    Validates a Fabric workload manifest package (.nupkg) and prints an admin publication checklist.

.DESCRIPTION
    This script performs lightweight preflight checks for customer self-host deployments:
      - Locates a manifest package
      - Verifies file extension, size, and ZIP integrity
      - Checks for required entries like WorkloadManifest.xml and Product.json
      - Prints SHA256 and a concise Fabric Admin publication checklist
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

function Resolve-ManifestPackagePath {
    param([string]$PathInput)

    if (-not [string]::IsNullOrWhiteSpace($PathInput)) {
        if (Test-Path $PathInput) {
            return (Resolve-Path $PathInput).Path
        }

        $relativeToScript = Join-Path $PSScriptRoot $PathInput
        if (Test-Path $relativeToScript) {
            return (Resolve-Path $relativeToScript).Path
        }

        return $null
    }

    $releaseRoot = Join-Path $PSScriptRoot "..\..\release"
    if (-not (Test-Path $releaseRoot)) {
        return $null
    }

    $packages = @(Get-ChildItem -Path $releaseRoot -Filter "*.nupkg" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending)

    if ($packages.Count -eq 0) {
        return $null
    }

    return $packages[0].FullName
}

function Get-PackageEntries {
    param([string]$PackagePath)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        return @($zip.Entries | ForEach-Object { $_.FullName })
    }
    finally {
        $zip.Dispose()
    }
}

Write-Info "=== Fabric Manifest Package Preflight ===" "Cyan"

$resolvedPath = Resolve-ManifestPackagePath -PathInput $ManifestPath
if ([string]::IsNullOrWhiteSpace($resolvedPath)) {
    Write-Fail "Manifest package not found."
    Write-Info "Run scripts/Build/BuildRelease.ps1 first, or pass -ManifestPath to this script." "Yellow"
    exit 1
}

$package = Get-Item $resolvedPath
if ($package.Extension -ne ".nupkg") {
    Write-Fail "Expected a .nupkg file, got: $($package.Extension)"
    exit 1
}

if ($package.Length -le 0) {
    Write-Fail "Manifest package is empty: $resolvedPath"
    exit 1
}

$entries = Get-PackageEntries -PackagePath $resolvedPath
$requiredSuffixes = @(
    "WorkloadManifest.xml",
    "Product.json"
)

$optionalSuffixes = @(
    "WorkloadDefinition.xsd",
    "ItemDefinition.xsd"
)

$missing = @()
foreach ($suffix in $requiredSuffixes) {
    $hasEntry = $entries | Where-Object { $_ -like "*$suffix" } | Select-Object -First 1
    if (-not $hasEntry) {
        $missing += $suffix
    }
}

$missingOptional = @()
foreach ($suffix in $optionalSuffixes) {
    $hasEntry = $entries | Where-Object { $_ -like "*$suffix" } | Select-Object -First 1
    if (-not $hasEntry) {
        $missingOptional += $suffix
    }
}

$sha256 = (Get-FileHash -Path $resolvedPath -Algorithm SHA256).Hash

Write-Info "Package: $resolvedPath"
Write-Info "Size (KB): $([math]::Round($package.Length / 1KB, 2))"
Write-Info "Last Modified: $($package.LastWriteTimeUtc.ToString('u'))"
Write-Info "Entries: $($entries.Count)"
Write-Info "SHA256: $sha256"

if ($missing.Count -gt 0) {
    Write-Fail "Preflight failed: required manifest entries are missing."
    foreach ($name in $missing) {
        Write-Fail "  - $name"
    }
    Write-Info "Rebuild with scripts/Build/BuildRelease.ps1 and retry." "Yellow"
    exit 2
}

if ($missingOptional.Count -gt 0) {
    Write-Warn "Optional entries not found (this may be expected depending on packaging):"
    foreach ($name in $missingOptional) {
        Write-Warn "  - $name"
    }
}

Write-Info "Preflight checks passed." "Green"
Write-Info ""
Write-Info "Fabric Admin publication checklist:" "Cyan"
Write-Info "1. Open Microsoft Fabric Admin portal." "Cyan"
Write-Info "2. Navigate to Workload Management." "Cyan"
Write-Info "3. Upload package: $resolvedPath" "Cyan"
Write-Info "4. Activate uploaded version for target tenant." "Cyan"
Write-Info "5. Validate item creation and editor load in a test workspace." "Cyan"
