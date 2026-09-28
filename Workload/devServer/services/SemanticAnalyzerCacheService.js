/**
 * SemanticAnalyzerCacheService
 * Manages caching and pre-calculation of semantic model analysis results.
 *
 * Supports two backends selected automatically at runtime:
 *  - "memory"  Always available; data is lost on server restart (default fallback)
 *  - "sql"     Persistent; promoted when server + database config is provided
 *
 * If SQL is configured but the connection/schema init fails the service
 * automatically falls back to the in-memory backend and logs a warning.
 */

// ---------------------------------------------------------------------------
// MemoryCacheBackend — zero-config, always available
// ---------------------------------------------------------------------------

class MemoryCacheBackend {
  constructor() {
    /** @type {Map<string, {entities, dependencies, relationships, aggregates, expiresAt: number}>} */
    this.store = new Map();
  }

  get backendName() {
    return "memory";
  }

  _key(workspaceId, datasetId) {
    return `${workspaceId}:${datasetId}`;
  }

  async initializeSchema() {
    // No-op for memory backend
  }

  async isCacheValid(workspaceId, datasetId) {
    const key = this._key(workspaceId, datasetId);
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async getCachedModelData(workspaceId, datasetId) {
    const key = this._key(workspaceId, datasetId);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    const { expiresAt: _ignored, ...data } = entry;
    return data;
  }

  async cacheModelData(
    workspaceId,
    datasetId,
    _workspaceName,
    _datasetName,
    entities,
    dependencies,
    relationships,
    aggregates,
    ttlMinutes
  ) {
    const key = this._key(workspaceId, datasetId);
    const expiresAt = Date.now() + ttlMinutes * 60 * 1000;
    this.store.set(key, { entities, dependencies, relationships, aggregates, expiresAt });
    console.log("[SemanticAnalyzerCache][memory] Cached model data:", {
      key,
      entities_count: entities.length,
      expires_at: new Date(expiresAt).toISOString(),
    });
  }

  async invalidateCache(workspaceId, datasetId) {
    this.store.delete(this._key(workspaceId, datasetId));
  }

  async cleanExpiredCache() {
    let deletedRows = 0;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        deletedRows++;
      }
    }
    return { deletedRows };
  }
}

// ---------------------------------------------------------------------------
// SqlCacheBackend — persistent, promoted when SQL config is provided
// ---------------------------------------------------------------------------

class SqlCacheBackend {
  /**
   * @param {Object} sqlConfig - SQL connection configuration
   * @param {Object} cacheConfig - TTL and persistence settings
   */
  constructor(sqlConfig, cacheConfig) {
    // Lazy-require so the module still loads without mssql installed
    this.sql = require("mssql");
    this.connectionConfig = {
      server: sqlConfig.server,
      database: sqlConfig.database,
      options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 30000,
        requestTimeout: 30000,
      },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    };
    this.cacheConfig = cacheConfig;
  }

  get backendName() {
    return "sql";
  }

  async _connect() {
    const pool = new this.sql.ConnectionPool(this.connectionConfig);
    await pool.connect();
    return pool;
  }

  /**
   * Create SQL schema tables if they don't exist.
   * Called once during SqlCacheBackend promotion. Throws on failure so the
   * caller can fall back to the memory backend.
   */
  async initializeSchema() {
    let connection;
    try {
      connection = await this._connect();
      const request = connection.request();

      // Main semantic model cache table
      await request.query(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'semantic_model_cache')
        CREATE TABLE semantic_model_cache (
          id BIGINT PRIMARY KEY IDENTITY(1,1),
          workspace_id NVARCHAR(MAX) NOT NULL,
          dataset_id NVARCHAR(MAX) NOT NULL,
          workspace_name NVARCHAR(MAX),
          dataset_name NVARCHAR(MAX),
          entities_json NVARCHAR(MAX) NOT NULL,
          dependencies_json NVARCHAR(MAX) NOT NULL,
          entity_relationships_json NVARCHAR(MAX),
          aggregates_json NVARCHAR(MAX),
          is_valid BIT DEFAULT 1,
          cached_at DATETIME2 DEFAULT GETUTCDATE(),
          expires_at DATETIME2,
          row_version BIGINT DEFAULT 1,
          UNIQUE(workspace_id, dataset_id)
        );
        CREATE INDEX idx_semantic_model_cache_workspace ON semantic_model_cache(workspace_id, dataset_id);
      `);

      // Entity aggregates table (for efficient querying)
      await request.query(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'entity_aggregates')
        CREATE TABLE entity_aggregates (
          id BIGINT PRIMARY KEY IDENTITY(1,1),
          workspace_id NVARCHAR(MAX) NOT NULL,
          dataset_id NVARCHAR(MAX) NOT NULL,
          entity_type NVARCHAR(50) NOT NULL,
          total_count INT,
          hidden_count INT,
          used_in_reports_count INT,
          cached_at DATETIME2 DEFAULT GETUTCDATE(),
          UNIQUE(workspace_id, dataset_id, entity_type)
        );
        CREATE INDEX idx_entity_aggregates_model ON entity_aggregates(workspace_id, dataset_id);
      `);

      // Entity relationship cache (denormalized for fast queries)
      await request.query(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'entity_relationships_cache')
        CREATE TABLE entity_relationships_cache (
          id BIGINT PRIMARY KEY IDENTITY(1,1),
          workspace_id NVARCHAR(MAX) NOT NULL,
          dataset_id NVARCHAR(MAX) NOT NULL,
          entity_id NVARCHAR(MAX) NOT NULL,
          depends_on_ids NVARCHAR(MAX),
          depended_on_by_ids NVARCHAR(MAX),
          relationship_filters NVARCHAR(MAX),
          relationship_filtered_by NVARCHAR(MAX),
          cached_at DATETIME2 DEFAULT GETUTCDATE(),
          UNIQUE(workspace_id, dataset_id, entity_id)
        );
        CREATE INDEX idx_entity_relationships_model ON entity_relationships_cache(workspace_id, dataset_id, entity_id);
      `);

      // Entity statistics cache
      await request.query(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'entity_statistics_cache')
        CREATE TABLE entity_statistics_cache (
          id BIGINT PRIMARY KEY IDENTITY(1,1),
          workspace_id NVARCHAR(MAX) NOT NULL,
          dataset_id NVARCHAR(MAX) NOT NULL,
          entity_id NVARCHAR(MAX) NOT NULL,
          table_name NVARCHAR(MAX),
          column_name NVARCHAR(MAX),
          row_count BIGINT,
          cardinality BIGINT,
          is_hidden BIT,
          entity_type NVARCHAR(50),
          cached_at DATETIME2 DEFAULT GETUTCDATE(),
          UNIQUE(workspace_id, dataset_id, entity_id)
        );
        CREATE INDEX idx_entity_statistics_model ON entity_statistics_cache(workspace_id, dataset_id);
      `);

      // Report usage cache
      await request.query(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'entity_report_usage_cache')
        CREATE TABLE entity_report_usage_cache (
          id BIGINT PRIMARY KEY IDENTITY(1,1),
          workspace_id NVARCHAR(MAX) NOT NULL,
          dataset_id NVARCHAR(MAX) NOT NULL,
          entity_id NVARCHAR(MAX) NOT NULL,
          report_count INT,
          direct_report_count INT,
          usage_summary_json NVARCHAR(MAX),
          cached_at DATETIME2 DEFAULT GETUTCDATE(),
          UNIQUE(workspace_id, dataset_id, entity_id)
        );
        CREATE INDEX idx_entity_report_usage_model ON entity_report_usage_cache(workspace_id, dataset_id);
      `);

      console.log("[SemanticAnalyzerCache][sql] Schema initialized successfully");
    } catch (error) {
      console.error("[SemanticAnalyzerCache][sql] Schema initialization failed:", error?.message);
      throw error;
    } finally {
      if (connection) {
        await connection.close();
      }
    }
  }

  async isCacheValid(workspaceId, datasetId) {
    let connection;
    try {
      connection = await this._connect();
      const result = await connection
        .request()
        .input("workspace_id", this.sql.NVarChar(this.sql.MAX), workspaceId)
        .input("dataset_id", this.sql.NVarChar(this.sql.MAX), datasetId)
        .query(`
          SELECT TOP 1 is_valid
          FROM semantic_model_cache
          WHERE workspace_id = @workspace_id
            AND dataset_id = @dataset_id
            AND is_valid = 1
            AND expires_at > GETUTCDATE()
        `);
      return result.recordset.length > 0;
    } catch (error) {
      console.warn("[SemanticAnalyzerCache][sql] Cache validation check failed:", error?.message);
      return false;
    } finally {
      if (connection) await connection.close();
    }
  }

  async getCachedModelData(workspaceId, datasetId) {
    let connection;
    try {
      connection = await this._connect();
      const result = await connection
        .request()
        .input("workspace_id", this.sql.NVarChar(this.sql.MAX), workspaceId)
        .input("dataset_id", this.sql.NVarChar(this.sql.MAX), datasetId)
        .query(`
          SELECT TOP 1
            entities_json,
            dependencies_json,
            entity_relationships_json,
            aggregates_json
          FROM semantic_model_cache
          WHERE workspace_id = @workspace_id
            AND dataset_id = @dataset_id
            AND is_valid = 1
            AND expires_at > GETUTCDATE()
        `);

      if (result.recordset.length === 0) return null;

      const row = result.recordset[0];
      return {
        entities: JSON.parse(row.entities_json || "[]"),
        dependencies: JSON.parse(row.dependencies_json || "[]"),
        relationships: JSON.parse(row.entity_relationships_json || "{}"),
        aggregates: JSON.parse(row.aggregates_json || "{}"),
      };
    } catch (error) {
      console.warn("[SemanticAnalyzerCache][sql] Failed to retrieve cached data:", error?.message);
      return null;
    } finally {
      if (connection) await connection.close();
    }
  }

  async cacheModelData(
    workspaceId,
    datasetId,
    workspaceName,
    datasetName,
    entities,
    dependencies,
    relationships,
    aggregates,
    ttlMinutes
  ) {
    let connection;
    try {
      connection = await this._connect();
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

      await connection
        .request()
        .input("workspace_id", this.sql.NVarChar(this.sql.MAX), workspaceId)
        .input("dataset_id", this.sql.NVarChar(this.sql.MAX), datasetId)
        .input("workspace_name", this.sql.NVarChar(this.sql.MAX), workspaceName || "")
        .input("dataset_name", this.sql.NVarChar(this.sql.MAX), datasetName || "")
        .input("entities_json", this.sql.NVarChar(this.sql.MAX), JSON.stringify(entities))
        .input("dependencies_json", this.sql.NVarChar(this.sql.MAX), JSON.stringify(dependencies))
        .input("relationships_json", this.sql.NVarChar(this.sql.MAX), JSON.stringify(relationships))
        .input("aggregates_json", this.sql.NVarChar(this.sql.MAX), JSON.stringify(aggregates))
        .input("expires_at", this.sql.DateTime2, expiresAt)
        .query(`
          MERGE INTO semantic_model_cache AS target
          USING (SELECT @workspace_id AS workspace_id, @dataset_id AS dataset_id) AS src
          ON target.workspace_id = src.workspace_id AND target.dataset_id = src.dataset_id
          WHEN MATCHED THEN
            UPDATE SET
              entities_json = @entities_json,
              dependencies_json = @dependencies_json,
              entity_relationships_json = @relationships_json,
              aggregates_json = @aggregates_json,
              is_valid = 1,
              cached_at = GETUTCDATE(),
              expires_at = @expires_at,
              row_version = row_version + 1
          WHEN NOT MATCHED THEN
            INSERT (workspace_id, dataset_id, workspace_name, dataset_name,
                    entities_json, dependencies_json, entity_relationships_json,
                    aggregates_json, is_valid, expires_at)
            VALUES (@workspace_id, @dataset_id, @workspace_name, @dataset_name,
                    @entities_json, @dependencies_json, @relationships_json,
                    @aggregates_json, 1, @expires_at);
        `);

      console.log("[SemanticAnalyzerCache][sql] Model cache updated:", {
        workspace_id: workspaceId,
        dataset_id: datasetId,
        entities_count: entities.length,
        expires_at: expiresAt.toISOString(),
      });
    } catch (error) {
      console.error("[SemanticAnalyzerCache][sql] Failed to cache model data:", error?.message);
      throw error;
    } finally {
      if (connection) await connection.close();
    }
  }

  async invalidateCache(workspaceId, datasetId) {
    let connection;
    try {
      connection = await this._connect();
      await connection
        .request()
        .input("workspace_id", this.sql.NVarChar(this.sql.MAX), workspaceId)
        .input("dataset_id", this.sql.NVarChar(this.sql.MAX), datasetId)
        .query(`
          UPDATE semantic_model_cache
          SET is_valid = 0, expires_at = GETUTCDATE()
          WHERE workspace_id = @workspace_id AND dataset_id = @dataset_id
        `);
      console.log("[SemanticAnalyzerCache][sql] Cache invalidated:", { workspaceId, datasetId });
    } catch (error) {
      console.error("[SemanticAnalyzerCache][sql] Failed to invalidate cache:", error?.message);
      throw error;
    } finally {
      if (connection) await connection.close();
    }
  }

  async cleanExpiredCache() {
    let connection;
    try {
      connection = await this._connect();
      const result = await connection.request().query(`
        DELETE FROM semantic_model_cache WHERE expires_at <= GETUTCDATE();
        SELECT @@ROWCOUNT AS deletedRows;
      `);
      const deletedRows = result.recordset[0]?.deletedRows || 0;
      console.log("[SemanticAnalyzerCache][sql] Expired entries cleaned:", { deletedRows });
      return { deletedRows };
    } catch (error) {
      console.error("[SemanticAnalyzerCache][sql] Failed to clean expired cache:", error?.message);
      throw error;
    } finally {
      if (connection) await connection.close();
    }
  }
}

// ---------------------------------------------------------------------------
// SemanticAnalyzerCacheService — public facade that delegates to a backend
// ---------------------------------------------------------------------------

/**
 * Public cache service.
 *
 * Default behaviour (no config required):
 *   Uses the in-memory backend. Data is lost on server restart but the service
 *   is fully functional with zero extra setup.
 *
 * With SQL config:
 *   Attempts to promote to the SQL backend. If the connection or schema init
 *   fails it silently falls back to the in-memory backend.
 *
 * Usage:
 *   const cache = new SemanticAnalyzerCacheService();
 *   await cache.initialize({ server: '...', database: '...', ttlMinutes: 60 });
 *   // or without SQL:
 *   await cache.initialize({ ttlMinutes: 60 });
 */
class SemanticAnalyzerCacheService {
  constructor() {
    /** @type {MemoryCacheBackend|SqlCacheBackend} */
    this.backend = new MemoryCacheBackend();
    this.cacheConfig = {
      ttlMinutes: 24 * 60,
      enablePersistence: true,
    };
  }

  /** Active backend name ("memory" | "sql") */
  get backendName() {
    return this.backend.backendName;
  }

  /**
   * Configure the cache service.
   * SQL config is optional — omitting server/database keeps the memory backend.
   * @param {Object} [config]
   * @param {string} [config.server]        - SQL Server hostname/IP
   * @param {string} [config.database]      - Database name
   * @param {number} [config.ttlMinutes]    - Cache TTL (default: 1440)
   * @param {boolean} [config.enablePersistence] - Set false to bypass cache writes
   * @returns {Promise<void>}
   */
  async initialize(config = {}) {
    if (config.ttlMinutes != null) this.cacheConfig.ttlMinutes = config.ttlMinutes;
    if (config.enablePersistence !== undefined) {
      this.cacheConfig.enablePersistence = config.enablePersistence;
    }

    if (!config.server || !config.database) {
      console.log(
        "[SemanticAnalyzerCache] No SQL config provided — using in-memory cache (data will not persist across restarts)"
      );
      return;
    }

    // Attempt to promote to SQL backend
    let sqlBackend;
    try {
      sqlBackend = new SqlCacheBackend(config, this.cacheConfig);
      await sqlBackend.initializeSchema();
      this.backend = sqlBackend;
      console.log("[SemanticAnalyzerCache] SQL backend active:", {
        server: config.server,
        database: config.database,
        ttlMinutes: this.cacheConfig.ttlMinutes,
      });
    } catch (err) {
      console.warn(
        "[SemanticAnalyzerCache] SQL backend unavailable, falling back to in-memory cache:",
        err?.message
      );
      // backend stays as MemoryCacheBackend
    }
  }

  /** @returns {Promise<boolean>} */
  async isCacheValid(workspaceId, datasetId) {
    if (!this.cacheConfig.enablePersistence) return false;
    return this.backend.isCacheValid(workspaceId, datasetId);
  }

  /** @returns {Promise<{entities, dependencies, relationships, aggregates}|null>} */
  async getCachedModelData(workspaceId, datasetId) {
    if (!this.cacheConfig.enablePersistence) return null;
    return this.backend.getCachedModelData(workspaceId, datasetId);
  }

  /** @returns {Promise<void>} */
  async cacheModelData(
    workspaceId,
    datasetId,
    workspaceName,
    datasetName,
    entities,
    dependencies,
    relationships,
    aggregates
  ) {
    if (!this.cacheConfig.enablePersistence) return;
    return this.backend.cacheModelData(
      workspaceId,
      datasetId,
      workspaceName,
      datasetName,
      entities,
      dependencies,
      relationships,
      aggregates,
      this.cacheConfig.ttlMinutes
    );
  }

  /** @returns {Promise<void>} */
  async invalidateCache(workspaceId, datasetId) {
    return this.backend.invalidateCache(workspaceId, datasetId);
  }

  /** @returns {Promise<{deletedRows: number}>} */
  async cleanExpiredCache() {
    return this.backend.cleanExpiredCache();
  }
}

module.exports = SemanticAnalyzerCacheService;
