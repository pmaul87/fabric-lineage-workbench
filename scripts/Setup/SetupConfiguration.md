# SetupWorkload.ps1 Configuration Guide

This document describes what configuration values are required during the `SetupWorkload.ps1` script execution and what can be overridden in local `.env` files afterward.

## Required User Inputs (Script Prompts)

### Core Configuration

1. **WorkloadName**
   - Format: `Org.YourProjectName` (e.g., `Org.MyWorkload`)
   - Must be registered with Microsoft Fabric before use
   - Used throughout the workload for identification

2. **FrontendAppId**
   - Entra Application ID for the frontend
   - Options:
     - Use existing Entra Application ID
     - Create new application via script (requires TenantId)
     - Script will guide through creation process

## Environment Variables (Can Override in Local .env Files)

These values have safe tracked defaults and can be customized per environment in local override files (`.env.dev.local`, `.env.test.local`, `.env.prod.local`):

### Per-Environment Overrides

- **FRONTEND_URL**
  - `.env.dev`: `http://localhost:60006/`
  - `.env.test`: `https://your-staging-url.azurestaticapps.net/`
  - `.env.prod`: `https://your-production-url.azurestaticapps.net/`

- **BACKEND_URL**
  - `.env.dev`: `http://localhost:5000/`
  - `.env.test`: `https://your-staging-backend-url.azurewebsites.net/`
  - `.env.prod`: `https://your-production-backend-url.azurewebsites.net/`

- **LOG_LEVEL**
  - `.env.dev`: `debug`
  - `.env.test`: `info`
  - `.env.prod`: `warn`

### Optional Service Configurations

- **ONELAKE_DFS_BASE_URL**
  - Default: `https://onelake.dfs.fabric.microsoft.com` (Production)

- **FABRIC_CLIENT_FOR_WORKLOADS_APP_ID**
  - Default: `d2450708-699c-41e3-8077-b0c8341509aa`
  - Expected App ID for Microsoft Fabric Client for Workloads (for token validation)
  - Can override if using different Fabric environment

- **NODE_ENV**
  - Controls authentication validation strictness in local devServer
  - Values: `development` (lenient) | `production` (strict)
  - Not explicitly set by setup script, but can be added to `.env` files

## Hardcoded Constants (Cannot Change)

These values are fixed in the codebase and cannot be overridden:

- **FABRIC_BACKEND_APP_ID**
  - Value: `00000009-0000-0000-c000-000000000000`
  - Microsoft Fabric Backend service application ID
  - Hardcoded in `Workload/devServer/authentication.js`

- **Azure AD Endpoint**
  - Value: `https://login.microsoftonline.com`
  - Production Azure AD authentication endpoint only
  - No support for PPE or other environments

## File Locations

- **Setup Script**: `scripts/Setup/SetupWorkload.ps1`
- **Environment Template**: `Workload/.env.template`
- **Tracked Safe Defaults**:
  - `Workload/.env.dev`
  - `Workload/.env.test`
  - `Workload/.env.prod`
- **Generated Local Overrides**:
  - `Workload/.env.dev.local` (local development)
  - `Workload/.env.test.local` (staging)
  - `Workload/.env.prod.local` (production)

## Security Notes

- `.env.*.local` files are in `.gitignore` and never committed to source control
- `.env.dev`, `.env.test`, and `.env.prod` are tracked with public-safe defaults
- Each developer runs `SetupWorkload.ps1` to generate their own `.env.*.local` files with tenant-specific values
- `BackendClientSecret` is entered securely (masked input) during setup
- `.env.*.local` files should be protected with file system permissions

## Workflow Summary

1. Run `SetupWorkload.ps1` once per repository setup
2. Script prompts for all required configuration
3. Generates `.env.dev.local`, `.env.test.local`, `.env.prod.local` with appropriate values
4. Customize environment-specific settings in `.env.*.local` files as needed
5. Never commit `.env.*.local` files to source control
6. Team members run the same setup process with their own credentials
