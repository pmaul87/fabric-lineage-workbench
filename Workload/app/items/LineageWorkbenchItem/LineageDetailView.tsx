import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Dropdown,
  Option,
  Spinner,
  Text,
  makeStyles,
  tokens,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Switch,
} from "@fluentui/react-components";
import { 
  ChevronRight16Regular, 
  ChevronDown16Regular,
  Dismiss12Regular,
} from "@fluentui/react-icons";
import { LineageViewerEdge, LineageViewerNode } from "./LineageGraphView";
import { getEntityTypeLabel } from "./lineageContracts";
import type { LineageWorkbenchExtractionConfig } from "./LineageWorkbenchItemDefinition";

const AZURE_OPENAI_API_VERSION = "2024-02-01";

async function callAzureOpenAiDirect(
  endpoint: string,
  apiKey: string,
  deploymentName: string,
  prompt: string,
  maxTokens = 500,
  temperature = 0.3
): Promise<string> {
  const base = endpoint.replace(/\/+$/, "");
  const url = `${base}/openai/deployments/${encodeURIComponent(deploymentName)}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content:
            "You are a data lineage expert. Provide concise, practical explanations for BI engineers and analytics developers.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage =
      (payload as any)?.error?.message ||
      (payload as any)?.message ||
      `Azure OpenAI request failed (${response.status}).`;
    throw new Error(String(errorMessage));
  }

  const text = String((payload as any)?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) {
    throw new Error("Azure OpenAI returned an empty response.");
  }

  return text;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: {
    padding: tokens.spacingVerticalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    overflowY: "auto",
    height: "100%",
    fontFamily: tokens.fontFamilyBase,
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    textAlign: "center",
  },

  // ── Cards (Section Containers) ──────────────────────────────────────────────
  card: {
    background: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  cardTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalXXS,
  },

  // ── Inline Badge List ────────────────────────────────────────────────────────
  badgeList: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    alignItems: "center",
  },
  badgeSeparator: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
  },

  // ── Accordion Panels ─────────────────────────────────────────────────────────
  accordionPanel: {
    background: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  accordionContent: {
    minHeight: "200px",
    maxHeight: "500px",
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },

  // ── Connection List ──────────────────────────────────────────────────────────
  connectionGroup: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    overflow: "hidden",
  },
  connectionGroupLabel: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    background: tokens.colorNeutralBackground2,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  connectionItem: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    flexShrink: 0,
    gap: tokens.spacingHorizontalS,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
    cursor: "pointer",
    userSelect: "none",
    background: "transparent",
    border: "none",
    width: "100%",
    textAlign: "left",
    transition: "background-color 0.1s ease",
    ":hover": {
      background: tokens.colorNeutralBackground2Hover,
    },
    ":active": {
      background: tokens.colorNeutralBackground2Pressed,
    },
  },
  connectionItemSelected: {
    background: tokens.colorBrandBackground2,
  },
  connectionItemName: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightMedium,
    color: tokens.colorNeutralForeground1,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  connectionItemSubLabel: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    marginTop: tokens.spacingVerticalXXS,
  },

  // ── Expression Code Block ────────────────────────────────────────────────────
  expressionBlock: {
    background: tokens.colorNeutralBackground3,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: tokens.spacingVerticalM,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: "300px",
    overflowY: "auto",
  },
  tabBar: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  tabItem: {
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    maxWidth: "340px",
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalXS}`,
  },
  tabItemActive: {
    background: tokens.colorBrandBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
  },
  tabButton: {
    cursor: "pointer",
    border: "none",
    background: "transparent",
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
  },
  tabCloseButton: {
    minWidth: "22px",
    width: "22px",
    height: "22px",
    padding: 0,
  },
  tabText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tabMeta: {
    color: tokens.colorNeutralForeground3,
  },
  splitView: {
    display: "flex",
    gap: tokens.spacingHorizontalM,
    alignItems: "stretch",
    flexWrap: "wrap",
  },
  splitPane: {
    flex: "1 1 480px",
    minWidth: "320px",
    maxWidth: "100%",
  },
  paneHeader: {
    background: tokens.colorNeutralBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    marginBottom: tokens.spacingVerticalS,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
  },
  splitDivider: {
    width: tokens.strokeWidthThin,
    backgroundColor: tokens.colorNeutralStroke2,
    alignSelf: "stretch",
    minHeight: "100%",
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────



// ─── Props ────────────────────────────────────────────────────────────────────

interface LineageDetailViewProps {
  selectedNodeId?: string;
  nodes: LineageViewerNode[];
  edges: LineageViewerEdge[];
  dimensions?: any;
  extraction?: LineageWorkbenchExtractionConfig;
  onNodeSelect?: (nodeId: string, source?: "table" | "graph" | "detail") => void;
  selectionSource?: "table" | "graph" | "detail";
  embedded?: boolean;
}

type LineageDetailViewSettings = {
  maxHopDepth: number;
  relationFilter: "all" | "hide-parent-child";
  groupingMode: "object-type" | "edge-type" | "hop-count";
};

const LINEAGE_DETAIL_VIEW_SETTINGS_KEY = "lineageWorkbench.detailView.settings.v1";

const clampHopDepth = (value: unknown): number => {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return 1;
  }
  return Math.min(20, Math.max(1, parsed));
};

const loadDetailViewSettings = (): LineageDetailViewSettings => {
  const defaults: LineageDetailViewSettings = {
    maxHopDepth: 1,
    relationFilter: "all",
    groupingMode: "object-type",
  };

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(LINEAGE_DETAIL_VIEW_SETTINGS_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<LineageDetailViewSettings>;
    const rawRelationFilter = (parsed as { relationFilter?: string }).relationFilter;
    const rawGroupingMode = (parsed as { groupingMode?: string }).groupingMode;
    const rawGroupByEdgeType = (parsed as { groupByEdgeType?: boolean }).groupByEdgeType;

    let groupingMode: "object-type" | "edge-type" | "hop-count" = "object-type";
    if (rawGroupingMode === "edge-type" || rawGroupingMode === "hop-count" || rawGroupingMode === "object-type") {
      groupingMode = rawGroupingMode;
    } else if (rawGroupByEdgeType) {
      groupingMode = "edge-type";
    }

    return {
      maxHopDepth: clampHopDepth(parsed.maxHopDepth),
      relationFilter:
        rawRelationFilter === "hide-parent-child" ||
        rawRelationFilter === "parent-child" ||
        rawRelationFilter === "parent child" ||
        rawRelationFilter === "hide-contains" ||
        rawRelationFilter === "contains" ||
        rawRelationFilter === "hide_contains"
          ? "hide-parent-child"
          : "all",
      groupingMode,
    };
  } catch {
    return defaults;
  }
};

const getDimensionArray = (source: any, keys: string[]): any[] => {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
};

const normalizeDimensionsPayload = (source: any) => {
  const raw = source ?? {};
  return {
    ...raw,
    reports: getDimensionArray(raw, ["reports", "t_report_metadata"]),
    pages: getDimensionArray(raw, ["pages", "t_report_pages"]),
    visuals: getDimensionArray(raw, ["visuals", "t_report_visuals"]),
    semanticModels: getDimensionArray(raw, ["semanticModels", "t_dataset_semantic_models", "t_datamodel_semantic_models", "lineage_semantic_models"]),
    tables: getDimensionArray(raw, ["tables", "t_dataset_tables"]),
    columns: getDimensionArray(raw, ["columns", "t_dataset_columns"]),
    measures: getDimensionArray(raw, ["measures", "t_dataset_measures", "t_dataset_measure"]),
    relationships: getDimensionArray(raw, ["relationships", "t_dataset_relations", "t_dataset_relationships"]),
    partitions: getDimensionArray(raw, ["partitions", "t_dataset_partitions"]),
    columnLineage: getDimensionArray(raw, ["columnLineage", "t_dataset_column_lineage", "t_column_lineage"]),
  };
};

// ─── Component ────────────────────────────────────────────────────────────────

export function LineageDetailView({
  selectedNodeId,
  nodes,
  edges,
  dimensions,
  extraction,
  onNodeSelect,
  selectionSource = "table",
  embedded = false,
}: LineageDetailViewProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const initialSettings = useMemo(() => loadDetailViewSettings(), []);

  const [maxHopDepth, setMaxHopDepth] = useState(initialSettings.maxHopDepth);
  const [relationFilter, setRelationFilter] = useState<"all" | "hide-parent-child">(initialSettings.relationFilter);
  const [groupingMode, setGroupingMode] = useState<"object-type" | "edge-type" | "hop-count">(initialSettings.groupingMode);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [detailTabs, setDetailTabs] = useState<string[]>(selectedNodeId ? [selectedNodeId] : []);
  const [activeTabId, setActiveTabId] = useState<string | undefined>(selectedNodeId);
  const [aiExplanationState, setAiExplanationState] = useState<{
    expression: { loading: boolean; text?: string; error?: string };
    query: { loading: boolean; text?: string; error?: string };
    lineage: { loading: boolean; text?: string; error?: string };
  }>({
    expression: { loading: false },
    query: { loading: false },
    lineage: { loading: false },
  });

  const showAllConnections = maxHopDepth > 1;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const settings: LineageDetailViewSettings = {
      maxHopDepth: clampHopDepth(maxHopDepth),
      relationFilter,
      groupingMode,
    };

    window.localStorage.setItem(LINEAGE_DETAIL_VIEW_SETTINGS_KEY, JSON.stringify(settings));
  }, [maxHopDepth, relationFilter, groupingMode]);

  useEffect(() => {
    if (embedded) {
      return;
    }

    if (!selectedNodeId) {
      setDetailTabs([]);
      setActiveTabId(undefined);
      return;
    }

    if (selectionSource === "table") {
      setDetailTabs([selectedNodeId]);
      setActiveTabId(selectedNodeId);
      return;
    }

    setDetailTabs((prev) => {
      if (prev.includes(selectedNodeId)) {
        return prev;
      }
      return [...prev, selectedNodeId];
    });
    setActiveTabId(selectedNodeId);
  }, [selectedNodeId, embedded, selectionSource, activeTabId]);

  const openNodeInTab = (nodeId: string) => {
    if (embedded) {
      onNodeSelect?.(nodeId, "detail");
      return;
    }

    setDetailTabs((prev) => {
      if (prev.includes(nodeId)) {
        return prev;
      }
      return [...prev, nodeId];
    });
    setActiveTabId(nodeId);
    onNodeSelect?.(nodeId, "detail");
  };

  const closeDetailTab = (tabId: string) => {
    if (embedded) {
      return;
    }

    const tabIndex = detailTabs.indexOf(tabId);
    if (tabIndex < 0) {
      return;
    }

    const nextTabs = detailTabs.filter((id) => id !== tabId);
    setDetailTabs(nextTabs);

    if (activeTabId === tabId) {
      const fallbackTab = nextTabs[tabIndex - 1] ?? nextTabs[tabIndex] ?? nextTabs[0];
      setActiveTabId(fallbackTab);
      if (fallbackTab) {
        onNodeSelect?.(fallbackTab, "detail");
      }
      return;
    }

    if (nextTabs.length === 0) {
      setActiveTabId(undefined);
    }
  };

  const effectiveSelectedNodeId = embedded ? selectedNodeId : (activeTabId || selectedNodeId);
  const splitPaneTargets = useMemo(() => {
    if (embedded) {
      return {
        leftTabId: undefined as string | undefined,
        rightTabId: undefined as string | undefined,
      };
    }

    const leftTabId = detailTabs[0] || effectiveSelectedNodeId;
    if (!leftTabId) {
      return {
        leftTabId: undefined as string | undefined,
        rightTabId: undefined as string | undefined,
      };
    }

    let rightTabId: string | undefined;
    if (effectiveSelectedNodeId && effectiveSelectedNodeId !== leftTabId) {
      rightTabId = effectiveSelectedNodeId;
    } else {
      rightTabId = detailTabs.find((tabId) => tabId !== leftTabId);
    }

    return { leftTabId, rightTabId };
  }, [detailTabs, effectiveSelectedNodeId, embedded]);

  const toggleNodeExpansion = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const nodeById = useMemo(() => {
    const m = new Map<string, LineageViewerNode>();
    for (const n of nodes) m.set(n.nodeId, n);
    return m;
  }, [nodes]);

  const selectedNode = effectiveSelectedNodeId ? nodeById.get(effectiveSelectedNodeId) : undefined;
  const resolvedSelectedTableName = useMemo(() => {
    if (!selectedNode) {
      return undefined;
    }

    if (selectedNode.tableName) {
      return selectedNode.tableName;
    }

    if (selectedNode.entityType !== "column" && selectedNode.entityType !== "measure") {
      return selectedNode.displayName;
    }

    if (selectedNode.parentNodeId) {
      const parentNode = nodeById.get(selectedNode.parentNodeId);
      if (parentNode?.tableName) {
        return parentNode.tableName;
      }
      if (parentNode?.displayName) {
        return parentNode.displayName;
      }
    }

    const parts = selectedNode.nodeId.split("|").map((part) => part.replace(/^[^:]+:/, ""));
    if (parts.length >= 3) {
      return parts[1];
    }
    if (parts.length >= 2) {
      return parts[0];
    }

    return undefined;
  }, [nodeById, selectedNode]);

  const requestLineageExplanation = async (): Promise<void> => {
    setAiExplanationState((prev) => ({
      ...prev,
      lineage: { loading: true, text: undefined, error: undefined },
    }));

    try {
      const config = extraction?.azureOpenAI;
      if (!config?.enabled) {
        throw new Error(
          t(
            "LineageDetail_AiDisabled_Message",
            "Explain with AI is currently disabled. Enable Azure OpenAI in Extraction settings to use this feature."
          )
        );
      }

      const endpoint = String(config.endpoint ?? "").trim().replace(/\/+$/, "");
      const apiKey = String(config.apiKey ?? "").trim();
      const deploymentName = String(config.deploymentName ?? "").trim();

      if (!endpoint || !apiKey || !deploymentName) {
        throw new Error(
          t(
            "LineageDetail_AiConfigMissing_Message",
            "Azure OpenAI configuration is incomplete. Fill endpoint, API key, and deployment name in Extraction settings."
          )
        );
      }

      if (!selectedNode || !effectiveSelectedNodeId) {
        throw new Error(t("LineageDetail_AiNoSelection", "Select a node to generate an explanation."));
      }

      const incoming = edges
        .filter((edge) => edge.toNodeId === effectiveSelectedNodeId)
        .slice(0, 20)
        .map((edge) => {
          const upstream = nodeById.get(edge.fromNodeId);
          return `- ${upstream?.displayName || edge.fromNodeId} (${edge.edgeType})`;
        })
        .join("\n");

      const outgoing = edges
        .filter((edge) => edge.fromNodeId === effectiveSelectedNodeId)
        .slice(0, 20)
        .map((edge) => {
          const downstream = nodeById.get(edge.toNodeId);
          return `- ${downstream?.displayName || edge.toNodeId} (${edge.edgeType})`;
        })
        .join("\n");

      const prompt = [
        "Explain this lineage node in concise business and technical terms.",
        "",
        `Node: ${selectedNode.displayName}`,
        `Type: ${selectedNode.entityType}`,
        `Node ID: ${selectedNode.nodeId}`,
        resolvedSelectedTableName ? `Table: ${resolvedSelectedTableName}` : "",
        "",
        "Upstream connections:",
        incoming || "- none",
        "",
        "Downstream connections:",
        outgoing || "- none",
        "",
        "Return: 1) what this object represents, 2) key upstream inputs, 3) downstream impact, 4) risks/validation checks.",
      ]
        .filter(Boolean)
        .join("\n");

      const aiText = await callAzureOpenAiDirect(
        endpoint,
        apiKey,
        deploymentName,
        prompt,
        config.maxTokens ?? 500,
        config.temperature ?? 0.3
      );

      setAiExplanationState((prev) => ({
        ...prev,
        lineage: {
          loading: false,
          text: aiText,
          error: undefined,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAiExplanationState((prev) => ({
        ...prev,
        lineage: {
          loading: false,
          text: undefined,
          error: message,
        },
      }));
    }
  };

  const requestAiExplanation = async (
    kind: "expression" | "query",
    text: string,
    context: { tableName?: string; columnName?: string; datasetName?: string }
  ): Promise<void> => {
    const queryText = String(text || "").trim();
    if (!queryText) {
      return;
    }

    setAiExplanationState((prev) => ({
      ...prev,
      [kind]: { loading: true, text: undefined, error: undefined },
    }));

    try {
      const config = extraction?.azureOpenAI;
      if (!config?.enabled) {
        throw new Error(
          t(
            "LineageDetail_AiDisabled_Message",
            "Explain with AI is currently disabled. Enable Azure OpenAI in Extraction settings to use this feature."
          )
        );
      }

      const endpoint = String(config.endpoint ?? "").trim().replace(/\/+$/, "");
      const apiKey = String(config.apiKey ?? "").trim();
      const deploymentName = String(config.deploymentName ?? "").trim();

      if (!endpoint || !apiKey || !deploymentName) {
        throw new Error(
          t(
            "LineageDetail_AiConfigMissing_Message",
            "Azure OpenAI configuration is incomplete. Fill endpoint, API key, and deployment name in Extraction settings."
          )
        );
      }

      const detailKindLabel = kind === "expression" ? "expression" : "query";
      const prompt = [
        `Explain the following ${detailKindLabel} in concise, practical terms for analytics engineers and BI developers.`,
        "",
        context.datasetName ? `Dataset: ${context.datasetName}` : "",
        context.tableName ? `Table: ${context.tableName}` : "",
        context.columnName ? `Column: ${context.columnName}` : "",
        "",
        `${kind === "expression" ? "Expression" : "Query"}:`,
        queryText,
        "",
        "Return: 1) purpose, 2) step-by-step logic, 3) caveats/performance notes.",
      ]
        .filter(Boolean)
        .join("\n");

      const aiText = await callAzureOpenAiDirect(
        endpoint,
        apiKey,
        deploymentName,
        prompt,
        config.maxTokens ?? 500,
        config.temperature ?? 0.3
      );

      setAiExplanationState((prev) => ({
        ...prev,
        [kind]: {
          loading: false,
          error: undefined,
          text: aiText,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAiExplanationState((prev) => ({
        ...prev,
        [kind]: {
          loading: false,
          text: undefined,
          error: message,
        },
      }));
    }
  };

  useEffect(() => {
    setAiExplanationState({
      expression: { loading: false },
      query: { loading: false },
      lineage: { loading: false },
    });
  }, [effectiveSelectedNodeId]);

  const normalizedDimensions = useMemo(() => normalizeDimensionsPayload(dimensions), [dimensions]);

  const inferredExpression = useMemo(() => {
    if (!effectiveSelectedNodeId) {
      return undefined;
    }

    const evidence = edges.find((edge) => {
      if (edge.toNodeId !== effectiveSelectedNodeId) {
        return false;
      }
      if (!edge.edgeType.includes("depends_on")) {
        return false;
      }
      return !!edge.evidence?.trim();
    })?.evidence;

    return evidence?.trim() || undefined;
  }, [effectiveSelectedNodeId, edges]);

  const typeSpecificFields = useMemo(() => {
    if (!selectedNode) return [] as Array<{ label: string; value?: string; isLink?: boolean }>;

    const common = [
      { label: t("LineageDetail_ObjectSubtype", "Subtype"), value: selectedNode.objectSubtype },
    ];

    switch (selectedNode.entityType) {
      case "measure": {
        const normalizeValue = (value: unknown): string => String(value ?? "").trim().toLowerCase();
        const selectedMeasureName = normalizeValue(selectedNode.displayName ?? selectedNode.objectName);
        const selectedTableName = normalizeValue(resolvedSelectedTableName ?? selectedNode.tableName);
        const selectedDatasetId = normalizeValue(selectedNode.datasetId);

        // Match measure_pk directly with node_id (no transformation needed)
        const measureDetails = normalizedDimensions.measures?.find((m: any) => 
          m.measure_pk === selectedNode.nodeId || 
          m.uid === selectedNode.nodeId || 
          (() => {
            const measureName = normalizeValue(m.measure_name ?? m.measureName ?? m.name ?? m.object_name);
            const measureTable = normalizeValue(m.table_name ?? m.tableName ?? m.table);
            const measureDatasetId = normalizeValue(m.dataset_id ?? m.datasetId ?? m.model_id ?? m.modelId);

            const nameMatches = measureName === selectedMeasureName;
            const tableMatches = !selectedTableName || !measureTable || measureTable === selectedTableName;
            const datasetMatches = !selectedDatasetId || !measureDatasetId || measureDatasetId === selectedDatasetId;

            return nameMatches && tableMatches && datasetMatches;
          })()
        );
        const modelDetails = normalizedDimensions.semanticModels?.find((m: any) => 
          m.dataset_id === selectedNode.datasetId || 
          m.uid === selectedNode.datasetId || 
          m.model_pk === selectedNode.datasetId
        );
        
        // Try multiple field name variations for expression and format
        const expression = selectedNode.expression ?? inferredExpression ?? 
          measureDetails?.expression ?? measureDetails?.Expression ?? 
          measureDetails?.measure_expression ?? measureDetails?.measureExpression;
        const format = selectedNode.formatString ?? 
          measureDetails?.formatstring ?? measureDetails?.formatString ?? 
          measureDetails?.format_string ?? measureDetails?.format;
        
        console.log("[LineageDetail] Measure metadata lookup:", {
          nodeId: selectedNode.nodeId,
          searchingFor: { measure_pk: selectedNode.nodeId, uid: selectedNode.nodeId, measure_name: selectedNode.displayName, table: selectedNode.tableName },
          resolvedTableName: resolvedSelectedTableName,
          totalMeasuresInDimensions: normalizedDimensions.measures?.length || 0,
          sampleMeasure: normalizedDimensions.measures?.[0],
          foundMeasureDetails: !!measureDetails,
          measureFields: measureDetails ? Object.keys(measureDetails) : [],
          measureDetailsRaw: measureDetails,
          foundModelDetails: !!modelDetails,
          workspace_name: modelDetails?.workspace_name,
          description: measureDetails?.description,
          expression,
          format,
        });
        
        // Check KPI status
        const isKPI = !!(measureDetails?.kpistatus || measureDetails?.kpi_status || measureDetails?.isKPI);
        
        return [
          { label: t("LineageDetail_Table", "Table"), value: resolvedSelectedTableName },
          { label: t("LineageDetail_Model", "Model"), value: modelDetails?.model_name || modelDetails?.displayName || selectedNode.datasetId },
          { label: t("LineageDetail_Workspace", "Workspace"), value: modelDetails?.workspace_name },
          { label: t("LineageDetail_ObjectName", "Object"), value: selectedNode.objectName || measureDetails?.name },
          { label: t("LineageDetail_DataType", "Data type"), value: selectedNode.dataType || measureDetails?.datatype },
          { label: t("LineageDetail_Format", "Format"), value: format },
          { label: t("LineageDetail_Expression", "Expression"), value: expression },
          { label: t("LineageDetail_DisplayFolder", "Display folder"), value: measureDetails?.displayfolder || measureDetails?.display_folder },
          { label: t("LineageDetail_IsKPI", "Is KPI"), value: isKPI ? "Yes" : undefined },
          { label: t("LineageDetail_Hidden", "Hidden"), value: measureDetails?.ishidden ? "Yes" : "No" },
          { label: t("LineageDetail_Description", "Description"), value: measureDetails?.description },
          ...common,
        ];
      }
      case "column": {
        const normalizeValue = (value: unknown): string => String(value ?? "").trim().toLowerCase();
        const selectedColumnName = normalizeValue(selectedNode.displayName ?? selectedNode.objectName);
        const selectedTableName = normalizeValue(resolvedSelectedTableName ?? selectedNode.tableName);
        const selectedDatasetId = normalizeValue(selectedNode.datasetId);

        // Match column_pk directly with node_id (no transformation needed)
        const columnDetails = normalizedDimensions.columns?.find((c: any) => 
          c.column_pk === selectedNode.nodeId || 
          c.uid === selectedNode.nodeId || 
          (() => {
            const columnName = normalizeValue(c.column_name ?? c.columnName ?? c.name ?? c.object_name);
            const columnTable = normalizeValue(c.table_name ?? c.tableName ?? c.table);
            const columnDatasetId = normalizeValue(c.dataset_id ?? c.datasetId ?? c.model_id ?? c.modelId);

            const nameMatches = columnName === selectedColumnName;
            const tableMatches = !selectedTableName || !columnTable || columnTable === selectedTableName;
            const datasetMatches = !selectedDatasetId || !columnDatasetId || columnDatasetId === selectedDatasetId;

            return nameMatches && tableMatches && datasetMatches;
          })()
        );
        const modelDetails = normalizedDimensions.semanticModels?.find((m: any) => 
          m.dataset_id === selectedNode.datasetId || 
          m.uid === selectedNode.datasetId || 
          m.model_pk === selectedNode.datasetId
        );

        const columnDatasetId =
          selectedNode.datasetId ??
          columnDetails?.dataset_id ??
          columnDetails?.datasetId ??
          modelDetails?.dataset_id ??
          modelDetails?.uid;
        const normalizedTableName = normalizeValue(resolvedSelectedTableName);
        const normalizedDatasetId = normalizeValue(columnDatasetId);
        const partitionRows = normalizedDimensions.partitions;
        const matchedPartitions = partitionRows.filter((partition: any) => {
          const partitionTableName = normalizeValue(partition.table_name ?? partition.name);
          const partitionDatasetId = normalizeValue(partition.dataset_id ?? partition.datasetId);

          const matchesTable = partitionTableName === normalizedTableName;
          const matchesDataset = normalizedDatasetId ? partitionDatasetId === normalizedDatasetId : !partitionDatasetId;
          return matchesTable && matchesDataset;
        });
        const partitionQueryText = matchedPartitions
          .map((partition: any, index: number) => {
            const queryText = String(partition.query ?? "").trim();
            if (!queryText) {
              return "";
            }

            const partitionName = String(partition.partition_name ?? "").trim();
            if (partitionName) {
              return `-- Partition ${index + 1}: ${partitionName}\n${queryText}`;
            }

            if (matchedPartitions.length > 1) {
              return `-- Partition ${index + 1}\n${queryText}`;
            }

            return queryText;
          })
          .filter((queryText: string) => queryText.length > 0)
          .join("\n\n");
        
        // Try multiple field name variations for expression and format
        const columnExpression = selectedNode.expression ?? inferredExpression ?? 
          columnDetails?.expression ?? columnDetails?.Expression ?? 
          columnDetails?.column_expression ?? columnDetails?.columnExpression;
        const format = selectedNode.formatString ?? 
          columnDetails?.formatstring ?? columnDetails?.formatString ?? 
          columnDetails?.format_string ?? columnDetails?.format;
        
        console.log("[LineageDetail] Column metadata lookup:", {
          nodeId: selectedNode.nodeId,
          selectedNodeFields: Object.keys(selectedNode),
          selectedNodeFull: selectedNode,
          searchingFor: { 
            column_pk: selectedNode.nodeId, 
            uid: selectedNode.nodeId, 
            column_name: selectedNode.displayName, 
              table: resolvedSelectedTableName 
          },
          resolvedTableName: resolvedSelectedTableName,
          totalColumnsInDimensions: normalizedDimensions.columns?.length || 0,
          sampleColumn: normalizedDimensions.columns?.[0],
          sampleColumnFields: normalizedDimensions.columns?.[0] ? Object.keys(normalizedDimensions.columns[0]) : [],
          foundColumnDetails: !!columnDetails,
          columnFields: columnDetails ? Object.keys(columnDetails) : [],
          columnDetailsRaw: columnDetails,
          columnExpression,
          partitionQueryText,
          format,
        });
        
        // Check if calculated column
        const isCalculated = !!(columnExpression || columnDetails?.type === "Calculated" || columnDetails?.column_type === "Calculated");
        
        return [
          { label: t("LineageDetail_Table", "Table"), value: resolvedSelectedTableName },
          { label: t("LineageDetail_Model", "Model"), value: modelDetails?.model_name || modelDetails?.displayName || selectedNode.datasetId },
          { label: t("LineageDetail_Workspace", "Workspace"), value: modelDetails?.workspace_name },
          { label: t("LineageDetail_ObjectName", "Object"), value: selectedNode.objectName || columnDetails?.name },
          { label: t("LineageDetail_ColumnType", "Column type"), value: isCalculated ? "Calculated" : "Data" },
          { label: t("LineageDetail_DataType", "Data type"), value: selectedNode.dataType || columnDetails?.datatype },
          { label: t("LineageDetail_Format", "Format"), value: format },
          { label: t("LineageDetail_DataCategory", "Data category"), value: columnDetails?.datacategory || columnDetails?.data_category },
          { label: t("LineageDetail_Expression", "Expression"), value: isCalculated ? columnExpression : undefined },
          { label: t("LineageDetail_Query", "Query"), value: !isCalculated ? partitionQueryText : undefined },
          { label: t("LineageDetail_SourceColumn", "Source column"), value: columnDetails?.sourcecolumn || columnDetails?.source_column },
          { label: t("LineageDetail_Aggregation", "Aggregation"), value: columnDetails?.summarizebydefault !== false ? (columnDetails?.aggregation || columnDetails?.defaultaggregation || "Sum") : "None" },
          { label: t("LineageDetail_SortOrder", "Sort by column"), value: columnDetails?.sortbycolumn || columnDetails?.sortbycolumnid },
          { label: t("LineageDetail_DisplayFolder", "Display folder"), value: columnDetails?.displayfolder || columnDetails?.display_folder },
          { label: t("LineageDetail_Hidden", "Hidden"), value: columnDetails?.ishidden ? "Yes" : "No" },
          { label: t("LineageDetail_Description", "Description"), value: columnDetails?.description },
          ...common,
        ];
      }
      case "visual": {
        const visualDetails = normalizedDimensions.visuals?.find((visual: any) => {
          const visualPk = visual.visual_pk;
          const visualUid = visual.LineageTag || visual.lineageTag || visual.lineage_tag || visual.uid || visual.data_uid || visual.visual_uid;
          const visualName = visual.visual_name || visual.visualName || visual.name;
          const reportId = visual.report_id || visual.reportId || visual.report_pk;
          const pageName = visual.page_name || visual.pageName || visual.Page_display_name || visual.page_display_name;

          if (visualPk === selectedNode.nodeId || visualUid === selectedNode.nodeId) {
            return true;
          }

          const fallbackReportId = selectedNode.reportId || selectedNode.nodeId.split("|").map((part) => part.replace(/^[^:]+:/, ""))[0];
          const fallbackPageId = selectedNode.pageId || selectedNode.nodeId.split("|").map((part) => part.replace(/^[^:]+:/, ""))[1];
          const fallbackVisualId = selectedNode.visualId || selectedNode.nodeId.split("|").map((part) => part.replace(/^[^:]+:/, ""))[selectedNode.nodeId.split("|").length - 1];

          return visualName === fallbackVisualId &&
            (!fallbackReportId || reportId === fallbackReportId) &&
            (!fallbackPageId || pageName === fallbackPageId);
        });

        const reportDetails = dimensions?.reports?.find((r: any) =>
          r.report_pk === selectedNode.reportId ||
          r.report_id === selectedNode.reportId ||
          r.uid === selectedNode.reportId ||
          r.LineageTag === selectedNode.reportId
        );

        const pageDetails = dimensions?.pages?.find((p: any) => {
          const pageName = p.page_name || p.pageName || p.name;
          const reportId = p.report_id || p.reportId;
          return pageName === selectedNode.pageId && reportId === selectedNode.reportId;
        });

        return [
          { label: t("LineageDetail_VisualType", "Visual type"), value: visualDetails?.display_type || visualDetails?.type || visualDetails?.visual_type || selectedNode.visualType },
          { label: t("LineageDetail_Page", "Page"), value: visualDetails?.Page_display_name || visualDetails?.page_display_name || pageDetails?.page_display_name || pageDetails?.Page_display_name || pageDetails?.displayName || selectedNode.pageId },
          { label: t("LineageDetail_Report", "Report"), value: reportDetails?.report_name || reportDetails?.displayName || selectedNode.reportId },
          { label: t("LineageDetail_Workspace", "Workspace"), value: reportDetails?.workspace_name },
          { label: t("LineageDetail_VisualTitle", "Visual title"), value: visualDetails?.title || visualDetails?.visual_title || visualDetails?.display_name },
          { label: t("LineageDetail_VisualName", "Visual name"), value: visualDetails?.visual_name || visualDetails?.name || selectedNode.visualId },
          { label: t("LineageDetail_Hidden", "Hidden"), value: visualDetails?.hidden !== undefined ? (visualDetails.hidden ? "Yes" : "No") : "N/A" },
          { label: t("LineageDetail_URL", "URL"), value: visualDetails?.url || visualDetails?.URL || visualDetails?.link, isLink: true },
          { label: t("LineageDetail_ReportId", "Report ID"), value: selectedNode.reportId },
          ...common,
        ];
      }
      case "report": {
        // Match report using multiple strategies
        let reportDetails = dimensions?.reports?.find((r: any) => 
          r.report_pk === selectedNode.nodeId
        );
        
        if (!reportDetails) {
          reportDetails = dimensions?.reports?.find((r: any) => {
            const uid = r.LineageTag || r.lineageTag || r.lineage_tag || r.uid || r.data_uid || r.report_uid;
            return uid === selectedNode.nodeId;
          });
        }
        
        if (!reportDetails && selectedNode.reportId) {
          reportDetails = dimensions?.reports?.find((r: any) => 
            r.report_id === selectedNode.reportId || r.reportId === selectedNode.reportId
          );
        }
        const modelDetails = normalizedDimensions.semanticModels?.find((m: any) => 
          m.dataset_id === selectedNode.datasetId || m.uid === selectedNode.datasetId
        );
        return [
          { label: t("LineageDetail_ReportId", "Report ID"), value: selectedNode.reportId || reportDetails?.report_id },
          { label: t("LineageDetail_Workspace", "Workspace"), value: reportDetails?.workspace_name },
          { label: t("LineageDetail_Dataset", "Dataset"), value: modelDetails?.model_name || modelDetails?.displayName || selectedNode.datasetId },
          { label: t("LineageDetail_Pages", "Pages"), value: reportDetails?.page_count?.toString() },
          { label: t("LineageDetail_Visuals", "Total visuals"), value: reportDetails?.visual_count?.toString() },
          { label: t("LineageDetail_Description", "Description"), value: reportDetails?.description },
          ...common,
        ];
      }
      case "page": {
        // Match page using multiple strategies
        let pageDetails = dimensions?.pages?.find((p: any) => 
          p.page_pk === selectedNode.nodeId
        );
        
        if (!pageDetails) {
          pageDetails = dimensions?.pages?.find((p: any) => {
            const uid = p.LineageTag || p.lineageTag || p.lineage_tag || p.uid || p.data_uid || p.page_uid;
            return uid === selectedNode.nodeId;
          });
        }
        
        if (!pageDetails && selectedNode.pageId) {
          pageDetails = dimensions?.pages?.find((p: any) => {
            const pageName = p.page_name || p.pageName || p.name;
            const reportId = p.report_id || p.reportId;
            return pageName === selectedNode.pageId && reportId === selectedNode.reportId;
          });
        }
        const reportDetails = dimensions?.reports?.find((r: any) => 
          r.report_id === selectedNode.reportId || 
          r.uid === selectedNode.reportId || 
          r.report_pk === selectedNode.reportId
        );
        return [
          { label: t("LineageDetail_PageNumber", "Page number"), value: selectedNode.pageNumber?.toString() || pageDetails?.page_number?.toString() },
          { label: t("LineageDetail_Report", "Report"), value: reportDetails?.report_name || reportDetails?.displayName || selectedNode.reportId },
          { label: t("LineageDetail_Workspace", "Workspace"), value: reportDetails?.workspace_name },
          { label: t("LineageDetail_Visuals", "Visuals on page"), value: pageDetails?.visual_count?.toString() },
          { label: t("LineageDetail_ReportId", "Report ID"), value: selectedNode.reportId },
          ...common,
        ];
      }
      case "table": {
        // Match table_pk directly with node_id (no transformation needed)
        const tableDetails = dimensions?.tables?.find((t: any) => 
          t.table_pk === selectedNode.nodeId || 
          t.uid === selectedNode.nodeId || 
          (t.table_name === selectedNode.tableName && t.dataset_id === selectedNode.datasetId)
        );
        const normalizeValue = (value: unknown): string => String(value ?? "").trim().toLowerCase();
        const modelDetails = normalizedDimensions.semanticModels?.find((m: any) => 
          m.dataset_id === selectedNode.datasetId || 
          m.uid === selectedNode.datasetId || 
          m.model_pk === selectedNode.datasetId
        );

        const tableDatasetId =
          selectedNode.datasetId ??
          tableDetails?.dataset_id ??
          tableDetails?.datasetId ??
          modelDetails?.dataset_id ??
          modelDetails?.uid;

        const tableName = selectedNode.tableName ?? selectedNode.displayName;
        const normalizedTableName = normalizeValue(tableName);
        const normalizedDatasetId = normalizeValue(tableDatasetId);
        const partitionRows = normalizedDimensions.partitions;
        const matchedPartitions = partitionRows.filter((partition: any) => {
          const partitionTableName = normalizeValue(partition.table_name ?? partition.name);
          const partitionDatasetId = normalizeValue(partition.dataset_id ?? partition.datasetId);

          const matchesTable = partitionTableName === normalizedTableName;
          const matchesDataset = normalizedDatasetId ? partitionDatasetId === normalizedDatasetId : !partitionDatasetId;
          return matchesTable && matchesDataset;
        });

        const partitionQueryText = matchedPartitions
          .map((partition: any, index: number) => {
            const queryText = String(partition.query ?? partition.source ?? "").trim();
            if (!queryText) {
              return "";
            }

            const partitionName = String(partition.partition_name ?? "").trim();
            if (partitionName) {
              return `-- Partition ${index + 1}: ${partitionName}\n${queryText}`;
            }

            if (matchedPartitions.length > 1) {
              return `-- Partition ${index + 1}\n${queryText}`;
            }

            return queryText;
          })
          .filter((queryText: string) => queryText.length > 0)
          .join("\n\n");
        
        console.log("[LineageDetail] Table metadata lookup:", {
          nodeId: selectedNode.nodeId,
          foundTableDetails: !!tableDetails,
          tableFields: tableDetails ? Object.keys(tableDetails) : [],
          tableDetailsRaw: tableDetails,
        });
        
        // Storage mode
        const storageMode = tableDetails?.mode || tableDetails?.storage_mode || tableDetails?.storagemode;
        
        // Check if calculated table
        const isCalculated = !!(tableDetails?.type === "Calculated" || tableDetails?.table_type === "Calculated" || tableDetails?.expression);
        
        return [
          { label: t("LineageDetail_Table", "Table"), value: selectedNode.tableName ?? selectedNode.displayName },
          { label: t("LineageDetail_Model", "Model"), value: modelDetails?.model_name || modelDetails?.displayName || selectedNode.datasetId },
          { label: t("LineageDetail_Workspace", "Workspace"), value: modelDetails?.workspace_name },
          { label: t("LineageDetail_TableType", "Table type"), value: isCalculated ? "Calculated" : "Data" },
          { label: t("LineageDetail_Source", "Source"), value: tableDetails?.sourcetype || tableDetails?.source_type },
          { label: t("LineageDetail_StorageMode", "Storage mode"), value: storageMode },
          { label: t("LineageDetail_Query", "Query"), value: partitionQueryText },
          { label: t("LineageDetail_Columns", "Column count"), value: tableDetails?.column_count?.toString() },
          { label: t("LineageDetail_Measures", "Measure count"), value: tableDetails?.measure_count?.toString() },
          { label: t("LineageDetail_RowCount", "Row count"), value: tableDetails?.row_count?.toLocaleString() || tableDetails?.rowcount?.toLocaleString() },
          { label: t("LineageDetail_Partitions", "Partitions"), value: tableDetails?.partition_count?.toString() || tableDetails?.partitioncount?.toString() },
          { label: t("LineageDetail_RefreshPolicy", "Refresh policy"), value: tableDetails?.refreshpolicy || tableDetails?.refresh_policy },
          { label: t("LineageDetail_DisplayFolder", "Display folder"), value: tableDetails?.displayfolder || tableDetails?.display_folder },
          { label: t("LineageDetail_Hidden", "Hidden"), value: tableDetails?.ishidden ? "Yes" : "No" },
          { label: t("LineageDetail_ObjectName", "Object"), value: selectedNode.objectName },
          { label: t("LineageDetail_Description", "Description"), value: tableDetails?.description },
          ...common,
        ];
      }
      default:
        return [
          { label: t("LineageDetail_ObjectName", "Object"), value: selectedNode.objectName },
          ...common,
          { label: t("LineageDetail_DataType", "Data type"), value: selectedNode.dataType },
        ];
    }
  }, [selectedNode, inferredExpression, t, dimensions, normalizedDimensions, resolvedSelectedTableName]);

  const selectedInfoCards = useMemo(() => {
    if (!selectedNode) return [] as Array<{ key: string; label: string; value: string; isCode?: boolean; isLink?: boolean }>;

    console.log("[LineageDetail] Building selectedInfoCards:", {
      entityType: selectedNode.entityType,
      nodeId: selectedNode.nodeId,
      typeSpecificFieldsCount: typeSpecificFields.length,
      typeSpecificFields: typeSpecificFields.map(f => ({ label: f.label, hasValue: !!f.value, value: f.value })),
      hasDimensions: !!dimensions,
      dimensionKeys: dimensions ? Object.keys(dimensions) : [],
    });

    return [
      {
        key: "type",
        label: t("LineageDetail_Type", "Type"),
        value: getEntityTypeLabel(selectedNode.entityType),
        isLink: false,
      },
      {
        key: "name",
        label: t("LineageDetail_Name", "Name"),
        value: selectedNode.displayName,
        isLink: false,
      },
      {
        key: "node-id",
        label: t("LineageDetail_NodeId", "Node ID"),
        value: selectedNode.nodeId,
        isLink: false,
      },
      ...typeSpecificFields
        .filter(
          (field) =>
            !!field.value &&
            field.label !== t("LineageDetail_Expression", "Expression") &&
            field.label !== t("LineageDetail_Query", "Query")
        ) // Exclude expression/query from inline display
        .map((field, index) => ({
          key: `meta-${index}-${field.label}`,
          label: field.label,
          value: field.value!,
          isLink: field.isLink || false,
        })),
    ];
  }, [selectedNode, typeSpecificFields, t, dimensions]);

  const datasetName = useMemo(() => {
    if (!selectedNode) {
      return undefined;
    }

    if (selectedNode.entityType === "column" || selectedNode.entityType === "measure") {
      return selectedNode.datasetId || selectedNode.tableName || selectedNode.displayName;
    }

    if (selectedNode.entityType === "table") {
      return selectedNode.datasetId || selectedNode.tableName || selectedNode.displayName;
    }

    if (selectedNode.entityType === "visual") {
      return selectedNode.reportId || selectedNode.pageId || selectedNode.displayName;
    }

    return selectedNode.displayName;
  }, [selectedNode]);

  const expressionValue = useMemo(() => {
    if (!selectedNode) {
      return "";
    }

    if (selectedNode.entityType === "column") {
      return selectedNode.expression ?? inferredExpression ?? "";
    }

    if (selectedNode.entityType === "measure") {
      return selectedNode.expression ?? inferredExpression ?? "";
    }

    return "";
  }, [inferredExpression, selectedNode]);

  const queryValue = useMemo(() => {
    if (!selectedNode || selectedNode.entityType !== "column") {
      return "";
    }

    const field = typeSpecificFields.find((entry) => entry.label === t("LineageDetail_Query", "Query"));
    return field?.value ?? "";
  }, [selectedNode, typeSpecificFields, t]);

  const showExpression = !!expressionValue && selectedNode?.entityType !== "visual" && selectedNode?.entityType !== "table" && selectedNode?.entityType !== "report";
  const showQuery = !!queryValue && selectedNode?.entityType === "column";

  const visibleEdges = useMemo(() => {
    const normalizedRelationFilter = relationFilter;
    const structuralEdgeTypes = new Set(["contains", "parent child", "parent-child", "hierarchy"]);
    return edges.filter((edge) => {
      const edgeType = (edge.edgeType || "").trim().toLowerCase();
      if (normalizedRelationFilter === "hide-parent-child") {
        return !structuralEdgeTypes.has(edgeType);
      }
      return true;
    });
  }, [edges, relationFilter]);

  const hiddenByRelationFilterNodeIds = useMemo(() => {
    if (relationFilter !== "hide-parent-child") {
      return new Set<string>();
    }

    const structuralEdgeTypes = new Set(["contains", "parent child", "parent-child", "hierarchy"]);
    const structuralChildTypesToHide = new Set(["column", "measure", "table", "lakehouse_table", "warehouse_table"]);
    const hasNonStructuralConnection = new Set<string>();

    for (const edge of edges) {
      const edgeType = (edge.edgeType || "").trim().toLowerCase();
      if (structuralEdgeTypes.has(edgeType)) {
        continue;
      }
      hasNonStructuralConnection.add(edge.fromNodeId);
      hasNonStructuralConnection.add(edge.toNodeId);
    }

    const hidden = new Set<string>();

    for (const edge of edges) {
      const edgeType = (edge.edgeType || "").trim().toLowerCase();
      if (!structuralEdgeTypes.has(edgeType)) {
        continue;
      }

      const childNode = nodeById.get(edge.toNodeId);
      const childType = String(childNode?.entityType || "").trim().toLowerCase();
      if (structuralChildTypesToHide.has(childType)) {
        if (!hasNonStructuralConnection.has(edge.toNodeId)) {
          hidden.add(edge.toNodeId);
        }
      }
    }

    return hidden;
  }, [edges, nodeById, relationFilter]);

  const nodeEdges = useMemo(() => {
    if (!effectiveSelectedNodeId) return { 
      incoming: [] as LineageViewerEdge[], 
      outgoing: [] as LineageViewerEdge[],
      incomingRelationships: [] as LineageViewerEdge[],
      outgoingRelationships: [] as LineageViewerEdge[],
      incomingDependencies: [] as LineageViewerEdge[],
      outgoingDependencies: [] as LineageViewerEdge[],
    };
    const incoming = visibleEdges.filter((e) => e.toNodeId === effectiveSelectedNodeId);
    const outgoing = visibleEdges.filter((e) => e.fromNodeId === effectiveSelectedNodeId);
    
    console.log("[LineageDetail] Node edges for", effectiveSelectedNodeId, ":", {
      incomingCount: incoming.length,
      outgoingCount: outgoing.length,
      totalEdges: visibleEdges.length,
      sampleIncoming: incoming.slice(0, 3),
      sampleOutgoing: outgoing.slice(0, 3),
    });
    
    return {
      incoming,
      outgoing,
      incomingRelationships: incoming.filter((e) => e.edgeType === "relationship"),
      outgoingRelationships: outgoing.filter((e) => e.edgeType === "relationship"),
      incomingDependencies: incoming.filter((e) => e.edgeType === "dependency"),
      outgoingDependencies: outgoing.filter((e) => e.edgeType === "dependency"),
    };
  }, [effectiveSelectedNodeId, visibleEdges]);

  const edgeCountByNodeId = useMemo(() => {
    const counts = new Map<string, { incoming: number; outgoing: number }>();

    for (const edge of edges) {
      const source = counts.get(edge.fromNodeId) || { incoming: 0, outgoing: 0 };
      source.outgoing += 1;
      counts.set(edge.fromNodeId, source);

      const target = counts.get(edge.toNodeId) || { incoming: 0, outgoing: 0 };
      target.incoming += 1;
      counts.set(edge.toNodeId, target);
    }

    return counts;
  }, [edges]);

  // Get downstream dependencies for a specific node (for expansion)
  const getNodeDownstream = (startNodeId: string): LineageViewerNode[] => {
    const visited = new Set<string>();
    const queue = [startNodeId];
    const result: LineageViewerNode[] = [];
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      
      // Find all edges where this node is the source (downstream dependencies)
      const outgoing = edges.filter(e => 
        e.fromNodeId === currentId && 
        (e.edgeType === "dependency" || e.edgeType === "relationship")
      );
      
      for (const edge of outgoing) {
        if (!visited.has(edge.toNodeId)) {
          const targetNode = nodeById.get(edge.toNodeId);
          if (targetNode && targetNode.nodeId !== startNodeId) {
            result.push(targetNode);
            queue.push(edge.toNodeId);
          }
        }
      }
    }
    
    return result;
  };

  // Compute all transitive upstream/downstream connections using BFS
  const allTransitiveConnections = useMemo(() => {
    if (!selectedNode || maxHopDepth < 1) {
      return {
        upstream: [] as LineageViewerNode[],
        downstream: [] as LineageViewerNode[],
        upstreamDegreeMap: new Map<string, number>(),
        downstreamDegreeMap: new Map<string, number>(),
        upstreamPathMap: new Map<string, string[]>(),
        downstreamPathMap: new Map<string, string[]>(),
      };
    }

    const computeTransitive = (
      startNodeId: string,
      direction: "upstream" | "downstream"
    ): { nodes: LineageViewerNode[], degreeMap: Map<string, number>, pathMap: Map<string, string[]> } => {
      const visited = new Set<string>();
      const queue: { nodeId: string, degree: number, path: string[] }[] = [{ nodeId: startNodeId, degree: 0, path: [startNodeId] }];
      const results: LineageViewerNode[] = [];
      const degreeMap = new Map<string, number>();
      const pathMap = new Map<string, string[]>();

      while (queue.length > 0) {
        const { nodeId: currentNodeId, degree: currentDegree, path: currentPath } = queue.shift()!;
        if (visited.has(currentNodeId)) continue;
        visited.add(currentNodeId);

        // Skip the starting node itself
        if (currentNodeId !== startNodeId) {
          const currentNode = nodeById.get(currentNodeId);
          if (currentNode) {
            results.push(currentNode);
            degreeMap.set(currentNodeId, currentDegree);
            const pathNames = currentPath
              .map((nodeId) => nodeById.get(nodeId)?.displayName)
              .filter((name): name is string => !!name);
            pathMap.set(currentNodeId, pathNames);
          }
        }

        // Find edges in the specified direction.
        // "Show all" should traverse the full lineage graph, not only dependency/relationship edges.
        const relevantEdges = visibleEdges.filter((e) =>
          direction === "upstream" ? e.toNodeId === currentNodeId : e.fromNodeId === currentNodeId,
        );

        // Add neighbors to queue with incremented degree
        if (currentDegree >= maxHopDepth) {
          continue;
        }

        for (const edge of relevantEdges) {
          const nextNodeId = direction === "upstream" ? edge.fromNodeId : edge.toNodeId;
          if (hiddenByRelationFilterNodeIds.has(nextNodeId)) {
            continue;
          }
          if (!visited.has(nextNodeId)) {
            queue.push({ nodeId: nextNodeId, degree: currentDegree + 1, path: [...currentPath, nextNodeId] });
          }
        }
      }

      return { nodes: results, degreeMap, pathMap };
    };

    const upstreamResult = computeTransitive(selectedNode.nodeId, "upstream");
    const downstreamResult = computeTransitive(selectedNode.nodeId, "downstream");

    return {
      upstream: upstreamResult.nodes,
      downstream: downstreamResult.nodes,
      upstreamDegreeMap: upstreamResult.degreeMap,
      downstreamDegreeMap: downstreamResult.degreeMap,
      upstreamPathMap: upstreamResult.pathMap,
      downstreamPathMap: downstreamResult.pathMap,
    };
  }, [selectedNode, maxHopDepth, nodeById, visibleEdges, hiddenByRelationFilterNodeIds]);

  // Classify related nodes by relationship category
  const relations = useMemo(() => {
    if (!selectedNode) return {};

    // Only include dependency and relationship edges, exclude structural "contains" edges
    const dependencyEdgesOnly = {
      incoming: nodeEdges.incoming.filter(e => e.edgeType === "dependency" || e.edgeType === "relationship"),
      outgoing: nodeEdges.outgoing.filter(e => e.edgeType === "dependency" || e.edgeType === "relationship"),
    };

    const neighborsOf = (edgeList: LineageViewerEdge[], side: "from" | "to") =>
      edgeList
        .map((e) => nodeById.get(side === "from" ? e.fromNodeId : e.toNodeId))
        .filter((n): n is LineageViewerNode => n !== undefined)
        .filter((n) => !hiddenByRelationFilterNodeIds.has(n.nodeId));

    // Use transitive connections if showAllConnections is true
    const incoming = maxHopDepth > 1 ? allTransitiveConnections.upstream : neighborsOf(dependencyEdgesOnly.incoming, "from");
    const outgoing = maxHopDepth > 1 ? allTransitiveConnections.downstream : neighborsOf(dependencyEdgesOnly.outgoing, "to");
    const all = [...incoming, ...outgoing];

    const byType = (type: string) => all.filter((n) => n.entityType === type);

    return {
      connectedColumns: { label: t("LineageDetail_Columns", "Connected columns"), nodes: byType("column") },
      connectedMeasures: { label: t("LineageDetail_Measures", "Connected measures"), nodes: byType("measure") },
      connectedVisuals: { label: t("LineageDetail_Visuals", "Connected visuals"), nodes: byType("visual") },
      connectedReports: { label: t("LineageDetail_Reports", "Connected reports"), nodes: byType("report") },
      directNeighbors: { label: maxHopDepth > 1 ? t("LineageDetail_AllConnections", "All connections") : t("LineageDetail_Neighbors", "All direct neighbors"), nodes: all },
      usedBy: { label: maxHopDepth > 1 ? t("LineageDetail_AllUsedBy", "All used by (transitive)") : t("LineageDetail_UsedBy", "Used by"), nodes: incoming },
      uses: { label: maxHopDepth > 1 ? t("LineageDetail_AllUses", "All uses (transitive)") : t("LineageDetail_Uses", "Uses"), nodes: outgoing },
      filteredBy: { label: t("LineageDetail_FilteredBy", "Filtered by"), nodes: [] }, // Will be populated below
    };
  }, [selectedNode, nodeEdges, nodeById, t, maxHopDepth, allTransitiveConnections, hiddenByRelationFilterNodeIds]);

  // Calculate "Filtered by" relationships
  const filteredByRelations = useMemo(() => {
    if (!selectedNode || !normalizedDimensions?.relationships) {      return [];
    }

    const smRelationships = Array.isArray(normalizedDimensions.relationships) ? normalizedDimensions.relationships : [];
    const smTables = Array.isArray(normalizedDimensions.tables) ? normalizedDimensions.tables : [];
    const nodeModelId = selectedNode.datasetId;    if (!nodeModelId) {      return [];
    }

    // Debug: log sample table object to see structure
    if (smTables.length > 0) {      console.log("[LineageDetail filteredBy] smTables properties:", Object.keys(smTables[0]));
    }

    // Build lookup map: table ID -> table name
    const tableIdToName = new Map<string, string>();
    smTables.forEach((table: any, idx: number) => {
      if (table.dataset_id === nodeModelId) {
        // LineageTag is the field that contains the GUID
        const tableId = table.lineagetag || table.LineageTag;
        const name = table.name || table.tablename || table.table_name;
        
        if (idx < 2) {
          console.log(`[LineageDetail filteredBy] Processing table #${idx}:`, {
            LineageTag: table.LineageTag,
            lineagetag: table.lineagetag,
            name: table.name,
            resolved_tableId: tableId,
            resolved_name: name,
            allKeys: Object.keys(table)
          });
        }
        
        if (tableId && name) {
          tableIdToName.set(tableId, name);
        }
      }
    });

    console.log("[LineageDetail] Built table ID->name map:", {
      size: tableIdToName.size,
      sample: Array.from(tableIdToName.entries()).slice(0, 3),
      hasColumns: !!normalizedDimensions.columns
    });

    // If direct table ID mapping failed and we have columns, try column-based matching
    if (tableIdToName.size === 0 && normalizedDimensions.columns) {      const smColumns = Array.isArray(normalizedDimensions.columns) ? normalizedDimensions.columns : [];
      
      // Debug: log sample column object
      if (smColumns.length > 0) {        console.log("[LineageDetail] smColumns properties:", Object.keys(smColumns[0]));      }
      
      const columnToTable = new Map<string, string>(); // column_id -> table_name
      
      smColumns.forEach((col: any, idx: number) => {
        if (col.dataset_id === nodeModelId) {
          // LineageTag is the field that contains the GUID
          const colId = col.lineagetag || col.LineageTag;
          const colTableName = col.tablename || col.table_name || col.table;
          
          if (idx < 2) {
            console.log(`[LineageDetail] Processing column #${idx}:`, {
              LineageTag: col.LineageTag,
              lineagetag: col.lineagetag,
              tablename: col.tablename,
              table_name: col.table_name,
              table: col.table,
              resolved_colId: colId,
              resolved_tableName: colTableName,
              allKeys: Object.keys(col)
            });
          }
          
          if (colId && colTableName) {
            columnToTable.set(colId, colTableName);
          }
        }
      });
      
      console.log("[LineageDetail] Built column->table map:", {
        size: columnToTable.size,
        sample: Array.from(columnToTable.entries()).slice(0, 3)
      });
      
      // Now map relationship table IDs via their referenced columns
      smRelationships.forEach((rel: any) => {
        if (rel.dataset_id === nodeModelId) {
          const fromColId = rel.fromcolumn || rel.from_column;
          const toColId = rel.tocolumn || rel.to_column;
          const fromTableId = rel.fromtable || rel.from_table;
          const toTableId = rel.totable || rel.to_table;
          
          if (fromColId && !tableIdToName.has(fromTableId)) {
            const tableName = columnToTable.get(fromColId);
            if (tableName) {
              tableIdToName.set(fromTableId, tableName);
            }
          }
          
          if (toColId && !tableIdToName.has(toTableId)) {
            const tableName = columnToTable.get(toColId);
            if (tableName) {
              tableIdToName.set(toTableId, tableName);
            }
          }
        }
      });    }

    // Build a map of filtering relationships: table -> tables that filter it
    const filteringMap = new Map<string, Set<string>>();
    
    // Debug: log sample relationship to see actual property names
    if (smRelationships.length > 0) {      console.log("[LineageDetail] Relationship properties:", Object.keys(smRelationships[0]));
    }
    
    let activeRelCount = 0;
    let matchingFilterCount = 0;
    
    smRelationships.forEach((rel: any) => {
      // Debug first few relationships
      if (activeRelCount < 3) {
        console.log("[LineageDetail] Processing relationship:", {
          name: rel.name,
          dataset_id: rel.dataset_id,
          fromtable: rel.fromtable,
          totable: rel.totable,
          isactive: rel.isactive,
          crossfilteringbehavior: rel.crossfilteringbehavior,
          tocardinality: rel.tocardinality,
          allProps: Object.keys(rel)
        });
      }
      
      if (rel.dataset_id !== nodeModelId) return;

      // Check if relationship is active (handle both number and string)
      const isActive = rel.isactive === 1 || rel.isactive === "1" || rel.isactive === true;
      if (!isActive) return;
      
      activeRelCount++;

      // Check cross-filter direction (use crossfilteringbehavior as primary)
      const crossFilterDir = (rel.crossfilteringbehavior || rel.crossfilterdirection || rel.cross_filter_direction || "").toLowerCase();
      const toCard = (rel.tocardinality || rel.to_cardinality || "").toLowerCase();

      // Criteria: BothDirections OR (OneDirection AND ToCardinality is One)
      const isBothDirections = crossFilterDir === "bothdirections" || crossFilterDir === "both";
      const isOneDirectionWithOne = 
        (crossFilterDir === "onedirection" || crossFilterDir === "singledirection") && 
        (toCard === "one" || toCard === "1");

      if (isBothDirections || isOneDirectionWithOne) {
        matchingFilterCount++;
        
        // Get table IDs and look up actual names
        const fromTableId = rel.fromtable || rel.from_table;
        const toTableId = rel.totable || rel.to_table;
        const fromTableName = tableIdToName.get(fromTableId) || fromTableId;
        const toTableName = tableIdToName.get(toTableId) || toTableId;
        
        // In Power BI relationships:
        // - fromTable is the "many" side (fact table)
        // - toTable is the "one" side (dimension table)
        // - The dimension (toTable) FILTERS the fact (fromTable)
        // So: fromTable is filtered BY toTable
        if (fromTableName && toTableName) {
          if (!filteringMap.has(fromTableName)) {
            filteringMap.set(fromTableName, new Set());
          }
          filteringMap.get(fromTableName)!.add(toTableName);
        }
      }
    });

    console.log("[LineageDetail] Built filtering map:", {
      totalRelationships: smRelationships.length,
      activeRelationships: activeRelCount,
      matchingFilters: matchingFilterCount,
      mapSize: filteringMap.size,
      sample: Array.from(filteringMap.entries()).slice(0, 3).map(([table, filters]) => ({
        table,
        filteredBy: Array.from(filters)
      }))
    });

    // Determine which tables to check based on node type
    const tablesToCheck = new Set<string>();
    
    if (selectedNode.entityType === "table" && selectedNode.tableName) {
      // For table nodes, check direct filtering
      tablesToCheck.add(selectedNode.tableName);    } else if (selectedNode.entityType === "column" || selectedNode.entityType === "measure") {
      // For columns/measures, inherit filtering from their parent table
      if (selectedNode.tableName) {
        tablesToCheck.add(selectedNode.tableName);      }
      
      // Also check all tables this node transitively depends on via dependency edges
      const visited = new Set<string>();
      const queue = [selectedNode.nodeId];
      
      while (queue.length > 0) {
        const currentNodeId = queue.shift()!;
        if (visited.has(currentNodeId)) continue;
        visited.add(currentNodeId);
        
        // Find all outgoing dependencies (what this node depends on)
        const dependencies = edges.filter(e => 
          e.fromNodeId === currentNodeId && 
          (e.edgeType === "dependency" || e.edgeType === "relationship")
        );
        
        for (const dep of dependencies) {
          const depNode = nodeById.get(dep.toNodeId);
          if (depNode) {
            // If this node depends on a table, check that table's filtering
            if (depNode.entityType === "table" && depNode.tableName) {
              tablesToCheck.add(depNode.tableName);            }
            // If this node depends on a column/measure, check their parent table too
            else if ((depNode.entityType === "column" || depNode.entityType === "measure") && depNode.tableName) {
              tablesToCheck.add(depNode.tableName);            }
            
            // Continue BFS traversal
            if (!visited.has(depNode.nodeId)) {
              queue.push(depNode.nodeId);
            }
          }
        }
      }
    }

    console.log("[LineageDetail] Tables to check for filtering:", {
      tables: Array.from(tablesToCheck),
      availableInMap: Array.from(filteringMap.keys())
    });

    // Collect all tables that filter any of the tables we're checking
    const filteringTableNames = new Set<string>();
    
    for (const tableName of tablesToCheck) {
      const filters = filteringMap.get(tableName);
      if (filters) {
        console.log(`[LineageDetail] Table "${tableName}" is filtered by:`, Array.from(filters));
        filters.forEach(f => filteringTableNames.add(f));
      } else {      }
    }

    console.log("[LineageDetail] All filtering tables found:", {
      count: filteringTableNames.size,
      tables: Array.from(filteringTableNames)
    });

    // Map table names to nodes
    const filteringNodes = Array.from(filteringTableNames)
      .map(tableName => {
        const tableNodeId = `table:${nodeModelId}|${tableName}`;
        const node = nodeById.get(tableNodeId);
        if (!node) {        }
        return node;
      })
      .filter((n: LineageViewerNode | undefined): n is LineageViewerNode => n !== undefined);
    
    console.log("[LineageDetail] FINAL Filtered by nodes:", {
      nodeCount: filteringNodes.length,
      nodes: filteringNodes.map((n: LineageViewerNode) => ({
        id: n.nodeId,
        name: n.displayName,
        tableName: n.tableName
      }))
    });

    return filteringNodes;
  }, [selectedNode, normalizedDimensions, edges, nodeById]);

  // Table relationships - show all relationships this table participates in
  const tableRelationships = useMemo(() => {
    if (!selectedNode || selectedNode.entityType !== "table" || !normalizedDimensions?.relationships) {
      return { asFrom: [], asTo: [] };
    }

    const smRelationships = Array.isArray(normalizedDimensions.relationships) ? normalizedDimensions.relationships : [];
    const smTables = Array.isArray(normalizedDimensions.tables) ? normalizedDimensions.tables : [];
    const nodeModelId = selectedNode.datasetId;
    const tableName = selectedNode.tableName || selectedNode.displayName; // No change here

    if (!nodeModelId) {
      return { asFrom: [], asTo: [] };
    }

    // Debug: log sample table object to see structure
    if (smTables.length > 0) {      console.log("[LineageDetail] smTables properties:", Object.keys(smTables[0]));    }

    // Build lookup map: table ID -> table name
    // NOTE: smTables may not have table_id, we need to check what field contains the GUID
    const tableIdToName = new Map<string, string>();
    const tableNameToId = new Map<string, string>();
    
    smTables.forEach((table: any, idx: number) => {
      if (table.dataset_id === nodeModelId) {
        // LineageTag is the field that contains the GUID
        const tableId = table.lineagetag || table.LineageTag;
        const name = table.name || table.tablename || table.table_name;
        
        if (idx < 3) {
          console.log(`[LineageDetail] Processing table #${idx}:`, {
            LineageTag: table.LineageTag,
            lineagetag: table.lineagetag,
            name: table.name,
            resolved_tableId: tableId,
            resolved_name: name,
            allKeys: Object.keys(table)
          });
        }
        
        if (tableId && name) {
          tableIdToName.set(tableId, name);
          tableNameToId.set(name, tableId);
        } else if (name) {
          // If we have a name but no ID, store it for potential column-based matching
          tableNameToId.set(name, name);
        }
      }
    });    if (tableIdToName.size > 0) {
      console.log("[LineageDetail] Sample table mappings:", 
        Array.from(tableIdToName.entries()).slice(0, 5)
      );
    }

    // If direct table ID mapping failed and we have columns, try column-based matching
    if (tableIdToName.size === 0 && normalizedDimensions.columns) {      const smColumns = Array.isArray(normalizedDimensions.columns) ? normalizedDimensions.columns : [];
      
      // Debug: log sample column object
      if (smColumns.length > 0) {        console.log("[LineageDetail relationships] smColumns properties:", Object.keys(smColumns[0]));      }
      
      const columnToTable = new Map<string, string>(); // column_id -> table_name
      
      smColumns.forEach((col: any, idx: number) => {
        if (col.dataset_id === nodeModelId) {
          // LineageTag is the field that contains the GUID
          const colId = col.lineagetag || col.LineageTag;
          const colTableName = col.tablename || col.table_name || col.table;
          
          if (idx < 2) {
            console.log(`[LineageDetail relationships] Processing column #${idx}:`, {
              LineageTag: col.LineageTag,
              lineagetag: col.lineagetag,
              tablename: col.tablename,
              table_name: col.table_name,
              table: col.table,
              resolved_colId: colId,
              resolved_tableName: colTableName,
              allKeys: Object.keys(col)
            });
          }
          
          if (colId && colTableName) {
            columnToTable.set(colId, colTableName);
          }
        }
      });
      
      console.log("[LineageDetail relationships] Built column->table map:", {
        size: columnToTable.size,
        sample: Array.from(columnToTable.entries()).slice(0, 3)
      });
      
      // Now map relationship table IDs via their referenced columns
      smRelationships.forEach((rel: any) => {
        if (rel.dataset_id === nodeModelId) {
          const fromColId = rel.fromcolumn || rel.from_column;
          const toColId = rel.tocolumn || rel.to_column;
          const fromTableId = rel.fromtable || rel.from_table;
          const toTableId = rel.totable || rel.to_table;
          
          if (fromColId && !tableIdToName.has(fromTableId)) {
            const colTableName = columnToTable.get(fromColId);
            if (colTableName) {
              tableIdToName.set(fromTableId, colTableName);
            }
          }
          
          if (toColId && !tableIdToName.has(toTableId)) {
            const colTableName = columnToTable.get(toColId);
            if (colTableName) {
              tableIdToName.set(toTableId, colTableName);
            }
          }
        }
      });    }

    const asFrom: any[] = [];
    const asTo: any[] = [];

    smRelationships.forEach((rel: any, idx: number) => {
      if (rel.dataset_id !== nodeModelId) return;

      // Get table IDs (these are GUIDs)
      const fromTableId = rel.fromtable || rel.from_table;
      const toTableId = rel.totable || rel.to_table;

      // Look up actual table names
      const fromTableName = tableIdToName.get(fromTableId) || fromTableId;
      const toTableName = tableIdToName.get(toTableId) || toTableId;

      // Check if this table is the "from" table
      if (fromTableName === tableName) {
        asFrom.push({
          name: rel.name || `${fromTableName} → ${toTableName}`,
          fromTable: fromTableName,
          toTable: toTableName,
          isActive: rel.isactive === 1 || rel.isactive === "1" || rel.isactive === true,
          crossFilterDirection: rel.crossfilteringbehavior || rel.crossfilterdirection || rel.cross_filter_direction || "None",
          fromCardinality: rel.fromcardinality || rel.from_cardinality || "Unknown",
          toCardinality: rel.tocardinality || rel.to_cardinality || "Unknown",
        });
      }

      // Check if this table is the "to" table
      if (toTableName === tableName) {
        asTo.push({
          name: rel.name || `${fromTableName} → ${toTableName}`,
          fromTable: fromTableName,
          toTable: toTableName,
          isActive: rel.isactive === 1 || rel.isactive === "1" || rel.isactive === true,
          crossFilterDirection: rel.crossfilteringbehavior || rel.crossfilterdirection || rel.cross_filter_direction || "None",
          fromCardinality: rel.fromcardinality || rel.from_cardinality || "Unknown",
          toCardinality: rel.tocardinality || rel.to_cardinality || "Unknown",
        });
      }
    });    return { asFrom, asTo };
  }, [selectedNode, normalizedDimensions]);

  // Update relations with filteredBy data
  const relationsWithFilteredBy = useMemo(() => {
    const result = {
      ...relations,
      filteredBy: { label: t("LineageDetail_FilteredBy", "Filtered by"), nodes: filteredByRelations },
    };    return result;
  }, [relations, filteredByRelations, t]);

  const rel = relationsWithFilteredBy;

  // Node relationships - show relationships for tables and columns (via parent table)
  const nodeRelationships = useMemo(() => {
    // Only show for tables and columns
    if (!selectedNode || (selectedNode.entityType !== "table" && selectedNode.entityType !== "column")) {
      return [];
    }

    if (!normalizedDimensions?.relationships) {
      return [];
    }

    const smRelationships = Array.isArray(normalizedDimensions.relationships) ? normalizedDimensions.relationships : [];
    const smColumns = Array.isArray(normalizedDimensions.columns) ? normalizedDimensions.columns : [];
    const nodeModelId = selectedNode.datasetId;

    // For columns, use parent table name; for tables, use the node's own name
    const lookupTableName = selectedNode.entityType === "column" 
      ? resolvedSelectedTableName 
      : selectedNode.displayName;

    if (!nodeModelId || !lookupTableName) {
      return [];
    }

    // Build lookup map: table ID -> table name from columns
    const tableIdToName = new Map<string, string>();
    smColumns.forEach((col: any) => {
      if (col.dataset_id === nodeModelId) {
        const colId = col.lineagetag || col.LineageTag;
        const colTableName = col.tablename || col.table_name || col.table;
        if (colId && colTableName) {
          // Also try to infer table IDs from relationship references
          if (!tableIdToName.has(colTableName)) {
            tableIdToName.set(colTableName, colTableName);
          }
        }
      }
    });

    // Extract relationships involving this table
    const relationships: any[] = [];

    smRelationships.forEach((rel: any) => {
      if (rel.dataset_id !== nodeModelId) return;

      // Get table IDs
      const fromTableId = rel.fromtable || rel.from_table;
      const toTableId = rel.totable || rel.to_table;
      const fromColId = rel.fromcolumn || rel.from_column;
      const toColId = rel.tocolumn || rel.to_column;

      // Resolve table names from column references
      let fromTableName = tableIdToName.get(fromTableId);
      let toTableName = tableIdToName.get(toTableId);

      // If not found by table ID, try to resolve from columns
      if (!fromTableName && fromColId) {
        const fromCol = smColumns.find((c: any) => 
          (c.lineagetag === fromColId || c.LineageTag === fromColId) && c.dataset_id === nodeModelId
        );
        fromTableName = fromCol?.tablename || fromCol?.table_name || fromCol?.table;
      }

      if (!toTableName && toColId) {
        const toCol = smColumns.find((c: any) => 
          (c.lineagetag === toColId || c.LineageTag === toColId) && c.dataset_id === nodeModelId
        );
        toTableName = toCol?.tablename || toCol?.table_name || toCol?.table;
      }

      // Check if this relationship involves the lookup table
      if (fromTableName === lookupTableName || toTableName === lookupTableName) {
        const isActive = rel.isactive === 1 || rel.isactive === "1" || rel.isactive === true;
        const crossFilterDir = rel.crossfilteringbehavior || rel.crossfilterdirection || rel.cross_filter_direction || "None";
        const fromCard = rel.fromcardinality || rel.from_cardinality || "Unknown";
        const toCard = rel.tocardinality || rel.to_cardinality || "Unknown";

        relationships.push({
          name: rel.name || `${fromTableName} → ${toTableName}`,
          fromTable: fromTableName || fromTableId,
          toTable: toTableName || toTableId,
          isActive,
          crossFilterDirection: crossFilterDir,
          fromCardinality: fromCard,
          toCardinality: toCard,
          direction: fromTableName === lookupTableName ? "outgoing" : "incoming",
        });
      }
    });

    return relationships;
  }, [selectedNode, normalizedDimensions, resolvedSelectedTableName]);

  const getGroupedConnectionNodes = (
    nodes: LineageViewerNode[],
    edgeTypesByNodeId: Map<string, string[]>,
    showTransitive: boolean,
    degreeByNodeId?: Map<string, number>
  ) => {
    const grouped = new Map<string, LineageViewerNode[]>();

    for (const node of nodes) {
      const directEdgeTypes = edgeTypesByNodeId.get(node.nodeId) || [];
      const nodeDegree = degreeByNodeId?.get(node.nodeId) ?? 1;
      let groupKey: string;

      if (groupingMode === "edge-type") {
        groupKey = directEdgeTypes.length > 0 ? directEdgeTypes.join(", ") : showTransitive ? "transitive" : "direct";
      } else if (groupingMode === "hop-count") {
        groupKey = `${nodeDegree}`;
      } else {
        groupKey = node.entityType;
      }

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey)!.push(node);
    }

    return grouped;
  };

  // Helper function to render connection items with expand capability
  const renderConnectionItem = (
    node: LineageViewerNode,
    depth: number = 0,
    degree?: number,
    showEdgeCounts: boolean = false,
    edgeTypes?: string[],
    hopPath?: string[],
    hopDirection: "upstream" | "downstream" = "downstream",
    includeParentHoverInfo: boolean = false
  ) => {
    const isExpanded = expandedNodes.has(node.nodeId);
    const downstream = isExpanded ? getNodeDownstream(node.nodeId) : [];
    const hasDownstream = downstream.length > 0;
    const isSelected = node.nodeId === effectiveSelectedNodeId;
    const edgeCounts = edgeCountByNodeId.get(node.nodeId) || { incoming: 0, outgoing: 0 };
    const hopSeparator = hopDirection === "upstream" ? " <- " : " -> ";
    const pathTooltip = degree !== undefined && showAllConnections && hopPath && hopPath.length > 1
      ? `Path: ${hopPath.join(hopSeparator)}`
      : undefined;
    const parentLabel = includeParentHoverInfo
      ? (node.parentNodeId ? (nodeById.get(node.parentNodeId)?.displayName ?? node.parentNodeId) : undefined)
      : undefined;
    const itemHoverTitle = [parentLabel ? `Parent: ${parentLabel}` : undefined, pathTooltip]
      .filter((value): value is string => !!value)
      .join("\n");
    
    return (
      <div key={node.nodeId} style={{ marginLeft: depth > 0 ? `${depth * 20}px` : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXXS }}>
          {/* Expand/collapse button */}
          {depth === 0 && hasDownstream && (
            <Button
              appearance="transparent"
              size="small"
              icon={isExpanded ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                toggleNodeExpansion(node.nodeId);
              }}
              style={{ minWidth: "24px", padding: "4px" }}
            />
          )}
          {depth === 0 && !hasDownstream && (
            <div style={{ width: "24px" }} />
          )}
          
          {/* Connection item button */}
          <button
            type="button"
            className={`${styles.connectionItem}${isSelected ? ` ${styles.connectionItemSelected}` : ""}`}
            onClick={() => openNodeInTab(node.nodeId)}
            style={{ flex: 1 }}
            title={itemHoverTitle || node.displayName}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", flex: 1, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXS, width: "100%" }}>
                <span className={styles.connectionItemName} title={node.displayName}>
                  {node.displayName}
                </span>
                {(groupingMode === "edge-type" || groupingMode === "hop-count") && showEdgeCounts && (
                  <Badge size="small" appearance="tint" color="informative" style={{ flexShrink: 0 }}>
                    {`type: ${getEntityTypeLabel(node.entityType)}`}
                  </Badge>
                )}
                {groupingMode !== "edge-type" && !!edgeTypes?.length && (
                  <Badge size="small" appearance="tint" color="informative" style={{ flexShrink: 0 }}>
                    {edgeTypes.length > 1 ? `edge: ${edgeTypes.join(", ")}` : `edge: ${edgeTypes[0]}`}
                  </Badge>
                )}
                {degree !== undefined && showAllConnections && (
                  <Badge size="small" appearance="outline" style={{ flexShrink: 0 }}>
                    {degree === 1 ? "direct" : `${degree} hops`}
                  </Badge>
                )}
                {showEdgeCounts && (
                  <Badge size="small" appearance="outline" style={{ flexShrink: 0 }}>
                    In {edgeCounts.incoming} | Out {edgeCounts.outgoing}
                  </Badge>
                )}
              </div>
              {node.tableName && (
                <span className={styles.connectionItemSubLabel}>{node.tableName}</span>
              )}
            </div>
          </button>
        </div>
        
        {/* Expanded downstream items */}
        {isExpanded && downstream.length > 0 && (
          <div style={{ marginTop: tokens.spacingVerticalXXS }}>
            {downstream.map((downstreamNode) =>
              renderConnectionItem(downstreamNode, depth + 1, degree, showEdgeCounts)
            )}
          </div>
        )}
      </div>
    );
  };

  if (!selectedNode) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          {t("LineageWorkbench_Detail_NoSelection", "Select a node in the graph or table to view details")}
        </div>
      </div>
    );
  }

  if (!embedded) {
    const leftNode = splitPaneTargets.leftTabId ? nodeById.get(splitPaneTargets.leftTabId) : undefined;
    const rightNode = splitPaneTargets.rightTabId ? nodeById.get(splitPaneTargets.rightTabId) : undefined;

    return (
      <div className={styles.root}>
        {detailTabs.length > 0 && (
          <div className={styles.card}>
            <div className={styles.tabBar}>
              {detailTabs.map((tabId) => {
                const tabNode = nodeById.get(tabId);
                if (!tabNode) return null;
                const active = tabId === effectiveSelectedNodeId;
                return (
                  <div
                    key={tabId}
                    className={`${styles.tabItem}${active ? ` ${styles.tabItemActive}` : ""}`}
                    title={tabNode.displayName}
                  >
                    <button
                      type="button"
                      className={styles.tabButton}
                      onClick={() => {
                        setActiveTabId(tabId);
                        onNodeSelect?.(tabId, "detail");
                      }}
                    >
                      <Text size={200} weight={active ? "semibold" : "regular"} className={styles.tabText}>
                        {tabNode.displayName}
                      </Text>
                      <Text size={100} className={styles.tabMeta}>
                        {getEntityTypeLabel(tabNode.entityType)}
                      </Text>
                    </button>
                    <Button
                      appearance="subtle"
                      size="small"
                      className={styles.tabCloseButton}
                      icon={<Dismiss12Regular />}
                      aria-label={t("LineageDetail_CloseTab", "Close tab")}
                      onClick={() => closeDetailTab(tabId)}
                    />
                  </div>
                );
              })}
            </div>
            <Text size={100} className={styles.tabMeta}>
              {t("LineageDetail_TabHint", "Tabs keep your navigation history. Two detail panes are shown side by side.")}
            </Text>
          </div>
        )}

        <div className={styles.splitView}>
          <div className={styles.splitPane}>
            {leftNode && (
              <div className={styles.paneHeader}>
                <Text weight="semibold">{leftNode.displayName}</Text>
                <Text size={100} className={styles.tabMeta}>{getEntityTypeLabel(leftNode.entityType)}</Text>
              </div>
            )}
            <LineageDetailView
              key={`primary-${splitPaneTargets.leftTabId || "empty"}`}
              embedded
              selectedNodeId={splitPaneTargets.leftTabId}
              nodes={nodes}
              edges={edges}
              dimensions={dimensions}
              extraction={extraction}
              onNodeSelect={onNodeSelect}
            />
          </div>
          {splitPaneTargets.rightTabId && (
            <>
              <div className={styles.splitDivider} />
              <div className={styles.splitPane}>
                {rightNode && (
                  <div className={styles.paneHeader}>
                    <Text weight="semibold">{rightNode.displayName}</Text>
                    <Text size={100} className={styles.tabMeta}>{getEntityTypeLabel(rightNode.entityType)}</Text>
                  </div>
                )}
                <LineageDetailView
                  key={`secondary-${splitPaneTargets.rightTabId}`}
                  embedded
                  selectedNodeId={splitPaneTargets.rightTabId}
                  nodes={nodes}
                  edges={edges}
                  dimensions={dimensions}
                  extraction={extraction}
                  onNodeSelect={onNodeSelect}
                />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.cardTitle}>{t("LineageDetail_SelectedInfo", "Selected info")}</div>
        <div className={styles.badgeList}>
          {selectedInfoCards.map((card, idx) => (
            <React.Fragment key={card.key}>
              <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXXS }}>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{card.label}:</Text>
                {card.isLink && card.value ? (
                  <a 
                    href={card.value} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(card.value, '_blank', 'noopener,noreferrer');
                    }}
                    style={{ 
                      color: tokens.colorBrandForeground1, 
                      textDecoration: "none",
                      fontSize: tokens.fontSizeBase200,
                      fontWeight: tokens.fontWeightSemibold,
                      cursor: "pointer"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
                    onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                  >
                    {card.value}
                  </a>
                ) : (
                  <Text size={200} weight="semibold" title={card.value}>
                    {card.value}
                  </Text>
                )}
              </div>
              {idx < selectedInfoCards.length - 1 && <span className={styles.badgeSeparator}>•</span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      <Accordion className={styles.accordionPanel} collapsible>
        <AccordionItem value="lineage-explanation">
          <AccordionHeader>
            <div style={{ display: "flex", alignItems: "center", width: "100%", gap: tokens.spacingHorizontalS }}>
              <Text weight="semibold">{t("LineageDetail_LineageExplanation", "Lineage explanation")}</Text>
              <div style={{ marginLeft: "auto" }}>
                <Button
                  size="small"
                  appearance="subtle"
                  disabled={aiExplanationState.lineage.loading}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void requestLineageExplanation();
                  }}
                >
                  {t("LineageDetail_ExplainLineageWithAI", "Explain lineage with AI")}
                </Button>
              </div>
            </div>
          </AccordionHeader>
          <AccordionPanel>
            <div className={styles.accordionContent}>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS, padding: tokens.spacingHorizontalM }}>
                {t(
                  "LineageDetail_LineageExplainHint",
                  "Generates a concise summary of upstream sources, downstream consumers, and key transformations for the selected element."
                )}
              </Text>
              {aiExplanationState.lineage.loading && (
                <div className={styles.card}>
                  <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS }}>
                    <Spinner size="tiny" />
                    <Text size={200}>{t("LineageDetail_Explaining", "Generating AI explanation...")}</Text>
                  </div>
                </div>
              )}
              {!!aiExplanationState.lineage.error && (
                <div className={styles.card}>
                  <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                    {aiExplanationState.lineage.error}
                  </Text>
                </div>
              )}
              {!!aiExplanationState.lineage.text && (
                <div className={styles.card}>
                  <div className={styles.cardTitle}>{t("LineageDetail_AIExplanation", "AI explanation")}</div>
                  <div className={styles.expressionBlock}>{aiExplanationState.lineage.text}</div>
                </div>
              )}
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      {/* ── Upstream & Downstream Connections ── */}
      <div className={styles.card}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: tokens.spacingHorizontalL }}>
          <div style={{ minWidth: "220px" }}>
            <Text weight="semibold" size={300}>{t("LineageDetail_ConnectionDepth", "Connection Depth")}</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalXXS, display: "block" }}>
              {showAllConnections 
                ? t("LineageDetail_ShowingAll", "Showing all transitive upstream/downstream dependencies")
                : t("LineageDetail_ShowingDirect", "Showing only neighbors")}
            </Text>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalL, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS }}>
              <Text size={200}>{t("LineageDetail_MaxHops", "Max hops")}</Text>
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={maxHopDepth}
                onChange={(e) => {
                  const rawValue = Number.parseInt(e.currentTarget.value, 10);
                  if (Number.isNaN(rawValue)) {
                    return;
                  }
                  const boundedValue = Math.min(20, Math.max(1, rawValue));
                  setMaxHopDepth(boundedValue);
                }}
                style={{
                  width: "72px",
                  border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
                  borderRadius: tokens.borderRadiusSmall,
                  padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
                  background: tokens.colorNeutralBackground1,
                  color: tokens.colorNeutralForeground1,
                }}
                aria-label={t("LineageDetail_MaxHops", "Max hops")}
              />
            </div>
            <Switch
              checked={relationFilter === "all"}
              onChange={(_, data) => setRelationFilter(data.checked ? "all" : "hide-parent-child")}
              label={relationFilter === "all" ? t("LineageDetail_ShowParentChild", "Show Parent/Child") : t("LineageDetail_HideParentChild", "Hide Parent/Child")}
            />
            <Dropdown
              selectedOptions={[groupingMode]}
              onOptionSelect={(_, data) => {
                const value = data.optionValue;
                if (value === "object-type" || value === "edge-type" || value === "hop-count") {
                  setGroupingMode(value);
                }
              }}
              style={{ minWidth: "230px" }}
            >
              <Option value="object-type">{t("LineageDetail_GroupByObjectType", "Group by object type")}</Option>
              <Option value="edge-type">{t("LineageDetail_GroupByEdgeType", "Group by edge type")}</Option>
              <Option value="hop-count">{t("LineageDetail_GroupByHopCount", "Group by # of Hops")}</Option>
            </Dropdown>
          </div>
        </div>
      </div>

      {(nodeEdges.incoming.length > 0 || nodeEdges.outgoing.length > 0) && (
        <>
          {/* Upstream (incoming) connections */}
          {(() => {
            const upstreamNodes = showAllConnections
              ? allTransitiveConnections.upstream
              : nodeEdges.incoming.map((e) => nodeById.get(e.fromNodeId)).filter((n): n is LineageViewerNode => n !== undefined);
            
            if (upstreamNodes.length === 0) return null;
            
            const upstreamEdgeTypesByNodeId = new Map<string, string[]>();
            for (const edge of nodeEdges.incoming) {
              const bucket = upstreamEdgeTypesByNodeId.get(edge.fromNodeId) || [];
              if (!bucket.includes(edge.edgeType)) {
                bucket.push(edge.edgeType);
              }
              upstreamEdgeTypesByNodeId.set(edge.fromNodeId, bucket);
            }

            const grouped = getGroupedConnectionNodes(
              upstreamNodes,
              upstreamEdgeTypesByNodeId,
              showAllConnections,
              showAllConnections ? allTransitiveConnections.upstreamDegreeMap : undefined
            );
            
            return (
              <Accordion className={styles.accordionPanel} collapsible>
                <AccordionItem value="upstream">
                  <AccordionHeader>
                    <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXS }}>
                      <Text weight="semibold">
                        {showAllConnections 
                          ? t("LineageDetail_AllUpstream", "All Upstream (transitive)")
                          : t("LineageDetail_Upstream", "Upstream")}
                      </Text>
                      <Badge>{upstreamNodes.length}</Badge>
                    </div>
                  </AccordionHeader>
                  <AccordionPanel>
                    <div className={styles.accordionContent}>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS, padding: tokens.spacingHorizontalM }}>
                        {showAllConnections
                          ? t("LineageDetail_AllUpstreamHint", "All nodes that this node transitively depends on")
                          : t("LineageDetail_UpstreamHint", "Nodes that this node directly depends on")}
                      </Text>
                      {Array.from(grouped.entries()).map(([groupKey, groupNodes]) => (
                        <div key={groupKey} className={styles.connectionGroup}>
                          <div className={styles.connectionGroupLabel}>
                            {(
                              groupingMode === "edge-type"
                                ? groupKey
                                : groupingMode === "hop-count"
                                  ? `${groupKey} ${groupKey === "1" ? "hop" : "hops"}`
                                  : getEntityTypeLabel(groupKey)
                            )} ({groupNodes.length})
                          </div>
                          {groupNodes.map((node) => {
                            const degree = showAllConnections ? allTransitiveConnections.upstreamDegreeMap.get(node.nodeId) : 1;
                            const hopPath = allTransitiveConnections.upstreamPathMap.get(node.nodeId);
                            const directEdgeTypes = upstreamEdgeTypesByNodeId.get(node.nodeId) || [];
                            const edgeTypesToShow =
                              showAllConnections && directEdgeTypes.length === 0
                                ? ["transitive"]
                                : directEdgeTypes;
                            return renderConnectionItem(node, 0, degree, true, edgeTypesToShow, hopPath, "upstream", true);
                          })}
                        </div>
                      ))}
                    </div>
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
            );
          })()}

          {/* Downstream (outgoing) connections */}
          {(() => {
            const downstreamNodes = showAllConnections
              ? allTransitiveConnections.downstream
              : nodeEdges.outgoing.map((e) => nodeById.get(e.toNodeId)).filter((n): n is LineageViewerNode => n !== undefined);
            
            if (downstreamNodes.length === 0) return null;

            const downstreamEdgeTypesByNodeId = new Map<string, string[]>();
            for (const edge of nodeEdges.outgoing) {
              const bucket = downstreamEdgeTypesByNodeId.get(edge.toNodeId) || [];
              if (!bucket.includes(edge.edgeType)) {
                bucket.push(edge.edgeType);
              }
              downstreamEdgeTypesByNodeId.set(edge.toNodeId, bucket);
            }

            const grouped = getGroupedConnectionNodes(
              downstreamNodes,
              downstreamEdgeTypesByNodeId,
              showAllConnections,
              showAllConnections ? allTransitiveConnections.downstreamDegreeMap : undefined
            );
            
            return (
              <Accordion className={styles.accordionPanel} collapsible>
                <AccordionItem value="downstream">
                  <AccordionHeader>
                    <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXS }}>
                      <Text weight="semibold">
                        {showAllConnections 
                          ? t("LineageDetail_AllDownstream", "All Downstream (transitive)")
                          : t("LineageDetail_Downstream", "Downstream")}
                      </Text>
                      <Badge>{downstreamNodes.length}</Badge>
                    </div>
                  </AccordionHeader>
                  <AccordionPanel>
                    <div className={styles.accordionContent}>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS, padding: tokens.spacingHorizontalM }}>
                        {showAllConnections
                          ? t("LineageDetail_AllDownstreamHint", "All nodes that transitively depend on this node")
                          : t("LineageDetail_DownstreamHint", "Nodes that directly depend on this node")}
                      </Text>
                      {Array.from(grouped.entries()).map(([groupKey, groupNodes]) => (
                        <div key={groupKey} className={styles.connectionGroup}>
                          <div className={styles.connectionGroupLabel}>
                            {(
                              groupingMode === "edge-type"
                                ? groupKey
                                : groupingMode === "hop-count"
                                  ? `${groupKey} ${groupKey === "1" ? "hop" : "hops"}`
                                  : getEntityTypeLabel(groupKey)
                            )} ({groupNodes.length})
                          </div>
                          {groupNodes.map((node) => {
                            const degree = showAllConnections ? allTransitiveConnections.downstreamDegreeMap.get(node.nodeId) : 1;
                            const hopPath = allTransitiveConnections.downstreamPathMap.get(node.nodeId);
                            const directEdgeTypes = downstreamEdgeTypesByNodeId.get(node.nodeId) || [];
                            const edgeTypesToShow =
                              showAllConnections && directEdgeTypes.length === 0
                                ? ["transitive"]
                                : directEdgeTypes;
                            return renderConnectionItem(node, 0, degree, true, edgeTypesToShow, hopPath, "downstream", true);
                          })}
                        </div>
                      ))}
                    </div>
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
            );
          })()}
        </>
      )}

      {showExpression && (
        <Accordion className={styles.accordionPanel} collapsible defaultOpenItems={["expression"]}>
          <AccordionItem value="expression">
            <AccordionHeader>
              <div style={{ display: "flex", alignItems: "center", width: "100%", gap: tokens.spacingHorizontalS }}>
                <Text weight="semibold">{t("LineageDetail_Expression", "Expression")}</Text>
                <div style={{ marginLeft: "auto" }}>
                  <Button
                    size="small"
                    appearance="subtle"
                    disabled={aiExplanationState.expression.loading || !expressionValue}
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void requestAiExplanation("expression", expressionValue ?? "", {
                        tableName: resolvedSelectedTableName,
                        columnName: selectedNode.entityType === "column" ? selectedNode.displayName : undefined,
                        datasetName,
                      });
                    }}
                  >
                    {t("LineageDetail_ExplainWithAI", "Explain with AI")}
                  </Button>
                </div>
              </div>
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.accordionContent}>
                <div className={styles.expressionBlock}>{expressionValue}</div>
                {aiExplanationState.expression.loading && (
                  <div className={styles.card}>
                    <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS }}>
                      <Spinner size="tiny" />
                      <Text size={200}>{t("LineageDetail_Explaining", "Generating AI explanation...")}</Text>
                    </div>
                  </div>
                )}
                {!!aiExplanationState.expression.error && (
                  <div className={styles.card}>
                    <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                      {aiExplanationState.expression.error}
                    </Text>
                  </div>
                )}
                {!!aiExplanationState.expression.text && (
                  <div className={styles.card}>
                    <div className={styles.cardTitle}>{t("LineageDetail_AIExplanation", "AI explanation")}</div>
                    <div className={styles.expressionBlock}>{aiExplanationState.expression.text}</div>
                  </div>
                )}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}

      {showQuery && (
        <Accordion className={styles.accordionPanel} collapsible>
          <AccordionItem value="query">
            <AccordionHeader>
              <div style={{ display: "flex", alignItems: "center", width: "100%", gap: tokens.spacingHorizontalS }}>
                <Text weight="semibold">{t("LineageDetail_Query", "Query")}</Text>
                <div style={{ marginLeft: "auto" }}>
                  <Button
                    size="small"
                    appearance="subtle"
                    disabled={aiExplanationState.query.loading || !queryValue}
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void requestAiExplanation("query", queryValue ?? "", {
                        tableName: resolvedSelectedTableName,
                        columnName: selectedNode.entityType === "column" ? selectedNode.displayName : undefined,
                        datasetName,
                      });
                    }}
                  >
                    {t("LineageDetail_ExplainWithAI", "Explain with AI")}
                  </Button>
                </div>
              </div>
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.accordionContent}>
                <div className={styles.expressionBlock}>{queryValue}</div>
                {aiExplanationState.query.loading && (
                  <div className={styles.card}>
                    <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS }}>
                      <Spinner size="tiny" />
                      <Text size={200}>{t("LineageDetail_Explaining", "Generating AI explanation...")}</Text>
                    </div>
                  </div>
                )}
                {!!aiExplanationState.query.error && (
                  <div className={styles.card}>
                    <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                      {aiExplanationState.query.error}
                    </Text>
                  </div>
                )}
                {!!aiExplanationState.query.text && (
                  <div className={styles.card}>
                    <div className={styles.cardTitle}>{t("LineageDetail_AIExplanation", "AI explanation")}</div>
                    <div className={styles.expressionBlock}>{aiExplanationState.query.text}</div>
                  </div>
                )}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}

      {/* ── Relationships (for tables and columns) ── */}
      {nodeRelationships.length > 0 && (
        <Accordion className={styles.accordionPanel} collapsible>
          <AccordionItem value="relationships">
            <AccordionHeader>
              <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXS }}>
                <Text weight="semibold">{t("LineageDetail_Relationships", "Relationships")}</Text>
                <Badge>{nodeRelationships.length}</Badge>
              </div>
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.accordionContent}>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS, padding: tokens.spacingHorizontalM }}>
                  {selectedNode.entityType === "column"
                    ? t("LineageDetail_RelationshipsColumnHint", "Relationships involving the parent table of this column")
                    : t("LineageDetail_RelationshipsTableHint", "Relationships where this table is involved")}
                </Text>
                {nodeRelationships.map((relationship: any, idx: number) => (
                  <div key={idx} className={styles.card} style={{ marginBottom: tokens.spacingVerticalS }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS }}>
                      {/* Relationship name and direction */}
                      <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXS, flexWrap: "wrap" }}>
                        <Text weight="semibold" size={300}>
                          {relationship.fromTable}
                        </Text>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>→</Text>
                        <Text weight="semibold" size={300}>
                          {relationship.toTable}
                        </Text>
                        {!relationship.isActive && (
                          <Badge size="small" appearance="outline" color="danger">
                            {t("LineageDetail_Inactive", "Inactive")}
                          </Badge>
                        )}
                      </div>

                      {/* Relationship details */}
                      <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalM, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXXS }}>
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            {t("LineageDetail_Multiplicity", "Multiplicity")}:
                          </Text>
                          <Badge size="small" appearance="outline">
                            {relationship.fromCardinality} : {relationship.toCardinality}
                          </Badge>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXXS }}>
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            {t("LineageDetail_CrossFilter", "Cross filter")}:
                          </Text>
                          <Badge size="small" appearance="outline">
                            {relationship.crossFilterDirection}
                          </Badge>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXXS }}>
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            {t("LineageDetail_Direction", "Direction")}:
                          </Text>
                          <Badge size="small" appearance="outline">
                            {relationship.direction === "outgoing" ? "↗" : "↙"} {relationship.direction}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}

      {/* ── Filtered by list (tables that filter this table via active relationships) ── */}
      {rel.filteredBy && rel.filteredBy.nodes.length > 0 && (
        <Accordion className={styles.accordionPanel} collapsible>
          <AccordionItem value="filtered-by">
            <AccordionHeader>
              <Text weight="semibold">{t("LineageDetail_FilteredBy", "Filtered by")} ({rel.filteredBy.nodes.length})</Text>
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.accordionContent}>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS, padding: tokens.spacingHorizontalM }}>
                {t("LineageDetail_FilteredByHint", "Tables that apply filters to this element or its dependencies through active relationships (BothDirections or OneDirection with ToCardinality=One)")}
              </Text>
          
          {(() => {
            const grouped = new Map<string, LineageViewerNode[]>();
            for (const n of rel.filteredBy.nodes) {
              if (!grouped.has(n.entityType)) grouped.set(n.entityType, []);
              grouped.get(n.entityType)!.push(n);
            }
            return Array.from(grouped.entries()).map(([entityType, groupNodes]) => (
              <div key={entityType} className={styles.connectionGroup}>
                <div className={styles.connectionGroupLabel}>
                  {getEntityTypeLabel(entityType)} ({groupNodes.length})
                </div>
                {groupNodes.map((node) => renderConnectionItem(node, 0))}
              </div>
            ));
          })()}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}

      {/* ── Table Relationships (for table nodes only) ── */}
      {selectedNode?.entityType === "table" && (tableRelationships.asFrom.length > 0 || tableRelationships.asTo.length > 0) && (
        <Accordion className={styles.accordionPanel} collapsible>
          <AccordionItem value="table-relationships">
            <AccordionHeader>
              <Text weight="semibold">{t("LineageDetail_TableRelationships", "Relationships")} ({tableRelationships.asFrom.length + tableRelationships.asTo.length})</Text>
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.accordionContent}>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalM, padding: tokens.spacingHorizontalM }}>
                {t("LineageDetail_TableRelationshipsHint", "All relationships where this table participates")}
              </Text>

          {/* Relationships where this table is the FROM table */}
          {tableRelationships.asFrom.length > 0 && (
            <div style={{ marginBottom: tokens.spacingVerticalL }}>
              <div className={styles.connectionGroupLabel}>
                {t("LineageDetail_AsFromTable", "As FROM table")} ({tableRelationships.asFrom.length})
              </div>
              {tableRelationships.asFrom.map((rel: any, idx: number) => (
                <div key={`from-${idx}`} className={styles.card} style={{ 
                  marginTop: tokens.spacingVerticalS, 
                  padding: tokens.spacingHorizontalM,
                  backgroundColor: tokens.colorNeutralBackground3
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS }}>
                    <Text weight="semibold" size={300}>
                      {rel.fromTable} → {rel.toTable}
                    </Text>
                    <div style={{ display: "flex", gap: tokens.spacingHorizontalM, flexWrap: "wrap" }}>
                      <div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageDetail_RelName", "Name")}: 
                        </Text>
                        <Text size={200}> {rel.name}</Text>
                      </div>
                      <div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageDetail_RelActive", "Active")}: 
                        </Text>
                        <Badge 
                          appearance="tint" 
                          size="small" 
                          color={rel.isActive ? "success" : "danger"}
                        >
                          {rel.isActive ? "Yes" : "No"}
                        </Badge>
                      </div>
                      <div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageDetail_RelCrossFilter", "Cross-filter")}: 
                        </Text>
                        <Text size={200}> {rel.crossFilterDirection}</Text>
                      </div>
                      <div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageDetail_RelCardinality", "Cardinality")}: 
                        </Text>
                        <Text size={200}> {rel.fromCardinality} → {rel.toCardinality}</Text>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Relationships where this table is the TO table */}
          {tableRelationships.asTo.length > 0 && (
            <div>
              <div className={styles.connectionGroupLabel}>
                {t("LineageDetail_AsToTable", "As TO table")} ({tableRelationships.asTo.length})
              </div>
              {tableRelationships.asTo.map((rel: any, idx: number) => (
                <div key={`to-${idx}`} className={styles.card} style={{ 
                  marginTop: tokens.spacingVerticalS, 
                  padding: tokens.spacingHorizontalM,
                  backgroundColor: tokens.colorNeutralBackground3
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS }}>
                    <Text weight="semibold" size={300}>
                      {rel.fromTable} → {rel.toTable}
                    </Text>
                    <div style={{ display: "flex", gap: tokens.spacingHorizontalM, flexWrap: "wrap" }}>
                      <div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageDetail_RelName", "Name")}: 
                        </Text>
                        <Text size={200}> {rel.name}</Text>
                      </div>
                      <div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageDetail_RelActive", "Active")}: 
                        </Text>
                        <Badge 
                          appearance="tint" 
                          size="small" 
                          color={rel.isActive ? "success" : "danger"}
                        >
                          {rel.isActive ? "Yes" : "No"}
                        </Badge>
                      </div>
                      <div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageDetail_RelCrossFilter", "Cross-filter")}: 
                        </Text>
                        <Text size={200}> {rel.crossFilterDirection}</Text>
                      </div>
                      <div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {t("LineageDetail_RelCardinality", "Cardinality")}: 
                        </Text>
                        <Text size={200}> {rel.fromCardinality} → {rel.toCardinality}</Text>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}

      {/* ── Query Steps (Column Transformation History) — MOVED TO SECOND-TO-LAST, COLLAPSED BY DEFAULT ── */}
      {selectedNode.entityType === "column" && (() => {
        const columnLineage = normalizedDimensions.columnLineage || [];
        const normalizeValue = (value: unknown): string => String(value ?? "").trim().toLowerCase();

        const selectedTableNameNormalized = normalizeValue(resolvedSelectedTableName);
        const selectedColumnNameNormalized = normalizeValue(selectedNode.displayName);
        const selectedDatasetIdNormalized = (() => {
          if (selectedNode.datasetId) {
            return normalizeValue(selectedNode.datasetId);
          }

          const columns = normalizedDimensions.columns;
          const matchedColumn = columns.find((c: any) => {
            const columnName = normalizeValue(c.column_name ?? c.columnName ?? c.name);
            const tableName = normalizeValue(c.table_name ?? c.tableName ?? c.table);
            return columnName === selectedColumnNameNormalized && tableName === selectedTableNameNormalized;
          });

          return normalizeValue(matchedColumn?.dataset_id ?? matchedColumn?.datasetId);
        })();

        console.log("[LineageDetailView] Query Steps Debug:", {
          totalColumnLineageRecords: columnLineage.length,
          hasDimensionsObject: !!normalizedDimensions,
          dimensionsKeys: normalizedDimensions ? Object.keys(normalizedDimensions) : [],
          columnLineageType: Array.isArray(columnLineage) ? 'array' : typeof columnLineage,
          selectedNodeInfo: {
            displayName: selectedNode.displayName,
            tableName: resolvedSelectedTableName,
            datasetId: selectedNode.datasetId,
            entityType: selectedNode.entityType,
          },
          sampleColumnLineageRecord: columnLineage[0] || "NO DATA",
          allColumnLineageColumns: columnLineage[0] ? Object.keys(columnLineage[0]) : [],
        });

        if (columnLineage.length === 0) {
          return null;
        }

        const baseMatches = columnLineage.filter((step: any) => {
          const stepFinalColumn = normalizeValue(step.final_column_name ?? step.finalColumnName ?? step.final_column);
          const stepColumnAtStep = normalizeValue(step.column_name_at_step ?? step.columnNameAtStep ?? step.column_name);
          const stepTable = normalizeValue(step.power_bi_table_name ?? step.table_name ?? step.tableName);
          const stepDatasetId = normalizeValue(step.dataset_id ?? step.datasetId ?? step.model_id ?? step.modelId);

          const matchesColumn =
            stepFinalColumn === selectedColumnNameNormalized ||
            stepColumnAtStep === selectedColumnNameNormalized;
          const matchesTable = !stepTable || stepTable === selectedTableNameNormalized;
          const matchesDataset =
            !selectedDatasetIdNormalized ||
            !stepDatasetId ||
            stepDatasetId === selectedDatasetIdNormalized;

          return matchesColumn && matchesTable && matchesDataset;
        });

        const strictSteps = baseMatches.filter((step: any) => {
          const stepDatasetId = normalizeValue(step.dataset_id ?? step.datasetId ?? step.model_id ?? step.modelId);

          // Preferred: dataset-aware match when both sides are known.
          if (selectedDatasetIdNormalized && stepDatasetId) {
            return stepDatasetId === selectedDatasetIdNormalized;
          }

          // Accept when one side is missing to avoid losing valid rows due to shape drift.
          return true;
        });

        const steps = strictSteps.length > 0 ? strictSteps : baseMatches;

        steps.sort((a: any, b: any) => {
          const aOrder = Number.parseInt(String(a.step_order ?? a.stepOrder ?? 0), 10) || 0;
          const bOrder = Number.parseInt(String(b.step_order ?? b.stepOrder ?? 0), 10) || 0;
          return bOrder - aOrder;
        });

        if (steps.length === 0) {
          return null;
        }

        return (
          <Accordion className={styles.accordionPanel} collapsible>
            <AccordionItem value="query-steps">
              <AccordionHeader>
                <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXS }}>
                  <Text weight="semibold">{t("LineageDetail_QuerySteps", "Query Steps")}</Text>
                  <Badge>{steps.length}</Badge>
                </div>
              </AccordionHeader>
              <AccordionPanel>
                <div className={styles.accordionContent}>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS, padding: tokens.spacingHorizontalM }}>
                    {t("LineageDetail_QueryStepsHint", "Power Query M transformation steps applied to this column")}
                  </Text>
                  {steps.map((step: any, index: number) => (
                    <div key={index} className={styles.card} style={{ marginBottom: tokens.spacingVerticalS }}>
                      <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXS, marginBottom: step.step_expression ? tokens.spacingVerticalS : 0, flexWrap: "wrap" }}>
                        {step.affects_entire_table && (
                          <Badge size="small" appearance="filled" color="warning">
                            {t("LineageDetail_AffectsTable", "Affects entire table")}
                          </Badge>
                        )}
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          {step.step_name || `Step ${step.step_order || index + 1}`}
                        </Text>
                        {step.transformation_function && (
                          <>
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>•</Text>
                            <Text size={200} weight="semibold">
                              {step.transformation_function}
                            </Text>
                          </>
                        )}
                        {step.column_name_at_step && step.column_name_at_step !== step.final_column_name && (
                          <>
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>•</Text>
                            <Text size={200}>
                              {step.column_name_at_step}
                            </Text>
                          </>
                        )}
                        {step.column_created_here && (
                          <Badge size="small" appearance="filled" color="success">
                            {t("LineageDetail_CreatedHere", "Column created here")}
                          </Badge>
                        )}
                        <Badge size="small" appearance="outline" style={{ marginLeft: "auto" }}>
                          {step.step_order || index + 1}
                        </Badge>
                      </div>

                      {step.step_expression && (
                        <div className={styles.expressionBlock} style={{ maxHeight: "200px" }}>
                          {step.step_expression}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        );
      })()}

    </div>
  );
}
