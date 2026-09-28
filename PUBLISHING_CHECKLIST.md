# Publishing Checklist

This checklist tracks the current open source publication readiness of Fabric Lineage Workbench.

Assessment date: 2026-09-28

## Repository hygiene

- [x] Tracked environment files sanitized for public source control.
- [x] Tenant-specific values moved to ignored `Workload/.env.*.local` files.
- [x] Personal homepage references removed from tracked source and manifest metadata.
- [x] Public-facing scaffold identity strings cleaned from the main app shell and package metadata.
- [x] Microsoft-owned repository security template removed.
- [ ] Replace the placeholder private reporting instruction in `SECURITY.md` with the exact maintainer contact or security advisory flow you want to use publicly.

## Build and packaging

- [x] Frontend build succeeds with `npm run build:test`.
- [x] Manifest packaging succeeds with `scripts/Build/BuildManifestPackage.ps1 -Environment test ...`.
- [x] Manifest package now includes a package readme.
- [x] Test-version deployment path is documented in `README.md` and `TEST_VERSION_README.md`.
- [ ] Run a full `scripts/Build/BuildRelease.ps1` check once with the final publish-safe defaults you want to ship.

## Code quality

- [x] TypeScript type check succeeds with `npx tsc --noEmit`.
- [ ] ESLint still reports warnings in the lineage UI components.
- [ ] Add or document a minimal smoke-test procedure for the customer deployment flow.

## Documentation

- [x] Main README points to customer deployment and test-version flows.
- [x] Setup documentation explains tracked safe defaults versus ignored local overrides.
- [x] Security policy is now repo-specific instead of Microsoft-specific.
- [ ] Review the remaining historical and sample-oriented docs under `docs/` to decide whether they should stay, move to `docs/archive/`, or be trimmed before release.

## Toolkit baseline review

- [x] Core toolkit-derived build/setup files were reviewed against the Microsoft Fabric Extensibility Toolkit baseline.
- [x] Functional divergences required for the current workload were kept intentionally.
- [ ] Optionally reduce remaining sample naming in internal helper scripts and playground assets if you want a more polished public repo.

## Current readiness assessment

Status: publishable with a small set of follow-up items.

The repository is now materially cleaner for public release:

- No known tenant IDs, frontend app IDs, or personal workload URLs remain in tracked source, docs, or manifest metadata.
- Local working behavior is preserved through ignored `.env.*.local` overrides.
- Customer self-host and tenant-specific test deployment flows are documented and scripted.
- The main build and manifest packaging paths are working.

The main remaining gaps are operational rather than structural:

- `SECURITY.md` still needs a final private reporting destination.
- ESLint warnings remain in the lineage UI code.
- The repo still contains historical and sample-oriented documentation that is not wrong, but may be noisier than you want for a first public release.
- A final end-to-end customer dry run should still be performed from a clean clone before publishing.
