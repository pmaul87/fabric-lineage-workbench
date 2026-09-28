
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Text, makeStyles, tokens, RadioGroup, Radio } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { getEntityTypeLabel } from "./lineageContracts";

const useStyles = makeStyles({
  root: {
    padding: tokens.spacingVerticalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    height: "100%",
    overflow: "auto",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
  },
  groupingToggle: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalXS,
    paddingLeft: tokens.spacingHorizontalM,
  },
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorNeutralBackground3,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    position: "sticky",
    top: "36px",
    zIndex: 1,
    cursor: "pointer",
  },
  groupHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
  },
  groupHeaderRight: {
    display: "flex",
    alignItems: "center",
  },
  groupTypeBadge: {
    marginRight: tokens.spacingHorizontalXS,
    textTransform: "uppercase",
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase100,
    letterSpacing: "0.04em",
  },
  groupLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: "none",
    letterSpacing: "0.04em",
  },
  headerCell: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: "uppercase",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    alignItems: "center",
    cursor: "pointer",
    transition: "background-color 0.2s",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  selectedRow: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  nameCell: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    minWidth: 0,
  },
  nodeName: {
    fontWeight: tokens.fontWeightSemibold,
    wordBreak: "break-word",
  },
  empty: {
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground2,
  },
});

interface LineageTableViewProps {
  nodes: Array<{
    nodeId: string;
    displayName: string;
    entityType: string;
    parentNodeId?: string;
    reportId?: string;
    datasetId?: string;
    modelName?: string;
    objectName?: string;
  }>;
  edges: Array<{ fromNodeId: string; toNodeId: string }>;
  selectedNodeId?: string;
  onNodeSelect?: (nodeId: string) => void;
}

export function LineageTableView({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
}: LineageTableViewProps) {
  // Grouping mode: "parent" (default) or "type"
  const [groupingMode, setGroupingMode] = useState<"parent" | "type">("parent");
  const { t } = useTranslation();
  const styles = useStyles();

  const degreeByNode = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of edges) {
      const from = edge.fromNodeId || "";
      const to = edge.toNodeId || "";
      if (from) {
        map.set(from, (map.get(from) ?? 0) + 1);
      }
      if (to) {
        map.set(to, (map.get(to) ?? 0) + 1);
      }
    }
    return map;
  }, [edges]);

  const groupedNodes = useMemo(() => {
    interface GroupedItem {
      nodeId: string;
      displayName: string;
      entityType: string;
      parentNodeId?: string;
      depth?: number;
      reportId?: string;
      datasetId?: string;
      modelName?: string;
      objectName?: string;
    }

    if (groupingMode === "type") {
      const typeMap = new Map<string, GroupedItem[]>();
      for (const node of nodes) {
        if (!typeMap.has(node.entityType)) typeMap.set(node.entityType, []);
        typeMap.get(node.entityType)!.push(node);
      }
      return Array.from(typeMap.entries()).map(([type, items]) => ({
        groupType: type,
        groupId: type,
        groupDisplayName: getEntityTypeLabel(type),
        nodes: items.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      }));
    }

    const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
    const childrenByParentId = new Map<string, GroupedItem[]>();

    for (const node of nodes) {
      if (!node.parentNodeId) {
        continue;
      }
      if (!childrenByParentId.has(node.parentNodeId)) {
        childrenByParentId.set(node.parentNodeId, []);
      }
      childrenByParentId.get(node.parentNodeId)!.push(node);
    }

    const roots = nodes.filter((node) => !node.parentNodeId || !nodeById.has(node.parentNodeId));
    const typePriority = new Map<string, number>([
      ["report", 0],
      ["semantic_model", 1],
      ["page", 2],
      ["table", 3],
    ]);
    roots.sort((a, b) => {
      const pA = typePriority.get(a.entityType) ?? 9;
      const pB = typePriority.get(b.entityType) ?? 9;
      if (pA !== pB) return pA - pB;
      return a.displayName.localeCompare(b.displayName);
    });

    const flattenHierarchy = (rootNode: GroupedItem): GroupedItem[] => {
      const output: GroupedItem[] = [];
      const walk = (current: GroupedItem, depth: number): void => {
        output.push({ ...current, depth });
        const children = [...(childrenByParentId.get(current.nodeId) ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName));
        for (const child of children) {
          walk(child, depth + 1);
        }
      };
      walk(rootNode, 0);
      return output;
    };

    return roots.map((rootNode) => ({
      groupType: rootNode.entityType,
      groupId: rootNode.nodeId,
      groupDisplayName: rootNode.displayName,
      nodes: flattenHierarchy(rootNode),
    }));
  }, [nodes, groupingMode]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(groupedNodes.map((group) => group.groupId))
  );
  
  const [collapsedSecondLevelNodes, setCollapsedSecondLevelNodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCollapsedGroups(new Set(groupedNodes.map((group) => group.groupId)));
    
    // Initialize second-level nodes as collapsed by default
    const parentNodes = new Set<string>();
    for (const group of groupedNodes) {
      for (let idx = 0; idx < group.nodes.length; idx++) {
        const node = group.nodes[idx];
        const nextNode = group.nodes[idx + 1];
        const indentDepth = node.depth ?? 0;
        const hasChildren = nextNode && (nextNode.depth ?? 0) > indentDepth;
        if (hasChildren) {
          parentNodes.add(node.nodeId);
        }
      }
    }
    setCollapsedSecondLevelNodes(parentNodes);
  }, [groupedNodes]);

  const toggleGroup = (groupId: string) => {
    console.log('[TableView] toggleGroup called for:', groupId);
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) {
        console.log('[TableView] Expanding group:', groupId);
        next.delete(groupId);
        
        // When expanding a group, also expand its immediate children (depth 1 nodes)
        // so the user can see something
        const group = groupedNodes.find(g => g.groupId === groupId);
        if (group && groupingMode === "parent") {
          setCollapsedSecondLevelNodes(prev => {
            const updated = new Set(prev);
            // Find and expand depth 0 (parent) and depth 1 nodes (immediate children)
            for (const node of group.nodes) {
              const depth = node.depth ?? 0;
              if (depth === 0 || depth === 1) {
                updated.delete(node.nodeId);
              }
            }
            return updated;
          });
        }
      } else {
        console.log('[TableView] Collapsing group:', groupId);
        next.add(groupId);
      }
      return next;
    });
  };
  
  const toggleSecondLevelNode = (nodeId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCollapsedSecondLevelNodes((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  if (nodes.length === 0) {
    return (
      <div className={styles.empty}>
        <Text>{t("LineageWorkbench_Table_Empty", "No nodes to display")}</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.groupingToggle}>
        <RadioGroup
          layout="horizontal"
          value={groupingMode}
          onChange={(_, data) => setGroupingMode(data.value as "parent" | "type")}
        >
          <Radio value="parent" label={t("LineageWorkbench_GroupByParent", "Group by Parent")} />
          <Radio value="type" label={t("LineageWorkbench_GroupByType", "Group by Type")} />
        </RadioGroup>
      </div>
      <div className={styles.tableHeader}>
        <Text className={styles.headerCell}>{t("LineageWorkbench_Lineage_Column_Name", "Node")}</Text>
        <Text className={styles.headerCell}>{t("LineageWorkbench_Lineage_Column_Type", "Type")}</Text>
        <Text className={styles.headerCell}>{t("LineageWorkbench_Lineage_Column_Connections", "Connections")}</Text>
      </div>
      {groupedNodes.map((group) => (
        <React.Fragment key={group.groupId}>
          <div
            className={styles.groupHeader}
            onClick={() => {
              // Click header to select the parent node
              onNodeSelect?.(group.groupId);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleGroup(group.groupId);
              }
            }}
            role="button"
            tabIndex={0}
            aria-expanded={!collapsedGroups.has(group.groupId)}
          >
            <div className={styles.groupHeaderLeft}>
              <button
                onClick={(event) => {
                  console.log('[TableView] Chevron button clicked for group:', group.groupId);
                  event.stopPropagation();
                  toggleGroup(group.groupId);
                }}
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  cursor: "pointer",
                  background: "none",
                  border: "none",
                  padding: "4px",
                  margin: 0,
                  minWidth: "20px",
                  minHeight: "20px",
                }}
                type="button"
                aria-label={collapsedGroups.has(group.groupId) ? "Expand group" : "Collapse group"}
              >
                {collapsedGroups.has(group.groupId) ? (
                  <ChevronRightRegular fontSize={14} />
                ) : (
                  <ChevronDownRegular fontSize={14} />
                )}
              </button>
              {/* Group type badge */}
              <Badge className={styles.groupTypeBadge} appearance="outline" size="small">
                {group.groupType === "report"
                  ? t("LineageWorkbench_GroupType_Report", "Report")
                  : group.groupType === "semantic_model"
                  ? t("LineageWorkbench_GroupType_SemanticModel", "Semantic Model")
                  : group.groupType === "orphan"
                  ? t("LineageWorkbench_GroupType_Other", "Other")
                  : group.groupType.charAt(0).toUpperCase() + group.groupType.slice(1).replace(/_/g, " ")}
              </Badge>
              <Text className={styles.groupLabel}>{group.groupDisplayName}</Text>
            </div>
            <div className={styles.groupHeaderRight}>
              <Badge appearance="tint" size="small">{group.nodes.length}</Badge>
            </div>
          </div>
          {!collapsedGroups.has(group.groupId) && group.nodes.map((node, idx) => {
            const isParentNode = idx === 0;
            const indentDepth = node.depth ?? 0;
            
            // Debug logging for first expansion
            if (idx === 0) {
              console.log('[TableView] Rendering nodes for expanded group:', {
                groupId: group.groupId,
                groupDisplayName: group.groupDisplayName,
                groupingMode,
                totalNodes: group.nodes.length,
                firstNodeIsParent: isParentNode,
                willSkipFirstNode: isParentNode && groupingMode === "parent" && group.nodes.length > 1,
                nodesSample: group.nodes.slice(0, 3).map(n => ({
                  nodeId: n.nodeId,
                  displayName: n.displayName,
                  depth: n.depth,
                })),
              });
            }
            
            // Skip the first node (parent) in hierarchical mode since it's shown in the header
            // UNLESS it's the only node in the group (no children)
            if (isParentNode && groupingMode === "parent" && group.nodes.length > 1) {
              console.log('[TableView] Skipping parent node (shown in header):', node.nodeId);
              return null;
            }
            
            console.log('[TableView] After skip checks for node:', {
              idx,
              nodeId: node.nodeId,
              displayName: node.displayName,
              depth: indentDepth,
              willCheckParentCollapse: indentDepth > 0,
            });
            
            // Determine if this node has children (next node has greater depth)
            const nextNode = group.nodes[idx + 1];
            const hasChildren = nextNode && (nextNode.depth ?? 0) > indentDepth;
            const isCollapsed = collapsedSecondLevelNodes.has(node.nodeId);
            
            console.log('[TableView] Node collapse state:', {
              nodeId: node.nodeId,
              displayName: node.displayName,
              depth: indentDepth,
              hasChildren,
              isCollapsed,
              isInCollapsedSet: collapsedSecondLevelNodes.has(node.nodeId),
            });
            
            // Skip rendering if this node's parent is collapsed
            if (indentDepth > 0) {
              // Find the parent by looking backwards for a node with depth = indentDepth - 1
              for (let i = idx - 1; i >= 0; i--) {
                const potentialParent = group.nodes[i];
                const parentDepth = potentialParent.depth ?? 0;
                if (parentDepth === indentDepth - 1) {
                  // This is the direct parent
                  const parentCollapsed = collapsedSecondLevelNodes.has(potentialParent.nodeId);
                  if (parentCollapsed) {
                    console.log('[TableView] Skipping node due to collapsed parent:', {
                      nodeId: node.nodeId,
                      nodeDisplayName: node.displayName,
                      nodeDepth: indentDepth,
                      parentNodeId: potentialParent.nodeId,
                      parentDisplayName: potentialParent.displayName,
                      parentDepth,
                    });
                    return null; // Skip rendering this node
                  }
                  break;
                } else if (parentDepth < indentDepth - 1) {
                  // We've gone too far back, no direct parent found
                  break;
                }
              }
            }
            
            console.log('[TableView] Rendering node:', {
              idx,
              nodeId: node.nodeId,
              displayName: node.displayName,
              depth: indentDepth,
              hasChildren,
            });

            return (
              <div
                key={node.nodeId}
                className={`${styles.row} ${selectedNodeId && node.nodeId === selectedNodeId ? styles.selectedRow : ""}`}
                onClick={() => onNodeSelect?.(node.nodeId)}
                style={indentDepth > 0 ? { paddingLeft: `calc(${tokens.spacingHorizontalM} + ${indentDepth * 20}px)` } : undefined}
              >
                <div className={styles.nameCell}>
                  <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXXS }}>
                    {hasChildren && (
                      <span
                        onClick={(e) => toggleSecondLevelNode(node.nodeId, e)}
                        style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
                      >
                        {isCollapsed ? (
                          <ChevronRightRegular fontSize={14} />
                        ) : (
                          <ChevronDownRegular fontSize={14} />
                        )}
                      </span>
                    )}
                    {!hasChildren && <span style={{ width: "14px" }} />}
                    <Text className={styles.nodeName}>{node.displayName}</Text>
                  </div>
                </div>
                <Badge appearance="outline" color={isParentNode ? "important" : "informative"}>
                  {node.entityType}
                </Badge>
                <Text>{degreeByNode.get(node.nodeId) ?? 0}</Text>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}
