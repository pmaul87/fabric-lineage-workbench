import React from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Text,
  Badge,
  Button,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowRight16Filled,
  DataTrending24Regular,
  Play24Regular,
  CheckmarkCircle24Regular,
  ErrorCircle24Regular,
  Clock24Regular,
} from "@fluentui/react-icons";
import { ItemEditorDefaultView } from "../../components/ItemEditor";
import type { LineageWorkbenchItemDefinition } from "./LineageWorkbenchItemDefinition";

const useStyles = makeStyles({
  hubRoot: {
    padding: tokens.spacingVerticalXL,
    maxWidth: "960px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXL,
  },
  heroSection: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  heroTitle: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  heroSubtitle: {
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground2,
  },
  statsRow: {
    display: "flex",
    gap: tokens.spacingHorizontalL,
    flexWrap: "wrap",
  },
  statChip: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  statLabel: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
  },
  statValue: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  cardsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: tokens.spacingHorizontalL,
  },
  capabilityCard: {
    display: "flex",
    flexDirection: "column",
    padding: tokens.spacingVerticalL,
    gap: tokens.spacingVerticalM,
    cursor: "pointer",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  cardIconRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorBrandForeground1,
  },
  cardTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  cardDescription: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    flexGrow: 1,
  },
  cardActionRow: {
    display: "flex",
    justifyContent: "flex-end",
  },
});

interface LineageWorkbenchItemDefaultViewProps {
  definition: LineageWorkbenchItemDefinition;
  onNavigateToExtract: () => void;
  onNavigateToLineage: () => void;
}

export function LineageWorkbenchItemDefaultView(props: LineageWorkbenchItemDefaultViewProps) {
  const { definition, onNavigateToExtract, onNavigateToLineage } = props;
  const { t } = useTranslation();
  const styles = useStyles();

  const nodeCount = definition.lineage?.graphSnapshot?.nodes.length ?? 0;
  const edgeCount = definition.lineage?.graphSnapshot?.edges.length ?? 0;
  const lastRun = definition.extraction?.lastRunAt
    ? new Date(definition.extraction.lastRunAt).toLocaleString()
    : t("LineageWorkbench_Hub_NeverExtracted", "Never extracted");
  const runStatus = definition.extraction?.lastRunStatus ?? "idle";

  const extractionStatusIcon = runStatus === "success"
    ? <CheckmarkCircle24Regular color={tokens.colorStatusSuccessForeground1} />
    : runStatus === "error"
      ? <ErrorCircle24Regular color={tokens.colorStatusDangerForeground1} />
      : <Clock24Regular color={tokens.colorNeutralForeground3} />;

  const extractionStatusLabel = runStatus === "success"
    ? t("LineageWorkbench_Hub_ExtractionSuccess", "Last extraction succeeded")
    : runStatus === "error"
      ? t("LineageWorkbench_Hub_ExtractionError", "Last extraction failed")
      : runStatus === "running"
        ? t("LineageWorkbench_Hub_ExtractionRunning", "Extraction running...")
        : t("LineageWorkbench_Hub_ExtractionIdle", "Ready to extract");

  const centerContent = (
    <div className={styles.hubRoot}>
      {/* Hero */}
      <div className={styles.heroSection}>
        <Text className={styles.heroTitle}>
          {t("LineageWorkbench_Hub_Title", "Lineage Workbench")}
        </Text>
        <Text className={styles.heroSubtitle}>
          {t("LineageWorkbench_Hub_Subtitle", "Extract, explore, and govern your Fabric data lineage in one place.")}
        </Text>
      </div>

      {/* Stats row */}
      <div className={styles.statsRow}>
        <div className={styles.statChip}>
          <Text className={styles.statLabel}>{t("LineageWorkbench_Hub_Nodes", "Nodes")}</Text>
          <Text className={styles.statValue}>{nodeCount}</Text>
        </div>
        <div className={styles.statChip}>
          <Text className={styles.statLabel}>{t("LineageWorkbench_Hub_Edges", "Edges")}</Text>
          <Text className={styles.statValue}>{edgeCount}</Text>
        </div>
        <div className={styles.statChip}>
          {extractionStatusIcon}
          <Text className={styles.statLabel}>{extractionStatusLabel}</Text>
        </div>
      </div>

      {/* Capability cards */}
      <div className={styles.cardsRow}>
        {/* Extract */}
        <Card className={styles.capabilityCard} onClick={onNavigateToExtract}>
          <div className={styles.cardIconRow}>
            <Play24Regular />
            <Text className={styles.cardTitle}>
              {t("LineageWorkbench_Hub_ExtractCard_Title", "Configure Extraction")}
            </Text>
          </div>
          <Text className={styles.cardDescription}>
            {t("LineageWorkbench_Hub_ExtractCard_Description",
              "Configure extraction targets and pull lineage data from your Fabric workspaces.")}
          </Text>
          <div className={styles.cardActionRow}>
            <Text>{lastRun}</Text>
            <Button
              appearance="transparent"
              icon={<ArrowRight16Filled />}
              iconPosition="after"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); onNavigateToExtract(); }}
            >
              {t("LineageWorkbench_Hub_ExtractCard_Action", "Configure")}
            </Button>
          </div>
        </Card>

        {/* Explore graph */}
        <Card className={styles.capabilityCard} onClick={onNavigateToLineage}>
          <div className={styles.cardIconRow}>
            <DataTrending24Regular />
            <Text className={styles.cardTitle}>
              {t("LineageWorkbench_Hub_ViewerCard_Title", "Explore Lineage Graph")}
            </Text>
          </div>
          <Text className={styles.cardDescription}>
            {t("LineageWorkbench_Hub_ViewerCard_Description",
              "Visualize and navigate the dependency graph. Focus on any node to trace its upstream and downstream relationships.")}
          </Text>
          <div className={styles.cardActionRow}>
            {nodeCount > 0 && (
              <Badge appearance="outline" color="informative">
                {t("LineageWorkbench_Hub_ViewerCard_NodeBadge", "{{count}} nodes", { count: nodeCount })}
              </Badge>
            )}
            <Button
              appearance="transparent"
              icon={<ArrowRight16Filled />}
              iconPosition="after"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); onNavigateToLineage(); }}
            >
              {t("LineageWorkbench_Hub_ViewerCard_Action", "Explore")}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );

  return (
    <ItemEditorDefaultView
      center={{ content: centerContent }}
    />
  );
}
