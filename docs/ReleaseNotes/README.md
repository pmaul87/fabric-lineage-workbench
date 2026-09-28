# Release Notes

This directory contains release notes for the Microsoft Fabric Extensibility Toolkit, organized by year for easy navigation and maintenance.

## Folder Structure

```text
docs/ReleaseNotes/
├── README.md (this file)
├── 2025/
│   ├── v2025.11.md
│   ├── v2025.12.md
│   └── v2025.12.1.md
├── 2026/
│   └── v2026.01.md
└── ...
```

## Release Note Format

Each release note file follows the naming convention: `v{YYYY}.{MM}[.{P}].md`

- **YYYY**: 4-digit year
- **MM**: 2-digit month (01-12)
- **P**: Optional patch number (1, 2, 3...)

### Examples

- `v2025.11.md` - November 2025 release
- `v2025.11.1.md` - November 2025 patch release 1
- `v2026.01.md` - January 2026 release

## Latest Releases

- **[v2026.07](2026/v2026.07.md)** - Lineage Workbench extraction flow and publish packaging cleanup
- **[Deployment UI Configuration](2026/06_DeploymentUIConfiguration.md)** - UI-based deployment configuration with entity picker for lakehouse selection
- **[v2026.03](2026/v2026.03.md)** - Remote workload hosting, job scheduling framework, item lifecycle operations with soft delete/restore support, and variables library sample in Client SDK playground.
- **[v2026.01](2026/v2026.01.md)** - Enhanced toolkit with new Dialog Control, improved Client SDK capabilities, and memory management optimizations
- **[v2025.12.1](2025/v2025.12.1.md)** - Patch release with critical bug fixes, security improvements, and stability enhancements
- **[v2025.12](2025/v2025.12.md)** - Major toolkit enhancement with standardized base components and SCSS architecture


---

For questions about the release process, see the internal documentation in `scripts/_internal/README.md`.
