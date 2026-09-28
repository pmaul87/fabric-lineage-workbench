# Customer deployment guide

This document describes every step required for customers to build, deploy, publish, and validate Fabric Lineage Workbench from source.

## 1. What you are deploying

A complete deployment has three parts:

- Frontend application hosted in Azure (from release/app)
- Fabric workload manifest package (.nupkg) published in Fabric Admin portal

## 2. Prerequisites

### Required tools

- PowerShell 7+
- Node.js 20 LTS
- npm
- Azure CLI (az)
- .NET SDK compatible with local DevGateway tooling

### Required access

- Azure subscription with permission to deploy Azure Web Apps
- Microsoft Fabric tenant with admin or delegated workload-management permissions
- Fabric workspace for testing
- Entra frontend application ID for the workload

## 3. Repository setup

1. Clone repository.
2. Install frontend dependencies.

```powershell
cd Workload
npm install
```

## 4. Configure workload and environment

Run setup scripts once per environment.

```powershell
cd ..\scripts\Setup
.\SetupWorkload.ps1 -WorkloadName "Org.MyLineageWorkload"
.\SetupDevEnvironment.ps1
```

Notes:

- Choose a final workload name for production, for example Contoso.LineageWorkbench.
- Setup creates required .env files used by build and local tooling, and generates the development manifest package from source.

## 5. Build release artifacts

Build the manifest package and frontend release output.

```powershell
cd ..\Build
.\BuildRelease.ps1 -WorkloadName "Org.MyLineageWorkload" -FrontendAppId "<frontend-app-id>" -Environment prod -WorkloadVersion "1.0.0"
```

Expected output:

- release/<WorkloadName>.<Version>.nupkg
- release/app/*

The release manifest is generated during this build step from the current setup files; it should not be pre-created or edited by hand.

## 6. Run manifest preflight

Validate the generated manifest package before publishing.

```powershell
cd ..\Deploy
.\TestFabricManifestPackage.ps1
```

Optional explicit package path:

```powershell
.\TestFabricManifestPackage.ps1 -ManifestPath "..\..\release\Org.MyLineageWorkload.1.0.0.nupkg"
```

The script prints:

- package metadata
- SHA256 hash
- publication checklist for Fabric Admin

## 7. Deploy frontend to Azure Web App

Deploy release/app using the deployment script.

```powershell
.\DeployToAzureWebApp.ps1 -WebAppName "<webapp-name>" -ResourceGroupName "<resource-group>" -ReleasePath "..\..\release\app" -DeployManifest $true
```

What this does:

- validates Azure access and target Web App
- deploys frontend via Zip Deploy
- validates public endpoint response
- automatically runs manifest preflight when DeployManifest is true
- prints Fabric Admin publication instructions for the manifest package

## 8. Publish workload manifest in Fabric Admin portal

1. Open Microsoft Fabric Admin portal.
2. Go to Workload Management.
3. Upload the validated .nupkg package.
4. Activate the uploaded workload version for your tenant.
5. Confirm the workload appears for item creation.

## 9. Validate customer-ready functionality

In Fabric:

- create a new Lineage Workbench item
- confirm item editor loads successfully
- run setup in the item
- run extraction flow in a test workspace
- verify graph loading and detail views

## 10. Recommended production checks

- Confirm your production workload name is final and consistent.
- Record and retain the preflight SHA256 for released package tracking.
- Test deployment in a non-production tenant first.
- Keep release version and changelog aligned.

## 11. Upgrade procedure

For each new release:

1. Pull latest source.
2. Rebuild release with new version.
3. Run manifest preflight and capture SHA256.
4. Deploy frontend to Azure.
5. Upload and activate new manifest package version.
6. Validate item creation and core flows.

## 12. Troubleshooting

- Missing .env file during build:
  - rerun scripts/Setup/SetupWorkload.ps1.
- Missing manifest package:
  - rerun scripts/Build/BuildRelease.ps1.
- Azure deploy failure:
  - verify az login, target resource group, and web app permissions.
- Manifest publication issues:
  - rerun scripts/Deploy/TestFabricManifestPackage.ps1 and confirm required entries.

## 13. Helpful references

- docs/Quickstart_SelfHost.md for a shorter flow
- TEST_VERSION_README.md for the no-local-test-server flow
- README.md for repository overview
- SECURITY.md for vulnerability reporting
- CONTRIBUTING.md for contribution standards

## 14. Alternative test version path

If you do not want to run a local test server, use the scripted test-version path described in [TEST_VERSION_README.md](TEST_VERSION_README.md).

This path is intended for customers who want to:

- create or reuse the app registration
- build the workload manifest and release artifacts
- create or reuse the Azure Web App
- deploy the frontend to Azure
- publish the validated manifest package to Fabric Admin

The main entry point is:

```powershell
cd scripts\Deploy
.\TestVersionDeployment.ps1
```
