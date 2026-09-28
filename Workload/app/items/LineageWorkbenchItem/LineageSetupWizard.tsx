import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Button,
  Field,
  Input,
  Radio,
  RadioGroup,
  Text,
  Spinner,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DatabaseRegular, CheckmarkCircleRegular, ErrorCircleRegular } from "@fluentui/react-icons";
import { WorkloadClientAPI } from "@ms-fabric/workload-client";
import { callDatahubOpen } from "../../controller/DataHubController";
import { ItemClient } from "../../clients/ItemClient";
import { FabricPlatformError } from "../../clients/FabricPlatformClient";

const useStyles = makeStyles({
  dialogContent: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    minHeight: "300px",
  },
  radioGroup: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  successIcon: {
    color: tokens.colorPaletteGreenForeground1,
    fontSize: "48px",
    textAlign: "center",
  },
  errorIcon: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: "48px",
    textAlign: "center",
  },
  centerContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalL,
    padding: tokens.spacingVerticalXXL,
  },
});

export interface LakehouseSetupResult {
  lakehouseId: string;
  lakehouseDisplayName: string;
  lakehouseWorkspaceId: string;
  isNew: boolean;
}

interface LineageSetupWizardProps {
  workloadClient: WorkloadClientAPI;
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (result: LakehouseSetupResult) => void;
}

type SetupMode = "existing" | "new";
type WizardStep = "select-mode" | "creating" | "success" | "error";

export function LineageSetupWizard(props: LineageSetupWizardProps) {
  const { workloadClient, workspaceId, isOpen, onClose, onComplete } = props;
  const { t } = useTranslation();
  const styles = useStyles();

  const [currentStep, setCurrentStep] = useState<WizardStep>("select-mode");
  const [setupMode, setSetupMode] = useState<SetupMode>("existing");
  const [newLakehouseName, setNewLakehouseName] = useState<string>("LineageScanner");
  const [selectedLakehouse, setSelectedLakehouse] = useState<LakehouseSetupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelectExisting = async () => {
    try {
      const result = await callDatahubOpen(
        workloadClient,
        ["Lakehouse"],
        t("LineageSetup_SelectLakehouse", "Select a Lakehouse for lineage storage"),
        false
      );

      if (result) {
        setSelectedLakehouse({
          lakehouseId: result.id,
          lakehouseDisplayName: result.displayName,
          lakehouseWorkspaceId: result.workspaceId || workspaceId,
          isNew: false,
        });
        setCurrentStep("success");
      }
    } catch (err) {
      let errorMessage: string;
      if (err instanceof FabricPlatformError) {
        switch (err.statusCode) {
          case 403:
            errorMessage = "You don't have permission to access lakehouses in this workspace.";
            break;
          case 404:
            errorMessage = "Workspace not found. Please ensure you have access.";
            break;
          default:
            errorMessage = `Failed to select lakehouse: ${err.message} (HTTP ${err.statusCode})`;
        }
      } else {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
      setError(errorMessage);
      setCurrentStep("error");
    }
  };

  const handleCreateNew = async () => {
    if (!newLakehouseName.trim()) {
      setError("Please enter a lakehouse name");
      return;
    }

    setCurrentStep("creating");
    setError(null);

    try {
      const itemClient = new ItemClient(workloadClient);
      
      // Create the lakehouse
      const lakehouse = await itemClient.createItem(workspaceId, {
        displayName: newLakehouseName.trim(),
        type: "Lakehouse",
        description: "Lineage storage lakehouse created by Fabric Lineage Workbench"
      });

      setSelectedLakehouse({
        lakehouseId: lakehouse.id,
        lakehouseDisplayName: lakehouse.displayName,
        lakehouseWorkspaceId: workspaceId,
        isNew: true,
      });
      setCurrentStep("success");
    } catch (err) {
      let errorMessage: string;
      if (err instanceof FabricPlatformError) {
        switch (err.statusCode) {
          case 409:
            errorMessage = `A lakehouse named "${newLakehouseName.trim()}" already exists in this workspace. Please choose a different name.`;
            break;
          case 400:
            errorMessage = `Invalid lakehouse name: ${err.message}`;
            break;
          case 403:
            errorMessage = "You don't have permission to create lakehouses in this workspace.";
            break;
          case 404:
            errorMessage = "Workspace not found. Please ensure you have access.";
            break;
          default:
            errorMessage = `Failed to create lakehouse: ${err.message} (HTTP ${err.statusCode})`;
        }
      } else {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
      setError(errorMessage);
      setCurrentStep("error");
    }
  };

  const handleNext = () => {
    if (setupMode === "existing") {
      handleSelectExisting();
    } else {
      handleCreateNew();
    }
  };

  const handleFinish = () => {
    if (selectedLakehouse) {
      onComplete(selectedLakehouse);
      onClose();
      // Reset state
      setCurrentStep("select-mode");
      setSetupMode("existing");
      setNewLakehouseName("LineageScanner");
      setSelectedLakehouse(null);
      setError(null);
    }
  };

  const handleCancel = () => {
    onClose();
    // Reset state
    setCurrentStep("select-mode");
    setSetupMode("existing");
    setNewLakehouseName("LineageScanner");
    setSelectedLakehouse(null);
    setError(null);
  };

  const renderSelectMode = () => (
    <div className={styles.dialogContent}>
      <Text>
        {t("LineageSetup_LakehousePrompt", "Choose how to set up the lakehouse for lineage storage:")}
      </Text>

      <RadioGroup
        value={setupMode}
        onChange={(_, data) => setSetupMode(data.value as SetupMode)}
        className={styles.radioGroup}
      >
        <Radio
          value="existing"
          label={
            <div>
              <Text weight="semibold">
                {t("LineageSetup_UseExisting", "Use existing lakehouse")}
              </Text>
              <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>
                {t("LineageSetup_UseExisting_Desc", "Select a lakehouse from your workspace")}
              </Text>
            </div>
          }
        />
        <Radio
          value="new"
          label={
            <div>
              <Text weight="semibold">
                {t("LineageSetup_CreateNew", "Create new lakehouse")}
              </Text>
              <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>
                {t("LineageSetup_CreateNew_Desc", "Deploy a new lakehouse in this workspace")}
              </Text>
            </div>
          }
        />
      </RadioGroup>

      {setupMode === "new" && (
        <Field
          label={t("LineageSetup_LakehouseName", "Lakehouse Name")}
          required
        >
          <Input
            value={newLakehouseName}
            onChange={(_, data) => setNewLakehouseName(data.value)}
            placeholder="LineageScanner"
          />
        </Field>
      )}
    </div>
  );

  const renderCreating = () => (
    <div className={styles.centerContent}>
      <Spinner size="extra-large" />
      <Text size={400} weight="semibold">
        {t("LineageSetup_Creating", "Creating lakehouse...")}
      </Text>
      <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
        {newLakehouseName}
      </Text>
    </div>
  );

  const renderSuccess = () => (
    <div className={styles.centerContent}>
      <CheckmarkCircleRegular className={styles.successIcon} />
      <Text size={500} weight="semibold">
        {t("LineageSetup_Success", "Lakehouse ready!")}
      </Text>
      <div style={{ textAlign: "center" }}>
        <Text size={300}>
          {selectedLakehouse?.isNew
            ? t("LineageSetup_Success_Created", "Successfully created lakehouse:")
            : t("LineageSetup_Success_Selected", "Successfully selected lakehouse:")}
        </Text>
        <Text size={400} weight="semibold" style={{ display: "block", marginTop: tokens.spacingVerticalS }}>
          {selectedLakehouse?.lakehouseDisplayName}
        </Text>
      </div>
    </div>
  );

  const renderError = () => (
    <div className={styles.centerContent}>
      <ErrorCircleRegular className={styles.errorIcon} />
      <Text size={500} weight="semibold">
        {t("LineageSetup_Error", "Setup failed")}
      </Text>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(_, data) => !data.open && handleCancel()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            <DatabaseRegular style={{ marginRight: tokens.spacingHorizontalS }} />
            {t("LineageSetup_Title", "Setup Lineage Storage")}
          </DialogTitle>
          <DialogContent>
            {currentStep === "select-mode" && renderSelectMode()}
            {currentStep === "creating" && renderCreating()}
            {currentStep === "success" && renderSuccess()}
            {currentStep === "error" && renderError()}
          </DialogContent>
          <DialogActions>
            {currentStep === "select-mode" && (
              <>
                <Button appearance="secondary" onClick={handleCancel}>
                  {t("LineageSetup_Cancel", "Cancel")}
                </Button>
                <Button
                  appearance="primary"
                  onClick={handleNext}
                  disabled={setupMode === "new" && !newLakehouseName.trim()}
                >
                  {setupMode === "existing"
                    ? t("LineageSetup_Select", "Select Lakehouse")
                    : t("LineageSetup_Create", "Create Lakehouse")}
                </Button>
              </>
            )}
            {currentStep === "creating" && (
              <Button appearance="secondary" disabled>
                {t("LineageSetup_PleaseWait", "Please wait...")}
              </Button>
            )}
            {currentStep === "success" && (
              <Button appearance="primary" onClick={handleFinish}>
                {t("LineageSetup_Finish", "Finish")}
              </Button>
            )}
            {currentStep === "error" && (
              <>
                <Button appearance="secondary" onClick={handleCancel}>
                  {t("LineageSetup_Close", "Close")}
                </Button>
                <Button appearance="primary" onClick={() => setCurrentStep("select-mode")}>
                  {t("LineageSetup_TryAgain", "Try Again")}
                </Button>
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
