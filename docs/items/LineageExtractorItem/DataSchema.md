# Lineage Data Schema

Phase 0: Scaffolding - Data schema documentation

## Overview

This document defines the data schema for lineage metadata stored in OneLake lakehouse.

## Storage Structure

```
Files/
└── lineage/
    ├── raw/                         # Raw extraction data
    │   ├── semantic_models/
    │   │   └── {model_id}.json
    │   ├── reports/
    │   │   └── {report_id}.json
    │   ├── notebooks/
    │   │   └── {notebook_id}.json
    │   ├── lakehouses/
    │   │   └── {lakehouse_id}.json
    │   ├── warehouses/
    │   │   └── {warehouse_id}.json
    │   ├── pipelines/
    │   │   └── {pipeline_id}.json
    │   └── dataflows/
    │       └── {dataflow_id}.json
    ├── processed/                   # Processed lineage graphs
    │   ├── {workspace_id}_graph.json
    │   └── snapshots/
    │       └── {workspace_id}_{timestamp}.json
    └── metadata/                    # Extraction metadata
        ├── extraction_log_{timestamp}.json
        └── config.json
```

## Raw Data Schemas (Phase 1)

### Semantic Model Metadata
```json
{
  "modelId": "string",
  "modelName": "string",
  "workspaceId": "string",
  "extractedAt": "ISO8601 timestamp",
  "tables": [
    {
      "name": "string",
      "description": "string"
    }
  ],
  "columns": [
    {
      "columnName": "string",
      "tableName": "string",
      "dataType": "string",
      "sourceColumn": "string",
      "description": "string"
    }
  ],
  "measures": [
    {
      "measureName": "string",
      "tableName": "string",
      "daxExpression": "string",
      "displayFolder": "string",
      "description": "string"
    }
  ],
  "relationships": [
    {
      "fromTable": "string",
      "fromColumn": "string",
      "toTable": "string",
      "toColumn": "string",
      "cardinality": "OneToMany | ManyToOne | OneToOne",
      "crossFilterDirection": "SingleDirection | BothDirections"
    }
  ]
}
```

### Report Metadata
```json
{
  "reportId": "string",
  "reportName": "string",
  "workspaceId": "string",
  "extractedAt": "ISO8601 timestamp",
  "pages": [
    {
      "pageName": "string",
      "displayName": "string",
      "ordinal": 0
    }
  ],
  "visuals": [
    {
      "visualId": "string",
      "visualType": "string",
      "pageName": "string",
      "dataBindings": [
        {
          "column": "string",
          "table": "string",
          "aggregation": "string"
        }
      ]
    }
  ],
  "dataSources": [
    {
      "dataSourceId": "string",
      "dataSourceType": "SemanticModel | Other",
      "connectionDetails": {}
    }
  ]
}
```

### Notebook Metadata
```json
{
  "notebookId": "string",
  "notebookName": "string",
  "workspaceId": "string",
  "extractedAt": "ISO8601 timestamp",
  "inputs": [
    {
      "sourceType": "Lakehouse | Warehouse | Other",
      "sourceId": "string",
      "tableName": "string"
    }
  ],
  "outputs": [
    {
      "targetType": "Lakehouse | Warehouse | Other",
      "targetId": "string",
      "tableName": "string"
    }
  ]
}
```

### Lakehouse Metadata
```json
{
  "lakehouseId": "string",
  "lakehouseName": "string",
  "workspaceId": "string",
  "extractedAt": "ISO8601 timestamp",
  "tables": [
    {
      "tableName": "string",
      "schema": [
        {
          "columnName": "string",
          "dataType": "string",
          "nullable": true
        }
      ]
    }
  ]
}
```

### Data Warehouse Metadata
```json
{
  "warehouseId": "string",
  "warehouseName": "string",
  "workspaceId": "string",
  "extractedAt": "ISO8601 timestamp",
  "tables": [
    {
      "tableName": "string",
      "schemaName": "string",
      "tableType": "Table | View",
      "columns": [
        {
          "columnName": "string",
          "dataType": "string",
          "nullable": true
        }
      ]
    }
  ],
  "views": [
    {
      "viewName": "string",
      "schemaName": "string",
      "definition": "string"
    }
  ]
}
```

### Pipeline Metadata
```json
{
  "pipelineId": "string",
  "pipelineName": "string",
  "workspaceId": "string",
  "extractedAt": "ISO8601 timestamp",
  "activities": [
    {
      "activityName": "string",
      "activityType": "Copy | Dataflow | Notebook | Other",
      "inputs": ["string"],
      "outputs": ["string"],
      "dependencies": ["string"]
    }
  ]
}
```

### Dataflow Metadata
```json
{
  "dataflowId": "string",
  "dataflowName": "string",
  "workspaceId": "string",
  "extractedAt": "ISO8601 timestamp",
  "sources": [
    {
      "sourceName": "string",
      "sourceType": "string",
      "connectionDetails": {}
    }
  ],
  "transformations": [
    {
      "stepName": "string",
      "operation": "string"
    }
  ],
  "destinations": [
    {
      "destinationType": "Lakehouse | Warehouse | Other",
      "destinationId": "string",
      "tableName": "string"
    }
  ]
}
```

## Processed Graph Schema (Phase 1)

### Lineage Graph
```json
{
  "graphId": "string",
  "workspaceId": "string",
  "createdAt": "ISO8601 timestamp",
  "metadata": {
    "extractionRunId": "string",
    "nodeCount": 0,
    "edgeCount": 0
  },
  "nodes": [
    {
      "id": "string",
      "type": "SemanticModel | Report | Notebook | Lakehouse | Warehouse | Pipeline | Dataflow | Column | Measure | Visual | Table",
      "name": "string",
      "artifactId": "string",
      "properties": {}
    }
  ],
  "edges": [
    {
      "from": "string",
      "to": "string",
      "relationshipType": "uses | derivedFrom | containedIn",
      "properties": {}
    }
  ]
}
```

## Extraction Metadata Schemas (Phase 1)

### Extraction Log
```json
{
  "extractionRunId": "string",
  "workspaceId": "string",
  "startTime": "ISO8601 timestamp",
  "endTime": "ISO8601 timestamp",
  "status": "running | completed | failed | partial",
  "config": {
    "artifactTypes": ["string"],
    "targetLakehouseId": "string"
  },
  "results": {
    "totalArtifacts": 0,
    "successful": 0,
    "failed": 0,
    "errors": [
      {
        "artifactId": "string",
        "errorMessage": "string",
        "timestamp": "ISO8601 timestamp"
      }
    ]
  }
}
```

### Configuration
```json
{
  "version": "1.0",
  "updatedAt": "ISO8601 timestamp",
  "targetWorkspaces": ["string"],
  "targetLakehouseId": "string",
  "artifactTypes": ["string"],
  "granularitySettings": {
    "semanticModels": {
      "extractColumns": true,
      "extractMeasures": true,
      "extractRelationships": true
    },
    "reports": {
      "extractVisuals": true,
      "extractPages": true,
      "extractDataSources": true
    }
  },
  "lastExtraction": "ISO8601 timestamp"
}
```

## Version History

### v1.0 (Phase 0)
- Initial schema definition
- Raw data schemas for all artifact types
- Processed graph schema
- Extraction metadata schemas

## TODO Phase 1

- [ ] Implement JSON schema validation
- [ ] Add schema versioning mechanism
- [ ] Create data transformation utilities
- [ ] Add example data files
- [ ] Document migration paths for schema updates
- [ ] Add compression strategies for large graphs
- [ ] Implement schema validation in OneLakeLineageStorage
