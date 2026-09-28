# Optional Persistence for Lineage Workbench Scans

This directory contains the database schema and persistence service for storing scan results from the Lineage Workbench metadata/report-scanning workflow in a Fabric SQL Database or SQL Warehouse.

**Note:** Database persistence is **completely optional**. The workbench works fine without it - configuration simply enables additional T-SQL querying and history capabilities.

## Overview

When configured, the scan workflow automatically persists results to a SQL database, and the workbench can mirror saved snapshots into the same store, enabling:
- **T-SQL querying** of report metadata across your organization
- **Historical tracking** of report scans and changes
- **Field usage analysis** to understand which fields are used across reports
- **Dataset impact analysis** to see all reports using a specific dataset
- **Audit trail** of all scan operations
- **Snapshot querying** for section snapshots, TMDL snapshots, and saved report JSON snapshots

## Database Schema

The schema consists of 7 tables:

1. **Report** - Top-level report metadata
2. **Page** - Report pages
3. **Visuals** - Visual components within pages
4. **VisualElements** - Data bindings and references within visuals
5. **Filters** - Filter definitions at report, page, or visual level
6. **ScanHistory** - Audit trail of all scan operations
7. **InsightWorkbenchSnapshot** - Section snapshots and raw entity snapshots mirrored from OneLake for SQL querying (legacy table name kept for compatibility)

See [sql/ReportScannerSchema.sql](./sql/ReportScannerSchema.sql) for the complete schema definition.

## Important: Database Persistence is Optional

**The scan workflow works without database configuration.** If you don't configure a SQL database:
- ✅ Report scanning still works normally
- ✅ Results are cached in the browser session
- ✅ All UI features function correctly
- ❌ T-SQL querying is not available
- ❌ Historical scans are not persisted between sessions

Only follow the setup steps below if you want persistent storage and T-SQL query capabilities.

## Setup Instructions

### Step 1: Create a Fabric SQL Database

1. Navigate to your Fabric workspace
2. Click **+ New** → **More options**
3. Select **SQL Database**
4. Name it (e.g., `InsightWorkbenchMetadata`)
5. Click **Create**

Alternatively, you can use a **Fabric Warehouse** if you prefer columnar optimization for analytics.

### Step 2: Run the Schema Script

1. Open the SQL Database or Warehouse in Fabric
2. Click **New Query**
3. Copy the contents of `sql/ReportScannerSchema.sql`
4. Paste and execute the script
5. Verify all tables were created successfully

Alternatively, after configuring SQL in **Insight Workbench → Storage Settings**, you can:

1. Click **Apply SQL settings**
2. Click **Test SQL connection**
3. Click **Set up SQL schema** to run the schema from the workbench
4. Use **View SQL setup script** if you want to inspect or copy the exact script first

### Step 3: Configure Environment Variables

Add the following to your `.env.dev` file:

```env
# Service Principal (Required for SQL Database authentication)
TENANT_ID=your-tenant-id
BACKEND_APPID=your-app-id
BACKEND_CLIENT_SECRET=your-client-secret

# Optional scan persistence SQL database configuration
SQL_DB_SERVER=yourserver.database.fabric.microsoft.com
SQL_DB_DATABASE=InsightWorkbenchMetadata
```

**Important:** SQL Database persistence requires service principal credentials because the backend needs to acquire SQL-specific Azure AD tokens (audience: `https://database.windows.net/`). Browser tokens from Fabric won't work for SQL authentication.

**Finding your SQL connection details:**

1. Open your SQL Database/Warehouse in Fabric
2. Click **Settings** or **Connection strings**
3. Copy the server endpoint (e.g., `xyz123.database.fabric.microsoft.com`)
4. The database name is what you named it during creation

**Setting up service principal:**

If you don't already have service principal credentials configured, see the [Setup Guide](../../../scripts/Setup/SetupConfiguration.md) for instructions on creating an Azure AD app registration.

### Step 4: Grant Service Principal Permissions

The service principal needs access to the SQL Database:

1. Open your SQL Database in Fabric
2. Navigate to **Settings** → **Security**
3. Add the service principal as a **Contributor** or **Admin**
4. Alternatively, run this SQL to grant permissions:

```sql
-- Replace {app-id} with your BACKEND_APPID
CREATE USER [your-app-name] FROM EXTERNAL PROVIDER;
ALTER ROLE db_owner ADD MEMBER [your-app-name];
```

### Step 5: Restart Dev Server

After configuring environment variables:

```powershell
# Stop the dev server (Ctrl+C in the terminal)
# Restart it
cd scripts\Run
.\StartDevServer.ps1
```

The server will automatically:
1. Detect the SQL configuration
2. Initialize the persistence service
3. Start persisting report scans to the database

## Verifying Setup

### Check Logs

When the dev server starts, you should see:

```
[ReportScannerPersistence] Configuration initialized with service principal
✅ Report Scanner persistence ready (using service principal authentication)
```

If configuration is missing, you'll see:

```
⚠️  SQL Database configured but missing service principal credentials
ℹ️  Set TENANT_ID, BACKEND_APPID, and BACKEND_CLIENT_SECRET to enable persistence
```

### Test a Scan

1. Open the workbench in the browser
2. Navigate to the scan/persistence feature area
3. Select a report
4. After the scan completes, check the database:

```sql
SELECT * FROM Report ORDER BY ScannedAtUtc DESC;
SELECT * FROM ScanHistory ORDER BY ScannedAtUtc DESC;
SELECT * FROM InsightWorkbenchSnapshot ORDER BY SavedAtUtc DESC;
```

## Querying Scan Results

### Example Queries

**Find all reports using a specific field:**

```sql
SELECT 
    r.Name AS ReportName, 
    p.Name AS PageName, 
    v.Title AS VisualTitle, 
    ve.SourceField
FROM VisualElements ve
JOIN Visuals v ON ve.VisualUID = v.UID
JOIN Page p ON v.PageUID = p.UID
JOIN Report r ON p.ReportUID = r.UID
WHERE ve.SourceTable = 'Sales' 
  AND ve.SourceField = 'Revenue';
```

**Report usage by dataset:**

```sql
SELECT 
    r.DatasetName, 
    COUNT(DISTINCT r.UID) AS ReportCount, 
    COUNT(DISTINCT p.UID) AS PageCount,
    COUNT(DISTINCT v.UID) AS VisualCount
FROM Report r
LEFT JOIN Page p ON r.UID = p.ReportUID
LEFT JOIN Visuals v ON p.UID = v.PageUID
WHERE r.DatasetName IS NOT NULL
GROUP BY r.DatasetName
ORDER BY ReportCount DESC;
```

**Filter usage analysis:**

```sql
SELECT 
    f.SourceTable, 
    f.SourceField, 
    COUNT(*) AS UsageCount
FROM Filters f
GROUP BY f.SourceTable, f.SourceField
ORDER BY UsageCount DESC;
```

**Scan success rate:**

```sql
SELECT 
    CAST(SUM(CASE WHEN Success = 1 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 AS SuccessRate,
    COUNT(*) AS TotalScans,
    SUM(CASE WHEN Success = 1 THEN 1 ELSE 0 END) AS SuccessfulScans,
    SUM(CASE WHEN Success = 0 THEN 1 ELSE 0 END) AS FailedScans
FROM ScanHistory;
```

**Most recent scan for each report:**

```sql
SELECT 
    r.WorkspaceId, 
    r.ReportId, 
    r.Name, 
    MAX(r.ScannedAtUtc) AS LastScannedAtUtc
FROM Report r
GROUP BY r.WorkspaceId, r.ReportId, r.Name
ORDER BY LastScannedAtUtc DESC;
```

## Frontend Integration

The Report Scanner view automatically persists results when:
- A report scan completes successfully
- A scan fails (records error in ScanHistory)

Persistence is **non-blocking** and **best-effort**:
- If the database is unavailable, the scan still works
- Errors are logged to console but don't interrupt user workflow
- UI remains responsive during persistence

## API Endpoints

The backend exposes the following endpoints:

- `POST /api/metadata/report-scanner/persist` - Store scan results
- `GET /api/metadata/report-scanner/history/:workspaceId/:reportId` - Get scan history
- `GET /api/metadata/report-scanner/field-usage?tableName=X&fieldName=Y` - Get field usage
- `GET /api/metadata/report-scanner/dataset-usage` - Get dataset usage summary

## Architecture

```
Frontend (React)
  └─ ReportScannerView
      └─ MetadataExplorerClient.persistReportScan()
          └─ POST /api/metadata/report-scanner/persist (no auth header needed)

Backend (Node.js)
  └─ metadata.api.js
      └─ ReportScannerPersistenceService
          └─ acquireSqlToken() (using service principal)
              └─ SQL Database (mssql package with AAD token)
```

**Authentication Flow:**
1. Backend uses service principal credentials (TENANT_ID, BACKEND_APPID, BACKEND_CLIENT_SECRET)
2. Acquires Azure AD token with scope `https://database.windows.net/.default`
3. Token is cached and reused until expiry (with 5-minute buffer)
4. Each SQL connection pool is created with the current valid token

## Troubleshooting

### "Service principal credentials not configured"

**Cause:** Missing TENANT_ID, BACKEND_APPID, or BACKEND_CLIENT_SECRET environment variables.

**Solution:**
1. Verify `.env.dev` contains all three service principal variables
2. Restart the dev server
3. Check dev server logs for initialization messages

### "Failed to acquire SQL token"

**Cause:** Service principal credentials are invalid or the app doesn't have permission to SQL Database.

**Solution:**
1. Verify the service principal credentials are correct
2. Check that the app registration exists in Azure AD
3. Ensure the service principal has been granted access to the SQL Database (see Step 4)

### "Cannot open server requested by the login. The login failed."

**Cause:** Service principal not granted access to SQL Database, or database firewall rules blocking connection.

**Solution:**
1. Add the service principal to the SQL Database with appropriate permissions (see Step 4)
2. Verify the SQL Database allows Azure service connections
3. Check that the SQL_DB_SERVER endpoint is correct

### "Persist report scan" returns 503

**Cause:** Persistence service not initialized (missing configuration or credentials).

**Solution:**
1. Verify both SQL database settings AND service principal credentials are in `.env.dev`
2. Restart the dev server and check initialization logs
3. Confirm no errors during startup

### No data appearing in database

**Cause:** Persistence is failing silently.

**Solution:**
1. Open browser console (F12)
2. Look for `[ReportScanner]` log messages
3. If you see "Failed to persist scan to database", check the error details
4. Verify the schema was created correctly with `SELECT * FROM INFORMATION_SCHEMA.TABLES`

## Performance Considerations

- **Connection Pooling:** The service uses connection pooling (max 10 connections)
- **Transactions:** Each scan is stored in a single transaction (rollback on failure)
- **Indexes:** Schema includes indexes on common query patterns
- **Non-blocking:** Persistence runs asynchronously and doesn't block UI

## Development Notes

### Adding New Fields

To add a new field to persist:

1. Update the SQL schema (`sql/ReportScannerSchema.sql`)
2. Update `ReportScannerPersistenceService.js` `storeReportScan()` method
3. Update `ReportScannerView.tsx` `persistScanToDatabase()` to include the new field
4. Update `MetadataExplorerClient.ts` `persistReportScan()` type signature

### Testing Locally

To test without database:
- Simply don't set the SQL environment variables
- The app will work normally, just without persistence

To test with database:
- Use a dev/test SQL Database in Fabric
- Run manual queries to verify data

## Security

- **Authentication:** Azure AD OAuth2 client credentials flow (service principal)
- **Token Management:** Tokens cached with 5-minute expiry buffer
- **Authorization:** Service principal must be explicitly granted SQL Database access
- **Encryption:** TLS 1.2+ for all connections
- **SQL Injection:** Protected via parameterized queries
- **Credentials:** Service principal credentials stored in environment variables (never in code)

## Future Enhancements

Potential additions to consider:
- **Incremental updates:** Only store new/changed reports
- **Soft deletes:** Track when reports are removed from Fabric
- **Schema versioning:** Support for schema migrations
- **Bulk import:** API for importing historical scan data
- **Power BI integration:** Semantic model on top of scan results

---

**Created:** 2026-04-14  
**Version:** 1.0  
**Status:** Production Ready
