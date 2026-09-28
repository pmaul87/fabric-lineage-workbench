import React, { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Button,
  Text,
  Spinner,
  MessageBar,
  MessageBarBody,
  Checkbox,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { WorkloadClientAPI } from "@ms-fabric/workload-client";
import { WorkspaceClient } from "../../clients/WorkspaceClient";
import { FabricPlatformError } from "../../clients/FabricPlatformClient";
import { Workspace } from "../../clients/FabricPlatformTypes";

const useStyles = makeStyles({
  content: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    minWidth: "500px",
    minHeight: "400px",
  },
  centerContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingVerticalL,
    minHeight: "300px",
  },
  workspaceList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    maxHeight: "400px",
    overflowY: "auto",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
  },
  workspaceItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalS,
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  workspaceInfo: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    flex: 1,
  },
  workspaceName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  workspaceMeta: {
    color: tokens.colorNeutralForeground3,
  },
});

export interface WorkspaceSelectionResult {
  workspaceIds: string[];
  workspaceNames: string[];
  workspaceTypes: string[];
}

interface LineageWorkspaceSelectionWizardProps {
  workloadClient: WorkloadClientAPI;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (result: WorkspaceSelectionResult) => void;
  currentWorkspaceId: string;
  preSelectedWorkspaceIds?: string[];
}

export function LineageWorkspaceSelectionWizard(props: LineageWorkspaceSelectionWizardProps) {
  const { workloadClient, isOpen, onClose, onComplete, currentWorkspaceId, preSelectedWorkspaceIds = [] } = props;
  const styles = useStyles();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string>>(new Set(preSelectedWorkspaceIds));

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const client = new WorkspaceClient(workloadClient);
      const allWorkspaces = await client.getAllWorkspaces();
      setWorkspaces(allWorkspaces);
    } catch (err) {
      let errorMessage: string;
      if (err instanceof FabricPlatformError) {
        switch (err.statusCode) {
          case 403:
            errorMessage = "You don't have permission to list workspaces.";
            break;
          case 404:
            errorMessage = "Unable to retrieve workspaces. Please try again.";
            break;
          default:
            errorMessage = `Failed to load workspaces: ${err.message} (HTTP ${err.statusCode})`;
        }
      } else {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [workloadClient]);

  useEffect(() => {
    if (isOpen) {
      void loadWorkspaces();
    }
  }, [isOpen, loadWorkspaces]);

  const getWorkspaceTypeLabel = (workspace: Workspace): string => {
    if (workspace.type === "Personal") {
      return "Personal workspace";
    }

    if (!workspace.capacityId) {
      return "Shared (Pro/PPU)";
    }

    return "Capacity-backed";
  };

  const toggleWorkspace = (workspaceId: string) => {
    const next = new Set(selectedWorkspaceIds);
    if (next.has(workspaceId)) {
      next.delete(workspaceId);
    } else {
      next.add(workspaceId);
    }
    setSelectedWorkspaceIds(next);
  };

  const handleComplete = () => {
    const selectedIds = Array.from(selectedWorkspaceIds);
    const selectedWorkspaces = workspaces.filter((ws) => selectedWorkspaceIds.has(ws.id));
    const selectedNames = selectedWorkspaces.map((ws) => ws.displayName || ws.id);
    const selectedTypes = selectedWorkspaces.map((ws) => getWorkspaceTypeLabel(ws));

    onComplete({
      workspaceIds: selectedIds,
      workspaceNames: selectedNames,
      workspaceTypes: selectedTypes,
    });
    onClose();
  };

  const handleClose = () => {
    setSelectedWorkspaceIds(new Set(preSelectedWorkspaceIds));
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(_, data) => !data.open && handleClose()}>
      <DialogSurface>
        <DialogTitle>Select Workspaces to Extract</DialogTitle>
        <DialogBody className={styles.content}>
          <DialogContent>
            {loading ? (
              <div className={styles.centerContent}>
                <Spinner size="extra-large" />
                <Text size={400}>Loading workspaces...</Text>
              </div>
            ) : error ? (
              <>
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
                <div className={styles.centerContent}>
                  <Button appearance="primary" onClick={loadWorkspaces}>
                    Retry
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Text>
                  Select one or more workspaces to extract lineage data from. The extraction will analyze all semantic
                  models and reports in the selected workspaces.
                </Text>

                <MessageBar intent="info">
                  <MessageBarBody>
                    <Text weight="semibold">Current workspace: </Text>
                    {currentWorkspaceId}
                  </MessageBarBody>
                </MessageBar>

                <div className={styles.workspaceList}>
                  {workspaces.length === 0 ? (
                    <Text style={{ textAlign: "center", color: tokens.colorNeutralForeground3 }}>
                      No workspaces available
                    </Text>
                  ) : (
                    workspaces.map((workspace) => (
                      <div key={workspace.id} className={styles.workspaceItem}>
                        <Checkbox
                          checked={selectedWorkspaceIds.has(workspace.id)}
                          onChange={() => toggleWorkspace(workspace.id)}
                        />
                        <div className={styles.workspaceInfo}>
                          <Text className={styles.workspaceName}>{workspace.displayName || workspace.id}</Text>
                          <Text size={200} className={styles.workspaceMeta}>
                            {workspace.id}
                          </Text>
                          <Text size={200} className={styles.workspaceMeta}>
                            Workspace type: {getWorkspaceTypeLabel(workspace)}
                          </Text>
                          {workspace.description && (
                            <Text size={200} className={styles.workspaceMeta}>
                              {workspace.description}
                            </Text>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  {selectedWorkspaceIds.size} workspace(s) selected
                </Text>
              </>
            )}
          </DialogContent>
        </DialogBody>
        <DialogActions>
          <Button appearance="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            onClick={handleComplete}
            disabled={loading || selectedWorkspaceIds.size === 0}
          >
            Select Workspaces
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  );
}
