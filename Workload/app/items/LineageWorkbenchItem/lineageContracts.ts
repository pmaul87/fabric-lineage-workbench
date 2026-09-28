export type RawRecord = Record<string, unknown>;

export type LineageEntityType =
  | "artifact"
  | "report"
  | "page"
  | "visual"
  | "semantic_model"
  | "semantic_object"
  | "table"
  | "column"
  | "measure"
  | "dataflow"
  | "notebook"
  | "lakehouse"
  | "lakehouse_table"
  | "lakehouse_column"
  | "warehouse"
  | "warehouse_table"
  | "unknown";

const asString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return undefined;
};

export interface ResolvedNodeFields {
  nodeId?: string;
  nodeName?: string;
  nodeType: LineageEntityType;
  parentNodeId?: string;
  datasetId?: string;
  tableName?: string;
}

export interface ResolvedEdgeFields {
  edgeId?: string;
  fromNodeId?: string;
  toNodeId?: string;
  edgeType: string;
  lineageId?: string;
}

export function normalizeEntityType(entityType: string | undefined): LineageEntityType {
  const normalized = (entityType ?? "unknown").toLowerCase().replace(/[-\s]/g, "_");
  
  switch (normalized) {
    case "artifact":
      return "artifact";

    // Reports and pages
    case "report":
      return "report";
    case "page":
      return "page";
    case "visual":
      return "visual";
      
    // Semantic models and tables
    case "semantic_model":
    case "semanticmodel":
    case "dataset":
      return "semantic_model";
    case "semantic_object":
    case "semanticobject":
      return "semantic_object";
      
    // Tables and columns (semantic model level)
    case "table":
      return "table";
    case "column":
      return "column";
    case "measure":
      return "measure";
      
    // Lakehouses and warehouses
    case "lakehouse":
      return "lakehouse";
    case "lakehouse_table":
    case "lakehousetable":
      return "lakehouse_table";
    case "lakehouse_column":
    case "lakehousecolumn":
      return "lakehouse_column";
    case "warehouse":
      return "warehouse";
    case "warehouse_table":
    case "warehousetable":
      return "warehouse_table";
      
    // Other artifact types
    case "dataflow":
      return "dataflow";
    case "notebook":
      return "notebook";
      
    default:
      return "unknown";
  }
}

export function resolveNodeFields(rawNode: RawRecord): ResolvedNodeFields {
  // Try multiple field name variations for entity type
  const entityTypeValue =
    asString(rawNode.node_type) ??
    asString(rawNode.nodeType) ??
    asString(rawNode.entityType) ??
    asString(rawNode.type) ??
    asString(rawNode.Type);

  const tableName = asString(rawNode.table_name) ?? asString(rawNode.tableName) ?? asString(rawNode.TableName);

  return {
    nodeId: asString(rawNode.node_id) ?? asString(rawNode.nodeId),
    nodeName:
      asString(rawNode.node_label) ??
      asString(rawNode.node_name) ??
      asString(rawNode.name) ??
      asString(rawNode.displayName) ??
      asString(rawNode.display_name),
    nodeType: normalizeEntityType(entityTypeValue),
    parentNodeId:
      asString(rawNode.parent_id) ??
      asString(rawNode.parent_node) ??
      asString(rawNode.parentNodeId),
    datasetId: asString(rawNode.dataset_id) ?? asString(rawNode.datasetId),
    tableName,
  };
}

export function resolveEdgeFields(rawEdge: RawRecord): ResolvedEdgeFields {
  const fromNodeId =
    asString(rawEdge.node_id) ??
    asString(rawEdge.from_node) ??
    asString(rawEdge.fromNodeId) ??
    asString(rawEdge.object_lineage_id) ??
    asString(rawEdge.objectLineageId) ??
    asString(rawEdge.referenced_node_id);

  const toNodeId =
    asString(rawEdge.referenced_node_id) ??
    asString(rawEdge.to_node) ??
    asString(rawEdge.toNodeId) ??
    asString(rawEdge.referenced_object_key) ??
    asString(rawEdge.refernced_object_key) ??
    asString(rawEdge.referenced_object_lineage_id) ??
    asString(rawEdge.referencedObjectLineageId) ??
    asString(rawEdge.node_id);

  const edgeType =
    asString(rawEdge.edge_type) ??
    asString(rawEdge.edgeType) ??
    asString(rawEdge.object_type) ??
    "uses";

  let edgeId =
    asString(rawEdge.dependency_pk) ??
    asString(rawEdge.edge_id) ??
    asString(rawEdge.edgeId) ??
    asString(rawEdge.LineageTag) ??
    asString(rawEdge.lineageTag);

  if (!edgeId && fromNodeId && toNodeId) {
    edgeId = `${fromNodeId}__${edgeType}__${toNodeId}`;
  }

  const lineageId =
    asString(rawEdge.LineageTag) ??
    asString(rawEdge.lineageTag) ??
    asString(rawEdge.lineage_tag) ??
    asString(rawEdge.lineage_id) ??
    asString(rawEdge.lineageId);

  return {
    edgeId,
    fromNodeId,
    toNodeId,
    edgeType,
    lineageId,
  };
}

export function isSyntheticSemanticModelNode(nodeId: string, entityType: string): boolean {
  return entityType === "semantic_model" && nodeId.startsWith("sm:");
}

export function getEntityTypeLabel(entityType: string): string {
  const labels: Record<string, string> = {
    report: "Reports",
    page: "Pages",
    visual: "Visuals",
    semantic_model: "Semantic Models",
    measure: "Measures",
    column: "Semantic Columns",
    table: "Semantic Tables",
    lakehouse_table: "Lakehouse Table",
    warehouse_table: "Warehouse Table",
    dataflow: "Dataflows",
    notebook: "Notebooks",
    lakehouse: "Lakehouses",
    lakehouse_column: "Lakehouse Column",
    warehouse: "Warehouses",
    semantic_object: "Semantic Objects",
    artifact: "Artifacts",
    unknown: "Unknown",
  };
  return labels[entityType] ?? entityType;
}
