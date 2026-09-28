# Semantic Analyzer Backend Cache - Integration Guide

This guide shows how to integrate the new caching layer with your existing API endpoints.

## 1. API Endpoint Setup

### Locate Your API Handler

Find the endpoint handler for semantic model entities (typically in `devServer/api/semantic.api.js` or similar):

```javascript
// Example: GET /api/semantic/models/{workspaceId}/{datasetId}/entities
app.get('/api/semantic/models/:workspaceId/:datasetId/entities', async (req, res) => {
  const { workspaceId, datasetId } = req.params;
  const { workspaceName, datasetName } = req.query;
  
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    // OLD: Call service directly
    // const result = await semanticAnalyzerService.loadModelEntities(...);
    
    // NEW: Service now handles caching internally
    const result = await semanticAnalyzerService.loadModelEntities(
      token, workspaceId, datasetId, workspaceName, datasetName
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Update Your Server Initialization

Add cache initialization to your backend startup routine:

```javascript
// In server.js or similar startup file
const SemanticAnalyzerService = require('./services/SemanticAnalyzerService');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.dev') });

// Initialize the Semantic Analyzer Service
const semanticAnalyzerService = new SemanticAnalyzerService();

// Initialize cache if enabled
if (process.env.SEMANTIC_ANALYZER_CACHE_ENABLED === 'true') {
  semanticAnalyzerService.initializeCache({
    enabled: true,
    server: process.env.FABRIC_SQL_SERVER,          // e.g., "server.database.windows.net"
    database: process.env.FABRIC_SQL_DATABASE,      // e.g., "InsightWorkbench-Cache"
    ttlMinutes: parseInt(process.env.SEMANTIC_ANALYZER_CACHE_TTL_MINUTES || '1440', 10),
    enablePersistence: process.env.SEMANTIC_ANALYZER_CACHE_PERSISTENCE !== 'false'
  });

  console.log('[Startup] Semantic Analyzer cache initialized');
  
  // Optional: Schedule periodic cache cleanup
  setInterval(() => {
    semanticAnalyzerService.cacheService.cleanExpiredCache()
      .then(result => console.log('[Cache Maintenance] Cleaned up', result.deletedRows, 'expired entries'))
      .catch(err => console.error('[Cache Maintenance] Cleanup failed:', err?.message));
  }, 6 * 60 * 60 * 1000); // Every 6 hours
} else {
  console.log('[Startup] Semantic Analyzer cache disabled (running in live-calculation mode)');
}

// Export for your API routes
app.locals.semanticAnalyzerService = semanticAnalyzerService;
```

## 2. Environment Configuration

### Development Setup (.env.dev)

```bash
# Semantic Analyzer Cache Configuration
SEMANTIC_ANALYZER_CACHE_ENABLED=true
FABRIC_SQL_SERVER=localhost
FABRIC_SQL_DATABASE=SemanticAnalyzerCache
SEMANTIC_ANALYZER_CACHE_TTL_MINUTES=1440
SEMANTIC_ANALYZER_CACHE_PERSISTENCE=true

# Alternative: Using LocalDB (Windows)
# FABRIC_SQL_SERVER=(localdb)\\mssqllocaldb
# FABRIC_SQL_DATABASE=SemanticAnalyzerCache
```

### Production Setup (.env.prod)

```bash
# Semantic Analyzer Cache Configuration
SEMANTIC_ANALYZER_CACHE_ENABLED=true
FABRIC_SQL_SERVER=prod-sql-server.database.windows.net
FABRIC_SQL_DATABASE=semantic-analyzer-cache-prod
SEMANTIC_ANALYZER_CACHE_TTL_MINUTES=60
SEMANTIC_ANALYZER_CACHE_PERSISTENCE=true

# Consider Azure Managed Identity instead of passwords
# Use connection string with Azure AD token if available
```

## 3. Database Setup

### Option A: SQL Server on Azure

1. Create SQL Server instance in Azure Portal
2. Create database: `SemanticAnalyzerCache`
3. Configure firewall rules for backend access
4. Use connection string in environment

```
Server=tcp:myserver.database.windows.net,1433;Initial Catalog=SemanticAnalyzerCache;
Persist Security Info=False;User ID=username;Password=xyz;Encrypt=True;
Connection Timeout=30;
```

### Option B: LocalDB (Windows Development Only)

```bash
# Create LocalDB instance
sqllocaldb create FabricAnalyzer

# Check status
sqllocaldb info

# Connection string
(localdb)\FabricAnalyzer
```

### Option C: Docker Container (Testing)

```dockerfile
# docker-compose.yml
version: '3.8'

services:
  semantic-analyzer-db:
    image: mcr.microsoft.com/mssql/server:2019-latest
    environment:
      SA_PASSWORD: 'YourComplexPassword123!'
      ACCEPT_EULA: 'Y'
    ports:
      - "1433:1433"
    volumes:
      - sqldata:/var/opt/mssql
    healthcheck:
      test: ["CMD", "/opt/mssql-tools/bin/sqlcmd", "-S", "localhost", "-U", "sa", "-P", "YourComplexPassword123!", "-Q", "SELECT 1"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  sqldata:
```

## 4. Schema Initialization (Automatic)

The `SemanticAnalyzerCacheService` automatically creates all required tables on first run:

```javascript
// This happens automatically when you call initializeCache()
// But you can also call it manually:

await semanticAnalyzerService.cacheService.initializeSchema();

// Verify tables exist
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME LIKE '%semantic%';
```

**Tables Created:**
- `semantic_model_cache` - Main model data
- `entity_aggregates` - Entity counts
- `entity_relationships_cache` - Dependency relationships
- `entity_statistics_cache` - Statistics cache
- `entity_report_usage_cache` - Report usage cache

## 5. Monitoring & Health Checks

### Request Handler Enhancement

```javascript
// Add middleware to log cache usage
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    if (data?.cacheSource) {
      console.log('[Cache] Source:', data.cacheSource, 'Model:', data.entities?.length, 'entities');
    }
    return originalJson.call(this, data);
  };
  next();
});
```

### Cache Health Endpoint

```javascript
// Add diagnostic endpoint
app.get('/api/health/semantic-analyzer-cache', async (req, res) => {
  try {
    const isValid = await semanticAnalyzerService.cacheService.isCacheValid(
      req.query.workspaceId || 'test',
      req.query.datasetId || 'test'
    );

    res.json({
      status: 'healthy',
      cacheEnabled: process.env.SEMANTIC_ANALYZER_CACHE_ENABLED === 'true',
      testCacheValid: isValid,
      sqlServer: process.env.FABRIC_SQL_SERVER,
      database: process.env.FABRIC_SQL_DATABASE,
      ttlMinutes: parseInt(process.env.SEMANTIC_ANALYZER_CACHE_TTL_MINUTES || '1440', 10)
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```

### Useful Diagnostic Queries

```sql
-- Check cache table sizes
SELECT 
  TABLE_NAME,
  CAST(SUM(CAST(p.rows AS bigint)) * 8 / 1024.0 AS numeric(36, 2)) AS [Size MB]
FROM sys.tables t
INNER JOIN sys.indexes i ON t.OBJECT_ID = i.OBJECT_ID
INNER JOIN sys.partitions p ON i.OBJECT_ID = p.OBJECT_ID AND i.INDEX_ID = p.INDEX_ID
WHERE t.NAME IN ('semantic_model_cache', 'entity_aggregates', 'entity_relationships_cache' 'entity_statistics_cache', 'entity_report_usage_cache')
GROUP BY TABLE_NAME;

-- Check cache hit rate
SELECT 
  COUNT(*) as CacheHits,
  SUM(CASE WHEN is_valid = 0 OR expires_at <= GETUTCDATE() THEN 1 ELSE 0 END) as CacheExpired,
  COUNT(*) - SUM(CASE WHEN is_valid = 0 OR expires_at <= GETUTCDATE() THEN 1 ELSE 0 END) as ValidCacheEntries
FROM semantic_model_cache;

-- Old entries
SELECT TOP 10 workspace_id, dataset_id, cached_at, expires_at, is_valid
FROM semantic_model_cache
ORDER BY cached_at DESC;
```

## 6. Troubleshooting Checklist

### Cache Not Initializing?

- [ ] Check `SEMANTIC_ANALYZER_CACHE_ENABLED=true` in .env
- [ ] Verify SQL server connectivity: `telnet server:1433`
- [ ] Check backend logs for `[SemanticAnalyzerCache]` entries
- [ ] Ensure database exists in SQL server
- [ ] Check SQL server firewall rules

### Cache Hit Rate Low?

- [ ] Check `cacheSource` in API response logs
- [ ] Compare: Should see `persistent-cache` once, then `live-calculation` on updates
- [ ] Increase TTL if models change frequently
- [ ] Check if table schemas changed (would invalidate cache)

### Performance Not Improving?

- [ ] Verify backend is actually using cache (check logs for `Cache hit!`)
- [ ] Check SQL query performance: `SELECT * FROM semantic_model_cache` should be <100ms
- [ ] Monitor network latency to SQL server
- [ ] Check if pre-calculation takes longer than expected

### SQL Connection Issues?

```javascript
// Manual SQL connection test
const sql = require('mssql');
const testConnection = new sql.ConnectionPool({
  server: process.env.FABRIC_SQL_SERVER,
  database: process.env.FABRIC_SQL_DATABASE,
  authentication: { type: 'default' },
  options: { encrypt: true, trustServerCertificate: false }
});

testConnection.connect().then(() => {
  console.log('✓ SQL connection successful');
  testConnection.close();
}).catch(err => {
  console.error('✗ SQL connection failed:', err.message);
});
```

## 7. Rollback Plan

If you need to disable caching:

```javascript
// Option A: Disable in environment
SEMANTIC_ANALYZER_CACHE_ENABLED=false

// Option B: Comment out cache initialization while keeping code
// semanticAnalyzerService.initializeCache({...});

// Option C: Invalidate all cache entries
// await semanticAnalyzerService.cacheService.invalidateCache('*', '*');
```

No code changes needed for the API endpoint - it will automatically fall back to live calculations.

## 8. Migration Path

### Phase 1: Deploy with Cache Disabled
- Deploy new code without enabling cache
- Verify no functional changes
- Monitor for any issues

### Phase 2: Enable Cache in Dev
- Set `SEMANTIC_ANALYZER_CACHE_ENABLED=true` in dev environment
- Monitor cache hit rates and performance
- Validate cache data correctness

### Phase 3: Enable Cache in Prod
- Create production SQL database
- Set environment variables
- Monitor telemetry and performance metrics
- Plan for cache cleanup jobs

---

## Quick Commands Reference

```bash
# Check SQL server connection
sqlcmd -S [server] -U [username] -P [password] -Q "SELECT @@VERSION"

# View cache table structure
sqlcmd -Q "SELECT * FROM semantic_model_cache" 

# Manual cache cleanup
# Run this periodically (cron job or scheduled task):
curl -X POST http://localhost:3000/api/semantic/cache/cleanup

# Monitor cache statistics
SELECT workspace_id, COUNT(*) as model_count, 
  SUM(CASE WHEN is_valid=1 THEN 1 ELSE 0 END) as valid_entries
FROM semantic_model_cache
GROUP BY workspace_id
```

---

**Status**: Ready for Integration  
**Last Updated**: 2026-04-14  
**Version**: 1.0
