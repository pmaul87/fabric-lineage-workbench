# Self-host quickstart

This guide is the shortest path for customers to build and deploy Fabric Lineage Workbench from source.

For a full step-by-step customer onboarding and operations guide, see [CUSTOMER_README.md](../CUSTOMER_README.md).
For a no-local-test-server path, see [TEST_VERSION_README.md](../TEST_VERSION_README.md).

## Prerequisites

- PowerShell 7+
- Node.js 20 LTS
- npm
- Azure CLI authenticated with rights to deploy a Web App
- A Fabric tenant and workspace for workload testing
- A frontend Entra App ID for the workload

## 1. Configure workload settings

```powershell
cd scripts\Setup
.\SetupWorkload.ps1 -WorkloadName "Org.MyLineageWorkload"
.\SetupDevEnvironment.ps1
```

## 2. Build release artifacts

```powershell
cd ..\Build
.\BuildRelease.ps1 -WorkloadName "Org.MyLineageWorkload" -FrontendAppId "<frontend-app-id>" -Environment prod -WorkloadVersion "1.0.0"
```

Expected output:

- release/<WorkloadName>.<Version>.nupkg
- release/app/*

## 3. Run manifest preflight

```powershell
cd ..\Deploy
.\TestFabricManifestPackage.ps1
```

What this does:

- Validates the latest release `.nupkg` package structure
- Prints SHA256 for release verification
- Prints a concise Fabric Admin publication checklist

## 4. Deploy frontend to Azure Web App

```powershell
cd ..\Deploy
.\DeployToAzureWebApp.ps1 -WebAppName "<webapp-name>" -ResourceGroupName "<resource-group>" -ReleasePath "..\..\release\app" -DeployManifest $true
```

What this does:

- Deploys release/app to Azure Web App
- Automatically runs manifest preflight and prints instructions for publishing the manifest package in Fabric Admin portal

## 5. Publish manifest in Fabric Admin portal

Use the validated manifest package from the preflight output and upload it in:

- Fabric Admin portal
- Workload Management
- Upload workload package (.nupkg)

Then activate the uploaded version for your tenant.

## 6. Validate end-to-end

- Open Fabric and create/open a Lineage Workbench item
- Confirm item loads and setup can be completed
- Run extraction workflow in a test workspace

## Troubleshooting

- If build fails due to missing env files, run SetupWorkload.ps1 again.
- If DevGateway auth fails, run `az login` and rerun setup.
- If manifest package is missing, rerun BuildRelease.ps1 and verify release/*.nupkg exists.
