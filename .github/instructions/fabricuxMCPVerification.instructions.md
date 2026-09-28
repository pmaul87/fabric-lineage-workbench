# Fabric UX MCP Server Verification for UI Changes

## Overview
Before making any UI changes to the Fabric Lineage Workbench workload, the fabricux MCP server **MUST** be verified as running. This ensures that UI patterns and layout guidance follows official Fabric UX standards.

## Verification Process

### 1. Check MCP Server Status
Before proceeding with UI modifications, verify that the fabricux MCP server is available:

```powershell
# Check if fabricux MCP is running
# The server should be accessible via the MCP tools in the IDE
```

### 2. If MCP Server is Running ✅
- Proceed with UI changes using **fabricux MCP guidance** for layout patterns, component selection, and UX best practices
- Use MCP tools to verify design patterns against Fabric standards
- Document which MCP guidance was referenced in code comments

### 3. If MCP Server is NOT Running ❌
**STOP IMMEDIATELY** and:
1. Inform the user: "The fabricux MCP server is not running. UI changes cannot proceed without verifying against official Fabric UX patterns. Please start the MCP server and try again."
2. Do NOT proceed with any UI modifications
3. Wait for user confirmation that MCP is running before resuming work

## When to Apply
- ✅ Component styling or layout changes
- ✅ Dialog/modal resizing or restructuring
- ✅ New UI sections or panels
- ✅ Navigation or interaction patterns
- ✅ Responsive layout adjustments

## Implementation Guideline
Add a verification check comment in UI change commits:

```typescript
// UI Change: [Description]
// MCP Verification: fabricux MCP verified as running on [DATE]
// Guidance: [Reference to specific MCP guidance used]
```

## References
- Fabricux MCP provides OneLake Catalog layout patterns, dialog sizing standards, and Fluent UI v9 component guidance
- See: `.ai/context/fabric.md` for Fabric platform documentation
- Component library: `@fluentui/react-components` v9
