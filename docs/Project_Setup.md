# Fabric Lineage Workbench setup guide

This guide describes the current setup flow for the Fabric Lineage Workbench workload. It is intended for developers and technical users working in a Fabric dev environment.

## Prerequisites

Before starting, make sure you have:

- PowerShell 7 or later
- Node.js LTS and npm
- .NET SDK compatible with the DevGateway runtime
- VS Code
- A Microsoft Fabric tenant and a test workspace
- Permission to create or use an Entra application registration for the workload
- Azure CLI if you want to use non-interactive DevGateway authentication

## 1. Clone the repository

```powershell
git clone <repository-url>
cd fabric-lineage-workbench
```

## 2. Configure the workload

Run the setup script to prepare the workload name, local environment files, and developer configuration.

```powershell
cd scripts\Setup
.\SetupWorkload.ps1 -WorkloadName "Org.MyLineageWorkload"
```

The workload name should follow the Fabric naming pattern and typically uses an org prefix such as `Org.MyLineageWorkload`.

If needed, you can also use the compatibility wrapper:

```powershell
cd scripts\Setup
.\Setup.ps1 -WorkloadName "Org.MyLineageWorkload"
```

## 3. Prepare the developer environment

After the workload is configured, initialize the local developer environment:

```powershell
cd scripts\Setup
.\SetupDevEnvironment.ps1
```

This creates the local configuration used by the DevGateway to connect to your Fabric workspace.

## 4. Start the frontend

Open a terminal and start the local frontend app:

```powershell
cd scripts\Run
.\StartDevServer.ps1
```

This starts the local React/webpack development server used by the workload frontend.

## 5. Start the DevGateway

Open a second terminal and start the DevGateway:

```powershell
cd scripts\Run
.\StartDevGateway.ps1
```

The DevGateway connects the local workload instance to your Fabric workspace in developer mode.

## 6. Enable developer mode in Fabric

To test the workload in Fabric, ensure your tenant and workspace are prepared for developer mode:

- enable Fabric developer mode in the Fabric developer settings
- confirm the target workspace is available for testing
- verify that your workload is registered correctly for local development

After startup, the workload should be available through the workload hub or the developer route configured for your workload.

## 7. Verify the workload

Once both the frontend and DevGateway are running:

1. open the Fabric workspace used for development
2. launch the workload item from the workload hub
3. confirm the Lineage Workbench editor loads
4. configure extraction settings, lakehouse/environment selection, and workspace extraction targets

## Notes

- The active setup flow is driven by the scripts in [scripts/Setup](../scripts/Setup) and [scripts/Run](../scripts/Run).
- The development workflow in this repository is the source of truth; legacy examples or sample item flows are not part of the supported end-user flow.
- For troubleshooting or deeper architectural context, refer to the current docs in [docs/README.md](README.md) and the source code under [Workload/app](../Workload/app).
