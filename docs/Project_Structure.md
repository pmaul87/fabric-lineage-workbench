# Repository structure and development layout

This document explains the current structure of the Fabric Lineage Workbench repository and the purpose of the main folders used in everyday development.

## High-level structure

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
│   ├── notebooks/
│   ├── .env.template
│   ├── .env.dev
│   ├── .env.test
│   └── .env.prod
├── build/
└── .github/
```

## Main folders

### Workload/app

This folder contains the frontend code for the custom Fabric workload item.

Key areas:

- `items/` – workload item implementations and view logic
- `components/` – shared UI components and Fabric patterns
- `clients/` – API wrappers and Fabric client access
- `services/` – business logic and lineage processing helpers
- `controller/` – workflow and orchestration logic

The main item currently implemented here is the Lineage Workbench workload item.

### Workload/Manifest

This folder stores the workload metadata and item configuration used by Microsoft Fabric.

Typical files:

- `Product.json` – workload metadata and labels
- `WorkloadManifest.xml` – workload manifest configuration
- `items/*` – per-item definitions and manifest templates
- `assets/` – icons and static assets used by the workload

### Workload/devServer

This folder contains the local development server configuration and helper scripts used while running the workload in developer mode.

### scripts/

Contains the project automation used to configure, run, and package the workload.

Important folders:

- `scripts/Setup/` – configuration and environment bootstrapping
- `scripts/Run/` – local dev server and DevGateway start scripts
- `scripts/Build/` – build and manifest packaging steps
- `scripts/Deploy/` – deployment-related tasks

### build/

This directory is generated during local builds and manifests. It contains development artifacts such as generated config files and processed package output.

These files are not the source of truth and are typically recreated as needed during setup or build execution.

## Environment files

The project uses environment configuration files for local development.

Important files:

- `Workload/.env.template` – template used during setup
- `Workload/.env.dev` – local development settings
- `Workload/.env.test` – test/staging settings
- `Workload/.env.prod` – production settings

These configuration files are used to personalize the workload name, app IDs, URLs, and local development behavior.

## Development workflow

The usual workflow is:

1. run the workload setup script
2. configure the local environment
3. start the frontend with the dev server script
4. start the DevGateway in a second terminal
5. open the workload in a Fabric developer workspace

This is the active path used for working with the project today.

## What is not part of the customer-facing workflow

Historical, exploratory, or internal-only notes under [docs](.) may still exist for background research, but they are not the primary guidance for users or customers. The active source of truth is:

- [README.md](../README.md)
- [docs/Project_Setup.md](Project_Setup.md)
- [docs/README.md](README.md)
- the scripts in [scripts](../scripts)
- the implementation under [Workload/app](../Workload/app)

This keeps documentation aligned with the actual current workload architecture and avoids exposing unnecessary legacy detail.
