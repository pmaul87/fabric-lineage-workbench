import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowClockwise24Regular, Home24Regular, Play24Regular, DataTrending24Regular } from "@fluentui/react-icons";
import { PageProps } from "../../App";
import { Ribbon, RibbonAction, createSaveAction, createSettingsAction, ViewContext } from "../../components/ItemEditor";

export const VIEW = {
  EMPTY: "empty",
  HOME: "home",
  EXTRACT: "extract",
  LINEAGE: "lineage",
} as const;

export type LineageWorkbenchView = typeof VIEW[keyof typeof VIEW];

interface LineageWorkbenchItemRibbonProps extends PageProps {
  viewContext: ViewContext;
  currentView: LineageWorkbenchView;
  isSaveButtonEnabled: boolean;
  saveItemCallback: () => Promise<void>;
  openSettingsCallback: () => Promise<void>;
  onNavigateHome: () => void;
  onNavigateToExtract: () => void;
  onNavigateToLineage: () => void;
  onRefreshLineage?: () => void;
}

export function LineageWorkbenchItemRibbon(props: LineageWorkbenchItemRibbonProps) {
  const { t } = useTranslation();

  const saveAction = createSaveAction(props.saveItemCallback, !props.isSaveButtonEnabled);
  const settingsAction = createSettingsAction(props.openSettingsCallback);

  const homeAction: RibbonAction = {
    key: "go-home",
    label: t("LineageWorkbench_Ribbon_Home", "Hub"),
    icon: Home24Regular,
    onClick: props.onNavigateHome,
    tooltip: t("LineageWorkbench_Ribbon_Home_Tooltip", "Go to Lineage Workbench hub"),
  };

  const extractAction: RibbonAction = {
    key: "go-extract",
    label: t("LineageWorkbench_Ribbon_Extract", "Configure Extraction"),
    icon: Play24Regular,
    onClick: props.onNavigateToExtract,
    tooltip: t("LineageWorkbench_Ribbon_Extract_Tooltip", "Open extraction configuration"),
  };

  const lineageAction: RibbonAction = {
    key: "go-lineage",
    label: t("LineageWorkbench_Ribbon_Lineage", "Lineage Graph"),
    icon: DataTrending24Regular,
    onClick: props.onNavigateToLineage,
    tooltip: t("LineageWorkbench_Ribbon_Lineage_Tooltip", "Open lineage graph explorer"),
  };

  const refreshAction: RibbonAction | undefined = props.onRefreshLineage
    ? {
        key: "refresh-lineage",
        label: t("LineageWorkbench_Ribbon_Refresh", "Refresh graph"),
        icon: ArrowClockwise24Regular,
        onClick: props.onRefreshLineage,
        tooltip: t("LineageWorkbench_Ribbon_Refresh_Tooltip", "Reload lineage graph data"),
      }
    : undefined;

  // Build context-aware actions: always show save + settings, add navigation + view-specific actions
  const homeToolbarActions: RibbonAction[] = [
    saveAction,
    settingsAction,
    ...(props.currentView !== VIEW.HOME ? [homeAction] : []),
    ...(props.currentView !== VIEW.EXTRACT ? [extractAction] : []),
    ...(props.currentView !== VIEW.LINEAGE ? [lineageAction] : []),
    ...(props.currentView === VIEW.LINEAGE && refreshAction ? [refreshAction] : []),
  ];

  return <Ribbon homeToolbarActions={homeToolbarActions} viewContext={props.viewContext} />;
}
