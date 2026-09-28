import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { WorkloadClientAPI } from "@ms-fabric/workload-client";
import { ItemClient } from "../../clients/ItemClient";
import { FabricPlatformError } from "../../clients/FabricPlatformClient";
import { OneLakeLineageStorage } from "../../clients/lineage/OneLakeLineageStorage";
import { resolveEdgeFields, resolveNodeFields } from "./lineageContracts";

const useStyles = makeStyles({
  surface: {
    width: "min(94vw, 1120px)",
    maxWidth: "1120px",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    width: "100%",
    minHeight: "560px",
    boxSizing: "border-box",
  },
  controlsRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 240px",
    gap: tokens.spacingHorizontalM,
    alignItems: "end",
  },
  actionsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalXS} 0`,
  },
  selectionActions: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
  artifactList: {
    display: "flex",
    flexDirection: "column",
    maxHeight: "420px",
    overflowY: "auto",
    overflowX: "auto",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    width: "100%",
  },
  listHeader: {
    display: "grid",
    gridTemplateColumns: "44px minmax(280px, 2fr) 180px minmax(220px, 1fr)",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  artifactItem: {
    display: "grid",
    gridTemplateColumns: "44px minmax(280px, 2fr) 180px minmax(220px, 1fr)",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    "&[data-selected='true']": {
      backgroundColor: tokens.colorBrandBackground2,
    },
  },
  artifactInfo: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    flex: 1,
  },
  artifactName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  artifactMeta: {
    color: tokens.colorNeutralForeground3,
  },
  emptyState: {
    padding: tokens.spacingVerticalXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

interface SelectableArtifact {
  id: string;
  displayName: string;
  type: string;
  workspaceId: string;
}

export interface ArtifactSelectionResult {
  selectedArtifactIds: string[];
  selectedArtifactLabels: string[];
  artifactSelector: Record<string, string[]>;
}

interface Props {
  workloadClient: WorkloadClientAPI;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (result: ArtifactSelectionResult) => void;
  workspaceIds: string[];
  selectedArtifactIds?: string[];
}

const ALLOWED_ITEM_TYPES = new Set(["Report", "SemanticModel", "Warehouse", "Lakehouse", "Notebook"]);

const RELATED_TOKEN_STOPWORDS = new Set([
  "report",
  "semantic",
  "semanticmodel",
  "model",
  "warehouse",
  "lakehouse",
  "notebook",
  "dataset",
  "data",
  "sample",
]);

const extractMeaningfulTokens = (value: string): Set<string> => {
  const tokens = (value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !RELATED_TOKEN_STOPWORDS.has(token));
  return new Set(tokens);
};

const countTokenOverlap = (left: Set<string>, right: Set<string>): number => {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
};

const normalizeTypeForSelector = (type: string): string => {
  const normalized = (type || "").trim().toLowerCase();
  if (normalized === "semanticmodel") {
    return "semanticmodel";
  }
  if (normalized === "report") {
    return "report";
  }
  if (normalized === "warehouse") {
    return "warehouse";
  }
  if (normalized === "lakehouse") {
    return "lakehouse";
  }
  if (normalized === "notebook") {
    return "notebook";
  }
  return normalized;
};

export function LineageArtifactSelectionWizard(props: Props) {
  // UI Change: Artifact picker restyled to Fabric-like dense selectable list.
  // MCP Verification: fabricux MCP verified as running on 2026-07-22.
  // Guidance: Fabric UX listbox + checkbox patterns (search/filter + multi-select list behavior).
  const {
    workloadClient,
    isOpen,
    onClose,
    onComplete,
    workspaceIds,
    selectedArtifactIds = [],
  } = props;
  const styles = useStyles();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<SelectableArtifact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(selectedArtifactIds));
  const [searchText, setSearchText] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [isSelectingRelated, setIsSelectingRelated] = useState(false);
  const [relatedSelectionMessage, setRelatedSelectionMessage] = useState<string | null>(null);

  const workspaceIdSet = useMemo(() => new Set(workspaceIds), [workspaceIds]);
  const workspaceScopeKey = useMemo(() => workspaceIds.slice().sort().join("|"), [workspaceIds]);

  const loadArtifacts = useCallback(async () => {
    if (!workspaceIds || workspaceIds.length === 0) {
      setArtifacts([]);
      setError("Select at least one workspace first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const itemClient = new ItemClient(workloadClient);
      const types = ["Report", "SemanticModel", "Warehouse", "Lakehouse", "Notebook"];
      const all: SelectableArtifact[] = [];

      for (const workspaceId of workspaceIds) {
        for (const type of types) {
          const response = await itemClient.listItems(workspaceId, { type });
          for (const item of response.value || []) {
            if (!ALLOWED_ITEM_TYPES.has(item.type)) {
              continue;
            }

            all.push({
              id: item.id,
              displayName: item.displayName || item.id,
              type: item.type,
              workspaceId,
            });
          }
        }
      }

      all.sort((a, b) => {
        if (a.workspaceId !== b.workspaceId) {
          return a.workspaceId.localeCompare(b.workspaceId);
        }
        if (a.type !== b.type) {
          return a.type.localeCompare(b.type);
        }
        return a.displayName.localeCompare(b.displayName);
      });

      setArtifacts(all);
    } catch (err) {
      if (err instanceof FabricPlatformError) {
        setError(`Failed to load artifacts: ${err.message} (HTTP ${err.statusCode})`);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [workloadClient, workspaceIds]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedIds(new Set(selectedArtifactIds));
  }, [isOpen, selectedArtifactIds]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void loadArtifacts();
  }, [isOpen, loadArtifacts, workspaceScopeKey]);

  const setSelectedState = (artifactId: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (!checked) {
      next.delete(artifactId);
    } else {
      next.add(artifactId);
    }
    setSelectedIds(next);
  };

  const toggleSelected = (artifactId: string) => {
    setSelectedState(artifactId, !selectedIds.has(artifactId));
  };

  const handleArtifactRowClick = (artifactId: string, event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    // Ignore clicks coming from checkbox internals to avoid conflicting toggles.
    if (target?.closest("input, label, button, [role='checkbox']")) {
      return;
    }
    toggleSelected(artifactId);
  };

  const filteredArtifacts = artifacts.filter((artifact) => {
    if (workspaceIdSet.size > 0 && !workspaceIdSet.has(artifact.workspaceId)) {
      return false;
    }

    if (selectedType !== "all" && artifact.type !== selectedType) {
      return false;
    }

    if (!searchText.trim()) {
      return true;
    }

    const query = searchText.trim().toLowerCase();
    return (
      artifact.displayName.toLowerCase().includes(query) ||
      artifact.id.toLowerCase().includes(query) ||
      artifact.workspaceId.toLowerCase().includes(query) ||
      artifact.type.toLowerCase().includes(query)
    );
  });

  const selectedVisibleCount = filteredArtifacts.filter((artifact) => selectedIds.has(artifact.id)).length;

  const handleSelectAllVisible = () => {
    const next = new Set(selectedIds);
    for (const artifact of filteredArtifacts) {
      next.add(artifact.id);
    }
    setSelectedIds(next);
  };

  const handleClearVisible = () => {
    const next = new Set(selectedIds);
    for (const artifact of filteredArtifacts) {
      next.delete(artifact.id);
    }
    setSelectedIds(next);
  };

  const handleClearAll = () => {
    setSelectedIds(new Set<string>());
  };

  const expandRelatedByHeuristic = (currentSelection: Set<string>): Set<string> => {
    const selectedArtifacts = artifacts.filter((artifact) => currentSelection.has(artifact.id));
    if (selectedArtifacts.length === 0) {
      return currentSelection;
    }

    const next = new Set(currentSelection);

    for (const selectedArtifact of selectedArtifacts) {
      const selectedName = (selectedArtifact.displayName || "").toLowerCase().trim();
      const selectedTokens = extractMeaningfulTokens(selectedArtifact.displayName || "");

      for (const candidate of artifacts) {
        if (candidate.workspaceId !== selectedArtifact.workspaceId) {
          continue;
        }

        const candidateName = (candidate.displayName || "").toLowerCase().trim();
        const exactNameMatch = selectedName.length > 0 && candidateName === selectedName;

        const overlap = countTokenOverlap(selectedTokens, extractMeaningfulTokens(candidate.displayName || ""));
        const strongTokenMatch = overlap >= 2;

        if (exactNameMatch || strongTokenMatch) {
          next.add(candidate.id);
        }
      }
    }

    return next;
  };

  const handleSelectAllRelated = async () => {
    if (selectedIds.size === 0) {
      return;
    }

    setIsSelectingRelated(true);
    setRelatedSelectionMessage(null);

    const beforeCount = selectedIds.size;

    try {
      const snapshotWorkspaceId = workspaceIds[0];
      if (snapshotWorkspaceId) {
        const storage = new OneLakeLineageStorage(workloadClient);
        const loadedGraph = await storage.loadLineageGraph(snapshotWorkspaceId);
        const snapshot = loadedGraph?.graphSnapshot ?? loadedGraph;
        const rawNodes: Array<Record<string, unknown>> =
          (Array.isArray(snapshot?.nodes) ? snapshot.nodes : null) ||
          (Array.isArray(snapshot?.v_nodes) ? snapshot.v_nodes : null) ||
          [];
        const rawEdges: Array<Record<string, unknown>> =
          (Array.isArray(snapshot?.edges) ? snapshot.edges : null) ||
          (Array.isArray(snapshot?.v_edges) ? snapshot.v_edges : null) ||
          [];

        if (rawNodes.length > 0 && rawEdges.length > 0) {
          const artifactIdsSet = new Set(artifacts.map((artifact) => artifact.id));
          const adjacency = new Map<string, Set<string>>();
          const availableNodeIds = new Set<string>();

          for (const rawNode of rawNodes) {
            const resolvedNode = resolveNodeFields(rawNode);
            if (!resolvedNode.nodeId) {
              continue;
            }
            availableNodeIds.add(resolvedNode.nodeId);
            if (!adjacency.has(resolvedNode.nodeId)) {
              adjacency.set(resolvedNode.nodeId, new Set<string>());
            }
          }

          for (const rawEdge of rawEdges) {
            const resolvedEdge = resolveEdgeFields(rawEdge);
            if (!resolvedEdge.fromNodeId || !resolvedEdge.toNodeId) {
              continue;
            }

            if (!adjacency.has(resolvedEdge.fromNodeId)) {
              adjacency.set(resolvedEdge.fromNodeId, new Set<string>());
            }
            if (!adjacency.has(resolvedEdge.toNodeId)) {
              adjacency.set(resolvedEdge.toNodeId, new Set<string>());
            }

            adjacency.get(resolvedEdge.fromNodeId)!.add(resolvedEdge.toNodeId);
            adjacency.get(resolvedEdge.toNodeId)!.add(resolvedEdge.fromNodeId);
          }

          const queue: string[] = [];
          const visited = new Set<string>();

          for (const selectedId of selectedIds) {
            if (availableNodeIds.has(selectedId)) {
              queue.push(selectedId);
              visited.add(selectedId);
            }
          }

          while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
              continue;
            }
            const neighbors = adjacency.get(current);
            if (!neighbors) {
              continue;
            }
            for (const neighbor of neighbors) {
              if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
              }
            }
          }

          const next = new Set(selectedIds);
          for (const nodeId of visited) {
            if (artifactIdsSet.has(nodeId)) {
              next.add(nodeId);
            }
          }

          const lineageAdded = next.size - beforeCount;
          if (lineageAdded > 0) {
            setSelectedIds(next);
            setRelatedSelectionMessage(`Selected ${lineageAdded} related artifact(s) from lineage graph.`);
            return;
          }
        }
      }

      const heuristicExpanded = expandRelatedByHeuristic(selectedIds);
      const heuristicAdded = heuristicExpanded.size - beforeCount;
      setSelectedIds(heuristicExpanded);
      if (heuristicAdded > 0) {
        setRelatedSelectionMessage(`No lineage links found for selected seeds. Added ${heuristicAdded} related artifact(s) by name matching.`);
      } else {
        setRelatedSelectionMessage("No related artifacts found from lineage or name matching.");
      }
    } catch (err) {
      const heuristicExpanded = expandRelatedByHeuristic(selectedIds);
      const heuristicAdded = heuristicExpanded.size - beforeCount;
      setSelectedIds(heuristicExpanded);
      const reason = err instanceof Error ? err.message : String(err);
      setRelatedSelectionMessage(
        heuristicAdded > 0
          ? `Lineage lookup failed (${reason}). Added ${heuristicAdded} related artifact(s) by name matching.`
          : `Lineage lookup failed (${reason}) and no related artifacts were found by fallback matching.`
      );
    } finally {
      setIsSelectingRelated(false);
    }
  };

  const handleConfirm = () => {
    const selected = artifacts.filter((artifact) => selectedIds.has(artifact.id));
    const selector: Record<string, string[]> = {};

    for (const artifact of selected) {
      const key = normalizeTypeForSelector(artifact.type);
      if (!selector[key]) {
        selector[key] = [];
      }
      selector[key].push(artifact.id);
    }

    const labels = selected.map((artifact) => `${artifact.displayName} (${artifact.type})`);

    onComplete({
      selectedArtifactIds: selected.map((artifact) => artifact.id),
      selectedArtifactLabels: labels,
      artifactSelector: selector,
    });

    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className={styles.surface}>
        <DialogTitle>Select Artifacts to Extract</DialogTitle>
        <DialogBody className={styles.content}>
          <DialogContent>
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: tokens.spacingVerticalM }}>
                <Spinner size="extra-large" />
                <Text>Loading artifacts from selected workspaces...</Text>
              </div>
            ) : error ? (
              <>
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
                <Button appearance="primary" onClick={loadArtifacts}>Retry</Button>
              </>
            ) : (
              <>
                <MessageBar intent="info">
                  <MessageBarBody>
                    Select specific artifacts to process. If none are selected, extraction runs across all artifacts in selected workspaces.
                  </MessageBarBody>
                </MessageBar>

                <div className={styles.controlsRow}>
                  <Field label="Search artifacts">
                    <Input
                      value={searchText}
                      onChange={(_, data) => setSearchText(data.value)}
                      placeholder="Search by name, type, workspace, or ID"
                    />
                  </Field>
                  <Field label="Artifact type">
                    <Dropdown
                      value={selectedType === "all" ? "All types" : selectedType}
                      selectedOptions={[selectedType]}
                      onOptionSelect={(_, data) => setSelectedType(data.optionValue || "all")}
                    >
                      <Option value="all">All types</Option>
                      <Option value="Report">Report</Option>
                      <Option value="SemanticModel">SemanticModel</Option>
                      <Option value="Warehouse">Warehouse</Option>
                      <Option value="Lakehouse">Lakehouse</Option>
                      <Option value="Notebook">Notebook</Option>
                    </Dropdown>
                  </Field>
                </div>

                <div className={styles.actionsRow}>
                  <div className={styles.selectionActions}>
                    <Badge appearance="filled" color="informative">
                      {selectedIds.size} selected
                    </Badge>
                    <Text size={200}>
                      {filteredArtifacts.length} visible, {selectedVisibleCount} selected in current filter
                    </Text>
                  </div>
                  <div className={styles.selectionActions}>
                    <Button appearance="subtle" size="small" onClick={handleSelectAllVisible} disabled={filteredArtifacts.length === 0}>
                      Select visible
                    </Button>
                    <Button appearance="subtle" size="small" onClick={handleClearVisible} disabled={selectedVisibleCount === 0}>
                      Clear visible
                    </Button>
                    <Button appearance="subtle" size="small" onClick={handleClearAll} disabled={selectedIds.size === 0}>
                      Clear all
                    </Button>
                    <Button appearance="subtle" size="small" onClick={handleSelectAllRelated} disabled={selectedIds.size === 0}>
                      {isSelectingRelated ? "Selecting related..." : "Select all related"}
                    </Button>
                  </div>
                </div>

                {relatedSelectionMessage && (
                  <MessageBar intent="info">
                    <MessageBarBody>{relatedSelectionMessage}</MessageBarBody>
                  </MessageBar>
                )}

                <div className={styles.artifactList}>
                  <div className={styles.listHeader}>
                    <Text size={200} weight="semibold">Sel</Text>
                    <Text size={200} weight="semibold">Name</Text>
                    <Text size={200} weight="semibold">Type</Text>
                    <Text size={200} weight="semibold">Workspace</Text>
                  </div>

                  {filteredArtifacts.length === 0 ? (
                    <div className={styles.emptyState}>
                      <Text>No artifacts found for current filters.</Text>
                    </div>
                  ) : (
                    filteredArtifacts.map((artifact) => (
                      <div
                        key={`${artifact.workspaceId}:${artifact.id}`}
                        className={styles.artifactItem}
                        data-selected={selectedIds.has(artifact.id)}
                        onClick={(event) => handleArtifactRowClick(artifact.id, event)}
                      >
                        <Checkbox
                          checked={selectedIds.has(artifact.id)}
                          onChange={(_, data) => setSelectedState(artifact.id, !!data.checked)}
                        />
                        <div className={styles.artifactInfo}>
                          <Text className={styles.artifactName}>{artifact.displayName}</Text>
                          <Text size={200} className={styles.artifactMeta}>{artifact.id}</Text>
                        </div>
                        <Text size={200}>{artifact.type}</Text>
                        <Text size={200} className={styles.artifactMeta}>{artifact.workspaceId}</Text>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </DialogBody>
        <DialogActions>
          <Button appearance="secondary" onClick={onClose}>Cancel</Button>
          <Button appearance="primary" onClick={handleConfirm} disabled={loading || !!error}>Apply Selection</Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  );
}
