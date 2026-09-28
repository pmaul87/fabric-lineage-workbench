/**
 * Report Scanner Persistence Service
 * Handles database operations for storing and querying report scan results
 * Target: Fabric SQL Database or SQL Warehouse
 */

const crypto = require("crypto");
const sql = require("mssql");
const https = require("https");

class ReportScannerPersistenceService {
  constructor() {
    this.connectionConfig = null;
    this.servicePrincipal = null;
    this.cachedToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Initialize database connection configuration
   * @param {Object} config - SQL connection configuration
   * @param {string} config.server - SQL server endpoint
   * @param {string} config.database - Database name
   * @param {string} config.tenantId - Azure AD tenant ID (optional)
   * @param {string} config.clientId - Service principal client ID (optional)
   * @param {string} config.clientSecret - Service principal client secret (optional)
   */
  initialize(config) {
    const schema = this.normalizeSchemaName(config.schema);
    this.connectionConfig = {
      server: config.server,
      database: config.database,
      schema,
      persistReportScanner: config.persistReportScanner !== false,
      persistSnapshots: config.persistSnapshots !== false,
      options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 30000,
        requestTimeout: 30000,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    // Store service principal credentials if provided
    if (config.tenantId && config.clientId && config.clientSecret) {
      this.servicePrincipal = {
        tenantId: config.tenantId,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      };
      console.log("[ReportScannerPersistence] Configuration initialized with service principal");
    } else {
      console.log("[ReportScannerPersistence] Configuration initialized without service principal (delegated tokens only)");
    }

    console.log("[ReportScannerPersistence] Configuration initialized", {
      server: config.server,
      database: config.database,
      schema,
      hasServicePrincipal: !!this.servicePrincipal,
    });
  }

  normalizeSchemaName(schemaName) {
    const candidate = String(schemaName || "dbo").trim();
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate) ? candidate : "dbo";
  }

  quoteIdentifier(identifier) {
    return `[${String(identifier).replace(/]/g, "]]")}]`;
  }

  tableName(name) {
    const schemaName = this.connectionConfig?.schema || "dbo";
    return `${this.quoteIdentifier(schemaName)}.${this.quoteIdentifier(name)}`;
  }

  /**
   * Acquire Azure AD access token for SQL Database
   * @returns {Promise<string>} Access token
   */
  async acquireSqlToken() {
    if (!this.servicePrincipal) {
      throw new Error("Service principal credentials not configured. Set TENANT_ID, BACKEND_APPID, and BACKEND_CLIENT_SECRET.");
    }

    // Return cached token if still valid (with 5 minute buffer)
    if (this.cachedToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      return this.cachedToken;
    }

    const tokenEndpoint = `https://login.microsoftonline.com/${this.servicePrincipal.tenantId}/oauth2/v2.0/token`;
    const postData = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.servicePrincipal.clientId,
      client_secret: this.servicePrincipal.clientSecret,
      scope: "https://database.windows.net/.default",
    }).toString();

    return new Promise((resolve, reject) => {
      const req = https.request(
        tokenEndpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          let responseBody = "";
          res.on("data", (chunk) => (responseBody += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              const tokenResponse = JSON.parse(responseBody);
              this.cachedToken = tokenResponse.access_token;
              this.tokenExpiry = Date.now() + tokenResponse.expires_in * 1000;
              resolve(this.cachedToken);
            } else {
              reject(new Error(`Failed to acquire SQL token: ${res.statusCode} - ${responseBody}`));
            }
          });
        }
      );

      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  }

  /**
   * Create a connection pool with Azure AD authentication
   * @returns {Promise<sql.ConnectionPool>}
   */
  async createConnectionPool() {
    if (!this.connectionConfig) {
      throw new Error("Service not initialized. Call initialize() first.");
    }

    const accessToken = await this.acquireSqlToken();

    const poolConfig = {
      ...this.connectionConfig,
      authentication: {
        type: "azure-active-directory-access-token",
        options: {
          token: accessToken,
        },
      },
    };

    const pool = new sql.ConnectionPool(poolConfig);
    await pool.connect();
    return pool;
  }

  /**
   * Store complete report scan results
   * @param {Object} scanData - Report scan data
   * @returns {Promise<string>} Report UID
   */
  async storeReportScan(scanData) {
    if (!this.connectionConfig) {
      throw new Error("Service not initialized. Call initialize() first.");
    }

    const pool = await this.createConnectionPool();

    try {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      // 1. Insert Report
      const reportResult = await transaction.request()
        .input("reportId", sql.NVarChar(100), scanData.reportId)
        .input("workspaceId", sql.NVarChar(100), scanData.workspaceId)
        .input("name", sql.NVarChar(500), scanData.reportName)
        .input("datasetName", sql.NVarChar(500), scanData.datasetName || null)
        .input("datasetId", sql.NVarChar(100), scanData.datasetId || null)
        .input("scannedByUser", sql.NVarChar(500), scanData.scannedByUser || null)
        .input("definitionFormat", sql.NVarChar(50), scanData.definitionFormat || null)
        .input("definitionSource", sql.NVarChar(50), scanData.definitionSource || null)
        .input("definitionAttempts", sql.Int, scanData.definitionAttempts || null)
        .query(`
          INSERT INTO ${this.tableName("Report")} (ReportId, WorkspaceId, Name, DatasetName, DatasetId, ScannedByUser, DefinitionFormat, DefinitionSource, DefinitionAttempts)
          OUTPUT INSERTED.UID
          VALUES (@reportId, @workspaceId, @name, @datasetName, @datasetId, @scannedByUser, @definitionFormat, @definitionSource, @definitionAttempts)
        `);

      const reportUID = reportResult.recordset[0].UID;

      // 2. Insert Pages
      const pageUIDMap = new Map();
      if (scanData.pages && scanData.pages.length > 0) {
        for (let i = 0; i < scanData.pages.length; i++) {
          const page = scanData.pages[i];
          const pageResult = await transaction.request()
            .input("reportUID", sql.UniqueIdentifier, reportUID)
            .input("pageId", sql.NVarChar(100), page.id || null)
            .input("name", sql.NVarChar(500), page.name)
            .input("displayOrder", sql.Int, i)
            .query(`
              INSERT INTO ${this.tableName("Page")} (ReportUID, PageId, Name, DisplayOrder)
              OUTPUT INSERTED.UID
              VALUES (@reportUID, @pageId, @name, @displayOrder)
            `);

          pageUIDMap.set(page.id || page.name, pageResult.recordset[0].UID);
        }
      }

      // 3. Insert Visuals and VisualElements
      if (scanData.pages && scanData.pages.length > 0) {
        for (const page of scanData.pages) {
          const pageUID = pageUIDMap.get(page.id || page.name);

          if (page.visuals && page.visuals.length > 0) {
            for (const visual of page.visuals) {
              const visualResult = await transaction.request()
                .input("pageUID", sql.UniqueIdentifier, pageUID)
                .input("visualId", sql.NVarChar(100), visual.id || null)
                .input("title", sql.NVarChar(500), visual.title || null)
                .input("name", sql.NVarChar(500), visual.name || null)
                .input("type", sql.NVarChar(100), visual.type)
                .query(`
                  INSERT INTO ${this.tableName("Visuals")} (PageUID, VisualId, Title, Name, Type)
                  OUTPUT INSERTED.UID
                  VALUES (@pageUID, @visualId, @title, @name, @type)
                `);

              const visualUID = visualResult.recordset[0].UID;

              // Insert VisualElements
              if (visual.elements && visual.elements.length > 0) {
                for (const element of visual.elements) {
                  await transaction.request()
                    .input("visualUID", sql.UniqueIdentifier, visualUID)
                    .input("elementKey", sql.NVarChar(500), element.key || null)
                    .input("type", sql.NVarChar(100), element.kind || element.type)
                    .input("sourceTable", sql.NVarChar(500), element.tableName || null)
                    .input("sourceField", sql.NVarChar(500), element.fieldName || element.name)
                    .input("sourcePath", sql.NVarChar(1000), element.sourcePath || null)
                    .input("queryRef", sql.NVarChar(1000), element.queryRef || null)
                    .query(`
                      INSERT INTO ${this.tableName("VisualElements")} (VisualUID, ElementKey, Type, SourceTable, SourceField, SourcePath, QueryRef)
                      VALUES (@visualUID, @elementKey, @type, @sourceTable, @sourceField, @sourcePath, @queryRef)
                    `);
                }
              }
            }
          }
        }
      }

      // 4. Insert Filters
      if (scanData.filters && scanData.filters.length > 0) {
        for (const filter of scanData.filters) {
          // Determine reference UID based on filter scope
          let referenceUID = reportUID;
          let referenceType = "Report";

          if (filter.pageId) {
            referenceUID = pageUIDMap.get(filter.pageId);
            referenceType = "Page";
          }
          // Visual-level filters would need visual UID lookup if supported

          await transaction.request()
            .input("referenceUID", sql.UniqueIdentifier, referenceUID)
            .input("referenceType", sql.NVarChar(20), referenceType)
            .input("filterName", sql.NVarChar(500), filter.name || null)
            .input("sourceTable", sql.NVarChar(500), filter.tableName || null)
            .input("sourceField", sql.NVarChar(500), filter.fieldName)
            .input("filterExpression", sql.NVarChar(sql.MAX), filter.expression || null)
            .query(`
              INSERT INTO ${this.tableName("Filters")} (ReferenceUID, ReferenceType, FilterName, SourceTable, SourceField, FilterExpression)
              VALUES (@referenceUID, @referenceType, @filterName, @sourceTable, @sourceField, @filterExpression)
            `);
        }
      }

      // 5. Insert ScanHistory
      await transaction.request()
        .input("reportUID", sql.UniqueIdentifier, reportUID)
        .input("scannedByUser", sql.NVarChar(500), scanData.scannedByUser || null)
        .input("source", sql.NVarChar(50), scanData.definitionSource || null)
        .input("attempts", sql.Int, scanData.definitionAttempts || null)
        .input("success", sql.Bit, scanData.success !== false ? 1 : 0)
        .input("errorMessage", sql.NVarChar(sql.MAX), scanData.errorMessage || null)
        .input("durationMs", sql.Int, scanData.durationMs || null)
        .query(`
          INSERT INTO ${this.tableName("ScanHistory")} (ReportUID, ScannedByUser, Source, Attempts, Success, ErrorMessage, DurationMs)
          VALUES (@reportUID, @scannedByUser, @source, @attempts, @success, @errorMessage, @durationMs)
        `);

      await transaction.commit();

      console.log("[ReportScannerPersistence] Report scan stored successfully", {
        reportUID,
        reportId: scanData.reportId,
        workspaceId: scanData.workspaceId,
        pages: scanData.pages?.length || 0,
        filters: scanData.filters?.length || 0,
      });

      return reportUID;
    } catch (error) {
      console.error("[ReportScannerPersistence] Failed to store report scan", {
        reportId: scanData.reportId,
        error: error.message,
        stack: error.stack,
      });

      await transaction.rollback();
      throw error;
    } finally {
      await pool.close();
    }
  }

  /**
   * Get scan history for a specific report
   * @param {string} workspaceId - Workspace ID
   * @param {string} reportId - Report ID
   * @returns {Promise<Array>} Scan history records
   */
  async getReportScanHistory(workspaceId, reportId) {
    if (!this.connectionConfig) {
      throw new Error("Service not initialized. Call initialize() first.");
    }

    const pool = await this.createConnectionPool();

    try {
      const result = await pool.request()
        .input("workspaceId", sql.NVarChar(100), workspaceId)
        .input("reportId", sql.NVarChar(100), reportId)
        .query(`
          SELECT 
            r.UID,
            r.Name,
            r.DatasetName,
            r.ScannedAtUtc,
            r.ScannedByUser,
            sh.Success,
            sh.ErrorMessage,
            sh.DurationMs,
            (SELECT COUNT(*) FROM ${this.tableName("Page")} WHERE ReportUID = r.UID) AS PageCount,
            (SELECT COUNT(*) FROM ${this.tableName("Visuals")} v JOIN ${this.tableName("Page")} p ON v.PageUID = p.UID WHERE p.ReportUID = r.UID) AS VisualCount
          FROM ${this.tableName("Report")} r
          LEFT JOIN ${this.tableName("ScanHistory")} sh ON r.UID = sh.ReportUID
          WHERE r.WorkspaceId = @workspaceId AND r.ReportId = @reportId
          ORDER BY r.ScannedAtUtc DESC
        `);

      return result.recordset;
    } finally {
      await pool.close();
    }
  }

  /**
   * Get field usage across all scanned reports
   * @param {string} tableName - Table name filter (optional)
   * @param {string} fieldName - Field name filter (optional)
   * @returns {Promise<Array>} Field usage records
   */
  async getFieldUsage(tableName, fieldName) {
    if (!this.connectionConfig) {
      throw new Error("Service not initialized. Call initialize() first.");
    }

    const pool = await this.createConnectionPool();

    try {
      let query = `
        SELECT 
          ve.SourceTable,
          ve.SourceField,
          COUNT(DISTINCT r.UID) AS ReportCount,
          COUNT(DISTINCT v.UID) AS VisualCount,
          STRING_AGG(DISTINCT r.Name, ', ') AS Reports
        FROM ${this.tableName("VisualElements")} ve
        JOIN ${this.tableName("Visuals")} v ON ve.VisualUID = v.UID
        JOIN ${this.tableName("Page")} p ON v.PageUID = p.UID
        JOIN ${this.tableName("Report")} r ON p.ReportUID = r.UID
      `;

      const conditions = [];
      const request = pool.request();

      if (tableName) {
        conditions.push("ve.SourceTable = @tableName");
        request.input("tableName", sql.NVarChar(500), tableName);
      }

      if (fieldName) {
        conditions.push("ve.SourceField = @fieldName");
        request.input("fieldName", sql.NVarChar(500), fieldName);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }

      query += `
        GROUP BY ve.SourceTable, ve.SourceField
        ORDER BY ReportCount DESC, VisualCount DESC
      `;

      const result = await request.query(query);
      return result.recordset;
    } finally {
      await pool.close();
    }
  }

  /**
   * Get dataset usage summary
   * @returns {Promise<Array>} Dataset usage statistics
   */
  async getDatasetUsageSummary() {
    if (!this.connectionConfig) {
      throw new Error("Service not initialized. Call initialize() first.");
    }

    const pool = await this.createConnectionPool();

    try {
      const result = await pool.request().query(`
        SELECT 
          r.DatasetName,
          r.DatasetId,
          COUNT(DISTINCT r.UID) AS ReportCount,
          COUNT(DISTINCT p.UID) AS PageCount,
          COUNT(DISTINCT v.UID) AS VisualCount,
          MAX(r.ScannedAtUtc) AS LastScannedAtUtc
        FROM ${this.tableName("Report")} r
        LEFT JOIN ${this.tableName("Page")} p ON r.UID = p.ReportUID
        LEFT JOIN ${this.tableName("Visuals")} v ON p.UID = v.PageUID
        WHERE r.DatasetName IS NOT NULL
        GROUP BY r.DatasetName, r.DatasetId
        ORDER BY ReportCount DESC
      `);

      return result.recordset;
    } finally {
      await pool.close();
    }
  }

  async executeBatch(script) {
    if (!this.connectionConfig) {
      throw new Error("Service not initialized. Call initialize() first.");
    }

    const pool = await this.createConnectionPool();
    try {
      await pool.request().batch(script);
    } finally {
      await pool.close();
    }
  }

  async storeWorkbenchSnapshot(snapshotData) {
    if (!this.connectionConfig) {
      throw new Error("Service not initialized. Call initialize() first.");
    }

    const pool = await this.createConnectionPool();
    const payloadHash = crypto.createHash("sha256").update(snapshotData.payload || "").digest("hex");

    try {
      await pool.request()
        .input("snapshotId", sql.NVarChar(100), snapshotData.snapshotId)
        .input("snapshotKind", sql.NVarChar(20), snapshotData.snapshotKind)
        .input("sectionName", sql.NVarChar(50), snapshotData.sectionName || null)
        .input("entityType", sql.NVarChar(50), snapshotData.entityType || null)
        .input("entityId", sql.NVarChar(200), snapshotData.entityId || null)
        .input("workspaceId", sql.NVarChar(100), snapshotData.workspaceId || null)
        .input("displayName", sql.NVarChar(500), snapshotData.displayName || null)
        .input("label", sql.NVarChar(500), snapshotData.label || null)
        .input("savedAtUtc", sql.DateTime2, new Date(snapshotData.savedAtUtc))
        .input("oneLakeFilePath", sql.NVarChar(2000), snapshotData.oneLakeFilePath)
        .input("contentFormat", sql.NVarChar(50), snapshotData.contentFormat)
        .input("payload", sql.NVarChar(sql.MAX), snapshotData.payload)
        .input("payloadHash", sql.NVarChar(128), payloadHash)
        .input("source", sql.NVarChar(50), snapshotData.source || "InsightWorkbench")
        .query(`
          IF EXISTS (SELECT 1 FROM ${this.tableName("InsightWorkbenchSnapshot")} WHERE SnapshotId = @snapshotId)
          BEGIN
            UPDATE ${this.tableName("InsightWorkbenchSnapshot")}
            SET SnapshotKind = @snapshotKind,
                SectionName = @sectionName,
                EntityType = @entityType,
                EntityId = @entityId,
                WorkspaceId = @workspaceId,
                DisplayName = @displayName,
                Label = @label,
                SavedAtUtc = @savedAtUtc,
                OneLakeFilePath = @oneLakeFilePath,
                ContentFormat = @contentFormat,
                Payload = @payload,
                PayloadHash = @payloadHash,
                Source = @source,
                CreatedAtUtc = GETUTCDATE()
            WHERE SnapshotId = @snapshotId
          END
          ELSE
          BEGIN
            INSERT INTO ${this.tableName("InsightWorkbenchSnapshot")} (
              SnapshotId,
              SnapshotKind,
              SectionName,
              EntityType,
              EntityId,
              WorkspaceId,
              DisplayName,
              Label,
              SavedAtUtc,
              OneLakeFilePath,
              ContentFormat,
              Payload,
              PayloadHash,
              Source
            )
            VALUES (
              @snapshotId,
              @snapshotKind,
              @sectionName,
              @entityType,
              @entityId,
              @workspaceId,
              @displayName,
              @label,
              @savedAtUtc,
              @oneLakeFilePath,
              @contentFormat,
              @payload,
              @payloadHash,
              @source
            )
          END
        `);
    } finally {
      await pool.close();
    }
  }
}

module.exports = ReportScannerPersistenceService;
