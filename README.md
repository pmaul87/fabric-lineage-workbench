# Fabric Lineage Workbench

Fabric Lineage Workbench is a Microsoft Fabric workload that helps teams extract, explore, and govern technical lineage across semantic models, reports, datasets, tables, and workspace dependencies. It brings setup, extraction, visualization, and requirement tracking into one custom workload experience.

This repository contains the implementation for the workload itself, including the item editor, extraction flow, lineage graph, development scripts, and manifest configuration required for a Fabric dev environment.

## Project links

- Microsoft Fabric documentation: https://learn.microsoft.com/fabric/
- Fabric Extensibility Toolkit documentation: https://learn.microsoft.com/fabric/extensibility-toolkit/
- Fabric workload overview: https://learn.microsoft.com/fabric/enterprise/overview
- Fabric developer docs: https://learn.microsoft.com/fabric/data-engineering/

## What this project does

- Configures the workload and item Definition for a Fabric environment
- Helps users create and manage a lineage storage lakehouse and Spark environment
- Deploys extraction assets for Fabric metadata collection
- Allows users to select one or multiple workspaces for lineage extraction
- Builds and visualizes lineage graphs with parent-child and dependency relationships
- Supports requirement tracking linked to lineage artifacts
- Runs in local development mode with a Fabric DevGateway and local frontend server

## Notice

This repository is an independent open source project built on top of the Microsoft Fabric Extensibility Toolkit.

Treat the project as preview-quality software and validate it in a non-production tenant before wider rollout.

## Current architecture

The project follows the Microsoft Fabric Extensibility Toolkit architecture for custom workload items:

- Workload frontend: React + TypeScript app under [Workload/app](Workload/app)
- Manifest and item metadata: [Workload/Manifest](Workload/Manifest)
- Local development server: [Workload/devServer](Workload/devServer)
- Setup and startup automation: [scripts/Setup](scripts/Setup) and [scripts/Run](scripts/Run)
- DevGateway runtime and local developer integration: [tools/DevGateway](tools/DevGateway)
- Supporting documentation: [docs](docs)

The main item implementation is organized under:

- [Workload/app/items/LineageWorkbenchItem](Workload/app/items/LineageWorkbenchItem)
- [Workload/app/services](Workload/app/services)
- [Workload/app/clients](Workload/app/clients)
- [Workload/app/components](Workload/app/components)

## Documentation status

This repository contains both active implementation docs and historical reference material. The docs that are still relevant for the current architecture are:

- [docs/Quickstart_SelfHost.md](docs/Quickstart_SelfHost.md) – fastest customer path from source to deployed workload
- [docs/Project_Setup.md](docs/Project_Setup.md) – current setup flow and environment expectations
- [docs/Project_Structure.md](docs/Project_Structure.md) – repository structure and build configuration
- [docs/components/README.md](docs/components/README.md) – shared Fabric component patterns
- [docs/components/ItemEditor/README.md](docs/components/ItemEditor/README.md) – item editor usage patterns
- [docs/ReleaseNotes/README.md](docs/ReleaseNotes/README.md) – release history

Legacy or design-specific material under [docs](docs) may still be useful for historical context, but it is not mandatory for day-to-day setup or development. The active path is the source code, the setup scripts, and the current setup guides above.

## Open source release readiness

For open source consumers, the recommended order is:

1. Follow [CUSTOMER_README.md](CUSTOMER_README.md) for the full customer build and deployment process.
2. Use [TEST_VERSION_README.md](TEST_VERSION_README.md) for the no-local-test-server path that creates the app registration, Azure Web App resources, release package, and manifest handoff for your own tenant.
3. Use [docs/Quickstart_SelfHost.md](docs/Quickstart_SelfHost.md) for the shortest path.
4. Use [CONTRIBUTING.md](CONTRIBUTING.md) for contribution and validation expectations.
5. Track changes through [CHANGELOG.md](CHANGELOG.md).
6. Use [SECURITY.md](SECURITY.md) for responsible vulnerability disclosure.
7. Review [PUBLISHING_CHECKLIST.md](PUBLISHING_CHECKLIST.md) before publishing a public release.

The scripted entry point for the test-version path is [scripts/Deploy/TestVersionDeployment.ps1](scripts/Deploy/TestVersionDeployment.ps1).

## Getting started

### Prerequisites

Before you start, make sure you have:

- Windows, macOS, or Linux with PowerShell 7+
- Node.js LTS and npm
- .NET SDK compatible with the local DevGateway runtime
- VS Code
- A Microsoft Fabric tenant and a Fabric workspace where you can test the workload
- An Entra application registration for the workload frontend, or permission to create one through the setup scripts
- Azure CLI when you want to use non-interactive authentication for the DevGateway

### 1. Clone the repository

```powershell
git clone <repository-url>
cd fabric-lineage-workbench
```

### 2. Configure the workload

Run the setup script from the setup folder. This prepares the workload name, environment files, and the necessary developer configuration.

```powershell
cd scripts\Setup
.\SetupWorkload.ps1 -WorkloadName "Org.MyLineageWorkload"
```

If you want to use the wrapper script that is kept for compatibility, you can also run:

```powershell
cd scripts\Setup
.\Setup.ps1 -WorkloadName "Org.MyLineageWorkload"
```

The workload name should follow the Fabric naming pattern, typically using an org-specific prefix such as `Org.MyLineageWorkload`.

`SetupWorkload.ps1` keeps the tracked `Workload/.env.dev`, `Workload/.env.test`, and `Workload/.env.prod` files public-safe and writes your tenant-specific values into ignored `Workload/.env.*.local` files.

## Tenant test deployment path

If you want a customer-style deployment without running the local test server, use the test-version flow:

```powershell
pwsh .\scripts\Deploy\TestVersionDeployment.ps1 `
	-WorkloadName "Org.MyLineageWorkload" `
	-TenantId "<your-tenant-id>" `
	-ResourceGroupName "rg-my-lineage-workload" `
	-WebAppName "my-lineage-workload-fe" `
	-Environment test
```

This path builds the manifest and frontend release, creates or reuses the frontend app registration, provisions the Azure Web App resources, deploys the frontend, and prepares the manifest package for upload in the Fabric Admin portal. See [TEST_VERSION_README.md](TEST_VERSION_README.md) for the full flow.

### 3. Prepare the developer environment

After the workload is configured, run the developer environment setup so the local DevGateway can connect to your Fabric workspace.

```powershell
cd scripts\Setup
.\SetupDevEnvironment.ps1
```

This step creates or refreshes the local developer configuration used by the workload runtime.

### 4. Start the frontend locally

Start the local UI and app host:

```powershell
cd scripts\Run
.\StartDevServer.ps1
```

This starts the React/webpack development server for the workload frontend.

### 5. Start the Fabric DevGateway

In a second terminal, start the local DevGateway so Fabric can connect to the workload in developer mode:

```powershell
cd scripts\Run
.\StartDevGateway.ps1
```

The DevGateway reads the generated configuration from the build output and connects the local workload to your Fabric workspace.

### 6. Enable Fabric developer mode

In your Microsoft Fabric tenant, make sure the following are enabled for your dev environment:

- Developer mode in the Fabric developer settings
- The required tenant-level developer configuration for custom workload testing
- Access to the target workspace where the workload is being tested

Then open the workload in your Fabric environment via the workload hub or the developer URL pattern for your workload.

### 7. Validate the workload

After startup, create or open a workload item in your Fabric workspace and confirm that the item loads in the custom editor. At that point you can configure the extraction target and begin exploring lineage.

## Typical development workflow

For day-to-day work, the normal local workflow is:

1. Start the frontend with `StartDevServer.ps1`
2. Start the DevGateway with `StartDevGateway.ps1`
3. Make code changes in [Workload/app](Workload/app)
4. Refresh the Fabric developer experience as needed
5. Rebuild or regenerate manifest artifacts when the workload config changes

Common commands:

```powershell
cd Workload
npm install
npm run build:prod
```

## Repository structure

```text
.
├── README.md
├── LICENSE
├── DEVELOPMENT.md
├── docs/
├── scripts/
├── tools/
├── Workload/
│   ├── app/
│   ├── Manifest/
│   ├── devServer/
└── build/
```

Key folders:

- [Workload/app](Workload/app) – frontend code, item views, services, and custom workload logic
- [Workload/Manifest](Workload/Manifest) – manifest templates and item metadata
- [scripts/Setup](scripts/Setup) – environment and workload bootstrap scripts
- [scripts/Run](scripts/Run) – dev-server and DevGateway startup scripts
- [scripts/Build](scripts/Build) – manifest packaging and build automation
- [docs](docs) – active docs and historical references
- [tools/DevGateway](tools/DevGateway) – local Fabric DevGateway runtime assets

## Official Microsoft references

These are the primary references to use when working with Fabric and custom workloads:

- Microsoft Fabric home: https://learn.microsoft.com/fabric/
- Fabric extensibility toolkit: https://learn.microsoft.com/fabric/extensibility-toolkit/
- Fabric developer documentation: https://learn.microsoft.com/fabric/enterprise/
- Fabric workspaces and items: https://learn.microsoft.com/fabric/get-started/
- Fabric admin and developer mode guidance: https://learn.microsoft.com/fabric/admin/

## License

See [LICENSE](LICENSE).
