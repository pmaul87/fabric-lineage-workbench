import React from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  Button,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowRight24Regular,
  DataTrending24Regular,
  Play24Regular,
  Rocket24Regular,
} from "@fluentui/react-icons";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    padding: tokens.spacingVerticalXXL,
    gap: tokens.spacingVerticalXL,
  },
  iconRow: {
    color: tokens.colorBrandForeground1,
    fontSize: "48px",
  },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    textAlign: "center",
  },
  subtitle: {
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground2,
    textAlign: "center",
    maxWidth: "480px",
  },
  stepsContainer: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    maxWidth: "440px",
    width: "100%",
  },
  stepRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  stepIcon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
    marginTop: "2px",
  },
  stepContent: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  stepTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
  },
  stepDesc: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
  },
  actionRow: {
    marginTop: tokens.spacingVerticalM,
  },
});

interface LineageWorkbenchItemEmptyViewProps {
  onGetStarted: () => void;
}

export function LineageWorkbenchItemEmptyView({ onGetStarted }: LineageWorkbenchItemEmptyViewProps) {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <div className={styles.root}>
      <div className={styles.iconRow}>
        <Rocket24Regular fontSize="inherit" />
      </div>

      <Text className={styles.title}>
        {t("LineageWorkbench_Empty_Title", "Welcome to Lineage Workbench")}
      </Text>

      <Text className={styles.subtitle}>
        {t("LineageWorkbench_Empty_Subtitle",
          "Your unified hub for extracting, visualizing, and governing data lineage across Microsoft Fabric.")}
      </Text>

      <div className={styles.stepsContainer}>
        <div className={styles.stepRow}>
          <Play24Regular className={styles.stepIcon} />
          <div className={styles.stepContent}>
            <Text className={styles.stepTitle}>
              {t("LineageWorkbench_Empty_Step1_Title", "1. Configure extraction")}
            </Text>
            <Text className={styles.stepDesc}>
              {t("LineageWorkbench_Empty_Step1_Desc",
                "Point the workbench at your Fabric workspaces and choose which artifact types to include.")}
            </Text>
          </div>
        </div>

        <div className={styles.stepRow}>
          <DataTrending24Regular className={styles.stepIcon} />
          <div className={styles.stepContent}>
            <Text className={styles.stepTitle}>
              {t("LineageWorkbench_Empty_Step2_Title", "2. Explore the lineage graph")}
            </Text>
            <Text className={styles.stepDesc}>
              {t("LineageWorkbench_Empty_Step2_Desc",
                "Visualize how reports, semantic models, dataflows, and other artifacts depend on each other.")}
            </Text>
          </div>
        </div>

      </div>

      <div className={styles.actionRow}>
        <Button
          appearance="primary"
          size="large"
          icon={<ArrowRight24Regular />}
          iconPosition="after"
          onClick={onGetStarted}
        >
          {t("LineageWorkbench_Empty_CTA", "Get Started")}
        </Button>
      </div>
    </div>
  );
}
