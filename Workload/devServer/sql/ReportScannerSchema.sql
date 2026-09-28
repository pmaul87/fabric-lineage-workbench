-- ============================================================================
-- Insight Workbench SQL Persistence Schema
-- ============================================================================
-- Purpose: Persist Report Scanner scan results and Insight Workbench snapshots
-- Target: Fabric SQL Database or SQL Warehouse
-- Version: 1.1
-- Date: 2026-04-20
-- Notes:
--   - Replace {{SCHEMA_NAME}} at runtime before execution.
--   - Script is idempotent and can be run multiple times.
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = '{{SCHEMA_NAME}}')
BEGIN
	EXEC('CREATE SCHEMA [{{SCHEMA_NAME}}]');
END;

-- ============================================================================
-- 1. Report Table
-- ============================================================================
IF OBJECT_ID(N'[{{SCHEMA_NAME}}].[Report]', N'U') IS NULL
BEGIN
	CREATE TABLE [{{SCHEMA_NAME}}].[Report] (
		UID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
		ReportId NVARCHAR(100) NOT NULL,
		WorkspaceId NVARCHAR(100) NOT NULL,
		Name NVARCHAR(500) NOT NULL,
		DatasetName NVARCHAR(500),
		DatasetId NVARCHAR(100),
		ScannedAtUtc DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
		ScannedByUser NVARCHAR(500),
		DefinitionFormat NVARCHAR(50),
		DefinitionSource NVARCHAR(50),
		DefinitionAttempts INT,
		CONSTRAINT UQ_Report_WorkspaceReport UNIQUE (WorkspaceId, ReportId, ScannedAtUtc)
	);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Report_WorkspaceId' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[Report]'))
	CREATE INDEX IX_Report_WorkspaceId ON [{{SCHEMA_NAME}}].[Report](WorkspaceId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Report_DatasetId' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[Report]'))
	CREATE INDEX IX_Report_DatasetId ON [{{SCHEMA_NAME}}].[Report](DatasetId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Report_ScannedAtUtc' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[Report]'))
	CREATE INDEX IX_Report_ScannedAtUtc ON [{{SCHEMA_NAME}}].[Report](ScannedAtUtc DESC);

-- ============================================================================
-- 2. Page Table
-- ============================================================================
IF OBJECT_ID(N'[{{SCHEMA_NAME}}].[Page]', N'U') IS NULL
BEGIN
	CREATE TABLE [{{SCHEMA_NAME}}].[Page] (
		UID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
		ReportUID UNIQUEIDENTIFIER NOT NULL,
		PageId NVARCHAR(100),
		Name NVARCHAR(500) NOT NULL,
		DisplayOrder INT,
		CONSTRAINT FK_Page_Report FOREIGN KEY (ReportUID)
			REFERENCES [{{SCHEMA_NAME}}].[Report](UID) ON DELETE CASCADE
	);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Page_ReportUID' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[Page]'))
	CREATE INDEX IX_Page_ReportUID ON [{{SCHEMA_NAME}}].[Page](ReportUID);

-- ============================================================================
-- 3. Visuals Table
-- ============================================================================
IF OBJECT_ID(N'[{{SCHEMA_NAME}}].[Visuals]', N'U') IS NULL
BEGIN
	CREATE TABLE [{{SCHEMA_NAME}}].[Visuals] (
		UID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
		PageUID UNIQUEIDENTIFIER NOT NULL,
		VisualId NVARCHAR(100),
		Title NVARCHAR(500),
		Name NVARCHAR(500),
		Type NVARCHAR(100) NOT NULL,
		CONSTRAINT FK_Visuals_Page FOREIGN KEY (PageUID)
			REFERENCES [{{SCHEMA_NAME}}].[Page](UID) ON DELETE CASCADE
	);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Visuals_PageUID' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[Visuals]'))
	CREATE INDEX IX_Visuals_PageUID ON [{{SCHEMA_NAME}}].[Visuals](PageUID);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Visuals_Type' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[Visuals]'))
	CREATE INDEX IX_Visuals_Type ON [{{SCHEMA_NAME}}].[Visuals](Type);

-- ============================================================================
-- 4. VisualElements Table
-- ============================================================================
IF OBJECT_ID(N'[{{SCHEMA_NAME}}].[VisualElements]', N'U') IS NULL
BEGIN
	CREATE TABLE [{{SCHEMA_NAME}}].[VisualElements] (
		UID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
		VisualUID UNIQUEIDENTIFIER NOT NULL,
		ElementKey NVARCHAR(500),
		Type NVARCHAR(100) NOT NULL,
		SourceTable NVARCHAR(500),
		SourceField NVARCHAR(500) NOT NULL,
		SourcePath NVARCHAR(1000),
		QueryRef NVARCHAR(1000),
		CONSTRAINT FK_VisualElements_Visual FOREIGN KEY (VisualUID)
			REFERENCES [{{SCHEMA_NAME}}].[Visuals](UID) ON DELETE CASCADE
	);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VisualElements_VisualUID' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[VisualElements]'))
	CREATE INDEX IX_VisualElements_VisualUID ON [{{SCHEMA_NAME}}].[VisualElements](VisualUID);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VisualElements_SourceTable' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[VisualElements]'))
	CREATE INDEX IX_VisualElements_SourceTable ON [{{SCHEMA_NAME}}].[VisualElements](SourceTable);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VisualElements_SourceField' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[VisualElements]'))
	CREATE INDEX IX_VisualElements_SourceField ON [{{SCHEMA_NAME}}].[VisualElements](SourceField);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VisualElements_Type' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[VisualElements]'))
	CREATE INDEX IX_VisualElements_Type ON [{{SCHEMA_NAME}}].[VisualElements](Type);

-- ============================================================================
-- 5. Filters Table
-- ============================================================================
IF OBJECT_ID(N'[{{SCHEMA_NAME}}].[Filters]', N'U') IS NULL
BEGIN
	CREATE TABLE [{{SCHEMA_NAME}}].[Filters] (
		UID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
		ReferenceUID UNIQUEIDENTIFIER NOT NULL,
		ReferenceType NVARCHAR(20) NOT NULL,
		FilterName NVARCHAR(500),
		SourceTable NVARCHAR(500),
		SourceField NVARCHAR(500) NOT NULL,
		FilterExpression NVARCHAR(MAX),
		CONSTRAINT CHK_Filters_ReferenceType CHECK (ReferenceType IN ('Report', 'Page', 'Visual'))
	);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Filters_ReferenceUID' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[Filters]'))
	CREATE INDEX IX_Filters_ReferenceUID ON [{{SCHEMA_NAME}}].[Filters](ReferenceUID, ReferenceType);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Filters_SourceTable' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[Filters]'))
	CREATE INDEX IX_Filters_SourceTable ON [{{SCHEMA_NAME}}].[Filters](SourceTable);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Filters_SourceField' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[Filters]'))
	CREATE INDEX IX_Filters_SourceField ON [{{SCHEMA_NAME}}].[Filters](SourceField);

-- ============================================================================
-- 6. ScanHistory Table
-- ============================================================================
IF OBJECT_ID(N'[{{SCHEMA_NAME}}].[ScanHistory]', N'U') IS NULL
BEGIN
	CREATE TABLE [{{SCHEMA_NAME}}].[ScanHistory] (
		UID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
		ReportUID UNIQUEIDENTIFIER NOT NULL,
		ScannedAtUtc DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
		ScannedByUser NVARCHAR(500),
		Source NVARCHAR(50),
		Attempts INT,
		Success BIT NOT NULL,
		ErrorMessage NVARCHAR(MAX),
		DurationMs INT,
		CONSTRAINT FK_ScanHistory_Report FOREIGN KEY (ReportUID)
			REFERENCES [{{SCHEMA_NAME}}].[Report](UID) ON DELETE CASCADE
	);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ScanHistory_ReportUID' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[ScanHistory]'))
	CREATE INDEX IX_ScanHistory_ReportUID ON [{{SCHEMA_NAME}}].[ScanHistory](ReportUID);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ScanHistory_ScannedAtUtc' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[ScanHistory]'))
	CREATE INDEX IX_ScanHistory_ScannedAtUtc ON [{{SCHEMA_NAME}}].[ScanHistory](ScannedAtUtc DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ScanHistory_Success' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[ScanHistory]'))
	CREATE INDEX IX_ScanHistory_Success ON [{{SCHEMA_NAME}}].[ScanHistory](Success);

-- ============================================================================
-- 7. InsightWorkbenchSnapshot Table
-- Stores section snapshots and raw entity snapshots for SQL querying.
-- ============================================================================
IF OBJECT_ID(N'[{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot]', N'U') IS NULL
BEGIN
	CREATE TABLE [{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot] (
		UID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
		SnapshotId NVARCHAR(100) NOT NULL,
		SnapshotKind NVARCHAR(20) NOT NULL,
		SectionName NVARCHAR(50),
		EntityType NVARCHAR(50),
		EntityId NVARCHAR(200),
		WorkspaceId NVARCHAR(100),
		DisplayName NVARCHAR(500),
		Label NVARCHAR(500),
		SavedAtUtc DATETIME2 NOT NULL,
		OneLakeFilePath NVARCHAR(2000) NOT NULL,
		ContentFormat NVARCHAR(50) NOT NULL,
		Payload NVARCHAR(MAX) NOT NULL,
		PayloadHash NVARCHAR(128),
		Source NVARCHAR(50) NOT NULL DEFAULT 'InsightWorkbench',
		CreatedAtUtc DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
		CONSTRAINT UQ_InsightWorkbenchSnapshot_SnapshotId UNIQUE (SnapshotId),
		CONSTRAINT CHK_InsightWorkbenchSnapshot_Kind CHECK (SnapshotKind IN ('Section', 'Entity'))
	);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_InsightWorkbenchSnapshot_SavedAtUtc' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot]'))
	CREATE INDEX IX_InsightWorkbenchSnapshot_SavedAtUtc ON [{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot](SavedAtUtc DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_InsightWorkbenchSnapshot_SectionName' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot]'))
	CREATE INDEX IX_InsightWorkbenchSnapshot_SectionName ON [{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot](SectionName, SavedAtUtc DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_InsightWorkbenchSnapshot_Entity' AND object_id = OBJECT_ID(N'[{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot]'))
	CREATE INDEX IX_InsightWorkbenchSnapshot_Entity ON [{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot](EntityType, EntityId, SavedAtUtc DESC);

-- ============================================================================
-- Example Queries
-- ============================================================================

-- Query 1: Find all visuals using a specific field
-- SELECT r.Name AS ReportName, p.Name AS PageName, v.Title AS VisualTitle, ve.SourceField
-- FROM [{{SCHEMA_NAME}}].[VisualElements] ve
-- JOIN [{{SCHEMA_NAME}}].[Visuals] v ON ve.VisualUID = v.UID
-- JOIN [{{SCHEMA_NAME}}].[Page] p ON v.PageUID = p.UID
-- JOIN [{{SCHEMA_NAME}}].[Report] r ON p.ReportUID = r.UID
-- WHERE ve.SourceTable = 'Sales' AND ve.SourceField = 'Revenue';

-- Query 2: Report usage by dataset
-- SELECT r.DatasetName, COUNT(DISTINCT r.UID) AS ReportCount,
--        COUNT(DISTINCT p.UID) AS PageCount,
--        COUNT(DISTINCT v.UID) AS VisualCount
-- FROM [{{SCHEMA_NAME}}].[Report] r
-- LEFT JOIN [{{SCHEMA_NAME}}].[Page] p ON r.UID = p.ReportUID
-- LEFT JOIN [{{SCHEMA_NAME}}].[Visuals] v ON p.UID = v.PageUID
-- GROUP BY r.DatasetName;

-- Query 3: Snapshot inventory by section
-- SELECT SnapshotKind, SectionName, EntityType, DisplayName, SavedAtUtc, OneLakeFilePath
-- FROM [{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot]
-- ORDER BY SavedAtUtc DESC;

-- Query 4: Latest TMDL snapshots per model
-- SELECT EntityId, DisplayName, MAX(SavedAtUtc) AS LastSnapshotUtc
-- FROM [{{SCHEMA_NAME}}].[InsightWorkbenchSnapshot]
-- WHERE EntityType = 'tmdl'
-- GROUP BY EntityId, DisplayName;
