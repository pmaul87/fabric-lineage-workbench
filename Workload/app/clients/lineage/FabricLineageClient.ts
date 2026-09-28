import { FabricPlatformClient } from "../FabricPlatformClient";
import { WorkloadClientAPI } from "@ms-fabric/workload-client";

/**
 * Notebookless lineage extraction contract.
 *
 * The Lineage Workbench consumes a shared snapshot file in OneLake:
 *   Files/lineage/snapshots/graph_snapshot.json
 *
 * This implementation keeps the contract stable while removing the notebook
 * dependency from the default extraction path. It uses in-tenant Fabric metadata
 * discovery and writes the same nodes/edges/dimensions structure expected by the
 * downstream lineage viewer.
 */

export interface ArtifactMetadata {
  id: string;
  name: string;
  type: string;
}

export interface DiscoveredItem {
  id: string;
  displayName: string;
  type: string;
  workspaceId: string;
}

export interface NotebooklessSnapshotRequest {
  workspaceIds: string[];
  selectedArtifactIds?: string[];
  artifactSelector?: Record<string, string[]>;
  artifactTypes?: string[];
  targetLakehouseId?: string;
  targetLakehouseWorkspaceId?: string;
  semanticModelDataByModelId?: Record<string, {
    entities?: Array<{
      id: string;
      name: string;
      type: string;
      tableName?: string;
      dataType?: string;
      expression?: string;
    }>;
    dependencies?: Array<{
      sourceId: string;
      targetId: string;
      dependencyType?: string;
    }>;
  }>;
  reportDataByReportId?: Record<string, {
    datasetId?: string;
    pages?: Array<{
      pageId: string;
      pageName: string;
      displayName?: string;
    }>;
    visuals?: Array<{
      visualId: string;
      visualName: string;
      visualType?: string;
      pageId: string;
      pageName: string;
      semanticRefs?: Array<{
        tableName?: string;
        objectName: string;
        objectType?: string;
      }>;
    }>;
  }>;
  lakehouseDataByArtifactId?: Record<string, {
    tables?: Array<{
      schemaName?: string;
      tableName: string;
      storagePath?: string;
      isShortcut?: boolean;
      lastModified?: string;
      contentLength?: number;
    }>;
  }>;
  warehouseDataByArtifactId?: Record<string, {
    tables?: Array<{
      schemaName?: string;
      tableName: string;
      storagePath?: string;
      lastModified?: string;
      contentLength?: number;
    }>;
  }>;
}

export interface NotebooklessLineageSnapshot {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  dimensions: Record<string, unknown[]>;
}

function toEntityType(type: string | undefined): string {
  const normalized = (type ?? "artifact").toLowerCase();
  if (normalized === "semanticmodel" || normalized === "semantic_model") return "semantic_model";
  if (normalized === "report") return "report";
  if (normalized === "lakehouse") return "lakehouse";
  if (normalized === "warehouse") return "warehouse";
  if (normalized === "notebook") return "notebook";
  if (normalized === "dataflow") return "dataflow";
  if (normalized === "pipeline") return "pipeline";
  return "artifact";
}

export function buildNotebooklessGraphSnapshot(
  request: NotebooklessSnapshotRequest,
  discoveredArtifacts: DiscoveredItem[]
): NotebooklessLineageSnapshot {
  const workspaceIds = (request.workspaceIds ?? []).filter(Boolean);
  const selectedArtifactIds = new Set((request.selectedArtifactIds ?? []).filter(Boolean));
  const artifactSelector = request.artifactSelector ?? {};
  const semanticModelDataByModelId = request.semanticModelDataByModelId ?? {};
  const reportDataByReportId = request.reportDataByReportId ?? {};
  const lakehouseDataByArtifactId = request.lakehouseDataByArtifactId ?? {};
  const warehouseDataByArtifactId = request.warehouseDataByArtifactId ?? {};
  const explicitArtifactIds = new Set<string>();
  Object.values(artifactSelector).forEach((list) => {
    list.filter(Boolean).forEach((id) => explicitArtifactIds.add(id));
  });
  const dimensions = {
    reports: [] as Record<string, unknown>[],
    semanticModels: [] as Record<string, unknown>[],
    lakehouses: [] as Record<string, unknown>[],
    warehouses: [] as Record<string, unknown>[],
    notebooks: [] as Record<string, unknown>[],
    dataflows: [] as Record<string, unknown>[],
    pipelines: [] as Record<string, unknown>[],
    tables: [] as Record<string, unknown>[],
    columns: [] as Record<string, unknown>[],
    measures: [] as Record<string, unknown>[],
    relationships: [] as Record<string, unknown>[],
    pages: [] as Record<string, unknown>[],
    visuals: [] as Record<string, unknown>[],
    workspaceArtifacts: [] as Record<string, unknown>[],
    columnLineage: [] as Record<string, unknown>[],
  };

  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];

  const filteredArtifacts = discoveredArtifacts.filter((item) => {
    if (selectedArtifactIds.size > 0 && !selectedArtifactIds.has(item.id)) {
      return false;
    }
    if (explicitArtifactIds.size > 0 && !explicitArtifactIds.has(item.id)) {
      return false;
    }
    if (workspaceIds.length > 0 && !workspaceIds.includes(item.workspaceId)) {
      return false;
    }
    return true;
  });

  const workspaceIdsForArtifacts = filteredArtifacts.length === 0 ? workspaceIds : [...new Set(filteredArtifacts.map((item) => item.workspaceId).filter(Boolean))];
  const allWorkspaceIds = workspaceIdsForArtifacts.length > 0 ? workspaceIdsForArtifacts : workspaceIds;

  const createNode = (item: DiscoveredItem) => {
    const entityType = toEntityType(item.type);
    const nodeId = `${entityType}:${item.workspaceId}:${item.id}`;
    const node = {
      id: nodeId,
      node_id: nodeId,
      node_type: entityType,
      node_label: item.displayName || item.id,
      node_name: item.displayName || item.id,
      workspace_id: item.workspaceId,
      displayName: item.displayName || item.id,
      dataset_id: item.id,
      type: item.type,
      entityType,
    };

    nodes.push(node);
    const dimensionCollection =
      entityType === "report"
        ? dimensions.reports
        : entityType === "semantic_model"
          ? dimensions.semanticModels
          : entityType === "lakehouse"
            ? dimensions.lakehouses
            : entityType === "warehouse"
              ? dimensions.warehouses
              : entityType === "notebook"
                ? dimensions.notebooks
                : entityType === "dataflow"
                  ? dimensions.dataflows
                  : entityType === "pipeline"
                    ? dimensions.pipelines
                    : dimensions.workspaceArtifacts;

    dimensionCollection.push({
      id: item.id,
      workspaceId: item.workspaceId,
      displayName: item.displayName || item.id,
      name: item.displayName || item.id,
      type: item.type,
      LineageTag: nodeId,
      lineageTag: nodeId,
    });

    return node;
  };

  const createdNodes = new Map<string, Record<string, unknown>>();
  for (const artifact of filteredArtifacts.length > 0 ? filteredArtifacts : []) {
    const node = createNode(artifact);
    createdNodes.set(`${artifact.workspaceId}:${artifact.id}`, node);
  }

  const semanticEntityNodeIdByModelAndName = new Map<string, string>();

  const registerSemanticEntityNode = (
    modelId: string,
    tableName: string | undefined,
    objectName: string,
    objectType: "column" | "measure",
    nodeId: string
  ) => {
    const normalizedModelId = modelId.trim().toLowerCase();
    const normalizedTableName = (tableName ?? "").trim().toLowerCase();
    const normalizedObjectName = objectName.trim().toLowerCase();
    if (!normalizedModelId || !normalizedObjectName) {
      return;
    }

    const typedKey = `${normalizedModelId}|${normalizedTableName}|${normalizedObjectName}|${objectType}`;
    const fallbackKey = `${normalizedModelId}|${normalizedTableName}|${normalizedObjectName}|unknown`;
    semanticEntityNodeIdByModelAndName.set(typedKey, nodeId);
    if (!semanticEntityNodeIdByModelAndName.has(fallbackKey)) {
      semanticEntityNodeIdByModelAndName.set(fallbackKey, nodeId);
    }
  };

  const createSemanticModelChildren = (semanticModelNode: Record<string, unknown>) => {
    const modelNodeId = String(semanticModelNode.node_id ?? "");
    const modelId = String(semanticModelNode.dataset_id ?? "");
    const modelName = String(semanticModelNode.node_name ?? semanticModelNode.node_label ?? "");
    const workspaceId = String(semanticModelNode.workspace_id ?? "");
    if (!modelNodeId || !modelId) {
      return;
    }
    const modelData =
      semanticModelDataByModelId[modelId] ??
      semanticModelDataByModelId[modelName.toLowerCase()];
    const entities = modelData?.entities ?? [];
    const dependencies = modelData?.dependencies ?? [];
    if (entities.length === 0) {
      return;
    }

    const tableNodeIdByName = new Map<string, string>();
    const entityNodeIdByEntityId = new Map<string, string>();

    const getTableNodeId = (tableName: string): string => {
      const existing = tableNodeIdByName.get(tableName);
      if (existing) {
        return existing;
      }

      const tableNodeId = `table:${modelId}|${tableName}`;
      const tableNode = {
        id: tableNodeId,
        node_id: tableNodeId,
        node_type: "table",
        node_label: tableName,
        node_name: tableName,
        table_name: tableName,
        dataset_id: modelId,
        workspace_id: workspaceId,
        parent_node: modelNodeId,
      };
      nodes.push(tableNode);
      edges.push({
        edge_id: `${modelNodeId}__contains__${tableNodeId}`,
        from_node: modelNodeId,
        to_node: tableNodeId,
        edge_type: "parent-child",
        fromNodeId: modelNodeId,
        toNodeId: tableNodeId,
        lineageId: `${modelNodeId}__contains__${tableNodeId}`,
      });
      dimensions.tables.push({
        id: tableNodeId,
        uid: tableNodeId,
        LineageTag: tableNodeId,
        lineageTag: tableNodeId,
        model_id: modelId,
        workspaceId,
        table_name: tableName,
        name: tableName,
      });
      tableNodeIdByName.set(tableName, tableNodeId);
      return tableNodeId;
    };

    for (const entity of entities) {
      const entityType = String(entity.type ?? "").toLowerCase();
      if (entityType === "table") {
        const tableName = String(entity.name ?? "").trim();
        if (tableName) {
          const tableNodeId = getTableNodeId(tableName);
          if (entity.id) {
            entityNodeIdByEntityId.set(String(entity.id), tableNodeId);
          }
        }
        continue;
      }

      if (entityType !== "column" && entityType !== "measure") {
        continue;
      }

      const tableName = String(entity.tableName ?? "").trim();
      const entityName = String(entity.name ?? "").trim();
      if (!entityName) {
        continue;
      }

      const parentTableNodeId = tableName
        ? getTableNodeId(tableName)
        : modelNodeId;
      const nodeId = entityType === "column"
        ? `col:${modelId}|${tableName}|${entityName}`
        : `measure:${modelId}|${tableName}|${entityName}`;

      nodes.push({
        id: nodeId,
        node_id: nodeId,
        node_type: entityType,
        node_label: entityName,
        node_name: entityName,
        table_name: tableName || undefined,
        dataset_id: modelId,
        workspace_id: workspaceId,
        parent_node: parentTableNodeId,
      });

      edges.push({
        edge_id: `${parentTableNodeId}__contains__${nodeId}`,
        from_node: parentTableNodeId,
        to_node: nodeId,
        edge_type: "parent-child",
        fromNodeId: parentTableNodeId,
        toNodeId: nodeId,
        lineageId: `${parentTableNodeId}__contains__${nodeId}`,
      });

      if (entityType === "column") {
        dimensions.columns.push({
          id: nodeId,
          uid: nodeId,
          LineageTag: nodeId,
          lineageTag: nodeId,
          model_id: modelId,
          workspaceId,
          table_name: tableName || undefined,
          column_name: entityName,
          name: entityName,
          datatype: entity.dataType,
        });
        registerSemanticEntityNode(modelId, tableName || undefined, entityName, "column", nodeId);
      } else {
        dimensions.measures.push({
          id: nodeId,
          uid: nodeId,
          LineageTag: nodeId,
          lineageTag: nodeId,
          model_id: modelId,
          workspaceId,
          table_name: tableName || undefined,
          measure_name: entityName,
          name: entityName,
          expression: entity.expression,
        });
        registerSemanticEntityNode(modelId, tableName || undefined, entityName, "measure", nodeId);
      }

      if (entity.id) {
        entityNodeIdByEntityId.set(String(entity.id), nodeId);
      }
    }

    for (const dep of dependencies) {
      const dependentNodeId = entityNodeIdByEntityId.get(String(dep.sourceId ?? ""));
      const referencedNodeId = entityNodeIdByEntityId.get(String(dep.targetId ?? ""));
      if (!dependentNodeId || !referencedNodeId) {
        continue;
      }

      // Notebook parity: dependencies flow from referenced object -> dependent object.
      const fromNodeId = referencedNodeId;
      const toNodeId = dependentNodeId;
      const dependencySubtype = String(dep.dependencyType ?? "expression").toLowerCase() || "expression";

      edges.push({
        edge_id: `${fromNodeId}__depends_on__${toNodeId}`,
        from_node: fromNodeId,
        to_node: toNodeId,
        edge_type: "dependency",
        dependency_subtype: dependencySubtype,
        fromNodeId,
        toNodeId,
        lineageId: `${fromNodeId}__depends_on__${toNodeId}`,
      });

      dimensions.columnLineage.push({
        from_node: fromNodeId,
        to_node: toNodeId,
        dependency_type: dependencySubtype,
        dataset_id: modelId,
        workspace_id: workspaceId,
      });
    }
  };

  const modelNodes = nodes.filter((node) => String(node.node_type) === "semantic_model");

  for (const modelNode of modelNodes) {
    createSemanticModelChildren(modelNode);
  }

  const nodeById = new Map<string, Record<string, unknown>>();
  for (const node of nodes) {
    const nodeId = String(node.node_id ?? "");
    if (nodeId) {
      nodeById.set(nodeId, node);
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of edges) {
    const edgeId = String(edge.edge_id ?? "");
    if (edgeId) {
      edgeIds.add(edgeId);
    }
  }

  const addNodeIfMissing = (node: Record<string, unknown>) => {
    const nodeId = String(node.node_id ?? "");
    if (!nodeId || nodeById.has(nodeId)) {
      return;
    }
    nodes.push(node);
    nodeById.set(nodeId, node);
  };

  const addEdgeIfMissing = (edge: Record<string, unknown>) => {
    const edgeId = String(edge.edge_id ?? "");
    if (!edgeId || edgeIds.has(edgeId)) {
      return;
    }
    edges.push(edge);
    edgeIds.add(edgeId);
  };

  const getSemanticModelNodeId = (datasetId: string): string | undefined => {
    const normalizedDatasetId = datasetId.trim().toLowerCase();
    if (!normalizedDatasetId) {
      return undefined;
    }

    const modelNode = nodes.find((candidate) => {
      if (String(candidate.node_type ?? "") !== "semantic_model") {
        return false;
      }
      return String(candidate.dataset_id ?? "").trim().toLowerCase() === normalizedDatasetId;
    });

    return modelNode ? String(modelNode.node_id ?? "") : undefined;
  };

  const reportNodes = nodes.filter((node) => String(node.node_type ?? "") === "report");
  for (const reportNode of reportNodes) {
    const reportId = String(reportNode.dataset_id ?? "").trim();
    const reportWorkspaceId = String(reportNode.workspace_id ?? "").trim();
    const reportName = String(reportNode.node_name ?? reportNode.node_label ?? reportId);
    if (!reportId) {
      continue;
    }

    const reportData = reportDataByReportId[reportId] ?? reportDataByReportId[reportName.toLowerCase()];
    if (!reportData) {
      continue;
    }

    const reportNodeId = String(reportNode.node_id ?? "");
    const datasetId = String(reportData.datasetId ?? "").trim();
    const pages = reportData.pages ?? [];
    const visuals = reportData.visuals ?? [];

    if (datasetId) {
      const semanticModelNodeId = getSemanticModelNodeId(datasetId);
      if (semanticModelNodeId) {
        addEdgeIfMissing({
          edge_id: `${semanticModelNodeId}__supports__${reportNodeId}`,
          from_node: semanticModelNodeId,
          to_node: reportNodeId,
          edge_type: "dependency",
          dependency_subtype: "report-model",
          fromNodeId: semanticModelNodeId,
          toNodeId: reportNodeId,
          lineageId: `${semanticModelNodeId}__supports__${reportNodeId}`,
        });
      }
    }

    const pageNameById = new Map<string, string>();
    for (const page of pages) {
      const pageId = String(page.pageId ?? "").trim();
      const pageName = String(page.pageName ?? "").trim();
      if (!pageId) {
        continue;
      }

      const pageDisplayName = String(page.displayName ?? pageName ?? pageId).trim() || pageId;
      pageNameById.set(pageId, pageDisplayName);
      const pageNodeId = `page:${reportId}|${pageId}`;

      addNodeIfMissing({
        id: pageNodeId,
        node_id: pageNodeId,
        node_type: "page",
        node_label: pageDisplayName,
        node_name: pageDisplayName,
        report_id: reportId,
        workspace_id: reportWorkspaceId,
        parent_node: reportNodeId,
      });

      addEdgeIfMissing({
        edge_id: `${reportNodeId}__parent__${pageNodeId}`,
        from_node: reportNodeId,
        to_node: pageNodeId,
        edge_type: "parent-child",
        fromNodeId: reportNodeId,
        toNodeId: pageNodeId,
        lineageId: `${reportNodeId}__parent__${pageNodeId}`,
      });

      dimensions.pages.push({
        id: pageNodeId,
        uid: pageNodeId,
        report_id: reportId,
        workspaceId: reportWorkspaceId,
        page_id: pageId,
        page_name: pageName || pageId,
        display_name: pageDisplayName,
        name: pageDisplayName,
        LineageTag: pageNodeId,
        lineageTag: pageNodeId,
      });
    }

    for (const visual of visuals) {
      const visualId = String(visual.visualId ?? "").trim();
      const pageId = String(visual.pageId ?? "").trim();
      if (!visualId || !pageId) {
        continue;
      }

      const pageNodeId = `page:${reportId}|${pageId}`;
      const visualNameBase = String(visual.visualName ?? visualId).trim() || visualId;
      const visualType = String(visual.visualType ?? "").trim();
      const visualName = visualType ? `${visualType}: ${visualNameBase}` : visualNameBase;
      const visualNodeId = `visual:${reportId}|${pageId}|${visualId}`;
      const pageName = pageNameById.get(pageId) || String(visual.pageName ?? pageId).trim() || pageId;

      addNodeIfMissing({
        id: visualNodeId,
        node_id: visualNodeId,
        node_type: "visual",
        node_label: visualName,
        node_name: visualName,
        visual_type: visualType || visual.visualType,
        report_id: reportId,
        workspace_id: reportWorkspaceId,
        page_id: pageId,
        page_name: pageName,
        parent_node: pageNodeId,
      });

      addEdgeIfMissing({
        edge_id: `${pageNodeId}__parent__${visualNodeId}`,
        from_node: pageNodeId,
        to_node: visualNodeId,
        edge_type: "parent-child",
        fromNodeId: pageNodeId,
        toNodeId: visualNodeId,
        lineageId: `${pageNodeId}__parent__${visualNodeId}`,
      });

      dimensions.visuals.push({
        id: visualNodeId,
        uid: visualNodeId,
        report_id: reportId,
        workspaceId: reportWorkspaceId,
        page_id: pageId,
        page_name: pageName,
        visual_id: visualId,
        visual_name: visualName,
        visual_type: visualType || visual.visualType,
        LineageTag: visualNodeId,
        lineageTag: visualNodeId,
      });

      for (const ref of visual.semanticRefs ?? []) {
        if (!datasetId) {
          continue;
        }

        const normalizedDatasetId = datasetId.trim().toLowerCase();
        const normalizedTableName = String(ref.tableName ?? "").trim().toLowerCase();
        const normalizedObjectName = String(ref.objectName ?? "").trim().toLowerCase();
        const normalizedObjectType = String(ref.objectType ?? "unknown").trim().toLowerCase();
        if (!normalizedObjectName) {
          continue;
        }

        const semanticNodeId =
          semanticEntityNodeIdByModelAndName.get(
            `${normalizedDatasetId}|${normalizedTableName}|${normalizedObjectName}|${normalizedObjectType}`
          ) ||
          semanticEntityNodeIdByModelAndName.get(
            `${normalizedDatasetId}|${normalizedTableName}|${normalizedObjectName}|unknown`
          );

        if (!semanticNodeId) {
          continue;
        }

        addEdgeIfMissing({
          edge_id: `${semanticNodeId}__feeds__${visualNodeId}`,
          from_node: semanticNodeId,
          to_node: visualNodeId,
          edge_type: "dependency",
          dependency_subtype: "report-visual",
          fromNodeId: semanticNodeId,
          toNodeId: visualNodeId,
          lineageId: `${semanticNodeId}__feeds__${visualNodeId}`,
        });

        dimensions.columnLineage.push({
          from_node: semanticNodeId,
          to_node: visualNodeId,
          dependency_type: "report-visual",
          dataset_id: datasetId,
          workspace_id: reportWorkspaceId,
          report_id: reportId,
          page_id: pageId,
          visual_id: visualId,
        });
      }
    }
  }

  const createTabularArtifactChildren = (
    artifactType: "lakehouse" | "warehouse",
    dataByArtifactId: Record<string, { tables?: Array<{ schemaName?: string; tableName: string; storagePath?: string; isShortcut?: boolean; lastModified?: string; contentLength?: number }> }>
  ) => {
    const artifactNodes = nodes.filter((node) => String(node.node_type ?? "") === artifactType);
    for (const artifactNode of artifactNodes) {
      const artifactId = String(artifactNode.dataset_id ?? "").trim();
      const artifactName = String(artifactNode.node_name ?? artifactNode.node_label ?? artifactId).trim();
      const artifactWorkspaceId = String(artifactNode.workspace_id ?? "").trim();
      const artifactNodeId = String(artifactNode.node_id ?? "");
      if (!artifactId || !artifactNodeId) {
        continue;
      }

      const artifactData = dataByArtifactId[artifactId] ?? dataByArtifactId[artifactName.toLowerCase()];
      const tables = artifactData?.tables ?? [];
      const schemaNodeIdByName = new Map<string, string>();

      const ensureSchemaNode = (schemaName: string): string => {
        const normalizedSchemaName = schemaName.trim();
        const existing = schemaNodeIdByName.get(normalizedSchemaName.toLowerCase());
        if (existing) {
          return existing;
        }

        const schemaNodeId = `${artifactType}-schema:${artifactId}|${normalizedSchemaName}`;
        const schemaNodeType = artifactType === "lakehouse" ? "lakehouse_schema" : "warehouse_schema";
        addNodeIfMissing({
          id: schemaNodeId,
          node_id: schemaNodeId,
          node_type: schemaNodeType,
          node_label: normalizedSchemaName,
          node_name: normalizedSchemaName,
          schema_name: normalizedSchemaName,
          workspace_id: artifactWorkspaceId,
          artifact_id: artifactId,
          parent_node: artifactNodeId,
        });

        addEdgeIfMissing({
          edge_id: `${artifactNodeId}__parent__${schemaNodeId}`,
          from_node: artifactNodeId,
          to_node: schemaNodeId,
          edge_type: "parent-child",
          fromNodeId: artifactNodeId,
          toNodeId: schemaNodeId,
          lineageId: `${artifactNodeId}__parent__${schemaNodeId}`,
        });

        schemaNodeIdByName.set(normalizedSchemaName.toLowerCase(), schemaNodeId);
        return schemaNodeId;
      };

      for (const table of tables) {
        const tableName = String(table.tableName ?? "").trim();
        if (!tableName) {
          continue;
        }

        const schemaName = String(table.schemaName ?? "").trim();
        const parentNodeId = schemaName ? ensureSchemaNode(schemaName) : artifactNodeId;

        const tableNodeId = schemaName
          ? `${artifactType}-table:${artifactId}|${schemaName}|${tableName}`
          : `${artifactType}-table:${artifactId}|${tableName}`;
        const tableNodeType = artifactType === "lakehouse" ? "lakehouse_table" : "warehouse_table";
        addNodeIfMissing({
          id: tableNodeId,
          node_id: tableNodeId,
          node_type: tableNodeType,
          node_label: tableName,
          node_name: tableName,
          table_name: tableName,
          schema_name: schemaName || undefined,
          workspace_id: artifactWorkspaceId,
          artifact_id: artifactId,
          parent_node: parentNodeId,
        });

        addEdgeIfMissing({
          edge_id: `${parentNodeId}__parent__${tableNodeId}`,
          from_node: parentNodeId,
          to_node: tableNodeId,
          edge_type: "parent-child",
          fromNodeId: parentNodeId,
          toNodeId: tableNodeId,
          lineageId: `${parentNodeId}__parent__${tableNodeId}`,
        });

        dimensions.tables.push({
          id: tableNodeId,
          uid: tableNodeId,
          artifact_id: artifactId,
          artifact_type: artifactType,
          workspaceId: artifactWorkspaceId,
          schema_name: schemaName || undefined,
          table_name: tableName,
          name: tableName,
          storage_path: table.storagePath,
          is_shortcut: table.isShortcut,
          last_modified: table.lastModified,
          content_length: table.contentLength,
          LineageTag: tableNodeId,
          lineageTag: tableNodeId,
        });
      }
    }
  };

  createTabularArtifactChildren("lakehouse", lakehouseDataByArtifactId);
  createTabularArtifactChildren("warehouse", warehouseDataByArtifactId);

  if (filteredArtifacts.length === 0 && allWorkspaceIds.length > 0) {
    const placeholderItem = {
      id: `placeholder-${Date.now()}`,
      displayName: "No artifacts discovered",
      type: "artifact",
      workspaceId: allWorkspaceIds[0],
    };
    createNode(placeholderItem);
  }

  const validNodeIds = new Set(nodes.map((node) => String(node.node_id ?? "")));
  const validEdges = edges.filter((edge) => {
    const fromNode = String(edge.from_node ?? edge.fromNodeId ?? "");
    const toNode = String(edge.to_node ?? edge.toNodeId ?? "");
    return validNodeIds.has(fromNode) && validNodeIds.has(toNode);
  });

  return {
    nodes,
    edges: validEdges,
    dimensions,
  };
}

export class FabricLineageClient extends FabricPlatformClient {
  constructor(workloadClient: WorkloadClientAPI) {
    super(workloadClient);
  }

  /**
   * Notebookless extraction path.
   *
   * Builds the same node/edge/dimension snapshot expected by the Lineage Workbench
   * while avoiding notebook execution. The snapshot remains compatible with the
   * existing OneLake graph loader in LineageGraphService.
   */
  async extractNotebooklessSnapshot(
    request: NotebooklessSnapshotRequest,
    discoveredArtifacts: DiscoveredItem[]
  ): Promise<NotebooklessLineageSnapshot> {
    return buildNotebooklessGraphSnapshot(request, discoveredArtifacts);
  }

  /**
   * Legacy compatibility stub retained for any code paths that still call a
   * specific artifact extractor by type. The project now uses the notebookless
   * snapshot builder as the single default extraction path.
   */
  async extractReportMetadata(workspaceId: string, itemId: string): Promise<ArtifactMetadata> {
    return { id: itemId, name: itemId, type: "report" };
  }

  async extractNotebookMetadata(workspaceId: string, itemId: string): Promise<ArtifactMetadata> {
    return { id: itemId, name: itemId, type: "notebook" };
  }

  async extractLakehouseMetadata(workspaceId: string, itemId: string): Promise<ArtifactMetadata> {
    return { id: itemId, name: itemId, type: "lakehouse" };
  }

  async extractWarehouseMetadata(workspaceId: string, itemId: string): Promise<ArtifactMetadata> {
    return { id: itemId, name: itemId, type: "warehouse" };
  }

  async extractPipelineMetadata(workspaceId: string, itemId: string): Promise<ArtifactMetadata> {
    return { id: itemId, name: itemId, type: "pipeline" };
  }

  async extractDataflowMetadata(workspaceId: string, itemId: string): Promise<ArtifactMetadata> {
    return { id: itemId, name: itemId, type: "dataflow" };
  }
}
