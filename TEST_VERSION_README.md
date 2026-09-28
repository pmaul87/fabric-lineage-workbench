# Test version deployment guide

This guide is the recommended path when you want to build and publish a test version without running the local test server.

It uses scripts to:

- create or reuse the frontend app registration
- build the workload manifest and release artifacts
- create or reuse an Azure Web App and App Service plan
- deploy the frontend release to Azure Web App
- run manifest preflight
- print the Fabric Admin publication checklist

## 1. Prerequisites

- PowerShell 7+
- Node.js 20 LTS
- npm
- Azure CLI logged in with permissions to create Azure resources
- Microsoft Fabric tenant access with permissions to publish a workload manifest
- A Tenant ID for app registration creation

## 2. Configure the workload once

If you have not already configured the repository, run the standard setup once:

```powershell
cd scripts\Setup
.\SetupWorkload.ps1 -WorkloadName "Org.MyLineageWorkload"
.\SetupDevEnvironment.ps1
```

## 3. Run the test-version deployment script

```powershell
cd ..\Deploy
.\TestVersionDeployment.ps1 `
  -WorkloadName "Org.MyLineageWorkload" `
  -TenantId "<tenant-id>" `
  -ResourceGroupName "<resource-group>" `
  -WebAppName "<webapp-name>" `
  -Location "eastus" `
  -WorkloadVersion "1.0.0"
```

What the script does:

1. Creates or reuses the frontend app registration.
2. Builds the release package.
3. Creates or reuses the Azure resource group, App Service plan, and Web App.
4. Deploys the frontend to Azure Web App.
5. Runs manifest preflight.
6. Prints the Fabric Admin publication checklist.

## 4. Upload the manifest to Fabric Admin

After the script completes, take the `.nupkg` package from `release/` and upload it in:

- Fabric Admin portal
- Workload Management
- Upload workload package

Then activate the version in your tenant.

## 5. Validate the test version

- Open Fabric
- Create or open the workload item
- Confirm the editor loads from the Azure-hosted frontend
- Run the extraction and lineage experience checks in your test workspace

## 6. Troubleshooting

- If app registration creation fails, verify Graph permissions and tenant access.
- If Azure resource creation fails, verify subscription permissions.
- If manifest preflight fails, inspect the release package and rerun the script.
