# Contributing to Fabric Lineage Workbench

Thanks for contributing to Fabric Lineage Workbench.

## Scope

This repository contains a Microsoft Fabric custom workload. Contributions are welcome for:

- Bug fixes
- Reliability improvements for setup, build, and deployment scripts
- Documentation improvements
- UI/UX improvements in the workload item editor
- Tests and validation automation

## Prerequisites

Before opening a pull request, confirm you can run:

- PowerShell 7+
- Node.js 20 LTS
- npm
- Azure CLI
- .NET SDK (compatible with DevGateway runtime)

## Local setup

1. Clone and install dependencies.

```powershell
cd Workload
npm install
```

2. Configure workload settings.

```powershell
cd ..\scripts\Setup
.\SetupWorkload.ps1 -WorkloadName "Org.MyLineageWorkload"
.\SetupDevEnvironment.ps1
```

3. Validate your changes.

```powershell
cd ..\..\Workload
npm run lint
npx tsc --noEmit
npm run build:test
```

## Development workflow

1. Create a feature branch from main.
2. Keep changes focused to one concern per PR.
3. Update docs when behavior changes.
4. Add or adjust validation steps when adding scripts.

## Pull request checklist

- Build succeeds with `npm run build:test`
- Lint passes with `npm run lint`
- Type checks pass with `npx tsc --noEmit`
- New or changed script behavior is documented
- No secrets were added to tracked files

## Commit guidance

- Use clear, imperative commit messages.
- Prefer small commits that each compile.
- Include context in the PR description: problem, approach, and validation evidence.

## Reporting issues

- Use GitHub Issues for bugs and feature requests.
- Include reproduction steps, expected behavior, and actual behavior.
- For setup/deploy issues, include script command and terminal output.

## Security

Do not report security vulnerabilities in public issues. See SECURITY.md for reporting guidance.
