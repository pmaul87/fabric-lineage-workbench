import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkloadClientAPI } from "@ms-fabric/workload-client";
import {
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  Radio,
  RadioGroup,
  Switch,
  makeStyles,
  tokens,
  Spinner,
} from "@fluentui/react-components";
import {
  ChevronDownRegular,
  ChevronRightRegular,
  SearchRegular,
  DataTrendingRegular,
  TableRegular,
  InfoRegular,
} from "@fluentui/react-icons";

import { OneLakeLineageStorage } from "../../clients/lineage/OneLakeLineageStorage";
import { LineageGraphView, LineageViewerNode, LineageViewerEdge } from "./LineageGraphView";
import { LineageTableView } from "./LineageTableView";
import { LineageDetailView } from "./LineageDetailView";
import type { LineageWorkbenchExtractionConfig } from "./LineageWorkbenchItemDefinition";
import { isSyntheticSemanticModelNode, resolveEdgeFields, resolveNodeFields } from "./lineageContracts";
import { buildGraphProjection, filterEdgesByNodes, filterNodes } from "./lineageGraphProcessing";

type ArtifactResolvedType = "report" | "semantic_model" | "lakehouse" | "warehouse";

// ─── Styles ───────────────────────────────────────────────────────────────────

const DEFAULT_GRAPH_NODE_LIMIT = 80;
type ExploreLayoutMode = "stacked" | "side-by-side" | "detail-focused";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "row",
    height: "100%",
    width: "100%",
    overflow: "hidden",
  },

  // ── Main content ──────────────────────────────────────────────────────────
  mainContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: tokens.colorNeutralBackground1,
  },

  // ── Collapsible panel ─────────────────────────────────────────────────────
  panel: {
    display: "flex",
    flexDirection: "column",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: "hidden",
    flexShrink: 0,
  },
  panelFill: {
    flex: 1,
    minHeight: "0",
  },
  panelFixed: {
    minHeight: "220px",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    background: tokens.colorNeutralBackground2,
    cursor: "pointer",
    userSelect: "none",
    flexShrink: 0,
  },
  panelHeaderTitle: {
    flex: 1,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
  },
  panelHeaderMeta: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  panelBody: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  graphHint: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground3,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
  },
  graphHintText: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  graphEmptyBody: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.spacingVerticalXL,
    textAlign: "center",
  },
  splitExplore: {
    flex: 1,
    minHeight: "280px",
    display: "flex",
    overflow: "hidden",
  },
  splitExploreHorizontal: {
    flexDirection: "row",
  },
  splitExploreVertical: {
    flexDirection: "column",
  },
  splitPane: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    overflow: "hidden",
  },
  splitTablePane: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    flex: "0 0 35%",
    maxWidth: "500px",
    overflow: "hidden",
  },
  splitGraphPane: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    overflow: "hidden",
  },
  splitPaneHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  splitDividerVertical: {
    width: "1px",
    background: tokens.colorNeutralStroke2,
    flexShrink: 0,
  },
  splitDividerHorizontal: {
    height: "1px",
    background: tokens.colorNeutralStroke2,
    flexShrink: 0,
  },
  resizeHandle: {
    height: "6px",
    background: tokens.colorNeutralBackground2,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "ns-resize",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    ":hover": {
      background: tokens.colorBrandBackground2,
    },
    ":active": {
      background: tokens.colorBrandBackground,
    },
  },
  resizeHandleLine: {
    width: "40px",
    height: "2px",
    background: tokens.colorNeutralStroke1,
    borderRadius: "1px",
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockSnapshot() {
  return {
    generatedAtUtc: new Date().toISOString(),
    nodes: [
      { nodeId: "sm:mock_model", displayName: "Sales Model", entityType: "semantic_model" },
      { nodeId: "report:mock_report", displayName: "Sales Dashboard", entityType: "report", datasetId: "mock_model", isGroupNode: true },
      { nodeId: "page:mock_report|ReportSection1", displayName: "Overview", entityType: "page", reportId: "mock_report", pageNumber: 1, parentNodeId: "report:mock_report", isGroupNode: true },
      { nodeId: "page:mock_report|ReportSection2", displayName: "Details", entityType: "page", reportId: "mock_report", pageNumber: 2, parentNodeId: "report:mock_report", isGroupNode: true },
      { nodeId: "visual:mock_report|ReportSection1|VisualContainer1", displayName: "Sales Chart", entityType: "visual", pageId: "ReportSection1", reportId: "mock_report", visualType: "clusteredColumnChart", parentNodeId: "page:mock_report|ReportSection1" },
      { nodeId: "visual:mock_report|ReportSection1|VisualContainer2", displayName: "Sales KPI", entityType: "visual", pageId: "ReportSection1", reportId: "mock_report", visualType: "card", parentNodeId: "page:mock_report|ReportSection1" },
      { nodeId: "visual:mock_report|ReportSection2|VisualContainer3", displayName: "Sales Table", entityType: "visual", pageId: "ReportSection2", reportId: "mock_report", visualType: "tableEx", parentNodeId: "page:mock_report|ReportSection2" },
      { nodeId: "table:mock_model|Sales", displayName: "Sales", entityType: "table" },
      { nodeId: "table:mock_model|Date", displayName: "Date", entityType: "table" },
      { nodeId: "col:mock_model|Sales|Amount", displayName: "Amount", entityType: "column", tableName: "Sales", datasetId: "mock_model" },
      { nodeId: "measure:mock_model|Sales|Total Sales", displayName: "Total Sales", entityType: "measure" },
    ],
    edges: [
      { edgeId: "sm-report:mock_model→mock_report", fromNodeId: "sm:mock_model", toNodeId: "report:mock_report", edgeType: "uses" },
      // Note: report→page and page→visual edges are represented by parentNodeId relationships, not explicit edges
      { edgeId: "rel:Sales_Date", fromNodeId: "table:mock_model|Sales", toNodeId: "table:mock_model|Date", edgeType: "relationship" },
      { edgeId: "dep:Total_Sales→Amount", fromNodeId: "measure:mock_model|Sales|Total Sales", toNodeId: "col:mock_model|Sales|Amount", edgeType: "dependency" },
      // Visual → Column/Measure edges (new in v_edges schema)
      { edgeId: "visual-uses-measure:VisualContainer1→Total_Sales", fromNodeId: "visual:mock_report|ReportSection1|VisualContainer1", toNodeId: "measure:mock_model|Sales|Total Sales", edgeType: "uses_measure" },
      { edgeId: "visual-uses-column:VisualContainer1→Amount", fromNodeId: "visual:mock_report|ReportSection1|VisualContainer1", toNodeId: "col:mock_model|Sales|Amount", edgeType: "uses_column" },
      { edgeId: "visual-uses-measure:VisualContainer2→Total_Sales", fromNodeId: "visual:mock_report|ReportSection1|VisualContainer2", toNodeId: "measure:mock_model|Sales|Total Sales", edgeType: "uses_measure" },
      { edgeId: "visual-uses-column:VisualContainer3→Amount", fromNodeId: "visual:mock_report|ReportSection2|VisualContainer3", toNodeId: "col:mock_model|Sales|Amount", edgeType: "uses_column" },
    ],
    dimensions: {
      reports: [{ uid: "mock|mock_report", report_id: "mock_report", report_name: "Sales Dashboard", dataset_id: "mock_model" }],
      pages: [] as any[],  // Empty to simulate real scenario where pages are derived from visuals
      visuals: [
        { uid: "mock|mock_report|VisualContainer1|ReportSection1", visual_name: "VisualContainer1", title: "Sales Chart", page_name: "ReportSection1", page_display_name: "Overview", report_id: "mock_report", type: "clusteredColumnChart" },
        { uid: "mock|mock_report|VisualContainer2|ReportSection1", visual_name: "VisualContainer2", title: "Sales KPI", page_name: "ReportSection1", page_display_name: "Overview", report_id: "mock_report", type: "card" },
        { uid: "mock|mock_report|VisualContainer3|ReportSection2", visual_name: "VisualContainer3", title: "Sales Table", page_name: "ReportSection2", page_display_name: "Details", report_id: "mock_report", type: "tableEx" },
      ],
      semanticModels: [{ uid: "mock|mock_model", model_id: "mock_model", model_name: "Sales Model" }],
      tables: [
        { uid: "mock|mock_model|Sales", model_id: "mock_model", name: "Sales", ishidden: false },
        { uid: "mock|mock_model|Date", model_id: "mock_model", name: "Date", ishidden: false },
      ],
      columns: [{ uid: "mock|mock_model|Sales|Amount", model_id: "mock_model", table: "Sales", name: "Amount", datatype: "decimal" }],
      measures: [{ uid: "mock|mock_model|Sales|Total Sales", model_id: "mock_model", table: "Sales", name: "Total Sales", expression: "SUM(Sales[Amount])" }],
      relationships: [{ uid: "mock|mock_model|Sales_Date", model_id: "mock_model", name: "Sales_Date", fromtable: "Sales", totable: "Date" }],
      smDependencies: [{ model_id: "mock_model", objectname: "Total Sales", objecttype: "Measure", tablename: "Sales", referencedobjectname: "Amount", referencedobjecttype: "Column", referencedtablename: "Sales" }],
      columnLineage: [
        {
          dataset_id: "mock_model",
          power_bi_table_name: "Sales",
          final_column_name: "Amount",
          column_name_at_step: "Amount",
          step_name: "Source",
          step_order: 1,
          transformation_function: "Table.SelectColumns",
          step_expression: '#"Source" = Sql.Database("server", "database")',
          affects_entire_table: false,
          column_created_here: true,
        },
        {
          dataset_id: "mock_model",
          power_bi_table_name: "Sales",
          final_column_name: "Amount",
          column_name_at_step: "Amount",
          step_name: "Changed Type",
          step_order: 2,
          transformation_function: "Table.TransformColumnTypes",
          step_expression: '= Table.TransformColumnTypes(Source, {{"Amount", type number}})',
          affects_entire_table: false,
          column_created_here: false,
        },
      ],
    },
  };
}

// ─── CollapsiblePanel ─────────────────────────────────────────────────────────

interface CollapsiblePanelProps {
  title: string;
  icon: React.ReactNode;
  meta?: string;
  expanded: boolean;
  onToggle: () => void;
  /** fill remaining height when true */
  fillHeight?: boolean;
  /** custom height in pixels (overrides fillHeight) */
  customHeight?: number;
  children: React.ReactNode;
}

function CollapsiblePanel({
  title,
  icon,
  meta,
  expanded,
  onToggle,
  fillHeight = false,
  customHeight,
  children,
}: CollapsiblePanelProps) {
  const styles = useStyles();

  const panelExtra = expanded ? (fillHeight ? styles.panelFill : styles.panelFixed) : "";
  const panelStyle = customHeight && expanded ? { height: `${customHeight}px`, flex: "0 0 auto" } : undefined;

  return (
    <div className={`${styles.panel}${panelExtra ? ` ${panelExtra}` : ""}`} style={panelStyle}>
      <div className={styles.panelHeader} onClick={onToggle}>
        {icon}
        <span className={styles.panelHeaderTitle}>{title}</span>
        {meta && <span className={styles.panelHeaderMeta}>{meta}</span>}
        {expanded ? <ChevronDownRegular fontSize={16} /> : <ChevronRightRegular fontSize={16} />}
      </div>
      {expanded && <div className={styles.panelBody}>{children}</div>}
    </div>
  );
}

// ─── ResizeHandle ─────────────────────────────────────────────────────────────

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
}

function ResizeHandle({ onMouseDown }: ResizeHandleProps) {
  const styles = useStyles();
  return (
    <div className={styles.resizeHandle} onMouseDown={onMouseDown}>
      <div className={styles.resizeHandleLine} />
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

interface LineageWorkbenchItemLineageViewProps {
  workloadClient: WorkloadClientAPI;
  workspaceId?: string;
  extraction?: LineageWorkbenchExtractionConfig;
  lineage: any;
  onLineageChange: (next: any) => void;
}

export function LineageWorkbenchItemLineageView({
  workloadClient,
  workspaceId,
  extraction,
  lineage,
  onLineageChange,
}: LineageWorkbenchItemLineageViewProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const hasHydratedActualGraphRef = useRef(false);
  const hasAttemptedActualGraphLoadRef = useRef(false);
  const refreshNonce = lineage?.refreshNonce as number | undefined;

  // ── Layout state ──────────────────────────────────────────────────────────
  const [tableExpanded, setTableExpanded] = useState(true);
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string>("");
  
  // ── Resizable panel heights ──────────────────────────────────────────────
  const [tableHeight, setTableHeight] = useState<number>(300);
  const [graphHeight, setGraphHeight] = useState<number>(400);
  const [detailHeight, setDetailHeight] = useState<number>(350);

  // ── Resize handlers ───────────────────────────────────────────────────────
  const handleResizeStart = (panel: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = 
      panel === "table" ? tableHeight :
      panel === "graph" ? graphHeight :
      detailHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Panels below the handle should grow when dragging upward in detail-focused mode.
      const invertDelta =
        panel === "detail" || (panel === "graph" && exploreLayout === "detail-focused");
      const delta = invertDelta
        ? startY - moveEvent.clientY
        : moveEvent.clientY - startY;
      const newHeight = Math.max(150, startHeight + delta); // Minimum 150px
      
      if (panel === "table") {
        setTableHeight(newHeight);
      } else if (panel === "graph") {
        setGraphHeight(newHeight);
      } else if (panel === "detail") {
        setDetailHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // ── Filter state ──────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [selectionSource, setSelectionSource] = useState<"table" | "graph" | "detail">("table");
  const [showHierarchyEdges, setShowHierarchyEdges] = useState(true);
  const graphScope = "focused"; // Always use focused mode
  const [graphNodeLimit] = useState<number>(DEFAULT_GRAPH_NODE_LIMIT);
  const [graphDisplayMode] = useState<"highlight" | "filter">("filter");
  const [exploreLayout, setExploreLayout] = useState<ExploreLayoutMode>("detail-focused");
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  // ── Data source ───────────────────────────────────────────────────────────
  const dataSourceMode = lineage?.dataSourceMode === "mock" ? "mock" : "actual";

  // Check if we should be loading data (to prevent showing empty state prematurely).
  // This must not be memoized from refs, otherwise the loading view can get stuck.
  const shouldLoadData =
    dataSourceMode === "actual" &&
    !hasAttemptedActualGraphLoadRef.current &&
    !hasHydratedActualGraphRef.current;

  // Ribbon refresh should force a fresh graph reload.
  useEffect(() => {
    if (typeof refreshNonce === "number") {
      hasHydratedActualGraphRef.current = false;
      hasAttemptedActualGraphLoadRef.current = false;
    }
  }, [refreshNonce]);

  useEffect((): void | (() => void) => {
    console.log("[LineageView] Data loading effect running:", {
      dataSourceMode,
      hasHydrated: hasHydratedActualGraphRef.current,
      workspaceId: workspaceId || "MISSING",
      hasExistingNodes: !!lineage?.graphSnapshot?.nodes?.length,
      hasExistingEdges: !!lineage?.graphSnapshot?.edges?.length,
    });

    if (dataSourceMode !== "actual") {
      console.log("[LineageView] Skipping load: not in actual mode");
      return;
    }
    if (hasAttemptedActualGraphLoadRef.current) {
      console.log("[LineageView] Skipping load: already attempted in this view session");
      return;
    }
    if (hasHydratedActualGraphRef.current) {
      console.log("[LineageView] Skipping load: already hydrated");
      return;
    }
    console.log("[LineageView] Starting API call to load graph...");
    hasAttemptedActualGraphLoadRef.current = true;
    let cancelled = false;
    setLoadError(""); // Clear any previous errors
    setIsLoadingGraph(true);
    const loadActualGraph = async (): Promise<void> => {
      try {
        const storage = new OneLakeLineageStorage(workloadClient);
        const loadedGraph = await storage.loadLineageGraph(workspaceId);
        const snapshot = loadedGraph?.graphSnapshot ?? loadedGraph;
        if (cancelled || !snapshot) {
          return;
        }

        hasHydratedActualGraphRef.current = true;
        console.log("[LineageView] Loaded graph snapshot:", {
          hasNodes: !!snapshot?.nodes?.length,
          hasEdges: !!snapshot?.edges?.length,
          hasDimensions: !!snapshot?.dimensions,
          // IMPORTANT: Check edges data
          nodesCount: snapshot?.nodes?.length || 0,
          edgesCount: snapshot?.edges?.length || 0,
          edgesIsArray: Array.isArray(snapshot?.edges),
          edgesValue: snapshot?.edges,
          sampleEdge: snapshot?.edges?.[0] ? snapshot.edges[0] : "N/A - v_edges table is empty",
          // New property names (primary)
          semanticModels: snapshot?.dimensions?.semanticModels?.length || 0,
          tables: snapshot?.dimensions?.tables?.length || 0,
          columns: snapshot?.dimensions?.columns?.length || 0,
          measures: snapshot?.dimensions?.measures?.length || 0,
          relationships: snapshot?.dimensions?.relationships?.length || 0,
          columnLineage: snapshot?.dimensions?.columnLineage?.length || 0,
          // Sample field names for debugging
          sampleSemanticModel: snapshot?.dimensions?.semanticModels?.[0] ? Object.keys(snapshot.dimensions.semanticModels[0]) : "N/A",
          sampleTable: snapshot?.dimensions?.tables?.[0] ? Object.keys(snapshot.dimensions.tables[0]) : "N/A",
          sampleColumnLineage: snapshot?.dimensions?.columnLineage?.[0] ? Object.keys(snapshot.dimensions.columnLineage[0]) : "N/A",
        });
        onLineageChange({
          ...(lineage ?? {}),
          dataSourceMode: "actual",
          lastLoadedAtUtc: new Date().toISOString(),
          graphSnapshot: snapshot,
        });
      } catch (error) {
        console.warn("Unable to hydrate actual lineage graph:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        // Provide user-friendly error messages
        if (
          errorMsg.toLowerCase().includes("authentication") ||
          errorMsg.includes("WorkloadAuthError") ||
          errorMsg.includes("error code 3")
        ) {
          setLoadError(
            t(
              "LineageWorkbench_Error_AuthRequired",
              "Authentication failed while loading lineage. Refresh the Fabric page and sign in again, then retry."
            )
          );
        } else if (errorMsg.includes("Lakehouse SQL endpoint is not available")) {
          setLoadError(
            t("LineageWorkbench_Error_NoSqlEndpoint", 
              "The lakehouse does not have a SQL endpoint available. Ensure you have a Lakehouse item with Delta tables.")
          );
        } else if (errorMsg.includes("Could not determine workspace ID")) {
          setLoadError(
            t("LineageWorkbench_Error_CannotResolveWorkspace", 
              "Could not determine workspace from lakehouse ID. Please ensure the lakehouse exists and you have access to it.")
          );
        } else {
          setLoadError(
            t("LineageWorkbench_Error_LoadFailed", 
              "Failed to load lineage data: {{error}}", { error: errorMsg })
          );
        }
      } finally {
        setIsLoadingGraph(false);
      }
    };

    loadActualGraph();
    return () => {
      cancelled = true;
    };
  }, [
    dataSourceMode,
    workspaceId,
    workloadClient,
    refreshNonce,
    onLineageChange,
    lineage,
    t,
  ]);

  const activeSnapshot = useMemo(() => {
    if (dataSourceMode === "mock") {
      return lineage?.mockGraphSnapshot ?? createMockSnapshot();
    }
    return lineage?.graphSnapshot ?? { 
      nodes: [], 
      edges: [], 
      dimensions: {
        reports: [],
        pages: [],
        visuals: [],
        semanticModels: [],
        tables: [],
        columns: [],
        measures: [],
        relationships: [],
        lakehouses: [],
        warehouses: [],
        smDependencies: [],
        workspaceArtifacts: [],
        columnLineage: [],
      }
    };
  }, [dataSourceMode, lineage]);

  // ── Node & edge normalization (simplified view-based architecture) ──────────
  // Builds graph from v_nodes (with parent_node relationships) and v_edges (with lineage_id lookups)
  const nodes: LineageViewerNode[] = useMemo(() => {
    const rawNodes = Array.isArray(activeSnapshot?.nodes) ? activeSnapshot.nodes : [];
    const dimensions = activeSnapshot?.dimensions ?? {};

    console.log("[LineageView] Building nodes from v_nodes:", {
      rawNodesCount: rawNodes.length,
      dimensionsAvailable: Object.keys(dimensions),
    });

    // Build dimension lookup maps for enrichment (using uid from composite key implementation)
    const reportsByUid = new Map<string, any>();
    const pagesByUid = new Map<string, any>();
    const visualsByUid = new Map<string, any>();
    const semanticModelsByUid = new Map<string, any>();
    const tablesByUid = new Map<string, any>();
    const columnsByUid = new Map<string, any>();
    const measuresByUid = new Map<string, any>();
    const lakehousesByUid = new Map<string, any>();
    const warehousesByUid = new Map<string, any>();
    const artifactTypeById = new Map<string, ArtifactResolvedType>();

    // Log dimension table structure for diagnostics
    if (dimensions.tables && dimensions.tables.length > 0) {
      console.log("[LineageView] 📋 Dimension Table Structure (tables):", {
        count: dimensions.tables.length,
        availableFields: Object.keys(dimensions.tables[0]),
        sampleRecord: dimensions.tables[0],
      });
    }
    if (dimensions.columns && dimensions.columns.length > 0) {
      console.log("[LineageView] 📋 Dimension Table Structure (columns):", {
        count: dimensions.columns.length,
        availableFields: Object.keys(dimensions.columns[0]),
        sampleRecord: dimensions.columns[0],
      });
    }
    if (dimensions.measures && dimensions.measures.length > 0) {
      console.log("[LineageView] 📋 Dimension Table Structure (measures):", {
        count: dimensions.measures.length,
        availableFields: Object.keys(dimensions.measures[0]),
        sampleRecord: dimensions.measures[0],
      });
    }

    // Populate lookup maps with flexible uid field detection (prioritizing LineageTag)
    for (const r of (dimensions.reports || [])) {
      const uid = r.LineageTag || r.lineageTag || r.lineage_tag || r.uid || r.data_uid || r.report_uid;
      if (uid) reportsByUid.set(uid, r);
      const reportId = r.report_id || r.reportId || r.id;
      if (reportId) artifactTypeById.set(String(reportId), "report");
    }
    for (const p of (dimensions.pages || [])) {
      const uid = p.LineageTag || p.lineageTag || p.lineage_tag || p.uid || p.data_uid || p.page_uid;
      if (uid) pagesByUid.set(uid, p);
    }
    for (const v of (dimensions.visuals || [])) {
      const uid = v.LineageTag || v.lineageTag || v.lineage_tag || v.uid || v.data_uid || v.visual_uid;
      if (uid) visualsByUid.set(uid, v);
    }
    for (const m of (dimensions.semanticModels || [])) {
      const uid = m.LineageTag || m.lineageTag || m.lineage_tag || m.uid || m.data_uid || m.model_uid || m.dataset_uid;
      if (uid) semanticModelsByUid.set(uid, m);
      const modelId = m.model_id || m.modelId || m.dataset_id || m.datasetId || m.id;
      if (modelId) artifactTypeById.set(String(modelId), "semantic_model");
    }
    for (const t of (dimensions.tables || [])) {
      const uid = t.LineageTag || t.lineageTag || t.lineage_tag || t.uid || t.data_uid || t.table_uid;
      if (uid) tablesByUid.set(uid, t);
    }
    for (const c of (dimensions.columns || [])) {
      // Index by node_id format: table_name|column_name|dataset_id
      const tableName = c.table_name || c.tableName;
      const columnName = c.column_name || c.columnName;
      const datasetId = c.dataset_id || c.datasetId;
      
      if (tableName && columnName && datasetId) {
        const nodeIdFormat = `${tableName}|${columnName}|${datasetId}`;
        columnsByUid.set(nodeIdFormat, c);
      }
      
      // Also index by LineageTag/uid as fallback
      const uid = c.LineageTag || c.lineageTag || c.lineage_tag || c.uid || c.data_uid || c.column_uid;
      if (uid) columnsByUid.set(uid, c);
    }
    for (const m of (dimensions.measures || [])) {
      const uid = m.LineageTag || m.lineageTag || m.lineage_tag || m.uid || m.data_uid || m.measure_uid;
      if (uid) measuresByUid.set(uid, m);
    }
    for (const lh of (dimensions.lakehouses || [])) {
      const uid = lh.LineageTag || lh.lineageTag || lh.lineage_tag || lh.uid || lh.data_uid || lh.lakehouse_uid;
      if (uid) lakehousesByUid.set(uid, lh);
      const lakehouseId = lh.lakehouse_id || lh.lakehouseId || lh.id;
      if (lakehouseId) artifactTypeById.set(String(lakehouseId), "lakehouse");
    }
    for (const wh of (dimensions.warehouses || [])) {
      const uid = wh.LineageTag || wh.lineageTag || wh.lineage_tag || wh.uid || wh.data_uid || wh.warehouse_uid;
      if (uid) warehousesByUid.set(uid, wh);
      const warehouseId = wh.warehouse_id || wh.warehouseId || wh.id;
      if (warehouseId) artifactTypeById.set(String(warehouseId), "warehouse");
    }

    console.log("[LineageView] Dimension lookup maps built:", {
      reports: reportsByUid.size,
      pages: pagesByUid.size,
      visuals: visualsByUid.size,
      semanticModels: semanticModelsByUid.size,
      tables: tablesByUid.size,
      columns: columnsByUid.size,
      measures: measuresByUid.size,
      lakehouses: lakehousesByUid.size,
      warehouses: warehousesByUid.size,
      // Sample UIDs for debugging
      sampleSemanticModelUid: semanticModelsByUid.size > 0 ? Array.from(semanticModelsByUid.keys())[0] : "N/A",
      sampleTableUid: tablesByUid.size > 0 ? Array.from(tablesByUid.keys())[0] : "N/A",
      sampleColumnUid: columnsByUid.size > 0 ? Array.from(columnsByUid.keys())[0] : "N/A",
      sampleMeasureUid: measuresByUid.size > 0 ? Array.from(measuresByUid.keys())[0] : "N/A",
      artifactTypeHints: artifactTypeById.size,
    });

    const result: LineageViewerNode[] = [];
    let enrichedCount = 0;
    let notEnrichedCount = 0;
    let noDataUidCount = 0;
    
    // Log first raw node to see available fields
    if (rawNodes.length > 0) {
      console.log("[LineageView] Sample raw node structure:", {
        availableFields: Object.keys(rawNodes[0]),
        sampleNode: rawNodes[0],
      });
    }
    
    // Helper function to construct UID from raw node based on available fields
    const constructUid = (rawNode: any, nodeType: string): string | undefined => {
      // Try LineageTag as primary key first (user-specified)
      if (rawNode.LineageTag) return rawNode.LineageTag;
      if (rawNode.lineageTag) return rawNode.lineageTag;
      if (rawNode.lineage_tag) return rawNode.lineage_tag;
      
      // Fallback to direct uid/data_uid fields
      if (rawNode.data_uid) return rawNode.data_uid;
      if (rawNode.uid) return rawNode.uid;
      
      // Auto-detect workspace/model/entity identifiers (flexible field names)
      const workspaceId = rawNode.workspace_id || rawNode.workspaceId || rawNode.WorkspaceId;
      const modelId = rawNode.model_id || rawNode.modelId || rawNode.dataset_id || rawNode.datasetId;
      
      // Construct UID based on entity type and available fields
      switch (nodeType?.toLowerCase()) {
        case 'column': {
          const tableName = rawNode.table_name || rawNode.tableName || rawNode.TableName;
          const columnName = rawNode.column_name || rawNode.columnName || rawNode.ColumnName || rawNode.node_name;
          if (workspaceId && modelId && tableName && columnName) {
            return `${workspaceId}|${modelId}|${tableName}|${columnName}`;
          }
          break;
        }
        case 'measure': {
          const measureName = rawNode.measure_name || rawNode.measureName || rawNode.MeasureName || rawNode.node_name;
          if (workspaceId && modelId && measureName) {
            return `${workspaceId}|${modelId}|${measureName}`;
          }
          break;
        }
        case 'table': {
          const tableName = rawNode.table_name || rawNode.tableName || rawNode.TableName || rawNode.node_name;
          if (workspaceId && modelId && tableName) {
            return `${workspaceId}|${modelId}|${tableName}`;
          }
          break;
        }
        case 'semantic_model':
        case 'dataset': {
          if (workspaceId && modelId) {
            return `${workspaceId}|${modelId}`;
          }
          break;
        }
        case 'report': {
          const reportId = rawNode.report_id || rawNode.reportId || rawNode.ReportId;
          if (workspaceId && reportId) {
            return `${workspaceId}|${reportId}`;
          }
          break;
        }
        case 'page': {
          const reportId = rawNode.report_id || rawNode.reportId;
          const pageName = rawNode.page_name || rawNode.pageName || rawNode.PageName || rawNode.node_name;
          if (workspaceId && reportId && pageName) {
            return `${workspaceId}|${reportId}|${pageName}`;
          }
          break;
        }
        case 'visual': {
          const reportId = rawNode.report_id || rawNode.reportId;
          const pageName = rawNode.page_name || rawNode.pageName;
          const visualName = rawNode.visual_name || rawNode.visualName || rawNode.VisualName || rawNode.node_name;
          if (workspaceId && reportId && pageName && visualName) {
            return `${workspaceId}|${reportId}|${pageName}|${visualName}`;
          }
          break;
        }
      }
      
      return undefined;
    };

    const resolveArtifactType = (rawNode: any, nodeId: string, currentType: string): string => {
      if (currentType && currentType !== "artifact" && currentType !== "unknown") {
        return currentType;
      }

      const directTypeHint =
        rawNode.artifact_type ||
        rawNode.artifactType ||
        rawNode.item_type ||
        rawNode.itemType ||
        rawNode.object_type ||
        rawNode.objectType ||
        rawNode.type ||
        rawNode.Type;

      if (typeof directTypeHint === "string" && directTypeHint.trim().length > 0) {
        const normalized = directTypeHint.trim().toLowerCase().replace(/[-\s]/g, "_");
        if (["report", "semantic_model", "semanticmodel", "dataset", "lakehouse", "warehouse"].includes(normalized)) {
          if (normalized === "semanticmodel" || normalized === "dataset") {
            return "semantic_model";
          }
          return normalized;
        }
      }

      return artifactTypeById.get(nodeId) ?? currentType;
    };
    
    // Convert v_nodes to LineageViewerNode with enrichment from dimension tables
    for (const rawNode of rawNodes) {
      // Primary column names from user's v_nodes schema: node_id, parent_node, node_name, dataset_id, node_type
      const { nodeId, nodeName, nodeType, parentNodeId: parentNode, datasetId, tableName } = resolveNodeFields(rawNode);
      
      // Construct UID adaptively based on available fields
      // For columns, use node_id directly (matches node_id format: table_name|column_name|dataset_id)
      let dataUid: string | undefined;
      if ((nodeType || "").toLowerCase() === "column") {
        dataUid = nodeId; // Use node_id directly for columns
      } else {
        dataUid = constructUid(rawNode, nodeType);
      }
      
      if (!dataUid) {
        noDataUidCount++;
      }
      
      if (!nodeId) {
        console.warn("[LineageView] Skipping node with missing node_id:", rawNode);
        continue;
      }

      const effectiveNodeType = resolveArtifactType(rawNode, nodeId, nodeType);

      // Enrich node with details from dimension tables using data_uid
      let enrichedNode: LineageViewerNode = {
        nodeId,
        displayName: nodeName || nodeId,  // Use nodeName as initial fallback
        entityType: effectiveNodeType as LineageViewerNode["entityType"],
        parentNodeId: parentNode || undefined,
        datasetId: datasetId || undefined,  // Include dataset_id from v_nodes
        tableName: tableName || undefined,
        isGroupNode: false,  // Will be determined by checking if any nodes have this as parent
      };

      // Look up additional details from dimension tables based on node type
      let detailRecord: any = null;
      let wasEnriched = false;
      if (dataUid) {
        switch (effectiveNodeType) {
          case "report":
            detailRecord = reportsByUid.get(dataUid);
            if (detailRecord) {
              enrichedNode.reportId = detailRecord.report_id || detailRecord.reportId;
              enrichedNode.datasetId = detailRecord.dataset_id || detailRecord.datasetId;
              // Try multiple field name variations for display name
              enrichedNode.displayName = 
                detailRecord.report_name || 
                detailRecord.reportName || 
                detailRecord.display_name || 
                detailRecord.displayName || 
                detailRecord.name || 
                nodeName || 
                nodeId;
              wasEnriched = true;
            }
            break;
          
          case "page":
            detailRecord = pagesByUid.get(dataUid);
            if (detailRecord) {
              enrichedNode.reportId = detailRecord.report_id || detailRecord.reportId;
              enrichedNode.pageNumber = detailRecord.page_number || detailRecord.pageNumber;
              // Try multiple field name variations
              enrichedNode.displayName = 
                detailRecord.page_display_name || 
                detailRecord.pageDisplayName || 
                detailRecord.display_name || 
                detailRecord.displayName || 
                detailRecord.page_name || 
                detailRecord.pageName || 
                detailRecord.name || 
                nodeName || 
                nodeId;
              wasEnriched = true;
            }
            break;
          
          case "visual":
            detailRecord = visualsByUid.get(dataUid);
            if (detailRecord) {
              enrichedNode.reportId = detailRecord.report_id || detailRecord.reportId;
              enrichedNode.pageId = detailRecord.page_name || detailRecord.pageName;
              enrichedNode.visualId =
                detailRecord.visual_name ||
                detailRecord.visualName ||
                detailRecord.name ||
                enrichedNode.visualId;
              enrichedNode.visualType =
                detailRecord.display_type ||
                detailRecord.type ||
                detailRecord.visual_type ||
                detailRecord.visualType;

              const visualTitle =
                detailRecord.title ||
                detailRecord.visual_title ||
                detailRecord.visualTitle ||
                detailRecord.display_name ||
                detailRecord.displayName;
              const visualName =
                detailRecord.visual_name ||
                detailRecord.visualName ||
                detailRecord.name ||
                nodeName;
              const visualTypeLabel = enrichedNode.visualType || "Visual";

              enrichedNode.displayName = visualTitle
                ? `${visualTypeLabel}: ${visualTitle}`
                : visualName
                  ? `${visualTypeLabel}: ${visualName}`
                  : nodeId;
              wasEnriched = true;
            }
            break;
          
          case "semantic_model":
            detailRecord = semanticModelsByUid.get(dataUid);
            if (detailRecord) {
              // Try multiple field name variations
              enrichedNode.displayName = 
                detailRecord.model_name || 
                detailRecord.modelName || 
                detailRecord.dataset_name || 
                detailRecord.datasetName || 
                detailRecord.display_name || 
                detailRecord.displayName || 
                detailRecord.name || 
                nodeName || 
                nodeId;
              wasEnriched = true;
            }
            break;
          
          case "table":
            detailRecord = tablesByUid.get(dataUid);
            if (detailRecord) {
              enrichedNode.displayName = 
                detailRecord.table_name || 
                detailRecord.tableName || 
                detailRecord.name || 
                nodeName || 
                nodeId;
              wasEnriched = true;
            }
            break;
          
          case "column":
            detailRecord = columnsByUid.get(dataUid);
            if (detailRecord) {
              enrichedNode.tableName = detailRecord.table_name || detailRecord.tableName || enrichedNode.tableName;
              enrichedNode.displayName = 
                detailRecord.column_name || 
                detailRecord.columnName || 
                detailRecord.name || 
                nodeName || 
                nodeId;
              enrichedNode.columnName = detailRecord.column_name || detailRecord.columnName; // Store raw column name
              enrichedNode.tableName = detailRecord.table_name || detailRecord.tableName; // Store table name for filtering
              enrichedNode.dataType = detailRecord.datatype || detailRecord.data_type || detailRecord.dataType;
              wasEnriched = true;
            }
            break;
          
          case "measure":
            detailRecord = measuresByUid.get(dataUid);
            if (detailRecord) {
              enrichedNode.displayName = 
                detailRecord.measure_name || 
                detailRecord.measureName || 
                detailRecord.name || 
                nodeName || 
                nodeId;
              enrichedNode.expression = detailRecord.expression;
              wasEnriched = true;
            }
            break;

          case "lakehouse":
            detailRecord = lakehousesByUid.get(dataUid);
            if (detailRecord) {
              enrichedNode.displayName = 
                detailRecord.lakehouse_name || 
                detailRecord.lakehouseName || 
                detailRecord.name || 
                nodeName || 
                nodeId;
              wasEnriched = true;
            }
            break;

          case "warehouse":
            detailRecord = warehousesByUid.get(dataUid);
            if (detailRecord) {
              enrichedNode.displayName = 
                detailRecord.warehouse_name || 
                detailRecord.warehouseName || 
                detailRecord.name || 
                nodeName || 
                nodeId;
              wasEnriched = true;
            }
            break;
        }
      }

      if (wasEnriched) {
        enrichedCount++;
        // Log first 3 successful enrichments for debugging
        if (enrichedCount <= 3) {
          console.log("[LineageView] Successfully enriched node:", {
            nodeId,
            nodeType: effectiveNodeType,
            dataUid,
            displayName: enrichedNode.displayName,
            detailRecordFields: detailRecord ? Object.keys(detailRecord) : "N/A",
          });
        }
      } else {
        notEnrichedCount++;
        // Log first 5 nodes that couldn't be enriched for debugging
        if (notEnrichedCount <= 5) {
          console.warn("[LineageView] Could not enrich node:", {
            nodeId,
            nodeType: effectiveNodeType,
            dataUid,
            nodeName,
            displayName: enrichedNode.displayName,
            dimensionRecordFound: !!detailRecord,
            availableKeys: detailRecord ? Object.keys(detailRecord) : "N/A",
            rawNodeFields: Object.keys(rawNode),
          });
        }
      }

      result.push(enrichedNode);
    }

    // Determine which nodes are group nodes (have children)
    const parentNodeIds = new Set(result.map(n => n.parentNodeId).filter(Boolean));
    for (const node of result) {
      if (parentNodeIds.has(node.nodeId)) {
        node.isGroupNode = true;
      }
    }

    console.log("[LineageView] Converted v_nodes to LineageViewerNode:", {
      totalNodes: result.length,
      enrichedCount,
      notEnrichedCount,
      noDataUidCount,
      uidConstructionAttempted: noDataUidCount,
      enrichmentRate: result.length > 0 ? `${Math.round(enrichedCount / result.length * 100)}%` : "N/A",
      groupNodes: result.filter(n => n.isGroupNode).length,
      rootNodes: result.filter(n => !n.parentNodeId).length,
      withParent: result.filter(n => n.parentNodeId).length,
    });
    
    console.log("[LineageView] 📊 Schema Detection Summary:", {
      message: "The system automatically adapted to your v_nodes structure",
      detectedFields: rawNodes.length > 0 ? Object.keys(rawNodes[0]) : [],
      uidStrategy: "Primary key: LineageTag (with fallback to data_uid/uid or constructed UIDs)",
      enrichmentSuccess: `${enrichedCount}/${result.length} nodes enriched with dimension data`,
    });

    // Log parent-child hierarchy for debugging
    const parentChildMap = new Map<string, string[]>();
    for (const node of result) {
      if (node.parentNodeId) {
        const children = parentChildMap.get(node.parentNodeId) || [];
        children.push(node.nodeId);
        parentChildMap.set(node.parentNodeId, children);
      }
    }
    console.log("[LineageView] Parent-child relationships:", {
      parentsWithChildren: parentChildMap.size,
      exampleHierarchy: Array.from(parentChildMap.entries()).slice(0, 3).map(([parent, children]) => ({
        parent,
        childrenCount: children.length,
        children: children.slice(0, 3),
      })),
    });

    // Remove dangling semantic-model nodes that have no structural or lineage links.
    // These often surface as isolated `sm:<datasetId>` entries and break focused view UX.
    const connectedNodeIds = new Set<string>();
    const rawEdges = Array.isArray(activeSnapshot?.edges) ? activeSnapshot.edges : [];
    for (const rawEdge of rawEdges) {
      const { fromNodeId, toNodeId } = resolveEdgeFields(rawEdge);
      if (fromNodeId) connectedNodeIds.add(fromNodeId);
      if (toNodeId) connectedNodeIds.add(toNodeId);
    }

    const filteredResult = result.filter((node) => {
      if (!isSyntheticSemanticModelNode(node.nodeId, node.entityType)) return true;

      const hasChildren = parentChildMap.has(node.nodeId);
      const isConnectedByEdge = connectedNodeIds.has(node.nodeId);
      return hasChildren || isConnectedByEdge;
    });

    // Guardrail: if pruning would hide all nodes, preserve the original node set.
    // This prevents false "No Data Found" states when lineage edges are sparse or unavailable.
    if (result.length > 0 && filteredResult.length === 0) {
      console.warn("[LineageView] Semantic node pruning removed all nodes; preserving original nodes.");
      return result;
    }

    const removedDanglingSemanticModels = result.length - filteredResult.length;
    if (removedDanglingSemanticModels > 0) {
      console.warn("[LineageView] Removed dangling semantic_model nodes:", {
        removedCount: removedDanglingSemanticModels,
        removedNodeIds: result
          .filter((node) => !filteredResult.some((kept) => kept.nodeId === node.nodeId))
          .map((node) => node.nodeId)
          .slice(0, 10),
      });
    }

    return filteredResult;
  }, [activeSnapshot]);

  const edges: LineageViewerEdge[] = useMemo(() => {
    const rawEdges = Array.isArray(activeSnapshot?.edges) ? activeSnapshot.edges : [];
    const dimensions = activeSnapshot?.dimensions ?? {};

    console.log("[LineageView] Building edges from v_edges:", {
      rawEdgesCount: rawEdges.length,
      sampleRawEdge: rawEdges[0] ? {
        ...rawEdges[0],
        availableFields: Object.keys(rawEdges[0]),
      } : "N/A",
      detectedFieldMapping: rawEdges[0] ? {
        edgeId: rawEdges[0].dependency_pk ? "dependency_pk" : 
                rawEdges[0].edge_id ? "edge_id" : 
                rawEdges[0].edgeId ? "edgeId" : 
                rawEdges[0].LineageTag ? "LineageTag" : "AUTO_CONSTRUCTED",
        fromNodeId: rawEdges[0].node_id ? "node_id (NEW SCHEMA)" : 
                    rawEdges[0].from_node ? "from_node" : 
                    rawEdges[0].fromNodeId ? "fromNodeId" : 
              rawEdges[0].object_lineage_id ? "object_lineage_id" : 
              rawEdges[0].objectLineageId ? "objectLineageId" : 
              rawEdges[0].referenced_node_id ? "referenced_node_id (legacy swapped)" : "NOT_FOUND",
        toNodeId: rawEdges[0].referenced_node_id ? "referenced_node_id (NEW SCHEMA)" : 
                  rawEdges[0].to_node ? "to_node" : 
                  rawEdges[0].toNodeId ? "toNodeId" : 
                  rawEdges[0].referenced_object_key ? "referenced_object_key" : 
                  rawEdges[0].refernced_object_key ? "refernced_object_key (TYPO)" : 
                  rawEdges[0].referenced_object_lineage_id ? "referenced_object_lineage_id" : 
            rawEdges[0].referencedObjectLineageId ? "referencedObjectLineageId" : 
            rawEdges[0].node_id ? "node_id (legacy swapped)" : "NOT_FOUND",
        edgeType: rawEdges[0].edge_type ? "edge_type" : 
                  rawEdges[0].edgeType ? "edgeType" : 
                  rawEdges[0].object_type ? "object_type (fallback)" : "DEFAULT",
      } : "N/A",
    });

    if (rawEdges.length === 0) {
      console.warn("⚠️ [LineageView] v_edges table is EMPTY! No lineage connections will be displayed.");
      console.warn("⚠️ Check your lakehouse to ensure v_edges view/table contains data.");
      console.warn("⚠️ Required v_edges columns: object_type (or object_lineage_id/from_node), referenced_object_key (or referenced_object_lineage_id/to_node)");
      console.warn("⚠️ Optional v_edges columns: dependency_pk (or edge_id, will be auto-generated if missing), edge_type, LineageTag, lineage_id");
    }

    // Build dimension lookup maps for lineage_id enrichment
    const reportsByUid = new Map<string, any>();
    const pagesByUid = new Map<string, any>();
    const visualsByUid = new Map<string, any>();
    const semanticModelsByUid = new Map<string, any>();
    const tablesByUid = new Map<string, any>();
    const columnsByUid = new Map<string, any>();
    const measuresByUid = new Map<string, any>();
    const relationshipsByUid = new Map<string, any>();

    // Populate lookup maps with flexible uid field detection (prioritizing LineageTag)
    for (const r of (dimensions.reports || [])) {
      const uid = r.LineageTag || r.lineageTag || r.lineage_tag || r.uid || r.data_uid || r.report_uid;
      if (uid) reportsByUid.set(uid, r);
    }
    for (const p of (dimensions.pages || [])) {
      const uid = p.LineageTag || p.lineageTag || p.lineage_tag || p.uid || p.data_uid || p.page_uid;
      if (uid) pagesByUid.set(uid, p);
    }
    for (const v of (dimensions.visuals || [])) {
      const uid = v.LineageTag || v.lineageTag || v.lineage_tag || v.uid || v.data_uid || v.visual_uid;
      if (uid) visualsByUid.set(uid, v);
    }
    for (const m of (dimensions.semanticModels || [])) {
      const uid = m.LineageTag || m.lineageTag || m.lineage_tag || m.uid || m.data_uid || m.model_uid || m.dataset_uid;
      if (uid) semanticModelsByUid.set(uid, m);
    }
    for (const t of (dimensions.tables || [])) {
      const uid = t.LineageTag || t.lineageTag || t.lineage_tag || t.uid || t.data_uid || t.table_uid;
      if (uid) tablesByUid.set(uid, t);
    }
    for (const c of (dimensions.columns || [])) {
      // Index by node_id format: table_name|column_name|dataset_id
      const tableName = c.table_name || c.tableName;
      const columnName = c.column_name || c.columnName;
      const datasetId = c.dataset_id || c.datasetId;
      
      if (tableName && columnName && datasetId) {
        const nodeIdFormat = `${tableName}|${columnName}|${datasetId}`;
        columnsByUid.set(nodeIdFormat, c);
      }
      
      // Also index by LineageTag/uid as fallback
      const uid = c.LineageTag || c.lineageTag || c.lineage_tag || c.uid || c.data_uid || c.column_uid;
      if (uid) columnsByUid.set(uid, c);
    }
    for (const m of (dimensions.measures || [])) {
      const uid = m.LineageTag || m.lineageTag || m.lineage_tag || m.uid || m.data_uid || m.measure_uid;
      if (uid) measuresByUid.set(uid, m);
    }
    for (const r of (dimensions.relationships || [])) {
      const uid = r.LineageTag || r.lineageTag || r.lineage_tag || r.uid || r.data_uid || r.relationship_uid;
      if (uid) relationshipsByUid.set(uid, r);
    }

    const result: LineageViewerEdge[] = [];
    let enrichedCount = 0;
    let missingLineageIdCount = 0;
    let skippedEdgesCount = 0;

    // Convert v_edges to LineageViewerEdge with enrichment from dimension tables
    for (const rawEdge of rawEdges) {
      const { edgeId, fromNodeId, toNodeId, edgeType, lineageId } = resolveEdgeFields(rawEdge);

      if (!edgeId || !fromNodeId || !toNodeId) {
        skippedEdgesCount++;
        if (skippedEdgesCount <= 3) {
          console.warn("[LineageView] Skipping edge with missing required fields:", {
            rawEdge,
            availableColumns: Object.keys(rawEdge),
            detectedValues: { edgeId, fromNodeId, toNodeId },
            missingFields: [
              !edgeId ? "edgeId (dependency_pk/edge_id or auto-constructed)" : null,
              !fromNodeId ? "fromNodeId (referenced_node_id/from_node)" : null,
              !toNodeId ? "toNodeId (node_id/to_node)" : null,
            ].filter(Boolean),
          });
        }
        continue;
      }

      // Create base edge
      const edge: LineageViewerEdge = {
        edgeId,
        fromNodeId,
        toNodeId,
        edgeType,
      };

      // Enrich edge with details from dimension tables using lineage_id
      if (lineageId) {
        let detailRecord: any = null;
        
        // Try to find the detail record in appropriate dimension table based on edge type
        switch (edgeType) {
          case "uses":
          case "uses_dataset":
            // Report → Semantic Model relationship
            detailRecord = reportsByUid.get(lineageId) || semanticModelsByUid.get(lineageId);
            if (detailRecord) {
              edge.datasetId = detailRecord.dataset_id || detailRecord.model_id;
              edge.reportId = detailRecord.report_id;
              enrichedCount++;
            }
            break;

          case "contains":
            // Parent → Child containment (report→page, page→visual, table→column/measure)
            detailRecord = pagesByUid.get(lineageId) || 
                          visualsByUid.get(lineageId) || 
                          columnsByUid.get(lineageId) || 
                          measuresByUid.get(lineageId);
            if (detailRecord) {
              edge.reportId = detailRecord.report_id;
              edge.pageId = detailRecord.page_name;
              edge.visualId = detailRecord.visual_name;
              edge.datasetId = detailRecord.model_id;
              enrichedCount++;
            }
            break;

          case "uses_column":
          case "uses_measure":
            // Visual/Report → Column/Measure usage
            detailRecord = columnsByUid.get(lineageId) || measuresByUid.get(lineageId);
            if (detailRecord) {
              edge.datasetId = detailRecord.model_id;
              // Note: Additional details (name, table) available via lineage_id lookup in dimension tables
              enrichedCount++;
            }
            break;

          case "relationship":
            // Table → Table relationship
            detailRecord = relationshipsByUid.get(lineageId);
            if (detailRecord) {
              edge.datasetId = detailRecord.model_id;
              // Note: Relationship name available via lineage_id lookup in dimension tables
              enrichedCount++;
            }
            break;

          case "dependency":
            // Measure/Column → Measure/Column dependency
            detailRecord = measuresByUid.get(lineageId) || columnsByUid.get(lineageId);
            if (detailRecord) {
              edge.datasetId = detailRecord.model_id;
              enrichedCount++;
            }
            break;

          default:
            // Unknown edge type, try all dimension tables
            detailRecord = reportsByUid.get(lineageId) ||
                          pagesByUid.get(lineageId) ||
                          visualsByUid.get(lineageId) ||
                          semanticModelsByUid.get(lineageId) ||
                          tablesByUid.get(lineageId) ||
                          columnsByUid.get(lineageId) ||
                          measuresByUid.get(lineageId) ||
                          relationshipsByUid.get(lineageId);
            if (detailRecord) {
              enrichedCount++;
            }
        }

        if (!detailRecord) {
          missingLineageIdCount++;
          if (missingLineageIdCount <= 5) {
            console.warn("[LineageView] Could not find dimension record for lineage_id:", {
              lineageId,
              edgeType,
              fromNodeId,
              toNodeId,
            });
          }
        }
      }

      result.push(edge);
    }

    console.log("[LineageView] Converted v_edges to LineageViewerEdge:", {
      totalEdges: result.length,
      skippedEdges: skippedEdgesCount,
      enrichedWithDetails: enrichedCount,
      missingLineageId: missingLineageIdCount,
      edgeTypes: Array.from(new Set(result.map(e => e.edgeType))),
      sampleEdge: result[0] || "N/A",
    });

    if (skippedEdgesCount > 0) {
      console.warn(`⚠️ [LineageView] Skipped ${skippedEdgesCount} edges due to missing required fields (dependency_pk/edge_id, object_type/from_node, or referenced_object_key/to_node)`);
    }

    // Validate edges - ensure both nodes exist
    const nodeIds = new Set(nodes.map(n => n.nodeId));
    const validEdges: LineageViewerEdge[] = [];
    let invalidEdgeCount = 0;
    let autoCorrectedSwappedCount = 0;
    
    // Add comprehensive diagnostics for edge validation
    if (result.length > 0 && nodes.length > 0) {
      console.log("[LineageView] Edge validation diagnostics:", {
        totalNodesInGraph: nodes.length,
        totalEdgesBeforeValidation: result.length,
        sampleNodeIds: Array.from(nodeIds).slice(0, 5),
        sampleEdgeFromIds: result.slice(0, 5).map(e => e.fromNodeId),
        sampleEdgeToIds: result.slice(0, 5).map(e => e.toNodeId),
      });
    }
    
    for (const edge of result) {
      const fromExists = nodeIds.has(edge.fromNodeId);
      const toExists = nodeIds.has(edge.toNodeId);
      
      if (!fromExists || !toExists) {
        const swappedFromExists = nodeIds.has(edge.toNodeId);
        const swappedToExists = nodeIds.has(edge.fromNodeId);

        if (swappedFromExists && swappedToExists) {
          autoCorrectedSwappedCount++;
          validEdges.push({
            ...edge,
            fromNodeId: edge.toNodeId,
            toNodeId: edge.fromNodeId,
          });
          if (autoCorrectedSwappedCount <= 5) {
            console.warn("[LineageView] Auto-corrected edge orientation for compatibility:", {
              edgeId: edge.edgeId,
              originalFrom: edge.fromNodeId,
              originalTo: edge.toNodeId,
              correctedFrom: edge.toNodeId,
              correctedTo: edge.fromNodeId,
            });
          }
          continue;
        }

        invalidEdgeCount++;
        if (invalidEdgeCount <= 5) {
          console.warn("[LineageView] ❌ Filtering edge with non-existent node reference:", {
            edgeId: edge.edgeId,
            fromNodeId: edge.fromNodeId,
            fromExists,
            toNodeId: edge.toNodeId,
            toExists,
            hint: !fromExists ? `Node '${edge.fromNodeId}' not found in v_nodes` : `Node '${edge.toNodeId}' not found in v_nodes`,
          });
        }
      } else {
        validEdges.push(edge);
      }
    }

    if (invalidEdgeCount > 0) {
      console.warn(`⚠️ [LineageView] Filtered out ${invalidEdgeCount}/${result.length} edges pointing to non-existent nodes`);
      console.warn(`💡 This usually means the node IDs in v_edges (object_type/referenced_object_key) don't match the node_id values in v_nodes.`);
      console.warn(`💡 Check the browser console logs above to see sample node IDs vs edge node references.`);
    }

    if (autoCorrectedSwappedCount > 0) {
      console.warn(`ℹ️ [LineageView] Auto-corrected ${autoCorrectedSwappedCount} edges with swapped source/target orientation for environment compatibility.`);
    }

    // Log sample edges for debugging
    if (validEdges.length > 0) {
      console.log("[LineageView] Sample valid edges:", validEdges.slice(0, 3));
    }

    return validEdges;
  }, [activeSnapshot, nodes]);

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const node of nodes) set.add(node.entityType);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [nodes]);

  // ── Filtered results ──────────────────────────────────────────────────────
  const filtered = filterNodes(nodes, searchText, entityFilter);

  const filteredEdges: LineageViewerEdge[] = useMemo(() => {
    const result = filterEdgesByNodes(edges, filtered);

    console.log("[LineageView] filteredEdges:", {
      totalEdges: edges.length,
      filteredEdges: result.length,
      filteredNodesCount: filtered.length,
      edgesFilteredOut: edges.length - result.length,
    });

    return result;
  }, [edges, filtered]);

  const {
    graphNodes,
    graphEdges,
    hiddenNodeCount,
    hiddenEdgeCount,
    requiresSelection,
    focusWarning,
  } = useMemo(() => {
    return buildGraphProjection({
      filteredNodes: filtered,
      filteredEdges,
      allNodes: nodes,
      allEdges: edges,
      selectedNodeId,
      graphScope,
      graphDisplayMode,
      graphNodeLimit,
      showHierarchyEdges,
    });
  }, [filtered, filteredEdges, nodes, edges, graphNodeLimit, graphScope, selectedNodeId, graphDisplayMode, showHierarchyEdges]);

  // ── BFS highlight map ─────────────────────────────────────────────────────
  const { depthByNodeId, highlightedNodeIds, highlightedEdgeIds} = useMemo(() => {
    const depthMap = new Map<string, number>();
    const hlNodes = new Set<string>();
    const hlEdges = new Set<string>();
    if (!selectedNodeId) return { depthByNodeId: depthMap, highlightedNodeIds: hlNodes, highlightedEdgeIds: hlEdges };

    depthMap.set(selectedNodeId, 0);
    const queue: string[] = [selectedNodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const d = depthMap.get(current)!;
      // Use ALL edges for BFS traversal, not just filtered edges
      for (const e of edges) {
        if (e.fromNodeId === current && !depthMap.has(e.toNodeId)) {
          depthMap.set(e.toNodeId, d + 1);
          hlNodes.add(e.toNodeId);
          hlEdges.add(e.edgeId);
          queue.push(e.toNodeId);
        }
        if (e.toNodeId === current && !depthMap.has(e.fromNodeId)) {
          depthMap.set(e.fromNodeId, d + 1);
          hlNodes.add(e.fromNodeId);
          hlEdges.add(e.edgeId);
          queue.push(e.fromNodeId);
        }
      }
    }
    return { depthByNodeId: depthMap, highlightedNodeIds: hlNodes, highlightedEdgeIds: hlEdges };
  }, [selectedNodeId, edges]);

  // ── Empty state configuration ─────────────────────────────────────────────
  const emptyStateConfig = useMemo(() => {
    if (dataSourceMode === "actual" && !isLoadingGraph) {
      return {
        title: t("LineageWorkbench_Lineage_Empty_Title_NoData", "No Data Found"),
        message: t(
          "LineageWorkbench_Lineage_Empty_Actual",
          "No lineage snapshot is available yet. Go to the Extract tab and click 'Run extraction' to build the graph snapshot."
        ),
        hint: t(
          "LineageWorkbench_Lineage_Empty_Hint",
          "The extraction process scans your selected workspaces for semantic models, reports, and related artifacts, then saves the graph snapshot in browser storage."
        ),
        icon: "empty" as const,
      };
    }
    return {
      title: t("LineageWorkbench_Lineage_Empty_Title_Generic", "No Graph Data"),
      message: t("LineageWorkbench_Lineage_Empty", "No graph nodes available. Run extraction first."),
      icon: "empty" as const,
    };
  }, [dataSourceMode, isLoadingGraph, t]);

  // In stacked mode, expanded panels split available space evenly.
  const stackedSharedHeight = exploreLayout === "stacked";
  const graphFills = graphExpanded && (stackedSharedHeight || (!tableExpanded && !detailExpanded));
  const tableFills = tableExpanded && (stackedSharedHeight || (!graphExpanded && !detailExpanded));
  const detailFills = detailExpanded && (stackedSharedHeight || (!graphExpanded && !tableExpanded));

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={styles.root}>
      {/* ── Main content: three collapsible panels stacked vertically ── */}
      <div className={styles.mainContent}>
        {loadError && (
          <MessageBar intent="error">
            <MessageBarBody>
              {loadError}
            </MessageBarBody>
          </MessageBar>
        )}
        
        {nodes.length > 0 && edges.length === 0 && !loadError && !isLoadingGraph && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <Text weight="semibold">v_edges table is empty or edges are invalid</Text>
              <br />
              Your lakehouse has {nodes.length} nodes but no valid edges (lineage connections). 
              The Lakehouse SQL endpoint can take some time to reflect newly written Delta tables, so this may be temporary right after extraction.
              <br />
              Check that your <strong>v_edges</strong> view/table contains data where node IDs match <strong>v_nodes.node_id</strong>: 
              <strong>node_id</strong> (from node) and <strong>referenced_node_id</strong> (to node) must reference existing node_id values. 
              Optional columns: <strong>object_type</strong> (edge type/info), edge_type, dependency_pk (edge ID). Check browser console (F12) for detailed diagnostics.
            </MessageBarBody>
          </MessageBar>
        )}
        
        {nodes.length === 0 && (isLoadingGraph || shouldLoadData) ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              padding: "40px",
              textAlign: "center",
              gap: tokens.spacingVerticalL,
            }}
          >
            <Spinner size="extra-large" />
            <div style={{ display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, maxWidth: 520 }}>
              <Text size={500} weight="semibold" style={{ color: tokens.colorNeutralForeground1 }}>
                {t("LineageWorkbench_Loading_Title", "Loading Lineage Graph")}
              </Text>
              <Text style={{ color: tokens.colorNeutralForeground3 }}>
                {t("LineageWorkbench_Loading_Message", "Fetching semantic models, tables, columns, measures, and relationships for the selected workspaces...")}
              </Text>
            </div>
          </div>
        ) : nodes.length === 0 && !isLoadingGraph && !shouldLoadData ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              padding: "40px",
              textAlign: "center",
              gap: tokens.spacingVerticalL,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, maxWidth: 520 }}>
              {dataSourceMode === "actual" && (
                <MessageBar intent="warning">
                  <MessageBarBody>
                    {t(
                      "LineageWorkbench_Lineage_Empty_SqlEndpointDelayWarning",
                      "No graph snapshot is currently visible. Run extraction in this environment and retry refresh."
                    )}
                  </MessageBarBody>
                </MessageBar>
              )}
              <Text size={500} weight="semibold" style={{ color: tokens.colorNeutralForeground1 }}>
                {emptyStateConfig.title}
              </Text>
              <Text style={{ color: tokens.colorNeutralForeground3 }}>
                {emptyStateConfig.message}
              </Text>
              {emptyStateConfig.hint && (
                <Text size={200} style={{ color: tokens.colorNeutralForeground4, fontStyle: "italic" }}>
                  {emptyStateConfig.hint}
                </Text>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* ── Layout selection controls (always visible) ── */}
            <div style={{ 
              padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
              borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
              backgroundColor: tokens.colorNeutralBackground2,
              display: "flex", 
              gap: tokens.spacingHorizontalS, 
              alignItems: "center" 
            }}>
              <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                {t("LineageWorkbench_ExploreLayout", "Layout")}:
              </Text>
              <RadioGroup
                layout="horizontal"
                value={exploreLayout}
                onChange={(_, data) => {
                  const value = String(data.value);
                  const next: ExploreLayoutMode =
                    value === "side-by-side" || value === "stacked" ? value : "detail-focused";
                  setExploreLayout(next);
                }}
              >
                <Radio value="detail-focused" label={t("LineageWorkbench_ExploreLayout_DetailFocused", "Detail focused")} />
                <Radio value="side-by-side" label={t("LineageWorkbench_ExploreLayout_SideBySide", "Side-by-Side")} />
                <Radio value="stacked" label={t("LineageWorkbench_ExploreLayout_Stacked", "Stacked")} />
              </RadioGroup>
            </div>

            {exploreLayout === "stacked" ? (
              <>
                {/* Table panel */}
                <CollapsiblePanel
                  title={t("LineageWorkbench_Panel_Table", "Table")}
                  icon={<TableRegular fontSize={16} />}
                  meta={
                    selectedNodeId
                      ? t("LineageWorkbench_NodeSelected", "Node selected")
                      : undefined
                  }
                  expanded={tableExpanded}
                  onToggle={() => setTableExpanded((v) => !v)}
                  fillHeight={tableFills}
                  customHeight={tableExpanded && !tableFills ? tableHeight : undefined}
                >
                  {/* Table filters */}
                  <div style={{ 
                    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`, 
                    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                    display: "flex",
                    gap: tokens.spacingHorizontalM,
                    alignItems: "center",
                    flexWrap: "wrap",
                    backgroundColor: tokens.colorNeutralBackground2,
                  }}>
                    <div style={{ flex: "1 1 200px", minWidth: "150px" }}>
                      <Input
                        contentBefore={<SearchRegular />}
                        placeholder={t("LineageWorkbench_Search", "Search nodes...")}
                        value={searchText}
                        onChange={(_, data) => setSearchText(data.value)}
                        size="small"
                      />
                    </div>
                    <div style={{ display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center" }}>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                        {t("LineageWorkbench_AllTypes", "Type")}:
                      </Text>
                      <Select
                        value={entityFilter}
                        onChange={(_, data) => setEntityFilter(data.value)}
                        size="small"
                        style={{ minWidth: "120px" }}
                      >
                        <option value="all">{t("LineageWorkbench_AllTypes", "All types")}</option>
                        {entityTypes.map((et) => (
                          <option key={et} value={et}>{et}</option>
                        ))}
                      </Select>
                    </div>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      {t("LineageWorkbench_Showing", "Showing")} {filtered.length} / {nodes.length}
                    </Text>
                  </div>

                  {isLoadingGraph ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: "100%",
                        padding: tokens.spacingVerticalXXL,
                        gap: tokens.spacingVerticalM,
                        flexDirection: "column",
                      }}
                    >
                      <Spinner size="medium" />
                      <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                        {t("LineageWorkbench_LoadingTable", "Loading nodes and edges...")}
                      </Text>
                    </div>
                  ) : (
                    <LineageTableView
                      nodes={filtered}
                      edges={filteredEdges}
                      selectedNodeId={selectedNodeId}
                      onNodeSelect={(id) => {
                        setSelectionSource("table");
                        setSelectedNodeId(id);
                        if (!detailExpanded) setDetailExpanded(true);
                      }}
                    />
                  )}
                </CollapsiblePanel>
                
                {tableExpanded && graphExpanded && !tableFills && (
                  <ResizeHandle onMouseDown={handleResizeStart("table")} />
                )}

                {/* Graph panel */}
                <CollapsiblePanel
                  title={t("LineageWorkbench_Panel_Graph", "Graph")}
                  icon={<DataTrendingRegular fontSize={16} />}
                  meta={`${graphNodes.length}/${filtered.length} nodes · ${graphEdges.length}/${filteredEdges.length} edges`}
                  expanded={graphExpanded}
                  onToggle={() => setGraphExpanded((v) => !v)}
                  fillHeight={graphFills}
                  customHeight={graphExpanded && !graphFills ? graphHeight : undefined}
                >
                  <div className={styles.graphHint}>
                    <Text className={styles.graphHintText}>
                      {t("LineageWorkbench_HierarchyEdgesHint", "Toggle parent-child helper edges in the graph.")}
                    </Text>
                    <Switch
                      checked={showHierarchyEdges}
                      onChange={(_, data) => setShowHierarchyEdges(!!data.checked)}
                      label={t("LineageWorkbench_ShowParentChildEdges", "Show parent-child edges")}
                    />
                  </div>

                  {(hiddenNodeCount > 0 || hiddenEdgeCount > 0) && (
                    <div className={styles.graphHint}>
                      <Text className={styles.graphHintText}>
                        {t(
                          "LineageWorkbench_GraphHint",
                          "Large graph mode: {{hiddenNodes}} nodes and {{hiddenEdges}} edges are hidden to reduce visual noise.",
                          { hiddenNodes: hiddenNodeCount, hiddenEdges: hiddenEdgeCount }
                        )}
                      </Text>
                    </div>
                  )}

                  {focusWarning && (
                    <div className={styles.graphHint}>
                      <MessageBar intent="warning">
                        <MessageBarBody>
                          {t("LineageWorkbench_GraphFocusWarning", focusWarning)}
                        </MessageBarBody>
                      </MessageBar>
                    </div>
                  )}

                  {requiresSelection ? (
                    <div className={styles.graphEmptyBody}>
                      <Text style={{ color: tokens.colorNeutralForeground3, maxWidth: 460 }}>
                        {t(
                          "LineageWorkbench_GraphRequiresSelection",
                          "Focused neighborhood mode is enabled. Select a node in the table to render a local subgraph."
                        )}
                      </Text>
                    </div>
                  ) : (
                    <LineageGraphView
                      nodes={graphNodes}
                      edges={graphEdges}
                      isLoading={isLoadingGraph}
                      focusNodeId={selectedNodeId || undefined}
                      depthByNodeId={depthByNodeId}
                      highlightedNodeIds={highlightedNodeIds}
                      highlightedEdgeIds={highlightedEdgeIds}
                      expandedGroups={expandedGroups}
                      onToggleGroup={(groupId) => {
                        setExpandedGroups(prev => {
                          const next = new Set(prev);
                          if (next.has(groupId)) {
                            next.delete(groupId);
                          } else {
                            next.add(groupId);
                          }
                          return next;
                        });
                      }}
                      onNodeClick={(id) => {
                        setSelectionSource("graph");
                        setSelectedNodeId(id);
                        if (!detailExpanded) setDetailExpanded(true);
                      }}
                    />
                  )}
                </CollapsiblePanel>
                
                {graphExpanded && detailExpanded && !graphFills && (
                  <ResizeHandle onMouseDown={handleResizeStart("graph")} />
                )}
              </>
            ) : (
              <CollapsiblePanel
                title={t("LineageWorkbench_Panel_Explore", "Explore")}
                icon={<DataTrendingRegular fontSize={16} />}
                meta={`${graphNodes.length}/${filtered.length} nodes · ${graphEdges.length}/${filteredEdges.length} edges`}
                expanded={tableExpanded || graphExpanded}
                onToggle={() => {
                  const next = !(tableExpanded || graphExpanded);
                  setTableExpanded(next);
                  setGraphExpanded(next);
                }}
                fillHeight
              >
                {exploreLayout === "detail-focused" ? (
                  <>
                  <div className={`${styles.splitExplore} ${styles.splitExploreHorizontal}`}>
                    <div className={styles.splitTablePane}>
                      <div className={styles.splitPaneHeader}>
                        <span>{t("LineageWorkbench_Panel_Table", "Table")}</span>
                        <span>{filtered.length}</span>
                      </div>
                      
                      {/* Table filters */}
                      <div style={{ 
                        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`, 
                        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                        display: "flex",
                        gap: tokens.spacingHorizontalM,
                        alignItems: "center",
                        flexWrap: "wrap",
                        backgroundColor: tokens.colorNeutralBackground2,
                      }}>
                        <div style={{ flex: "1 1 200px", minWidth: "150px" }}>
                          <Input
                            contentBefore={<SearchRegular />}
                            placeholder={t("LineageWorkbench_Search", "Search nodes...")}
                            value={searchText}
                            onChange={(_, data) => setSearchText(data.value)}
                            size="small"
                          />
                        </div>
                        <div style={{ display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center" }}>
                          <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                            {t("LineageWorkbench_AllTypes", "Type")}:
                          </Text>
                          <Select
                            value={entityFilter}
                            onChange={(_, data) => setEntityFilter(data.value)}
                            size="small"
                            style={{ minWidth: "120px" }}
                          >
                            <option value="all">{t("LineageWorkbench_AllTypes", "All types")}</option>
                            {entityTypes.map((et) => (
                              <option key={et} value={et}>{et}</option>
                            ))}
                          </Select>
                        </div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageWorkbench_Showing", "Showing")} {filtered.length} / {nodes.length}
                        </Text>
                      </div>

                      {isLoadingGraph ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            height: "100%",
                            padding: tokens.spacingVerticalXXL,
                            gap: tokens.spacingVerticalM,
                            flexDirection: "column",
                          }}
                        >
                          <Spinner size="medium" />
                          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                            {t("LineageWorkbench_LoadingTable", "Loading nodes and edges...")}
                          </Text>
                        </div>
                      ) : (
                        <LineageTableView
                          nodes={filtered}
                          edges={filteredEdges}
                          selectedNodeId={selectedNodeId}
                          onNodeSelect={(id) => {
                            setSelectionSource("table");
                            setSelectedNodeId(id);
                          }}
                        />
                      )}
                    </div>

                    <div className={styles.splitDividerVertical} />

                    <div className={styles.splitGraphPane}>
                      <div className={styles.splitPaneHeader}>
                        <span>{t("LineageWorkbench_Panel_Details", "Details")}</span>
                        <span>{selectedNodeId ? nodes.find((n) => n.nodeId === selectedNodeId)?.displayName : ""}</span>
                      </div>
                      <LineageDetailView
                        nodes={nodes}
                        edges={edges}
                        dimensions={activeSnapshot?.dimensions}
                        extraction={extraction}
                        selectedNodeId={selectedNodeId}
                        selectionSource={selectionSource}
                        onNodeSelect={(nodeId, source) => {
                          setSelectionSource(source ?? "detail");
                          setSelectedNodeId(nodeId);
                        }}
                      />
                    </div>
                  </div>

                  {/* Resize handle for Graph panel in detail-focused mode */}
                  {graphExpanded && !graphFills && (
                    <ResizeHandle onMouseDown={handleResizeStart("graph")} />
                  )}

                  {/* Graph panel */}
                  <CollapsiblePanel
                    title={t("LineageWorkbench_Panel_Graph", "Graph")}
                    icon={<DataTrendingRegular fontSize={16} />}
                    meta={`${graphNodes.length}/${filtered.length} nodes · ${graphEdges.length}/${filteredEdges.length} edges`}
                    expanded={graphExpanded}
                    onToggle={() => setGraphExpanded((v) => !v)}
                    fillHeight={graphFills}
                    customHeight={graphExpanded && !graphFills ? graphHeight : undefined}
                  >
                    <div className={styles.graphHint}>
                      <Text className={styles.graphHintText}>
                        {t("LineageWorkbench_HierarchyEdgesHint", "Toggle parent-child helper edges in the graph.")}
                      </Text>
                      <Switch
                        checked={showHierarchyEdges}
                        onChange={(_, data) => setShowHierarchyEdges(!!data.checked)}
                        label={t("LineageWorkbench_ShowParentChildEdges", "Show parent-child edges")}
                      />
                    </div>

                    {(hiddenNodeCount > 0 || hiddenEdgeCount > 0) && (
                      <div className={styles.graphHint}>
                        <Text className={styles.graphHintText}>
                          {t(
                            "LineageWorkbench_GraphHint",
                            "Large graph mode: {{hiddenNodes}} nodes and {{hiddenEdges}} edges are hidden to reduce visual noise.",
                            { hiddenNodes: hiddenNodeCount, hiddenEdges: hiddenEdgeCount }
                          )}
                        </Text>
                      </div>
                    )}

                    {focusWarning && (
                      <div className={styles.graphHint}>
                        <MessageBar intent="warning">
                          <MessageBarBody>
                            {t("LineageWorkbench_GraphFocusWarning", focusWarning)}
                          </MessageBarBody>
                        </MessageBar>
                      </div>
                    )}

                    {requiresSelection ? (
                      <div className={styles.graphEmptyBody}>
                        <Text style={{ color: tokens.colorNeutralForeground3, maxWidth: 460 }}>
                          {t(
                            "LineageWorkbench_GraphRequiresSelection",
                            "Focused neighborhood mode is enabled. Select a node in the table to render a local subgraph."
                          )}
                        </Text>
                      </div>
                    ) : (
                      <LineageGraphView
                        nodes={graphNodes}
                        edges={graphEdges}
                        isLoading={isLoadingGraph}
                        focusNodeId={selectedNodeId || undefined}
                        depthByNodeId={depthByNodeId}
                        highlightedNodeIds={highlightedNodeIds}
                        highlightedEdgeIds={highlightedEdgeIds}
                        expandedGroups={expandedGroups}
                        onToggleGroup={(groupId) => {
                          setExpandedGroups(prev => {
                            const next = new Set(prev);
                            if (next.has(groupId)) {
                              next.delete(groupId);
                            } else {
                              next.add(groupId);
                            }
                            return next;
                          });
                        }}
                        onNodeClick={(id) => {
                          setSelectionSource("graph");
                          setSelectedNodeId(id);
                        }}
                      />
                    )}
                  </CollapsiblePanel>
                  </>
                ) : (
                  <div
                    className={`${styles.splitExplore} ${
                      exploreLayout === "side-by-side" ? styles.splitExploreHorizontal : styles.splitExploreVertical
                    }`}
                  >
                  <div className={styles.splitTablePane}>
                    <div className={styles.splitPaneHeader}>
                      <span>{t("LineageWorkbench_Panel_Table", "Table")}</span>
                      <span>{filtered.length}</span>
                    </div>
                    
                    {/* Table filters */}
                    <div style={{ 
                      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`, 
                      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                      display: "flex",
                      gap: tokens.spacingHorizontalM,
                      alignItems: "center",
                      flexWrap: "wrap",
                      backgroundColor: tokens.colorNeutralBackground2,
                    }}>
                      <div style={{ flex: "1 1 200px", minWidth: "150px" }}>
                        <Input
                          contentBefore={<SearchRegular />}
                          placeholder={t("LineageWorkbench_Search", "Search nodes...")}
                          value={searchText}
                          onChange={(_, data) => setSearchText(data.value)}
                          size="small"
                        />
                      </div>
                      <div style={{ display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center" }}>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                          {t("LineageWorkbench_AllTypes", "Type")}:
                        </Text>
                        <Select
                          value={entityFilter}
                          onChange={(_, data) => setEntityFilter(data.value)}
                          size="small"
                          style={{ minWidth: "120px" }}
                        >
                          <option value="all">{t("LineageWorkbench_AllTypes", "All types")}</option>
                          {entityTypes.map((et) => (
                            <option key={et} value={et}>{et}</option>
                          ))}
                        </Select>
                      </div>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        {t("LineageWorkbench_Showing", "Showing")} {filtered.length} / {nodes.length}
                      </Text>
                    </div>

                    {isLoadingGraph ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: "100%",
                          padding: tokens.spacingVerticalXXL,
                          gap: tokens.spacingVerticalM,
                          flexDirection: "column",
                        }}
                      >
                        <Spinner size="medium" />
                        <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageWorkbench_LoadingTable", "Loading nodes and edges...")}
                        </Text>
                      </div>
                    ) : (
                      <LineageTableView
                        nodes={filtered}
                        edges={filteredEdges}
                        selectedNodeId={selectedNodeId}
                        onNodeSelect={(id) => {
                          setSelectionSource("table");
                          setSelectedNodeId(id);
                          if (!detailExpanded) setDetailExpanded(true);
                        }}
                      />
                    )}
                  </div>

                  <div className={exploreLayout === "side-by-side" ? styles.splitDividerVertical : styles.splitDividerHorizontal} />

                  <div className={styles.splitGraphPane}>
                    <div className={styles.splitPaneHeader}>
                      <span>{t("LineageWorkbench_Panel_Graph", "Graph")}</span>
                      <span>{`${graphNodes.length}/${filtered.length}`}</span>
                    </div>

                    {(hiddenNodeCount > 0 || hiddenEdgeCount > 0) && (
                      <div className={styles.graphHint}>
                        <Text className={styles.graphHintText}>
                          {t(
                            "LineageWorkbench_GraphHint",
                            "Large graph mode: {{hiddenNodes}} nodes and {{hiddenEdges}} edges are hidden to reduce visual noise.",
                            { hiddenNodes: hiddenNodeCount, hiddenEdges: hiddenEdgeCount }
                          )}
                        </Text>
                      </div>
                    )}

                    {focusWarning && (
                      <div className={styles.graphHint}>
                        <MessageBar intent="warning">
                          <MessageBarBody>
                            {t("LineageWorkbench_GraphFocusWarning", focusWarning)}
                          </MessageBarBody>
                        </MessageBar>
                      </div>
                    )}

                    {requiresSelection ? (
                      <div className={styles.graphEmptyBody}>
                        <Text style={{ color: tokens.colorNeutralForeground3, maxWidth: 460 }}>
                          {t(
                            "LineageWorkbench_GraphRequiresSelection",
                            "Focused neighborhood mode is enabled. Select a node in the table to render a local subgraph."
                          )}
                        </Text>
                      </div>
                    ) : (
                      <LineageGraphView
                        nodes={graphNodes}
                        edges={graphEdges}
                        isLoading={isLoadingGraph}
                        focusNodeId={selectedNodeId || undefined}
                        depthByNodeId={depthByNodeId}
                        highlightedNodeIds={highlightedNodeIds}
                        highlightedEdgeIds={highlightedEdgeIds}
                        expandedGroups={expandedGroups}
                        onToggleGroup={(groupId) => {
                          setExpandedGroups(prev => {
                            const next = new Set(prev);
                            if (next.has(groupId)) {
                              next.delete(groupId);
                            } else {
                              next.add(groupId);
                            }
                            return next;
                          });
                        }}
                        onNodeClick={(id) => {
                          setSelectionSource("graph");
                          setSelectedNodeId(id);
                          if (!detailExpanded) setDetailExpanded(true);
                        }}
                      />
                    )}
                  </div>
                </div>
                )}
              </CollapsiblePanel>
            )}

            {/* Resize handle for Details panel */}
            {exploreLayout !== "detail-focused" && detailExpanded && !detailFills && (
              <ResizeHandle onMouseDown={handleResizeStart("detail")} />
            )}

            {/* Details panel */}
            {exploreLayout !== "detail-focused" && (
              <CollapsiblePanel
              title={t("LineageWorkbench_Panel_Details", "Details")}
              icon={<InfoRegular fontSize={16} />}
              meta={
                selectedNodeId
                  ? nodes.find((n) => n.nodeId === selectedNodeId)?.displayName
                  : t("LineageWorkbench_NoSelection", "No node selected")
              }
              expanded={detailExpanded}
              onToggle={() => setDetailExpanded((v) => !v)}
              fillHeight={detailFills}
              customHeight={detailExpanded && !detailFills ? detailHeight : undefined}
            >
              <LineageDetailView
                nodes={nodes}
                edges={edges}
                dimensions={activeSnapshot?.dimensions}
                extraction={extraction}
                selectedNodeId={selectedNodeId}
                selectionSource={selectionSource}
                onNodeSelect={(nodeId, source) => {
                  setSelectionSource(source ?? "detail");
                  setSelectedNodeId(nodeId);
                  setGraphExpanded(true);
                }}
              />
            </CollapsiblePanel>
            )}
          </>
        )}
      </div>

    </div>
  );
}
