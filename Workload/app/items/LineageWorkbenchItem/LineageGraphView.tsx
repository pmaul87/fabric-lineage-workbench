import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import type { Node, Edge, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronRightFilled, SaveRegular, TargetArrowRegular, ChevronUpRegular, ChevronDownRegular } from "@fluentui/react-icons";
import { Text, tokens, Button, Slider, Label, Spinner } from "@fluentui/react-components";
import dagre from "dagre";
import { toPng } from "html-to-image";

// ─── Lineage graph types (inlined from original LineageViewerItemDefinition) ──

export interface LineageViewerNode {
  nodeId: string;
  displayName: string;
  entityType: "report" | "page" | "visual" | "semantic_model" | "semantic_object" | "table" | "column" | "measure" | "dataflow" | "notebook" | "lakehouse" | "lakehouse_table" | "warehouse" | "warehouse_table" | "unknown";
  datasetId?: string;
  modelName?: string;
  tableName?: string;
  columnName?: string;
  objectName?: string;
  objectSubtype?: string;
  dataType?: string;
  expression?: string;
  formatString?: string;
  reportId?: string;
  pageId?: string;
  visualId?: string;
  pageNumber?: number;
  visualType?: string;
  parentNodeId?: string;
  isGroupNode?: boolean;
}

export interface LineageViewerEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
  datasetId?: string;
  reportId?: string;
  pageId?: string;
  visualId?: string;
  evidence?: string;
}

// ÔöÇÔöÇÔöÇ Entity-type colour palette (Fabric CSS tokens + palette fallbacks) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

interface EntityPalette {
  bg: string;
  border: string;
  typeLabel: string;
}

const PALETTE: Record<string, EntityPalette> = {
  report: {
    bg: "var(--colorBrandBackground2, #cce4f6)",
    border: "var(--colorBrandStroke1, #0078d4)",
    typeLabel: "Report",
  },
  page: {
    bg: "var(--colorPaletteBlueBackground2, #e7f1fb)",
    border: "var(--colorPaletteBlueBorderActive, #005a9e)",
    typeLabel: "Page",
  },
  visual: {
    bg: "var(--colorPalettePurpleBackground2, #ede8f8)",
    border: "var(--colorPalettePurpleBorderActive, #7c3aed)",
    typeLabel: "Visual",
  },
  measure: {
    bg: "var(--colorPaletteGreenBackground2, #e6f4ea)",
    border: "var(--colorPaletteGreenBorderActive, #2d7d32)",
    typeLabel: "Measure",
  },
  column: {
    bg: "var(--colorPaletteTealBackground2, #e0f2f1)",
    border: "var(--colorPaletteTealBorderActive, #00796b)",
    typeLabel: "Column",
  },
  table: {
    bg: "var(--colorPaletteMarigoldBackground2, #fff3cd)",
    border: "var(--colorPaletteMarigoldBorderActive, #c67a00)",
    typeLabel: "Table",
  },
  dataflow: {
    bg: "var(--colorPaletteBerryBackground2, #fbe5ef)",
    border: "var(--colorPaletteBerryBorderActive, #a4262c)",
    typeLabel: "Dataflow",
  },
  notebook: {
    bg: "var(--colorPaletteCornflowerBackground2, #e8efff)",
    border: "var(--colorPaletteCornflowerBorderActive, #4f6bed)",
    typeLabel: "Notebook",
  },
  lakehouse: {
    bg: "var(--colorPaletteSeafoamBackground2, #e2f3ef)",
    border: "var(--colorPaletteSeafoamBorderActive, #0f766e)",
    typeLabel: "Lakehouse",
  },
  lakehouse_table: {
    bg: "var(--colorPaletteSeafoamBackground2, #e2f3ef)",
    border: "var(--colorPaletteSeafoamBorderActive, #0f766e)",
    typeLabel: "Lakehouse Table",
  },
  warehouse: {
    bg: "var(--colorPaletteDarkOrangeBackground2, #ffe8d1)",
    border: "var(--colorPaletteDarkOrangeBorderActive, #b75d00)",
    typeLabel: "Warehouse",
  },
  warehouse_table: {
    bg: "var(--colorPaletteDarkOrangeBackground2, #ffe8d1)",
    border: "var(--colorPaletteDarkOrangeBorderActive, #b75d00)",
    typeLabel: "Warehouse Table",
  },
  semantic_object: {
    bg: "var(--colorPalettePeachBackground2, #fdf0e8)",
    border: "var(--colorPalettePeachBorderActive, #d4662a)",
    typeLabel: "Object",
  },
  semantic_model: {
    bg: "var(--colorPaletteLavenderBackground2, #f0e8ff)",
    border: "var(--colorPaletteLavenderBorderActive, #6b4eff)",
    typeLabel: "Semantic Model",
  },
  unknown: {
    bg: "var(--colorNeutralBackground2, #f5f5f5)",
    border: "var(--colorNeutralStroke1, #bdbdbd)",
    typeLabel: "Unknown",
  },
  group: {
    bg: "var(--colorNeutralBackground1, #ffffff)",
    border: "var(--colorBrandStroke1, #0078d4)",
    typeLabel: "Group",
  },
};

const palette = (type: string): EntityPalette => PALETTE[type] ?? PALETTE.unknown;

// Table-based color palette generator

const TABLE_COLORS = [
  { bg: "#e3f2fd", border: "#1976d2" }, // Blue
  { bg: "#f3e5f5", border: "#7b1fa2" }, // Purple
  { bg: "#e8f5e9", border: "#388e3c" }, // Green
  { bg: "#fff3e0", border: "#f57c00" }, // Orange
  { bg: "#fce4ec", border: "#c2185b" }, // Pink
  { bg: "#e0f2f1", border: "#00796b" }, // Teal
  { bg: "#fff9c4", border: "#f9a825" }, // Yellow
  { bg: "#f1f8e9", border: "#689f38" }, // Light Green
  { bg: "#e1f5fe", border: "#0288d1" }, // Light Blue
  { bg: "#fce4ec", border: "#e91e63" }, // Deep Pink
  { bg: "#ede7f6", border: "#5e35b1" }, // Deep Purple
  { bg: "#e0f7fa", border: "#0097a7" }, // Cyan
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function getTableColor(tableName: string): { bg: string; border: string } {
  const hash = hashString(tableName);
  return TABLE_COLORS[hash % TABLE_COLORS.length];
}

// Centrality calculation

// Network Intelligence Functions

interface NetworkMetrics {
  degreeCentrality: number;
  betweennessCentrality: number;
  upstreamCount: number;
  downstreamCount: number;
  depth: number;
}

function calculateNetworkMetrics(
  nodes: LineageViewerNode[],
  edges: LineageViewerEdge[],
  depthByNodeId: Map<string, number>
): Map<string, NetworkMetrics> {
  console.log("[LineageGraph] calculateNetworkMetrics input:", {
    nodesCount: nodes.length,
    edgesCount: edges.length,
    sampleEdge: edges[0] ? {
      edgeId: edges[0].edgeId,
      fromNodeId: edges[0].fromNodeId,
      toNodeId: edges[0].toNodeId,
      edgeType: edges[0].edgeType,
    } : "N/A",
  });

  const metrics = new Map<string, NetworkMetrics>();
  const adjacency = new Map<string, Set<string>>();
  const upstreamMap = new Map<string, Set<string>>();
  const downstreamMap = new Map<string, Set<string>>();
  
  // Build adjacency lists
  for (const edge of edges) {
    if (!adjacency.has(edge.fromNodeId)) adjacency.set(edge.fromNodeId, new Set());
    if (!adjacency.has(edge.toNodeId)) adjacency.set(edge.toNodeId, new Set());
    adjacency.get(edge.fromNodeId)!.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)!.add(edge.fromNodeId);
    
    if (!upstreamMap.has(edge.toNodeId)) upstreamMap.set(edge.toNodeId, new Set());
    upstreamMap.get(edge.toNodeId)!.add(edge.fromNodeId);
    
    if (!downstreamMap.has(edge.fromNodeId)) downstreamMap.set(edge.fromNodeId, new Set());
    downstreamMap.get(edge.fromNodeId)!.add(edge.toNodeId);
  }
  
  // Calculate betweenness centrality (simplified - count shortest paths through node)
  const betweenness = new Map<string, number>();
  for (const node of nodes) {
    betweenness.set(node.nodeId, 0);
  }
  
  // For each pair of nodes, find shortest path and increment betweenness for intermediate nodes
  for (const source of nodes) {
    const distances = new Map<string, number>();
    const predecessors = new Map<string, Set<string>>();
    const queue = [source.nodeId];
    distances.set(source.nodeId, 0);
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDist = distances.get(current)!;
      
      const neighbors = adjacency.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!distances.has(neighbor)) {
          distances.set(neighbor, currentDist + 1);
          queue.push(neighbor);
          predecessors.set(neighbor, new Set([current]));
        } else if (distances.get(neighbor) === currentDist + 1) {
          predecessors.get(neighbor)!.add(current);
        }
      }
    }
    
    // Backtrack to count paths through each node
    for (const [target] of distances) {
      if (target === source.nodeId) continue;
      const preds = predecessors.get(target);
      if (preds) {
        for (const pred of preds) {
          if (pred !== source.nodeId) {
            betweenness.set(pred, (betweenness.get(pred) || 0) + 1);
          }
        }
      }
    }
  }
  
  // Assemble metrics for each node
  for (const node of nodes) {
    const degree = adjacency.get(node.nodeId)?.size || 0;
    const between = betweenness.get(node.nodeId) || 0;
    const upstream = upstreamMap.get(node.nodeId)?.size || 0;
    const downstream = downstreamMap.get(node.nodeId)?.size || 0;
    const depth = depthByNodeId.get(node.nodeId) || 0;
    
    metrics.set(node.nodeId, {
      degreeCentrality: degree,
      betweennessCentrality: between,
      upstreamCount: upstream,
      downstreamCount: downstream,
      depth,
    });
  }
  
  console.log("[LineageGraph] calculateNetworkMetrics result:", {
    metricsCount: metrics.size,
    sampleMetrics: Array.from(metrics.entries()).slice(0, 3).map(([nodeId, m]) => ({
      nodeId,
      connections: m.degreeCentrality,
      upstream: m.upstreamCount,
      downstream: m.downstreamCount,
    })),
    zeroConnectionNodes: Array.from(metrics.entries()).filter(([_, m]) => m.degreeCentrality === 0).length,
  });
  
  return metrics;
}

function findCriticalPath(
  startNodeId: string,
  endNodeId: string,
  edges: LineageViewerEdge[]
): Set<string> {
  const pathNodes = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  
  // Build adjacency list
  for (const edge of edges) {
    if (!adjacency.has(edge.fromNodeId)) adjacency.set(edge.fromNodeId, new Set());
    adjacency.get(edge.fromNodeId)!.add(edge.toNodeId);
  }
  
  // BFS to find shortest path
  const queue: { node: string; path: string[] }[] = [{ node: startNodeId, path: [startNodeId] }];
  const visited = new Set<string>([startNodeId]);
  
  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    
    if (node === endNodeId) {
      path.forEach(n => pathNodes.add(n));
      return pathNodes;
    }
    
    const neighbors = adjacency.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, path: [...path, neighbor] });
      }
    }
  }
  
  return pathNodes;
}

// ÔöÇÔöÇÔöÇ Node dimensions ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

const NODE_W = 210;

// ÔöÇÔöÇÔöÇ Custom node data shape ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

export interface LineageNodeData extends Record<string, unknown> {
  label: string;
  subLabel?: string;
  parentLabel?: string;
  typeLabel?: string;
  entityType: string;
  tableName?: string;
  isFocus: boolean;
  isRelated: boolean;
  isDirectUpstream: boolean;
  isDirectDownstream: boolean;
  depth: number;
  isGroupNode?: boolean;
  isExpanded?: boolean;
  childCount?: number;
  degreeCentrality?: number;
  betweennessCentrality?: number;
  upstreamCount?: number;
  downstreamCount?: number;
  useTableColors?: boolean;
  onToggleExpanded?: (nodeId: string) => void;
}

type LineageFlowNode = Node<LineageNodeData, "lineageNode">;

// ÔöÇÔöÇÔöÇ Custom node renderer ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function LineageNodeComponent({ data, id }: NodeProps<LineageFlowNode>) {
  const pal = palette(data.entityType);
  const isFocus = data.isFocus;
  const isRelated = data.isRelated;
  const isDirectUpstream = data.isDirectUpstream;
  const isDirectDownstream = data.isDirectDownstream;
  const isGroupNode = data.isGroupNode;
  const relatedBg = "var(--colorPaletteLavenderBackground2, #f0e8ff)";
  const relatedBorder = "var(--colorPaletteLavenderBorderActive, #6b4eff)";
  const upstreamBg = "var(--colorPaletteRedBackground2, #fde7e9)";
  const upstreamBorder = "var(--colorPaletteRedBorderActive, #d13438)";
  const downstreamBg = "var(--colorPaletteGreenBackground2, #e6f4ea)";
  const downstreamBorder = "var(--colorPaletteGreenBorderActive, #2d7d32)";
  const bidirectionalBg = "var(--colorPaletteDarkOrangeBackground2, #ffe8d1)";
  const bidirectionalBorder = "var(--colorPaletteDarkOrangeBorderActive, #b75d00)";

  // Determine base colors (table-based or entity-type based)
  let baseColor = pal;
  if (data.useTableColors && data.tableName && !isGroupNode) {
    const tableColor = getTableColor(data.tableName);
    baseColor = { bg: tableColor.bg, border: tableColor.border, typeLabel: pal.typeLabel };
  }

  const nodeBg = isFocus
    ? "var(--colorBrandBackground, #0078d4)"
    : isDirectUpstream && isDirectDownstream
      ? bidirectionalBg
      : isDirectUpstream
        ? upstreamBg
        : isDirectDownstream
          ? downstreamBg
          : isRelated
            ? relatedBg
            : baseColor.bg;
  const nodeBorder = isFocus
    ? "var(--colorBrandBackground, #0078d4)"
    : isDirectUpstream && isDirectDownstream
      ? bidirectionalBorder
      : isDirectUpstream
        ? upstreamBorder
        : isDirectDownstream
          ? downstreamBorder
          : isRelated
            ? relatedBorder
            : baseColor.border;
  const accentColor = isFocus ? "#fff" : nodeBorder;
  
  // Build enhanced tooltip content with network metrics
  const tooltipLines = [
    data.label,
    data.subLabel ? `Table: ${data.subLabel}` : null,
    data.depth !== undefined ? `Depth: ${data.depth}` : null,
    data.upstreamCount !== undefined ? `↑ Upstream: ${data.upstreamCount}` : null,
    data.downstreamCount !== undefined ? `↓ Downstream: ${data.downstreamCount}` : null,
    data.degreeCentrality !== undefined ? `Connections: ${data.degreeCentrality}` : null,
    data.betweennessCentrality !== undefined && data.betweennessCentrality > 0 
      ? `Betweenness: ${data.betweennessCentrality}` 
      : null,
  ].filter(Boolean);
  const tooltipContent = tooltipLines.join('\\n');

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    data.onToggleExpanded?.(id);
  };

  return (
    <div
      style={{
        background: nodeBg,
        border: `2px solid ${nodeBorder}`,
        borderRadius: "var(--borderRadiusMedium, 6px)",
        padding: isGroupNode ? "12px" : "8px 12px",
        width: isGroupNode ? 240 : NODE_W,
        fontFamily: "var(--fontFamilyBase, 'Segoe UI', sans-serif)",
        boxShadow: isFocus
          ? "0 4px 16px rgba(0,120,212,0.35)"
          : isGroupNode
            ? "0 2px 8px rgba(0,0,0,0.1)"
            : "0 1px 4px rgba(0,0,0,0.08)",
        cursor: "pointer",
        userSelect: "none",
      }}
      title={tooltipContent}
    >
      {isGroupNode ? (
        <>
          <Handle type="target" position={Position.Left} style={{ background: accentColor, border: "none" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
            <button
              onClick={handleExpandClick}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
              }}
              title={data.isExpanded ? "Collapse group" : "Expand group"}
            >
              <ChevronRightFilled
                style={{
                  color: accentColor,
                  transform: data.isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  fontSize: 16,
                }}
              />
            </button>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: isFocus ? "#ffffff" : "var(--colorNeutralForeground1, #1a1a1a)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 160,
                }}
                title={data.label}
              >
                {data.label}
              </div>

              {data.childCount !== undefined && (
                <div
                  style={{
                    fontSize: 10,
                    color: isFocus ? "rgba(255,255,255,0.65)" : "var(--colorNeutralForeground3, #757575)",
                  }}
                >
                  {data.childCount} items
                </div>
              )}

              {data.typeLabel && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    width: "fit-content",
                    padding: "2px 6px",
                    borderRadius: 999,
                    fontSize: 10,
                    lineHeight: 1.2,
                    color: isFocus ? "#ffffff" : nodeBorder,
                    background: isFocus ? "rgba(255,255,255,0.14)" : "var(--colorNeutralBackground1, #fff)",
                    border: `1px solid ${isFocus ? "rgba(255,255,255,0.3)" : nodeBorder}`,
                  }}
                >
                  {data.typeLabel}
                </div>
              )}

              {data.parentLabel && (
                <div
                  style={{
                    fontSize: 10,
                    color: isFocus ? "rgba(255,255,255,0.78)" : "var(--colorNeutralForeground2, #424242)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 160,
                  }}
                  title={data.parentLabel}
                >
                  Parent: {data.parentLabel}
                </div>
              )}
            </div>
          </div>

          <Handle type="source" position={Position.Right} style={{ background: accentColor, border: "none" }} />
        </>
      ) : (
        <>
          <Handle type="target" position={Position.Left} style={{ background: accentColor, border: "none" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {/* primary label */}
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: isFocus ? "#ffffff" : "var(--colorNeutralForeground1, #1a1a1a)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: NODE_W - 24,
              }}
              title={data.label}
            >
              {data.label}
            </div>

            {/* sub-label (table name) */}
            {data.subLabel && (
              <div
                style={{
                  fontSize: 11,
                  color: isFocus ? "rgba(255,255,255,0.65)" : "var(--colorNeutralForeground3, #757575)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={data.subLabel}
              >
                {data.subLabel}
              </div>
            )}

            {data.typeLabel && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  width: "fit-content",
                  padding: "2px 6px",
                  borderRadius: 999,
                  fontSize: 10,
                  lineHeight: 1.2,
                  color: isFocus ? "#ffffff" : nodeBorder,
                  background: isFocus ? "rgba(255,255,255,0.14)" : "var(--colorNeutralBackground1, #fff)",
                  border: `1px solid ${isFocus ? "rgba(255,255,255,0.3)" : nodeBorder}`,
                }}
              >
                {data.typeLabel}
              </div>
            )}

            {data.parentLabel && (
              <div
                style={{
                  fontSize: 10,
                  color: isFocus ? "rgba(255,255,255,0.75)" : "var(--colorNeutralForeground3, #757575)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: NODE_W - 24,
                }}
                title={data.parentLabel}
              >
                Parent: {data.parentLabel}
              </div>
            )}
          </div>

          <Handle type="source" position={Position.Right} style={{ background: accentColor, border: "none" }} />
        </>
      )}
    </div>
  );
}

const NODE_TYPES = { lineageNode: LineageNodeComponent };

// ─── Dagre auto-layout ────────────────────────────────────────────────────────

/**
 * Apply Dagre hierarchical layout algorithm to position nodes automatically.
 * This creates a clean, layered visualization that minimizes edge crossings.
 */
function applyDagreLayout(
  nodes: LineageFlowNode[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
  focusNodeId?: string
): LineageFlowNode[] {
  const dagreGraph = new dagre.graphlib.Graph();
  
  // If we have a focus node, find its related nodes (direct connections)
  const relatedNodeIds = new Set<string>();
  if (focusNodeId) {
    relatedNodeIds.add(focusNodeId);
    for (const edge of edges) {
      if (edge.source === focusNodeId) {
        relatedNodeIds.add(edge.target); // Downstream
      }
      if (edge.target === focusNodeId) {
        relatedNodeIds.add(edge.source); // Upstream
      }
    }
  }
  
  // Configure graph for hierarchical layout with increased spacing for parent-child nodes
  // Adjust spacing based on whether we're focusing on a specific node
  const baseNodesep = focusNodeId ? 150 : 200; // Tighter spacing when focused
  const baseRanksep = focusNodeId ? 250 : 300; // Standard rank separation
  
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction, // Standard LR or TB layout (upstream left, downstream right)
    align: "UL", // Align nodes to upper-left
    nodesep: baseNodesep, // Horizontal spacing between nodes
    edgesep: 80, // Spacing between edges
    ranksep: baseRanksep, // Vertical spacing between layers
    marginx: 80,
    marginy: 80,
  });

  // Add nodes to Dagre graph with rank constraints for better grouping
  for (const node of nodes) {
    const width = node.style?.width as number || NODE_W;
    const height = node.style?.height as number || 60;
    const data = node.data as LineageNodeData;
    
    // Assign rank based on entity type for column-based grouping
    let rank: number | undefined = undefined;
    if (data.entityType === "semantic_model") {
      rank = 0; // Leftmost column
    } else if (data.entityType === "table" || data.entityType === "lakehouse_table" || data.entityType === "warehouse_table") {
      rank = 1; // Middle column
    } else if (data.entityType === "column" || data.entityType === "measure") {
      rank = 2; // Rightmost column for semantic model internals
    } else if (data.entityType === "report") {
      rank = 3; // Reports appear after semantic model internals (consumers)
    } else if (data.entityType === "page") {
      rank = 4; // Pages appear after reports
    } else if (data.entityType === "visual") {
      rank = 5; // Visuals appear after pages (most granular level)
    }
    // Other artifacts get auto-assigned based on connections
    
    // Boost rank priority for focus node and related nodes
    if (focusNodeId && relatedNodeIds.has(node.id)) {
      // Related nodes get a slight priority boost to cluster together
      dagreGraph.setNode(node.id, { width, height, rank: rank ?? 99 });
    } else {
      dagreGraph.setNode(node.id, { width, height, rank });
    }
  }

  // Add edges to Dagre graph with weights for focus node connections
  for (const edge of edges) {
    // Increase edge weight for edges connected to focus node
    // Higher weight = stronger attraction = nodes pulled closer together
    let weight = 1;
    if (focusNodeId && (edge.source === focusNodeId || edge.target === focusNodeId)) {
      weight = 10; // Much stronger connection for direct relationships
    } else if (focusNodeId && (relatedNodeIds.has(edge.source) && relatedNodeIds.has(edge.target))) {
      weight = 5; // Moderate connection between related nodes
    }
    
    dagreGraph.setEdge(edge.source, edge.target, { weight });
  }

  // Run Dagre layout algorithm
  dagre.layout(dagreGraph);

  // Apply calculated positions to nodes
  // Standard LR layout: upstream flows left, downstream flows right
  const positionedNodes = nodes.map((node) => {
    const dagreNode = dagreGraph.node(node.id);
    if (!dagreNode) return node;

    // Dagre positions are centered, ReactFlow positions are top-left
    const width = node.style?.width as number || NODE_W;
    const height = node.style?.height as number || 60;

    const x = dagreNode.x - width / 2;
    const y = dagreNode.y - height / 2;

    return {
      ...node,
      position: {
        x,
        y,
      },
    };
  });

  // Second pass: convert child node positions to be relative to their parents
  const parentPositions = new Map<string, { x: number; y: number }>();
  const parentChildren = new Map<string, typeof positionedNodes>();
  
  // Build parent position map and parent-children relationships
  for (const node of positionedNodes) {
    // Track all node positions (both parents and non-parents)
    parentPositions.set(node.id, node.position);
    
    // Build parent-child map
    if (node.parentId) {
      if (!parentChildren.has(node.parentId)) {
        parentChildren.set(node.parentId, []);
      }
      parentChildren.get(node.parentId)!.push(node);
    }
  }
  
  // Multi-pass to handle nested hierarchies (reports → pages → visuals)
  // First pass: make positions relative to immediate parent
  const relativePositionedNodes = positionedNodes.map((node) => {
    if (node.parentId) {
      const parentPos = parentPositions.get(node.parentId);
      if (parentPos) {
        const relativeX = node.position.x - parentPos.x + 30; // 30px padding from parent edge
        const relativeY = node.position.y - parentPos.y + 60; // 60px padding for parent header
        
        return {
          ...node,
          position: {
            x: relativeX,
            y: relativeY,
          },
        };
      }
    }
    return node;
  });
  
  // Second pass: expand parent sizes to fit all children (including nested children)
  return relativePositionedNodes.map((node) => {
    const children = parentChildren.get(node.id);
    if (children && children.length > 0) {
      const currentWidth = node.style?.width as number || NODE_W;
      const currentHeight = node.style?.height as number || 60;
      
      // Calculate bounds needed to contain all children (with generous padding to prevent overlap)
      let maxX = currentWidth;
      let maxY = currentHeight;
      
      for (const child of children) {
        const childWidth = child.style?.width as number || NODE_W;
        const childHeight = child.style?.height as number || 60;
        
        // Child position is now relative to parent
        const childRelX = child.position.x;
        const childRelY = child.position.y;
        
        // If child is also a parent (e.g., page containing visuals), account for its expanded size
        const childActualWidth = relativePositionedNodes.find(n => n.id === child.id)?.style?.width as number || childWidth;
        const childActualHeight = relativePositionedNodes.find(n => n.id === child.id)?.style?.height as number || childHeight;
        
        maxX = Math.max(maxX, childRelX + childActualWidth + 30); // 30px right padding
        maxY = Math.max(maxY, childRelY + childActualHeight + 30); // 30px bottom padding
      }
      
      return {
        ...node,
        style: {
          ...node.style,
          width: maxX,
          height: maxY,
        },
      };
    }
    
    return node;
  });
}

function buildLayout(
  lvNodes: LineageViewerNode[],
  lvEdges: LineageViewerEdge[],
  focusNodeId: string | undefined,
  depthByNodeId: Map<string, number>,
  highlightedNodeIds: Set<string>,
  highlightedEdgeIds: Set<string>,
  expandedGroups: Set<string>,
  onToggleGroup: (groupId: string) => void,
  useTableColors: boolean,
  networkMetrics: Map<string, NetworkMetrics>,
  criticalPathNodes: Set<string>
): { nodes: LineageFlowNode[]; edges: Edge[] } {
  // ── Build hierarchical structure: Semantic Model → Table → Column/Measure ──
  
  const syntheticGroupNodes: LineageViewerNode[] = [];
  const allNodes = [...lvNodes];
  
  // Ensure parent nodes are included when children exist
  // This prevents ReactFlow errors when positioning child nodes
  const nodeById = new Map<string, LineageViewerNode>();
  const neededParentIds = new Set<string>();
  
  for (const node of lvNodes) {
    nodeById.set(node.nodeId, node);
    if (node.parentNodeId) {
      neededParentIds.add(node.parentNodeId);
    }
  }
  
  // Add missing parent nodes (reports/pages that should contain children)
  for (const parentId of neededParentIds) {
    if (!nodeById.has(parentId)) {
      // Extract parent info from ID pattern
      if (parentId.startsWith('report:')) {
        const reportId = parentId.substring(7);
        syntheticGroupNodes.push({
          nodeId: parentId,
          displayName: `Report (${reportId})`,
          entityType: "report",
          reportId: reportId,
          isGroupNode: true,
        });
        console.warn(`[LineageGraph] Added missing parent report node: ${parentId}`);
      } else if (parentId.startsWith('page:')) {
        const parts = parentId.substring(5).split('|');
        const reportId = parts[0];
        const pageName = parts.slice(1).join('|');
        syntheticGroupNodes.push({
          nodeId: parentId,
          displayName: pageName || 'Page',
          entityType: "page",
          reportId: reportId,
          pageId: pageName,
          isGroupNode: true,
          parentNodeId: `report:${reportId}`, // Link page to report
        });
        // Ensure report parent also exists
        neededParentIds.add(`report:${reportId}`);
        console.warn(`[LineageGraph] Added missing parent page node: ${parentId}`);
      }
    }
  }
  
  // Create semantic model group nodes if they don't exist
  const modelNodeIds = new Set(lvNodes.filter(n => n.entityType === "semantic_model").map(n => n.nodeId));
  const datasetIds = new Set(lvNodes.filter(n => n.datasetId).map(n => n.datasetId!));
  const connectedIds = new Set<string>();
  for (const edge of lvEdges) {
    connectedIds.add(edge.fromNodeId);
    connectedIds.add(edge.toNodeId);
  }
  const hasHierarchyChildren = new Set(lvNodes.map(n => n.parentNodeId).filter(Boolean));
  
  for (const datasetId of datasetIds) {
    const modelNodeId = `sm:${datasetId}`;
    const shouldCreateModelNode = connectedIds.has(modelNodeId) || hasHierarchyChildren.has(modelNodeId);
    if (!modelNodeIds.has(modelNodeId) && shouldCreateModelNode) {
      const modelName = lvNodes.find(n => n.datasetId === datasetId && n.modelName)?.modelName || `Model ${datasetId}`;
      syntheticGroupNodes.push({
        nodeId: modelNodeId,
        displayName: modelName,
        entityType: "semantic_model",
        datasetId: datasetId,
        isGroupNode: true,
      });
    }
  }
  
  allNodes.push(...syntheticGroupNodes);

  const allNodesById = new Map(allNodes.map(n => [n.nodeId, n]));

  const childCountByParent = new Map<string, number>();
  for (const node of allNodes) {
    if (!node.parentNodeId) continue;
    childCountByParent.set(node.parentNodeId, (childCountByParent.get(node.parentNodeId) ?? 0) + 1);
  }

  // ── Build directional highlight info ──────────────────────────────────────
  const directUpstreamNodeIds = new Set<string>();
  const directDownstreamNodeIds = new Set<string>();
  const directUpstreamEdgeIds = new Set<string>();
  const directDownstreamEdgeIds = new Set<string>();

  if (focusNodeId) {
    for (const edge of lvEdges) {
      if (edge.toNodeId === focusNodeId) {
        directUpstreamNodeIds.add(edge.fromNodeId);
        directUpstreamEdgeIds.add(edge.edgeId);
      }
      if (edge.fromNodeId === focusNodeId) {
        directDownstreamNodeIds.add(edge.toNodeId);
        directDownstreamEdgeIds.add(edge.edgeId);
      }
    }
  }

  // ── Create flat node list for Dagre (hierarchical layout) ────────────────
  const nodes: LineageFlowNode[] = [];
  
  for (const node of allNodes) {
    const isFocus = node.nodeId === focusNodeId;
    const isRelated = highlightedNodeIds.has(node.nodeId) && node.nodeId !== focusNodeId;
    const isDirectUpstream = directUpstreamNodeIds.has(node.nodeId);
    const isDirectDownstream = directDownstreamNodeIds.has(node.nodeId);
    const depth = depthByNodeId.get(node.nodeId) ?? 0;
    const metrics = networkMetrics.get(node.nodeId);
    
    // Calculate node dimensions based on type
    let width = NODE_W;
    let height = 60;
    
    if (node.entityType === "semantic_model") {
      width = 280;
      height = 80;
    } else if (node.entityType === "table" || node.entityType === "lakehouse_table" || node.entityType === "warehouse_table") {
      width = 240;
      height = 70;
    } else if (node.entityType === "column" || node.entityType === "measure") {
      width = 220;
      height = 55;
    } else if (node.entityType === "report") {
      width = 300;
      height = 100;
    } else if (node.entityType === "page") {
      width = 260;
      height = 80;
    } else if (node.entityType === "visual") {
      width = 220;
      height = 60;
    }
    
    // Build ReactFlow node with optional parent relationship
    const typeLabel = palette(node.entityType).typeLabel;
    const showTypeInLabel = node.entityType === "lakehouse_table" || node.entityType === "warehouse_table";

    const reactFlowNode: LineageFlowNode = {
      id: node.nodeId,
      type: "lineageNode",
      position: { x: 0, y: 0 }, // Will be calculated by Dagre
      style: {
        width,
        height,
      },
      data: {
        label: showTypeInLabel ? `${typeLabel}: ${node.displayName}` : node.displayName,
        subLabel: node.tableName || node.dataType || undefined,
        parentLabel: node.parentNodeId ? (allNodesById.get(node.parentNodeId)?.displayName ?? node.parentNodeId) : undefined,
        typeLabel,
        entityType: node.entityType,
        tableName: node.tableName,
        isFocus: isFocus || criticalPathNodes.has(node.nodeId),
        isRelated,
        isDirectUpstream,
        isDirectDownstream,
        depth,
        isGroupNode: node.isGroupNode,
        childCount: childCountByParent.get(node.nodeId),
        degreeCentrality: metrics?.degreeCentrality,
        betweennessCentrality: metrics?.betweennessCentrality,
        upstreamCount: metrics?.upstreamCount,
        downstreamCount: metrics?.downstreamCount,
        useTableColors,
        onToggleExpanded: onToggleGroup,
      },
    };
    
    // NOTE: Parent-child relationships (parentId) are NOT used in graph view
    // They are only needed for table/tree views
    // Graph view shows a flat network of nodes with edges showing relationships
    
    nodes.push(reactFlowNode);
  }

  // ── Create edges (only between visible nodes) ────────────────────────────
  const visibleNodeIds = new Set(allNodes.map(n => n.nodeId));
  const nodeMap = new Map(allNodes.map(n => [n.nodeId, n]));
  
  let filteredOutEdgeCount = 0;
  const filteredOutEdges: Array<{ edgeId: string; reason: string; fromExists: boolean; toExists: boolean }> = [];
  
  // Keep all edges including containment edges for clarity, even with parent-child nesting
  const edges: Edge[] = lvEdges
    .filter(e => {
      // Keep edge if both nodes are visible
      const fromExists = visibleNodeIds.has(e.fromNodeId);
      const toExists = visibleNodeIds.has(e.toNodeId);
      
      if (!fromExists || !toExists) {
        filteredOutEdgeCount++;
        if (filteredOutEdges.length < 10) {
          const fromNode = nodeMap.get(e.fromNodeId);
          const toNode = nodeMap.get(e.toNodeId);
          filteredOutEdges.push({
            edgeId: e.edgeId,
            reason: !fromExists && !toExists ? "both nodes missing" : !fromExists ? "source node missing" : "target node missing",
            fromExists,
            toExists,
          });
          
          console.warn(`[LineageGraph] Filtering out edge ${e.edgeId}:`, {
            edgeType: e.edgeType,
            fromNodeId: e.fromNodeId,
            fromExists,
            fromNodeType: fromNode?.entityType,
            toNodeId: e.toNodeId,
            toExists,
            toNodeType: toNode?.entityType,
          });
        }
        return false;
      }
      
      return true;
    })
    .map((e) => {
      const isHighlighted = highlightedEdgeIds.has(e.edgeId);
      const isUpstreamEdge = directUpstreamEdgeIds.has(e.edgeId);
      const isDownstreamEdge = directDownstreamEdgeIds.has(e.edgeId);
      
      // Enhanced edge styling for better visibility
      const edgeColor = isUpstreamEdge
        ? "var(--colorPaletteRedBorderActive, #d13438)"
        : isDownstreamEdge
          ? "var(--colorPaletteGreenBorderActive, #2d7d32)"
          : isHighlighted
            ? "var(--colorPaletteLavenderBorderActive, #6b4eff)"
            : e.edgeType === "hierarchy"
              ? "var(--colorNeutralStroke3, #b0b0b0)"
              : e.edgeType === "relationship"
                ? "var(--colorBrandStroke1, #0078d4)"
                : e.edgeType === "contains"
                  ? "var(--colorNeutralStroke2, #c4c4c4)"
                  : e.edgeType === "uses_column" || e.edgeType === "uses_measure"
                    ? "var(--colorPaletteOrangeBorderActive, #ff8c00)"
                    : "var(--colorNeutralStroke1, #9e9e9e)";
      
      const edgeWidth = isUpstreamEdge || isDownstreamEdge ? 3 : isHighlighted ? 2.5 : e.edgeType === "hierarchy" ? 1 : e.edgeType === "contains" ? 1.5 : 2;
      const isAnimated = isUpstreamEdge || isDownstreamEdge;
      
      // Different stroke patterns for different edge types
      let strokeDasharray: string | undefined = undefined;
      if (e.edgeType === "hierarchy") {
        strokeDasharray = "1,2"; // Fine dotted for parent-child hierarchy
      } else if (e.edgeType === "dependency") {
        strokeDasharray = "5,5"; // Dashed for dependencies
      } else if (e.edgeType === "contains") {
        strokeDasharray = "2,3"; // Dotted for containment
      } else if (e.edgeType === "uses_column" || e.edgeType === "uses_measure") {
        strokeDasharray = "3,3"; // Dotted for visual-to-object usage
      }
      // Solid line for relationships (no dasharray)

      // Edge labels
      let edgeLabel = "";
      if (e.edgeType === "hierarchy") {
        edgeLabel = ""; // No label for hierarchy edges to reduce clutter
      } else if (e.edgeType === "relationship") {
        edgeLabel = "relationship";
      } else if (e.edgeType === "contains") {
        edgeLabel = "contains";
      } else if (e.edgeType === "uses_column") {
        edgeLabel = "uses";
      } else if (e.edgeType === "uses_measure") {
        edgeLabel = "uses";
      } else if (e.edgeType === "dependency") {
        edgeLabel = "dependency";
      }

      return {
        id: e.edgeId,
        source: e.fromNodeId,
        target: e.toNodeId,
        type: "smoothstep",
        animated: isAnimated,
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
        style: { 
          stroke: edgeColor, 
          strokeWidth: edgeWidth,
          strokeDasharray,
        },
        label: edgeLabel,
        labelStyle: { 
          fontSize: 10, 
          fill: isHighlighted ? edgeColor : "var(--colorNeutralForeground3, #757575)",
          fontWeight: isHighlighted ? 600 : 400,
        },
        labelBgStyle: { fill: "var(--colorNeutralBackground1, #fff)", fillOpacity: 0.9 },
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 4,
      };
    });

  // ── Log edge filtering summary ────────────────────────────────────────────
  console.log("[LineageGraph] Edge filtering summary:", {
    inputEdges: lvEdges.length,
    outputEdges: edges.length,
    filteredOut: filteredOutEdgeCount,
    visibleNodes: visibleNodeIds.size,
    sampleFilteredEdges: filteredOutEdges.slice(0, 5),
  });
  
  if (filteredOutEdgeCount > 0) {
    console.warn(`⚠️ [LineageGraph] ${filteredOutEdgeCount} edges filtered out due to missing nodes`);
  }

  // ── Apply Dagre hierarchical layout (left-to-right flow) with focus-aware clustering ─────────────────
  const layoutedNodes = applyDagreLayout(nodes, edges, "LR", focusNodeId);

  // ── Final validation: Ensure all edges point to existing layouted nodes ──
  const layoutedNodeIds = new Set(layoutedNodes.map(n => n.id));
  const validEdges = edges.filter(edge => {
    const sourceExists = layoutedNodeIds.has(edge.source);
    const targetExists = layoutedNodeIds.has(edge.target);
    
    if (!sourceExists || !targetExists) {
      console.error(`[LineageGraph] CRITICAL: Edge ${edge.id} references non-existent layouted nodes!`, {
        source: edge.source,
        sourceExists,
        target: edge.target,
        targetExists,
        edgeType: edge.type,
      });
      return false;
    }
    return true;
  });

  if (validEdges.length < edges.length) {
    console.error(`⚠️ [LineageGraph] Removed ${edges.length - validEdges.length} edges that pointed to non-existent layouted nodes!`);
  }

  console.log("[LineageGraph] Final output for ReactFlow:", {
    nodes: layoutedNodes.length,
    edges: validEdges.length,
    invalidEdgesRemoved: edges.length - validEdges.length,
    sampleNode: layoutedNodes[0] ? {
      id: layoutedNodes[0].id,
      type: layoutedNodes[0].type,
      position: layoutedNodes[0].position,
      parentId: layoutedNodes[0].parentId,
    } : "N/A",
    sampleEdge: validEdges[0] ? {
      id: validEdges[0].id,
      source: validEdges[0].source,
      target: validEdges[0].target,
      type: validEdges[0].type,
    } : "N/A",
  });

  return { nodes: layoutedNodes, edges: validEdges };
}

// ─── Inner component (needs to be inside ReactFlowProvider) ──────────────────

interface LineageGraphViewProps {
  nodes: LineageViewerNode[];
  edges: LineageViewerEdge[];
  isLoading?: boolean;
  focusNodeId?: string;
  depthByNodeId: Map<string, number>;
  highlightedNodeIds?: Set<string>;
  highlightedEdgeIds?: Set<string>;
  expandedGroups?: Set<string>;
  onToggleGroup?: (groupId: string) => void;
  onNodeClick?: (nodeId: string) => void;
}

// ─── Legend Component ─────────────────────────────────────────────────────────

interface LegendProps {
}

function GraphLegend({}: LegendProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  return (
    <Panel position="top-right" style={{ margin: 10 }}>
      <div
        style={{
          background: tokens.colorNeutralBackground1,
          border: `1px solid ${tokens.colorNeutralStroke2}`,
          borderRadius: tokens.borderRadiusMedium,
          padding: "12px",
          fontSize: "11px",
          fontFamily: tokens.fontFamilyBase,
          minWidth: isExpanded ? "200px" : "auto",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ marginBottom: isExpanded ? "12px" : "0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <Text weight="semibold" size={300}>Legend</Text>
          <Button
            appearance="subtle"
            size="small"
            icon={isExpanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? "Collapse legend" : "Expand legend"}
          />
        </div>
        
        {isExpanded && (
          <>

        {/* Edge Types */}
        <div style={{ marginBottom: "8px" }}>
          <Text weight="semibold" size={200} style={{ display: "block", marginBottom: "6px" }}>Edge Types</Text>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "40px", height: "2px", background: tokens.colorBrandStroke1 }} />
              <Text size={100}>Relationship</Text>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "40px", height: "2px", background: tokens.colorNeutralStroke1, backgroundImage: "repeating-linear-gradient(90deg, currentColor, currentColor 5px, transparent 5px, transparent 10px)" }} />
              <Text size={100}>Dependency</Text>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "40px", height: "2px", background: tokens.colorNeutralStroke2, backgroundImage: "repeating-linear-gradient(90deg, currentColor, currentColor 2px, transparent 2px, transparent 5px)" }} />
              <Text size={100}>Contains</Text>
            </div>
          </div>
        </div>

        {/* Highlight States */}
        <div>
          <Text weight="semibold" size={200} style={{ display: "block", marginBottom: "6px" }}>Highlights</Text>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "16px", height: "16px", background: "var(--colorBrandBackground, #0078d4)", border: "2px solid var(--colorBrandBackground, #0078d4)", borderRadius: "3px" }} />
              <Text size={100}>Selected</Text>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "16px", height: "16px", background: "var(--colorPaletteRedBackground2, #fde7e9)", border: "2px solid var(--colorPaletteRedBorderActive, #d13438)", borderRadius: "3px" }} />
              <Text size={100}>Upstream</Text>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "16px", height: "16px", background: "var(--colorPaletteGreenBackground2, #e6f4ea)", border: "2px solid var(--colorPaletteGreenBorderActive, #2d7d32)", borderRadius: "3px" }} />
              <Text size={100}>Downstream</Text>
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function LineageGraphInner({
  nodes: lvNodes,
  edges: lvEdges,
  isLoading,
  focusNodeId,
  depthByNodeId,
  highlightedNodeIds,
  highlightedEdgeIds,
  expandedGroups: externalExpandedGroups,
  onToggleGroup: externalOnToggleGroup,
  onNodeClick,
}: LineageGraphViewProps) {
  const expandedGroups = useMemo(() => externalExpandedGroups ?? new Set<string>(), [externalExpandedGroups]);
  const useTableColors = true;
  const [focusZoom, setFocusZoom] = useState(1.0); // Standard zoom level for better visibility
  const { getNode, setCenter } = useReactFlow();
  
  // Track previous focusNodeId to only center when it actually changes
  const prevFocusNodeIdRef = useRef<string | undefined>(undefined);
  // Track drag state to prevent auto-centering during drag operations
  const isDraggingRef = useRef(false);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [criticalPathMode, setCriticalPathMode] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  
  const effectiveHighlightedNodeIds = useMemo(() => highlightedNodeIds ?? new Set<string>(), [highlightedNodeIds]);
  const effectiveHighlightedEdgeIds = useMemo(() => highlightedEdgeIds ?? new Set<string>(), [highlightedEdgeIds]);
  
  // Calculate network metrics (replaces simple centrality)
  const networkMetrics = useMemo(() => 
    calculateNetworkMetrics(lvNodes, lvEdges, depthByNodeId), 
    [lvNodes, lvEdges, depthByNodeId]
  );
  
  // Find critical path nodes if mode is active
  const criticalPathNodes = useMemo(() => {
    if (criticalPathMode.start && criticalPathMode.end) {
      return findCriticalPath(criticalPathMode.start, criticalPathMode.end, lvEdges);
    }
    return new Set<string>();
  }, [criticalPathMode, lvEdges]);
  


  const handleToggleGroup = useCallback((groupId: string) => {
    externalOnToggleGroup?.(groupId);
  }, [externalOnToggleGroup]);
  
  // Context menu handlers
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);
  
  const handleContextMenuAction = useCallback((action: string, nodeId: string) => {
    switch (action) {
      case "focus":
        onNodeClick?.(nodeId);
        break;
      case "trace-start":
        setCriticalPathMode({ start: nodeId, end: null });
        break;
      case "trace-end":
        if (criticalPathMode.start) {
          setCriticalPathMode({ start: criticalPathMode.start, end: nodeId });
        }
        break;
      case "clear-trace":
        setCriticalPathMode({ start: null, end: null });
        break;
    }
    setContextMenu(null);
  }, [onNodeClick, criticalPathMode]);
  
  // Export to PNG
  const handleExportPNG = useCallback(async () => {
    if (!reactFlowWrapper.current) return;
    try {
      const dataUrl = await toPng(reactFlowWrapper.current, {
        backgroundColor: "#ffffff",
        filter: (node) => {
          // Exclude controls and minimap from export
          return !node.classList?.contains('react-flow__controls') && 
                 !node.classList?.contains('react-flow__minimap');
        },
      });
      const link = document.createElement("a");
      link.download = `lineage-graph-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to export PNG:", err);
    }
  }, []);

  const layout = useMemo(
    () => buildLayout(lvNodes, lvEdges, focusNodeId, depthByNodeId, effectiveHighlightedNodeIds, effectiveHighlightedEdgeIds, expandedGroups, handleToggleGroup, useTableColors, networkMetrics, criticalPathNodes),
    [lvNodes, lvEdges, focusNodeId, depthByNodeId, effectiveHighlightedNodeIds, effectiveHighlightedEdgeIds, expandedGroups, handleToggleGroup, useTableColors, networkMetrics, criticalPathNodes]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  useEffect(() => {
    const { nodes: n, edges: e } = buildLayout(lvNodes, lvEdges, focusNodeId, depthByNodeId, effectiveHighlightedNodeIds, effectiveHighlightedEdgeIds, expandedGroups, handleToggleGroup, useTableColors, networkMetrics, criticalPathNodes);
    setNodes(n);
    setEdges(e);
  }, [lvNodes, lvEdges, focusNodeId, depthByNodeId, effectiveHighlightedNodeIds, effectiveHighlightedEdgeIds, expandedGroups, handleToggleGroup, setNodes, setEdges, useTableColors, networkMetrics, criticalPathNodes]);

  // Center view on selected node
  // UI Change: Focus node centering with standard LR layout (upstream left, downstream right)
  // MCP Verification: fabricux MCP verified as running on 2026-05-28
  // Guidance: Dragging Movements (2.5.7) - user should be able to freely pan canvas without interference
  useEffect(() => {
    // Only center if focusNodeId has actually changed AND not currently dragging
    if (focusNodeId && focusNodeId !== prevFocusNodeIdRef.current && !isDraggingRef.current) {
      // Use double requestAnimationFrame to ensure ReactFlow has finished rendering
      // First RAF: React has committed the DOM changes
      // Second RAF: Browser has painted and ReactFlow has measured nodes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (isDraggingRef.current) return;

          const selectedNode = getNode(focusNodeId);
          if (!selectedNode?.position) {
            console.warn('[LineageGraphView] Node not found:', focusNodeId);
            return;
          }

          // Use node dimensions, fallback to defaults if not yet measured
          const width = selectedNode.measured?.width ?? selectedNode.width ?? 200;
          const height = selectedNode.measured?.height ?? selectedNode.height ?? 80;

          // Calculate the center point of the selected node
          const centerX = selectedNode.position.x + width / 2;
          const centerY = selectedNode.position.y + height / 2;

          console.log('[LineageGraphView] Centering on node:', {
            nodeId: focusNodeId,
            nodeName: (selectedNode.data as LineageNodeData)?.label,
            position: selectedNode.position,
            size: { width, height },
            centerPoint: { x: centerX, y: centerY },
            zoom: focusZoom
          });

          // Center the viewport on the selected node
          setCenter(centerX, centerY, { zoom: focusZoom, duration: 400 });
        });
      });
      
      // Update the ref to track current focusNodeId
      prevFocusNodeIdRef.current = focusNodeId;
    } 
    
    if (!focusNodeId) {
      // Clear ref when focus is removed
      prevFocusNodeIdRef.current = undefined;
    }
  }, [focusNodeId, getNode, setCenter, focusZoom]);

  const handleNodeClick = useCallback(
    (_evt: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick]
  );

  // Track drag state to prevent auto-centering interference
  const handleNodeDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleNodeDragStop = useCallback(() => {
    // Small delay to ensure drag has fully completed
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 100);
  }, []);

  // Only show empty state when not loading
  if (lvNodes.length === 0 && !isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--colorNeutralForeground3, #757575)",
          fontFamily: "var(--fontFamilyBase, 'Segoe UI', sans-serif)",
          fontSize: 14,
        }}
      >
        No nodes to display. Select a root object and adjust filters.
      </div>
    );
  }

  return (
    <div ref={reactFlowWrapper} style={{ width: "100%", height: "100%", position: "relative" }}>
      {isLoading && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 1000,
          background: tokens.colorNeutralBackground1,
          padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
          borderRadius: tokens.borderRadiusLarge,
          boxShadow: tokens.shadow16,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: tokens.spacingVerticalL,
        }}>
          <Spinner size="large" />
          <Text size={400} weight="semibold">
            Loading lineage graph...
          </Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, maxWidth: "300px", textAlign: "center" }}>
            Fetching semantic models, tables, columns, measures, and relationships from the lakehouse.
          </Text>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.01 }}
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        style={{ background: "var(--colorNeutralBackground2, #fafafa)" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="var(--colorNeutralStroke2, #e0e0e0)"
          gap={18}
          size={1}
        />
        <Controls
          style={{
            background: "var(--colorNeutralBackground1, #fff)",
            border: "1px solid var(--colorNeutralStroke2, #e0e0e0)",
            borderRadius: "var(--borderRadiusMedium, 6px)",
          }}
        />
        <MiniMap
          nodeColor={(node) => {
            const d = node.data as LineageNodeData;
            if (d.isFocus) return "var(--colorBrandBackground, #0078d4)";
            if (d.isDirectUpstream && d.isDirectDownstream) return "var(--colorPaletteDarkOrangeBorderActive, #b75d00)";
            if (d.isDirectUpstream) return "var(--colorPaletteRedBorderActive, #d13438)";
            if (d.isDirectDownstream) return "var(--colorPaletteGreenBorderActive, #2d7d32)";
            if (d.isRelated) return "var(--colorPaletteLavenderBorderActive, #6b4eff)";
            if (d.useTableColors && d.tableName) return getTableColor(d.tableName).border;
            return palette(d.entityType).border;
          }}
          maskColor="rgba(255,255,255,0.55)"
          style={{
            background: "var(--colorNeutralBackground1, #fff)",
            border: "1px solid var(--colorNeutralStroke2, #e0e0e0)",
            borderRadius: "var(--borderRadiusMedium, 6px)",
          }}
        />
        
        {/* Focus Zoom Panel - positioned next to zoom controls */}
        <Panel position="bottom-left" style={{ margin: 10, marginLeft: 100 }}>
          <div
            style={{
              background: "var(--colorNeutralBackground1, #fff)",
              padding: "12px",
              borderRadius: "var(--borderRadiusMedium, 6px)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              minWidth: "220px",
            }}
          >
            <Label size="small" weight="semibold" style={{ display: "block", marginBottom: "8px" }}>
              Focus Zoom Level
            </Label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Slider
                min={0.3}
                max={2.0}
                step={0.1}
                value={focusZoom}
                onChange={(_, data) => setFocusZoom(data.value)}
                style={{ flex: 1 }}
              />
              <Text size={200} style={{ minWidth: "35px", color: tokens.colorNeutralForeground2 }}>
                {focusZoom.toFixed(1)}x
              </Text>
            </div>
          </div>
        </Panel>
        
        {/* Export and Trace Panel */}
        <Panel position="top-left" style={{ margin: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--colorNeutralBackground1, #fff)", padding: 8, borderRadius: "var(--borderRadiusMedium, 6px)", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
            <Button
              icon={<SaveRegular />}
              onClick={handleExportPNG}
              title="Export to PNG"
              size="small"
            />
            {criticalPathMode.start && (
              <Button
                icon={<TargetArrowRegular />}
                onClick={() => setCriticalPathMode({ start: null, end: null })}
                title="Clear trace"
                size="small"
                appearance="subtle"
              >
                {criticalPathMode.end ? "Clear" : "Select end node"}
              </Button>
            )}
          </div>
        </Panel>
        
        <GraphLegend />
      </ReactFlow>
      
      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 1000,
            background: "var(--colorNeutralBackground1, #fff)",
            border: "1px solid var(--colorNeutralStroke2, #e0e0e0)",
            borderRadius: "var(--borderRadiusMedium, 6px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            minWidth: 180,
          }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <div style={{ padding: 4 }}>
            <button
              onClick={() => handleContextMenuAction("focus", contextMenu.nodeId)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 13,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--colorNeutralBackground2, #fafafa)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "none"}
            >
              Focus on this node
            </button>
            <button
              onClick={() => handleContextMenuAction("trace-start", contextMenu.nodeId)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 13,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--colorNeutralBackground2, #fafafa)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "none"}
            >
              Trace from here...
            </button>
            {criticalPathMode.start && (
              <button
                onClick={() => handleContextMenuAction("trace-end", contextMenu.nodeId)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: 13,
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--colorNeutralBackground2, #fafafa)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
              >
                ...to here
              </button>
            )}
            {criticalPathMode.start && (
              <button
                onClick={() => handleContextMenuAction("clear-trace", contextMenu.nodeId)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  borderTop: "1px solid var(--colorNeutralStroke2, #e0e0e0)",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--colorNeutralBackground2, #fafafa)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
              >
                Clear trace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ÔöÇÔöÇÔöÇ Public export (wraps with provider) ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

export function LineageGraphView(props: LineageGraphViewProps) {
  return (
    <ReactFlowProvider>
      <LineageGraphInner {...props} />
    </ReactFlowProvider>
  );
}
