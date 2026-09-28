import type { LineageViewerEdge, LineageViewerNode } from "./LineageGraphView";

export interface GraphProjectionResult {
  graphNodes: LineageViewerNode[];
  graphEdges: LineageViewerEdge[];
  hiddenNodeCount: number;
  hiddenEdgeCount: number;
  requiresSelection: boolean;
  focusWarning?: string;
}

export function filterNodes(
  nodes: LineageViewerNode[],
  searchText: string,
  entityFilter: string
): LineageViewerNode[] {
  const search = searchText.trim().toLowerCase();
  return nodes.filter((node) => {
    if (entityFilter !== "all" && node.entityType !== entityFilter) return false;
    if (!search) return true;
    return `${node.displayName} ${node.nodeId} ${node.entityType}`.toLowerCase().includes(search);
  });
}

export function filterEdgesByNodes(
  edges: LineageViewerEdge[],
  filteredNodes: LineageViewerNode[]
): LineageViewerEdge[] {
  const ids = new Set(filteredNodes.map((n) => n.nodeId));
  return edges.filter((e) => ids.has(e.fromNodeId) && ids.has(e.toNodeId));
}

interface ProjectionInput {
  filteredNodes: LineageViewerNode[];
  filteredEdges: LineageViewerEdge[];
  allNodes: LineageViewerNode[];
  allEdges: LineageViewerEdge[];
  selectedNodeId: string;
  graphScope: "focused" | "full";
  graphDisplayMode: "highlight" | "filter";
  graphNodeLimit: number;
  showHierarchyEdges?: boolean;
}

export function buildGraphProjection(input: ProjectionInput): GraphProjectionResult {
  const {
    filteredNodes,
    filteredEdges,
    allNodes,
    allEdges,
    selectedNodeId,
    graphScope,
    graphDisplayMode,
    graphNodeLimit,
    showHierarchyEdges = true,
  } = input;

  if (filteredNodes.length === 0) {
    return {
      graphNodes: [],
      graphEdges: [],
      hiddenNodeCount: 0,
      hiddenEdgeCount: 0,
      requiresSelection: false,
    };
  }

  if (graphScope === "full") {
    const limitedNodes = [...filteredNodes]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, graphNodeLimit);

    const limitedNodeIds = new Set(limitedNodes.map((n) => n.nodeId));
    const parentIds = new Set<string>();
    for (const node of limitedNodes) {
      if (node.parentNodeId && !limitedNodeIds.has(node.parentNodeId)) {
        parentIds.add(node.parentNodeId);
      }
    }

    for (const parentId of parentIds) {
      const parentNode = allNodes.find((n) => n.nodeId === parentId);
      if (parentNode) {
        limitedNodes.push(parentNode);
        limitedNodeIds.add(parentId);
      }
    }

    const limitedEdges = filteredEdges.filter((e) => limitedNodeIds.has(e.fromNodeId) && limitedNodeIds.has(e.toNodeId));

    return {
      graphNodes: limitedNodes,
      graphEdges: limitedEdges,
      hiddenNodeCount: Math.max(0, filteredNodes.length - limitedNodes.length),
      hiddenEdgeCount: Math.max(0, filteredEdges.length - limitedEdges.length),
      requiresSelection: false,
    };
  }

  const selectedInFilter = selectedNodeId && filteredNodes.some((n) => n.nodeId === selectedNodeId);
  if (!selectedInFilter) {
    return {
      graphNodes: [],
      graphEdges: [],
      hiddenNodeCount: filteredNodes.length,
      hiddenEdgeCount: filteredEdges.length,
      requiresSelection: true,
    };
  }

  const upstreamMap = new Map<string, string[]>();
  const downstreamMap = new Map<string, string[]>();
  for (const edge of allEdges) {
    if (!upstreamMap.has(edge.toNodeId)) upstreamMap.set(edge.toNodeId, []);
    upstreamMap.get(edge.toNodeId)!.push(edge.fromNodeId);

    if (!downstreamMap.has(edge.fromNodeId)) downstreamMap.set(edge.fromNodeId, []);
    downstreamMap.get(edge.fromNodeId)!.push(edge.toNodeId);
  }

  const maxDepth = graphDisplayMode === "filter" ? 5 : Infinity;
  const visited = new Set<string>([selectedNodeId]);
  const depthMap = new Map<string, number>([[selectedNodeId, 0]]);

  const upstreamQueue: string[] = [selectedNodeId];
  while (upstreamQueue.length > 0 && visited.size < graphNodeLimit) {
    const current = upstreamQueue.shift()!;
    const currentDepth = depthMap.get(current) || 0;
    if (currentDepth >= maxDepth) continue;

    const upstreamNeighbors = upstreamMap.get(current) ?? [];
    for (const neighbor of upstreamNeighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      depthMap.set(neighbor, currentDepth + 1);
      upstreamQueue.push(neighbor);
      if (visited.size >= graphNodeLimit) break;
    }
  }

  const downstreamQueue: string[] = [selectedNodeId];
  while (downstreamQueue.length > 0 && visited.size < graphNodeLimit) {
    const current = downstreamQueue.shift()!;
    const currentDepth = depthMap.get(current) || 0;
    if (currentDepth >= maxDepth) continue;

    const downstreamNeighbors = downstreamMap.get(current) ?? [];
    for (const neighbor of downstreamNeighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      depthMap.set(neighbor, currentDepth + 1);
      downstreamQueue.push(neighbor);
      if (visited.size >= graphNodeLimit) break;
    }
  }

  const focusedNodes = allNodes.filter((n) => visited.has(n.nodeId));
  const nodeMap = new Map(allNodes.map((n) => [n.nodeId, n]));
  const parentsToAdd = new Set<string>();
  for (const node of focusedNodes) {
    if (node.parentNodeId && nodeMap.has(node.parentNodeId) && !visited.has(node.parentNodeId)) {
      parentsToAdd.add(node.parentNodeId);
    }
  }
  for (const parentId of parentsToAdd) {
    visited.add(parentId);
    const parentNode = nodeMap.get(parentId);
    if (parentNode) {
      focusedNodes.push(parentNode);
    }
  }

  const focusedEdges = allEdges.filter((e) => visited.has(e.fromNodeId) && visited.has(e.toNodeId));

  // Add synthetic parent-child hierarchy edges for hierarchical relationships
  const syntheticEdges: LineageViewerEdge[] = [];
  if (showHierarchyEdges) {
    for (const node of focusedNodes) {
      if (node.parentNodeId && visited.has(node.parentNodeId)) {
        // Create edge from parent to child
        syntheticEdges.push({
          edgeId: `hierarchy_${node.parentNodeId}_${node.nodeId}`,
          fromNodeId: node.parentNodeId,
          toNodeId: node.nodeId,
          edgeType: "hierarchy", // Distinct type for styling
        });
      }
    }
  }

  // Combine lineage edges with synthetic hierarchy edges
  const allGraphEdges = [...focusedEdges, ...syntheticEdges];

  console.log("[buildGraphProjection] Added hierarchy edges:", {
    focusedNodes: focusedNodes.length,
    lineageEdges: focusedEdges.length,
    hierarchyEdges: syntheticEdges.length,
    totalGraphEdges: allGraphEdges.length,
  });

  // Harden focused mode for demo scenarios: keep the selected node visible even if disconnected.
  if (focusedNodes.length === 0 && selectedNodeId) {
    const selectedNode = allNodes.find((n) => n.nodeId === selectedNodeId);
    if (selectedNode) {
      return {
        graphNodes: [selectedNode],
        graphEdges: [],
        hiddenNodeCount: Math.max(0, allNodes.length - 1),
        hiddenEdgeCount: allEdges.length,
        requiresSelection: false,
        focusWarning: "Selected node has no connected lineage edges in current data.",
      };
    }
  }

  const focusWarning = allGraphEdges.length === 0
    ? "Selected node is isolated (no lineage edges available)."
    : undefined;

  return {
    graphNodes: focusedNodes,
    graphEdges: allGraphEdges,
    hiddenNodeCount: Math.max(0, allNodes.length - focusedNodes.length),
    hiddenEdgeCount: Math.max(0, allEdges.length - focusedEdges.length),
    requiresSelection: false,
    focusWarning,
  };
}
