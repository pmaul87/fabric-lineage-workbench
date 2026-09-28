import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { NotificationType } from "@ms-fabric/workload-client";
import { PageProps, ContextProps } from "../../App";
import { ItemWithDefinition, callGetItem, getWorkloadItem, saveWorkloadItem } from "../../controller/ItemCRUDController";
import { callOpenSettings } from "../../controller/SettingsController";
import { callNotificationOpen } from "../../controller/NotificationController";
import { ItemEditor, useViewNavigation } from "../../components/ItemEditor";
import { LineageWorkbenchItemDefinition, LineageWorkbenchExtractionConfig } from "./LineageWorkbenchItemDefinition"; 
import { LineageWorkbenchItemDefaultView } from "./LineageWorkbenchItemDefaultView";
import { LineageWorkbenchItemExtractionView } from "./LineageWorkbenchItemExtractionView";
import { LineageWorkbenchItemEmptyView } from "./LineageWorkbenchItemEmptyView";
import { LineageWorkbenchItemLineageView } from "./LineageWorkbenchItemLineageView";
import { LineageWorkbenchItemRibbon, VIEW, LineageWorkbenchView } from "./LineageWorkbenchItemRibbon";
// Removed LineageViewerItem imports (standalone workload eliminated)
import "./LineageWorkbenchItem.scss";

const enum SaveStatus {
  NotSaved = "NotSaved",
  Saving = "Saving",
  Saved = "Saved",
}

function getReadableErrorMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return "Unknown save error.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const nestedError = payload.error as Record<string, unknown> | string | undefined;
    const message =
      payload.message ||
      (typeof nestedError === "object" ? nestedError?.message : undefined) ||
      (typeof nestedError === "string" ? nestedError : undefined);

    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }

    try {
      return JSON.stringify(payload);
    } catch {
      return "Unknown save error.";
    }
  }

  return String(error);
}

const INITIAL_DEFINITION: LineageWorkbenchItemDefinition = {
  extraction: {
    artifactTypes: [],
    selectedArtifactIds: [],
    selectedArtifactLabels: [],
    artifactSelector: {},
    lastRunStatus: "idle",
  },
  lineage: {
    dataSourceMode: "actual",
    direction: "both",
    maxDepth: 4,
  },
};

// ---------------------------------------------------------------------------
// View wrappers — use navigation hook to expose setCurrentView
// ---------------------------------------------------------------------------

interface HomeViewWrapperProps {
  definition: LineageWorkbenchItemDefinition;
  onViewChange: (view: LineageWorkbenchView) => void;
}

function HomeViewWrapper({ definition, onViewChange }: HomeViewWrapperProps) {
  const { setCurrentView } = useViewNavigation();
  const navigate = (view: LineageWorkbenchView) => {
    setCurrentView(view);
    onViewChange(view);
  };

  return (
    <LineageWorkbenchItemDefaultView
      definition={definition}
      onNavigateToExtract={() => navigate(VIEW.EXTRACT)}
      onNavigateToLineage={() => navigate(VIEW.LINEAGE)}
    />
  );
}

interface EmptyViewWrapperProps {
  onGetStarted: () => void;
  onViewChange: (view: LineageWorkbenchView) => void;
}

function EmptyViewWrapper({ onGetStarted, onViewChange }: EmptyViewWrapperProps) {
  const { setCurrentView } = useViewNavigation();
  return (
    <LineageWorkbenchItemEmptyView
      onGetStarted={() => {
        onGetStarted();
        setCurrentView(VIEW.HOME);
        onViewChange(VIEW.HOME);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function LineageWorkbenchItemEditor(props: PageProps) {
  const { workloadClient } = props;
  const pageContext = useParams<ContextProps>();
  const { t } = useTranslation();

  const [isLoading, setIsLoading] = useState(true);
  const [item, setItem] = useState<ItemWithDefinition<LineageWorkbenchItemDefinition>>();
  const [definition, setDefinition] = useState<LineageWorkbenchItemDefinition>(INITIAL_DEFINITION);
  const latestDefinitionRef = useRef<LineageWorkbenchItemDefinition>(INITIAL_DEFINITION);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(SaveStatus.NotSaved);
  const [currentView, setCurrentViewState] = useState<LineageWorkbenchView>(VIEW.HOME);
  const [viewSetter, setViewSetter] = useState<((view: string) => void) | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        if (pageContext.itemObjectId) {
          const loadedItem = await getWorkloadItem<LineageWorkbenchItemDefinition>(
            workloadClient,
            pageContext.itemObjectId
          );
          const loadedDefinition: LineageWorkbenchItemDefinition = {
            ...INITIAL_DEFINITION,
            ...(loadedItem.definition ?? {}),
            extraction: {
              ...INITIAL_DEFINITION.extraction,
              ...(loadedItem.definition?.extraction ?? {}),
            },
            lineage: {
              ...INITIAL_DEFINITION.lineage,
              ...(loadedItem.definition?.lineage ?? {}),
              dataSourceMode: loadedItem.definition?.lineage?.dataSourceMode ?? "actual",
            },
          };
          setItem(loadedItem);
          setDefinition(loadedDefinition);
          latestDefinitionRef.current = loadedDefinition;
          setSaveStatus(loadedItem.definition ? SaveStatus.Saved : SaveStatus.NotSaved);
          setCurrentViewState(loadedItem.definition ? VIEW.HOME : VIEW.EMPTY);
        }
      } catch (error) {
        console.error("Failed to load LineageWorkbench item:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [pageContext.itemObjectId, workloadClient]);

  useEffect(() => {
    latestDefinitionRef.current = definition;
  }, [definition]);

  // ── Navigation helpers ────────────────────────────────────────────────────
  const navigateTo = useCallback((view: LineageWorkbenchView) => {
    setCurrentViewState(view);
    if (viewSetter) {
      viewSetter(view);
    }
  }, [viewSetter]);

  // ── Definition change handlers ────────────────────────────────────────────
  const handleExtractionChange = (next: LineageWorkbenchExtractionConfig) => {
    setDefinition((prev) => ({ ...prev, extraction: next }));
    setSaveStatus(SaveStatus.NotSaved);
  };

  // The lineage state is now managed directly in the Workbench definition.
  const handleLineageChange = (next: any) => {
    setDefinition((prev) => ({ ...prev, lineage: next }));
    setSaveStatus(SaveStatus.NotSaved);
  };

  const handleRefreshLineage = () => {
    setDefinition((prev) => {
      return {
        ...prev,
        lineage: {
          ...prev.lineage,
          // Signal the lineage view to reload from lakehouse immediately.
          refreshNonce: Date.now(),
        },
      };
    });
    setSaveStatus(SaveStatus.NotSaved);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!item) {
      await callNotificationOpen(
        workloadClient,
        t("LineageWorkbench_Save_Failed_Title", "Failed to save Lineage Workbench"),
        t("LineageWorkbench_Save_Failed_ItemNotLoaded", "The item is still loading. Please wait a moment and try saving again."),
        NotificationType.Error,
        undefined
      );
      return;
    }

    const definitionToSave = latestDefinitionRef.current;
    const itemIdToSave = item.id || pageContext.itemObjectId;

    if (!itemIdToSave) {
      await callNotificationOpen(
        workloadClient,
        t("LineageWorkbench_Save_Failed_Title", "Failed to save Lineage Workbench"),
        t("LineageWorkbench_Save_Failed_NoItemId", "The workbench item ID is missing. Reopen the item and try again."),
        NotificationType.Error,
        undefined
      );
      return;
    }

    setSaveStatus(SaveStatus.Saving);
    try {
      const saveResult = await saveWorkloadItem<LineageWorkbenchItemDefinition>(workloadClient, {
        ...item,
        id: itemIdToSave,
        definition: definitionToSave,
      });
      if (!saveResult) {
        throw new Error("The item definition update did not return a result.");
      }
      setItem((prev) => (prev ? { ...prev, definition: definitionToSave } : prev));
      setSaveStatus(SaveStatus.Saved);
      await callNotificationOpen(
        workloadClient,
        t("LineageWorkbench_Save_Success_Title", "Lineage Workbench saved"),
        t("LineageWorkbench_Save_Success_Message", "Your workbench settings and lineage graph have been saved."),
        NotificationType.Success,
        undefined
      );
    } catch (error) {
      setSaveStatus(SaveStatus.NotSaved);
      await callNotificationOpen(
        workloadClient,
        t("LineageWorkbench_Save_Failed_Title", "Failed to save Lineage Workbench"),
        getReadableErrorMessage(error),
        NotificationType.Error,
        undefined
      );
    }
  };

  const handleOpenSettings = async () => {
    if (!item) {
      return;
    }
    try {
      const itemResponse = await callGetItem(workloadClient, item.id);
      await callOpenSettings(workloadClient, itemResponse.item, "About");
    } catch (error) {
      console.error("Failed to open settings:", error);
    }
  };

  // ── Static view definitions ───────────────────────────────────────────────
  const views = [
    {
      name: VIEW.EMPTY,
      component: (
        <EmptyViewWrapper
          onGetStarted={() => setSaveStatus(SaveStatus.NotSaved)}
          onViewChange={(view) => setCurrentViewState(view)}
        />
      ),
    },
    {
      name: VIEW.HOME,
      component: <HomeViewWrapper definition={definition} onViewChange={(view) => setCurrentViewState(view)} />,
    },
    {
      name: VIEW.EXTRACT,
      component: (
        <LineageWorkbenchItemExtractionView
          workloadClient={workloadClient}
          workspaceId={item?.workspaceId}
          extraction={definition.extraction ?? {}}
          onExtractionChange={handleExtractionChange}
          onSave={item ? handleSave : undefined}
        />
      ),
    },
    {
      name: VIEW.LINEAGE,
      component: (
        <LineageWorkbenchItemLineageView
            workloadClient={workloadClient}
            workspaceId={item?.workspaceId}
            extraction={definition.extraction}
          lineage={definition.lineage}
          onLineageChange={handleLineageChange}
        />
      ),
    },
  ];

  // ── Initial view after load ───────────────────────────────────────────────
  const getInitialView = () => {
    if (!item?.definition) {
      return VIEW.EMPTY;
    }
    return VIEW.HOME;
  };

  return (
    <ItemEditor
      isLoading={isLoading}
      getInitialView={getInitialView}
      loadingMessage={t("LineageWorkbench_Loading", "Loading Lineage Workbench...")}
      ribbon={(context) => (
        <LineageWorkbenchItemRibbon
          {...props}
          viewContext={context}
          currentView={currentView}
          isSaveButtonEnabled={saveStatus !== SaveStatus.Saving}
          saveItemCallback={handleSave}
          openSettingsCallback={handleOpenSettings}
          onNavigateHome={() => navigateTo(VIEW.HOME)}
          onNavigateToExtract={() => navigateTo(VIEW.EXTRACT)}
          onNavigateToLineage={() => navigateTo(VIEW.LINEAGE)}
          onRefreshLineage={currentView === VIEW.LINEAGE ? handleRefreshLineage : undefined}
        />
      )}
      views={views}
      viewSetter={(setView) => {
        if (!viewSetter) {
          setViewSetter(() => setView);
        }
      }}
    />
  );
}
