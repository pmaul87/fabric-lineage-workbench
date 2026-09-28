param (
    #Indicates if the files should be validated before building the package
    [boolean]$ValidateFiles = $false,
    [string]$Environment = "dev",
    [string]$WorkloadName,
    [string]$FrontendAppId,
    [string]$BackendAppId,
    [string]$WorkloadVersion
)

. (Join-Path $PSScriptRoot "..\Common\EnvHelpers.ps1")

Write-Host "Building Nuget Package ..."

################################################
# Load environment variables from .env file
################################################
$workloadRoot = Join-Path $PSScriptRoot "..\..\Workload"
$environmentConfig = Get-MergedEnvironmentConfig -WorkloadRoot $workloadRoot -EnvironmentName $Environment
$envVars = $environmentConfig.Values

if ($PSBoundParameters.ContainsKey('WorkloadName') -and $WorkloadName) {
    $envVars['WORKLOAD_NAME'] = $WorkloadName
}

if ($PSBoundParameters.ContainsKey('FrontendAppId') -and $FrontendAppId) {
    $envVars['FRONTEND_APPID'] = $FrontendAppId
}

if ($PSBoundParameters.ContainsKey('BackendAppId')) {
    $envVars['BACKEND_APPID'] = $BackendAppId
}

if ($PSBoundParameters.ContainsKey('WorkloadVersion') -and $WorkloadVersion) {
    $envVars['WORKLOAD_VERSION'] = $WorkloadVersion
}

Write-EnvironmentLoadSummary -Config $environmentConfig -Prefix "Loaded environment variables for $Environment"

################################################
# Copy template files to temp directory and replace variables
################################################
$templatePath = Join-Path $PSScriptRoot "..\..\Workload\Manifest"
# Use a unique system temp folder to avoid file locking issues
$guid = [Guid]::NewGuid().ToString()
$tempPath = Join-Path ([System.IO.Path]::GetTempPath()) "Fabric_Manifest_Build_$guid"
$outputDir = Join-Path $PSScriptRoot "..\..\build\Manifest\"

Write-Host "Using temporary directory: $tempPath"
New-Item -ItemType Directory -Path $tempPath -Force | Out-Null


Write-Host "Copying template files from $templatePath to $tempPath"

# Copy all template files to temp directory
Copy-Item -Path "$templatePath\*" -Destination $tempPath -Recurse -Force

# Check if assets folder exists and report
$assetsPath = Join-Path $tempPath "assets"
if (Test-Path $assetsPath) {
    $assetFiles = Get-ChildItem -Path $assetsPath -Recurse -File
    Write-Host "Copied $($assetFiles.Count) asset files (images, etc.) without modification"
}

# Move all JSON and XML files from items subdirectories to root temp directory
# Only process items that are configured in ITEM_NAMES environment variable
$itemsPath = Join-Path $tempPath "items"
if (Test-Path $itemsPath) {
    # Parse ITEM_NAMES from environment variables (comma-separated list)
    $configuredItems = @()
    if ($envVars.ContainsKey('ITEM_NAMES')) {
        $configuredItems = $envVars['ITEM_NAMES'] -split ',' | ForEach-Object { 
            $itemName = $_.Trim()
            # Add "Item" suffix to match folder naming convention
            if (-not $itemName.EndsWith('Item')) {
                $itemName = $itemName + 'Item'
            }
            $itemName
        }
        Write-Host "Configured items from ITEM_NAMES: $($configuredItems -join ', ')"
    } else {
        Write-Warning "ITEM_NAMES not found in environment variables. No items will be processed."
    }
    
    if ($configuredItems.Count -gt 0) {
        $itemFiles = Get-ChildItem -Path $itemsPath -Recurse -Include "*.json", "*.xml" | Where-Object { $_.FullName -notlike "*\ItemDefinition\*" }
        
        # Filter to only include configured items
        $filteredItemFiles = $itemFiles | Where-Object {
            $itemFolderName = Split-Path (Split-Path $_.FullName -Parent) -Leaf
            $configuredItems -contains $itemFolderName
        }
        
        if ($filteredItemFiles.Count -gt 0) {
            Write-Host "Moving $($filteredItemFiles.Count) item configuration files to root directory (from configured items only)..."
            
            foreach ($itemFile in $filteredItemFiles) {
                $destinationPath = Join-Path $tempPath $itemFile.Name
                
                # Handle duplicate names by adding item folder name as prefix
                if (Test-Path $destinationPath) {
                    $itemFolderName = Split-Path (Split-Path $itemFile.FullName -Parent) -Leaf
                    $destinationPath = Join-Path $tempPath "$itemFolderName$($itemFile.Name)"
                    Write-Host "  Renaming $($itemFile.Name) to $itemFolderName$($itemFile.Name) to avoid conflicts"
                }
                
                Move-Item -Path $itemFile.FullName -Destination $destinationPath
                Write-Host "  Moved $($itemFile.Name) to root directory"
            }
        } else {
            Write-Host "No item configuration files found for configured items: $($configuredItems -join ', ')"
        }
    }
}

# Process all XML, JSON, and nuspec files to replace placeholders
# Include asset JSON files (like translations.json) but exclude binary files (images, etc.)
$filesToProcess = Get-ChildItem -Path $tempPath -Recurse -Include "*.xml", "*.json", "*.nuspec"

Write-Host "Processing $($filesToProcess.Count) files for variable replacement..."
Write-Host "Binary files (images, etc.) will be copied without modification."

foreach ($file in $filesToProcess) {
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    $originalContent = $content
    
    # Replace environment variables with actual values
    foreach ($key in $envVars.Keys) {
        $placeholder = "{{$key}}"
        if ($content -match [regex]::Escape($placeholder)) {
            $content = $content -replace [regex]::Escape($placeholder), $envVars[$key]
            Write-Host "  Replaced $placeholder with $($envVars[$key]) in $($file.Name)"
        }
    }
    
    # Additional common placeholders that might use different naming
    $content = $content -replace '\{\{WORKLOAD_ID\}\}', $envVars['WORKLOAD_NAME']
    
    # Replace MANIFEST_FOLDER with the current temp manifest folder path
    if ($content -match [regex]::Escape('{{MANIFEST_FOLDER}}')) {
        $content = $content -replace '\{\{MANIFEST_FOLDER\}\}', $tempPath
        Write-Host "  Replaced {{MANIFEST_FOLDER}} with $tempPath in $($file.Name)"
    }
    
    # Only write if content changed
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -Encoding UTF8
    }
}

################################################
# Validate processed files if requested
################################################
if($ValidateFiles -eq $true) {
    Write-Output "Validating processed configuration files..."
    $ScriptsDir = Join-Path $PSScriptRoot "Manifest\ValidationScripts"

    & "$ScriptsDir\RemoveErrorFile.ps1" -outputDirectory $ScriptsDir
    & "$ScriptsDir\ManifestValidator.ps1" -inputDirectory $tempPath -inputXml "WorkloadManifest.xml" -inputXsd "WorkloadDefinition.xsd" -outputDirectory $ScriptsDir
    & "$ScriptsDir\ItemManifestValidator.ps1" -inputDirectory $tempPath -inputXsd "ItemDefinition.xsd" -workloadManifest "WorkloadManifest.xml" -outputDirectory $ScriptsDir

    $validationErrorFile = Join-Path $ScriptsDir "ValidationErrors.txt"
    if (Test-Path $validationErrorFile) {
        Write-Host "Validation errors found. See $validationErrorFile"
        Get-Content $validationErrorFile | Write-Host
        exit 1
    }
    Write-Host "Validation completed successfully" -ForegroundColor Green
}

################################################
# Build the current nuget package
################################################
$nugetDir = Join-Path $PSScriptRoot "..\..\tools\NuGet"
$nugetPath = Join-Path $nugetDir "nuget.exe"
$nuspecPath = Join-Path $tempPath "\ManifestPackage.nuspec"



Write-Host "Using configuration in $outputDir"

if (-not (Test-Path $nugetPath)) {
    Write-Host "NuGet executable not found at $nugetPath. Downloading latest official nuget.exe..."
    New-Item -ItemType Directory -Path $nugetDir -Force | Out-Null
    $downloadUrl = "https://dist.nuget.org/win-x86-commandline/latest/nuget.exe"
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $nugetPath -UseBasicParsing
    } catch {
        Write-Host "Failed to download nuget.exe from $downloadUrl" -ForegroundColor Red
        throw
    }
}

if($IsWindows){
    & $nugetPath pack $nuspecPath -OutputDirectory $outputDir -Verbosity detailed
} else {
    # On Mac and Linux, we need to use mono to run the script
    # alternatively, we could use dotnet tool if available
    # nuget pack $nuspecFile -OutputDirectory $outputDir -Verbosity detailed 2>&1   
    mono $nugetPath pack $nuspecPath -OutputDirectory $outputDir -Verbosity detailed
}

Write-Host "✅ Created the new ManifestPackage in $outputDir." -ForegroundColor Blue

# Cleanup temp directory
if (Test-Path $tempPath) {
    Write-Host "Cleaning up temporary directory..."
    Remove-Item $tempPath -Recurse -Force -ErrorAction SilentlyContinue
}

