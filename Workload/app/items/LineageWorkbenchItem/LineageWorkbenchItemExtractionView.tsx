import React, { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  Field,
  Input,
  Checkbox,
  Divider,
  Button,
  Spinner,
  ProgressBar,
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { PlayRegular, BuildingRegular, DocumentRegular } from "@fluentui/react-icons";
import { WorkloadClientAPI } from "@ms-fabric/workload-client";
import { ItemClient } from "../../clients/ItemClient";
import { OneLakeStorageClient } from "../../clients/OneLakeStorageClient";
import { ItemEditorDefaultView } from "../../components/ItemEditor";
import type { LineageWorkbenchExtractionConfig } from "./LineageWorkbenchItemDefinition";
import { LineageWorkspaceSelectionWizard, WorkspaceSelectionResult } from "./LineageWorkspaceSelectionWizard";
import { ArtifactSelectionResult, LineageArtifactSelectionWizard } from "./LineageArtifactSelectionWizard";
import { buildNotebooklessGraphSnapshot } from "../../clients/lineage/FabricLineageClient";
import { FabricTableLineageStorage } from "../../clients/lineage/FabricTableLineageStorage";
import { callAcquireFrontendAccessToken, callPromptFrontendConsent } from "../../clients/FabricAuthenticationService";

const POWER_BI_XMLA_SCOPE = "https://analysis.windows.net/powerbi/api/Dataset.Read.All";
const POWER_BI_REPORT_SCOPE = "https://analysis.windows.net/powerbi/api/Report.Read.All";

async function acquireFabricTokenWithScopes(workloadClient: WorkloadClientAPI, scopes: string[]): Promise<string> {
  try {
    const tokenResult = await callAcquireFrontendAccessToken(workloadClient, scopes.join(" "));
    return tokenResult.token;
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    const isScopeValidationError =
      errorText.includes("Invalid or unsupported authentication scopes") ||
      errorText.includes("WorkloadAuthError.4");

    if (!isScopeValidationError) {
      throw error;
    }

    console.warn("[LineageExtraction] Scoped token request failed, retrying with default frontend token", {
      requestedScopes: scopes,
      error: errorText,
    });
    const fallbackToken = await callAcquireFrontendAccessToken(workloadClient, "");
    return fallbackToken.token;
  }
}

type DirectSemanticEntity = {
  id: string;
  name: string;
  type: string;
  tableName?: string;
  dataType?: string;
  expression?: string;
};

type DirectSemanticDependency = {
  sourceId: string;
  targetId: string;
  dependencyType?: string;
};

type DirectSemanticLoadResult = {
  entities: DirectSemanticEntity[];
  dependencies: DirectSemanticDependency[];
  source: "xmla-analyzer" | "client-fallback";
};

type RawApiResponseSnapshot = {
  apiType: "semantic-analyzer" | "executeQueries" | "report-detail" | "report-definition" | "onelake-path-metadata";
  queryLabel: string;
  workspaceId: string;
  datasetId: string;
  request: {
    method: "GET" | "POST";
    url: string;
    body?: string;
  };
  response: {
    ok: boolean;
    status: number;
    body: string;
  };
  capturedAt: string;
};

type ReportSemanticRef = {
  tableName?: string;
  objectName: string;
  objectType?: string;
};

type ReportPageMetadata = {
  pageId: string;
  pageName: string;
  displayName?: string;
};

type ReportVisualMetadata = {
  visualId: string;
  visualName: string;
  visualType?: string;
  pageId: string;
  pageName: string;
  semanticRefs: ReportSemanticRef[];
};

type DirectReportLoadResult = {
  reportId: string;
  reportName: string;
  workspaceId: string;
  datasetId?: string;
  pages: ReportPageMetadata[];
  visuals: ReportVisualMetadata[];
};

type DirectApiCallEvent = {
  stage: "started" | "succeeded" | "failed" | "warning";
  queryLabel: string;
  datasetId: string;
  workspaceId: string;
  error?: string;
  capturedAt?: string;
};

type ApiCallLogEntry = {
  sequence: number;
  stage: "started" | "succeeded" | "failed" | "warning";
  queryLabel: string;
  datasetId: string;
  datasetName: string;
  workspaceId: string;
  error?: string;
  capturedAt: string;
};

type ApiCallStats = {
  attempted: number;
  succeeded: number;
  failed: number;
  warnings: number;
  failures: string[];
  warningMessages: string[];
  callLog: ApiCallLogEntry[];
  datasets: Record<string, {
    datasetId: string;
    datasetName: string;
    workspaceId: string;
    attempted: number;
    succeeded: number;
    failed: number;
    warnings: number;
    failures: string[];
    warningMessages: string[];
  }>;
};

const MAX_STATUS_MESSAGES = 50;
const MAX_STATUS_CALL_LOG = 500;

function formatApiIssueMessage(event: DirectApiCallEvent): string {
  const detail = formatUnknownError(event.error).trim() || "Request failed";
  return `${event.queryLabel} (${event.datasetId}): ${detail}`;
}

function formatWorkloadAuthErrorCode(code: number): string {
  switch (code) {
    case 0:
      return "Authentication is not available in the current Fabric context.";
    case 1:
      return "User interaction failed during authentication.";
    case 2:
      return "Workload authentication is misconfigured (redirect URI or audience mismatch).";
    case 3:
      return "Unknown authentication error while acquiring Fabric access token.";
    case 4:
      return "Invalid or unsupported authentication scopes were requested.";
    default:
      return `Authentication failed with error code ${code}.`;
  }
}

function formatUnknownError(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }

  if (error instanceof Error) {
    return error.message || "Unknown error";
  }

  if (typeof error === "number") {
    return formatWorkloadAuthErrorCode(error);
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const nested = typeof payload.error === "object" && payload.error !== null
      ? (payload.error as Record<string, unknown>)
      : undefined;

    const directCode = typeof payload.error === "number" ? payload.error : undefined;
    const nestedCode = typeof nested?.code === "number" ? nested.code : undefined;
    if (directCode !== undefined || nestedCode !== undefined) {
      const code = directCode ?? nestedCode ?? 0;
      const codeMessage = formatWorkloadAuthErrorCode(code);
      const extra = [
        typeof payload.message === "string" ? payload.message : undefined,
        typeof nested?.message === "string" ? nested.message : undefined,
        typeof nested?.details === "string" ? nested.details : undefined,
      ].filter((value): value is string => Boolean(value)).join(" | ");
      return extra ? `${codeMessage} | ${extra}` : codeMessage;
    }

    const candidates = [
      payload.message,
      payload.error,
      payload.errorMessage,
      payload.status,
      payload.statusCode,
      nested?.code,
      nested?.message,
      nested?.details,
      nested?.innerError,
    ].filter((v) => v !== undefined && v !== null);

    if (candidates.length > 0) {
      try {
        return candidates
          .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
          .join(" | ");
      } catch {
        // Fall through to full serialization.
      }
    }

    try {
      return JSON.stringify(payload);
    } catch {
      const summary = Object.entries(payload)
        .slice(0, 8)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : String(v)}`)
        .join("; ");
      return summary || "Unknown error object";
    }
  }

  return String(error);
}

function summarizeExecuteQueriesError(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as {
      error?: {
        code?: string;
        "pbi.error"?: {
          details?: Array<{ code?: string; detail?: { value?: string } }>;
        };
      };
    };

    const pbiDetails = parsed?.error?.["pbi.error"]?.details ?? [];
    const detailsMessage = pbiDetails.find((d) => d?.code === "DetailsMessage")?.detail?.value;
    const asCode = pbiDetails.find((d) => d?.code === "AnalysisServicesErrorCode")?.detail?.value;

    if (String(asCode || "") === "3239575574") {
      return "Dependency metadata query is not supported for this semantic model via executeQueries.";
    }

    if (detailsMessage) {
      return String(detailsMessage);
    }

    if (parsed?.error?.code) {
      return String(parsed.error.code);
    }
  } catch {
    // Ignore parsing errors and return original text.
  }

  return detail;
}

function getRowValue(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).length > 0) {
      return String(value);
    }
  }

  for (const [rowKey, value] of Object.entries(row)) {
    if (value === undefined || value === null || String(value).length === 0) {
      continue;
    }
    const normalizedRowKey = rowKey.toLowerCase();
    if (keys.some((key) => normalizedRowKey === key.toLowerCase())) {
      return String(value);
    }
  }

  return undefined;
}

function normalizeEntityKey(tableName: string, name: string): string {
  return `${tableName.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
}

function extractTenantIdFromAuthErrorMessage(message: string | null | undefined): string | null {
  const text = String(message || "");
  const patterns = [
    /login\.microsoftonline\.com\/([0-9a-zA-Z.-]{3,})\//,
    /workloadSignIn\/([0-9a-fA-F-]{36})\//,
    /"tenantId":"([0-9a-fA-F-]{36})"/i,
    /"tid":"([0-9a-fA-F-]{36})"/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = String(match[1]).trim();
      if (candidate.toLowerCase() === "common") {
        continue;
      }

      return candidate;
    }
  }

  return null;
}

function buildAdminConsentUrl(tenantId: string | null, frontendAppId: string | null | undefined): string | null {
  const normalizedTenantId = String(tenantId || "").trim();
  const normalizedAppId = String(frontendAppId || "").trim();
  if (!normalizedTenantId || !normalizedAppId) {
    return null;
  }

  return `https://login.microsoftonline.com/${normalizedTenantId}/adminconsent?client_id=${normalizedAppId}`;
}

function extractDaxReferences(expression: string): Array<{ tableName?: string; name: string }> {
  const references: Array<{ tableName?: string; name: string }> = [];
  const seen = new Set<string>();
  const regex = /'((?:''|[^'])+)'\[([^\]]+)\]|\[([^\]]+)\]/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(expression)) !== null) {
    const tableName = match[1] ? match[1].replace(/''/g, "'") : undefined;
    const name = match[2] || match[3];
    if (!name) {
      continue;
    }

    const key = `${(tableName || "").toLowerCase()}|${name.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    references.push({ tableName, name });
  }

  return references;
}

function buildExpressionDependencies(entities: DirectSemanticEntity[]): DirectSemanticDependency[] {
  const measureByQualifiedName = new Map<string, string>();
  const columnByQualifiedName = new Map<string, string>();
  const measureByName = new Map<string, string[]>();
  const columnByName = new Map<string, string[]>();
  const unique = new Map<string, DirectSemanticDependency>();

  const addByName = (index: Map<string, string[]>, name: string, id: string): void => {
    const key = name.trim().toLowerCase();
    const current = index.get(key) || [];
    index.set(key, [...current, id]);
  };

  for (const entity of entities) {
    if (!entity.id || !entity.name) {
      continue;
    }

    if (!entity.tableName) {
      continue;
    }

    const qualifiedKey = normalizeEntityKey(entity.tableName, entity.name);
    if (entity.type === "Measure") {
      measureByQualifiedName.set(qualifiedKey, entity.id);
      addByName(measureByName, entity.name, entity.id);
    } else if (entity.type === "Column") {
      columnByQualifiedName.set(qualifiedKey, entity.id);
      addByName(columnByName, entity.name, entity.id);
    }
  }

  const resolveUnqualified = (name: string, sourceTableName?: string): string | undefined => {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) {
      return undefined;
    }

    if (sourceTableName) {
      const sameTableKey = normalizeEntityKey(sourceTableName, name);
      const sameTableMeasure = measureByQualifiedName.get(sameTableKey);
      if (sameTableMeasure) {
        return sameTableMeasure;
      }

      const sameTableColumn = columnByQualifiedName.get(sameTableKey);
      if (sameTableColumn) {
        return sameTableColumn;
      }
    }

    const measureMatches = measureByName.get(normalizedName) || [];
    if (measureMatches.length === 1) {
      return measureMatches[0];
    }

    const columnMatches = columnByName.get(normalizedName) || [];
    if (columnMatches.length === 1) {
      return columnMatches[0];
    }

    return undefined;
  };

  for (const source of entities) {
    if (!source.id || !source.expression) {
      continue;
    }

    if (source.type !== "Measure" && source.type !== "Column") {
      continue;
    }

    for (const reference of extractDaxReferences(source.expression)) {
      let targetId: string | undefined;

      if (reference.tableName) {
        const key = normalizeEntityKey(reference.tableName, reference.name);
        targetId = measureByQualifiedName.get(key) || columnByQualifiedName.get(key);
      } else {
        targetId = resolveUnqualified(reference.name, source.tableName);
      }

      if (!targetId || targetId === source.id) {
        continue;
      }

      const dependencyKey = `${source.id}->${targetId}`;
      unique.set(dependencyKey, {
        sourceId: source.id,
        targetId,
        dependencyType: "expression",
      });
    }
  }

  return Array.from(unique.values());
}

async function executeXmlaQueryDirect(
  workloadClient: WorkloadClientAPI,
  workspaceId: string,
  datasetId: string,
  query: string,
  queryLabel: string,
  onApiCallEvent?: (event: DirectApiCallEvent) => void,
  options?: { failureStage?: "failed" | "warning" },
  onRawApiResponse?: (snapshot: RawApiResponseSnapshot) => void
): Promise<Array<Record<string, unknown>>> {
  onApiCallEvent?.({
    stage: "started",
    queryLabel,
    datasetId,
    workspaceId,
  });

  const accessToken = await acquireFabricTokenWithScopes(workloadClient, [POWER_BI_XMLA_SCOPE]);
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      queries: [{ query }],
      serializerSettings: { includeNulls: true },
    }),
  });

  const rawBody = await response.text().catch(() => "");
  onRawApiResponse?.({
    apiType: "executeQueries",
    queryLabel,
    workspaceId,
    datasetId,
    request: {
      method: "POST",
      url,
      body: JSON.stringify({
        queries: [{ query }],
        serializerSettings: { includeNulls: true },
      }),
    },
    response: {
      ok: response.ok,
      status: response.status,
      body: rawBody,
    },
    capturedAt: new Date().toISOString(),
  });

  if (!response.ok) {
    const details = rawBody;
    const summarizedError = summarizeExecuteQueriesError(details || `executeQueries failed (${response.status})`);
    onApiCallEvent?.({
      stage: options?.failureStage ?? "failed",
      queryLabel,
      datasetId,
      workspaceId,
      error: summarizedError,
    });
    throw new Error(`executeQueries failed (${response.status})${summarizedError ? `: ${summarizedError}` : ""}`);
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    payload = {};
  }
  onApiCallEvent?.({
    stage: "succeeded",
    queryLabel,
    datasetId,
    workspaceId,
  });
  const rows = payload?.results?.[0]?.tables?.[0]?.rows;
  return Array.isArray(rows) ? rows : [];
}

async function loadSemanticModelEntitiesViaAnalyzer(
  workloadClient: WorkloadClientAPI,
  workspaceId: string,
  datasetId: string,
  onApiCallEvent?: (event: DirectApiCallEvent) => void,
  context?: { workspaceName?: string; datasetName?: string },
  onRawApiResponse?: (snapshot: RawApiResponseSnapshot) => void
): Promise<DirectSemanticLoadResult> {
  onApiCallEvent?.({
    stage: "started",
    queryLabel: "XMLA_ANALYZER",
    datasetId,
    workspaceId,
  });

  const accessToken = await acquireFabricTokenWithScopes(workloadClient, [POWER_BI_XMLA_SCOPE]);
  const query = new URLSearchParams();
  if (context?.workspaceName) {
    query.set("workspaceName", context.workspaceName);
  }
  if (context?.datasetName) {
    query.set("datasetName", context.datasetName);
  }

  const endpoint = `/api/semantic/models/${encodeURIComponent(workspaceId)}/${encodeURIComponent(datasetId)}/entities${query.toString() ? `?${query.toString()}` : ""}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const rawBody = await response.text().catch(() => "");
  onRawApiResponse?.({
    apiType: "semantic-analyzer",
    queryLabel: "XMLA_ANALYZER",
    workspaceId,
    datasetId,
    request: {
      method: "GET",
      url: endpoint,
    },
    response: {
      ok: response.ok,
      status: response.status,
      body: rawBody,
    },
    capturedAt: new Date().toISOString(),
  });

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const backendMessage =
      (payload as any)?.message ||
      (payload as any)?.error ||
      `Semantic analyzer request failed (${response.status}).`;
    onApiCallEvent?.({
      stage: "failed",
      queryLabel: "XMLA_ANALYZER",
      datasetId,
      workspaceId,
      error: String(backendMessage),
    });
    throw new Error(String(backendMessage));
  }

  const entitiesRaw = Array.isArray((payload as any)?.entities) ? (payload as any).entities : [];
  const dependenciesRaw = Array.isArray((payload as any)?.dependencies) ? (payload as any).dependencies : [];

  const entities: DirectSemanticEntity[] = entitiesRaw
    .filter((entity: any) => entity?.id && entity?.name && entity?.type)
    .map((entity: any) => ({
      id: String(entity.id),
      name: String(entity.name),
      type: String(entity.type),
      tableName: entity.tableName ? String(entity.tableName) : undefined,
      dataType: entity.dataType ? String(entity.dataType) : undefined,
      expression: entity.expression ? String(entity.expression) : undefined,
    }));

  const analyzerDependencies: DirectSemanticDependency[] = dependenciesRaw
    .filter((dependency: any) => dependency?.sourceId && dependency?.targetId)
    .map((dependency: any) => ({
      sourceId: String(dependency.sourceId),
      targetId: String(dependency.targetId),
      dependencyType: dependency.dependencyType ? String(dependency.dependencyType) : "expression",
    }));

  // Analyzer coverage can vary by model shape; merge with expression-derived dependencies
  // to improve measure lineage completeness.
  const expressionDependencies = buildExpressionDependencies(entities);
  const mergedDependencies = new Map<string, DirectSemanticDependency>();
  for (const dep of analyzerDependencies) {
    mergedDependencies.set(`${dep.sourceId}->${dep.targetId}`, dep);
  }
  for (const dep of expressionDependencies) {
    const key = `${dep.sourceId}->${dep.targetId}`;
    if (!mergedDependencies.has(key)) {
      mergedDependencies.set(key, dep);
    }
  }

  onApiCallEvent?.({
    stage: "succeeded",
    queryLabel: "XMLA_ANALYZER",
    datasetId,
    workspaceId,
  });

  return { entities, dependencies: Array.from(mergedDependencies.values()), source: "xmla-analyzer" };
}

async function loadSemanticModelEntitiesDirect(
  workloadClient: WorkloadClientAPI,
  workspaceId: string,
  datasetId: string,
  onApiCallEvent?: (event: DirectApiCallEvent) => void,
  context?: { workspaceName?: string; datasetName?: string },
  onRawApiResponse?: (snapshot: RawApiResponseSnapshot) => void
): Promise<DirectSemanticLoadResult> {
  try {
    return await loadSemanticModelEntitiesViaAnalyzer(
      workloadClient,
      workspaceId,
      datasetId,
      onApiCallEvent,
      context,
      onRawApiResponse
    );
  } catch (error) {
    const errorText = formatUnknownError(error);
    onApiCallEvent?.({
      stage: "warning",
      queryLabel: "XMLA_ANALYZER",
      datasetId,
      workspaceId,
      error: `Analyzer unavailable for this model; falling back to client-side extraction. ${errorText}`,
    });
  }

  const [tableRows, columnRows, measureRows] = await Promise.all([
    executeXmlaQueryDirect(
      workloadClient,
      workspaceId,
      datasetId,
      "EVALUATE SELECTCOLUMNS(INFO.VIEW.TABLES(), \"TableName\", [Name])",
      "INFO.VIEW.TABLES",
      onApiCallEvent,
      undefined,
      onRawApiResponse
    ),
    executeXmlaQueryDirect(
      workloadClient,
      workspaceId,
      datasetId,
      "EVALUATE SELECTCOLUMNS(INFO.VIEW.COLUMNS(), \"TableName\", [Table], \"Name\", [Name], \"DataType\", [DataType], \"Expression\", [Expression])",
      "INFO.VIEW.COLUMNS",
      onApiCallEvent,
      undefined,
      onRawApiResponse
    ),
    executeXmlaQueryDirect(
      workloadClient,
      workspaceId,
      datasetId,
      "EVALUATE SELECTCOLUMNS(INFO.VIEW.MEASURES(), \"TableName\", [Table], \"Name\", [Name], \"Expression\", [Expression])",
      "INFO.VIEW.MEASURES",
      onApiCallEvent,
      undefined,
      onRawApiResponse
    ),
  ]);

  const entities: DirectSemanticEntity[] = [];

  for (const row of tableRows) {
    const tableName = getRowValue(row, ["TableName", "[TableName]", "Name", "[Name]"]);
    if (!tableName) continue;
    entities.push({
      id: `table:${datasetId}|${tableName}`,
      name: tableName,
      type: "Table",
      tableName,
    });
  }

  for (const row of columnRows) {
    const tableName = getRowValue(row, ["TableName", "[TableName]", "Table", "[Table]"]);
    const name = getRowValue(row, ["Name", "[Name]", "ColumnName", "[ColumnName]"]);
    if (!tableName || !name) continue;
    const id = `col:${datasetId}|${tableName}|${name}`;
    entities.push({
      id,
      name,
      type: "Column",
      tableName,
      dataType: getRowValue(row, ["DataType", "[DataType]"]),
      expression: getRowValue(row, ["Expression", "[Expression]"]),
    });
  }

  for (const row of measureRows) {
    const tableName = getRowValue(row, ["TableName", "[TableName]", "Table", "[Table]"]);
    const name = getRowValue(row, ["Name", "[Name]", "MeasureName", "[MeasureName]"]);
    if (!tableName || !name) continue;
    const id = `measure:${datasetId}|${tableName}|${name}`;
    entities.push({
      id,
      name,
      type: "Measure",
      tableName,
      expression: getRowValue(row, ["Expression", "[Expression]"]),
    });
  }

  const dependencies = buildExpressionDependencies(entities);

  return { entities, dependencies, source: "client-fallback" };
}

function normalizeReportObjectType(value: string | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("measure")) return "measure";
  if (normalized.includes("column")) return "column";
  return "unknown";
}

function decodeInlineBase64Payload(payload: string): string {
  try {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function tryParseJson(value: string): any | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseDefinitionPart(part: { payload: string; payloadType?: string }): any | undefined {
  const payloadType = String(part.payloadType || "InlineBase64");
  if (payloadType === "InlineJson") {
    if (typeof part.payload === "string") {
      return tryParseJson(part.payload) ?? part.payload;
    }
    return part.payload;
  }

  const decoded = decodeInlineBase64Payload(String(part.payload || ""));
  if (!decoded) {
    return undefined;
  }
  return tryParseJson(decoded) ?? decoded;
}

function addSemanticRef(
  refMap: Map<string, ReportSemanticRef>,
  tableName: string | undefined,
  objectName: string | undefined,
  objectType?: string
): void {
  const normalizedObjectName = String(objectName ?? "").trim();
  if (!normalizedObjectName) {
    return;
  }
  const normalizedTableName = String(tableName ?? "").trim();
  const normalizedType = normalizeReportObjectType(objectType);
  const key = `${normalizedTableName.toLowerCase()}|${normalizedObjectName.toLowerCase()}|${normalizedType}`;
  if (!refMap.has(key)) {
    refMap.set(key, {
      tableName: normalizedTableName || undefined,
      objectName: normalizedObjectName,
      objectType: normalizedType,
    });
  }
}

function addSemanticRefFromQueryRef(refMap: Map<string, ReportSemanticRef>, queryRef: string): void {
  const normalized = String(queryRef || "").trim();
  if (!normalized) {
    return;
  }

  const bracketMatch = normalized.match(/^'?([^'\[]+)'?\[([^\]]+)\]$/);
  if (bracketMatch) {
    addSemanticRef(refMap, bracketMatch[1], bracketMatch[2], "unknown");
    return;
  }

  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex > 0) {
    addSemanticRef(refMap, normalized.slice(0, dotIndex), normalized.slice(dotIndex + 1), "unknown");
    return;
  }

  addSemanticRef(refMap, undefined, normalized, "unknown");
}

function extractVisualSemanticRefs(value: any): ReportSemanticRef[] {
  const refs = new Map<string, ReportSemanticRef>();

  const visit = (candidate: any): void => {
    if (candidate == null) {
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => visit(entry));
      return;
    }
    if (typeof candidate !== "object") {
      return;
    }

    const queryRef = (candidate as any).queryRef;
    if (typeof queryRef === "string") {
      addSemanticRefFromQueryRef(refs, queryRef);
    }

    const sourceRefEntity = (candidate as any)?.SourceRef?.Entity;
    const sourceProperty = (candidate as any)?.Property;
    if (typeof sourceRefEntity === "string" && typeof sourceProperty === "string") {
      addSemanticRef(refs, sourceRefEntity, sourceProperty, (candidate as any).Kind);
    }

    const expressionSourceRef = (candidate as any)?.Expression?.SourceRef?.Entity;
    const expressionProperty = (candidate as any)?.Expression?.Property;
    if (typeof expressionSourceRef === "string" && typeof expressionProperty === "string") {
      addSemanticRef(refs, expressionSourceRef, expressionProperty, (candidate as any).Kind);
    }

    const expressionValue = (candidate as any)?.expression;
    if (typeof expressionValue === "string") {
      for (const token of expressionValue.match(/'[^']+'\[[^\]]+\]|\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\b/g) || []) {
        addSemanticRefFromQueryRef(refs, token);
      }
    }

    for (const nested of Object.values(candidate)) {
      visit(nested);
    }
  };

  visit(value);
  return Array.from(refs.values());
}

function tryParseVisualConfig(value: any): any {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    return tryParseJson(value) ?? value;
  }
  return value;
}

function resolveReportVisualType(visualPayload: any, configPayload?: any): string {
  const directCandidates = [
    visualPayload?.visualType,
    visualPayload?.type,
    visualPayload?.visual?.visualType,
    visualPayload?.singleVisual?.visualType,
    visualPayload?.visualContainerType,
  ];

  const parsedConfig = tryParseVisualConfig(configPayload);
  const configCandidates = [
    parsedConfig?.singleVisual?.visualType,
    parsedConfig?.visual?.visualType,
    parsedConfig?.type,
    parsedConfig?.visualType,
    parsedConfig?.singleVisual?.prototypeQuery?.Type,
  ];

  for (const candidate of [...directCandidates, ...configCandidates]) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

async function loadReportMetadataDirect(
  workloadClient: WorkloadClientAPI,
  itemClient: ItemClient,
  workspaceId: string,
  reportId: string,
  reportName: string,
  onRawApiResponse?: (snapshot: RawApiResponseSnapshot) => void,
  onApiCallStatus?: (event: DirectApiCallEvent) => void
): Promise<DirectReportLoadResult> {
  const accessToken = await acquireFabricTokenWithScopes(workloadClient, [POWER_BI_REPORT_SCOPE]);

  const reportDetailUrl = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}`;
  let datasetId: string | undefined;
  const callIdentity = {
    datasetId: reportId,
    workspaceId,
  };

  try {
    onApiCallStatus?.({
      stage: "started",
      queryLabel: "REPORT_DETAIL",
      ...callIdentity,
    });
    const reportDetailResponse = await fetch(reportDetailUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const detailBody = await reportDetailResponse.text().catch(() => "");
    onRawApiResponse?.({
      apiType: "report-detail",
      queryLabel: "REPORT_DETAIL",
      workspaceId,
      datasetId: reportId,
      request: {
        method: "GET",
        url: reportDetailUrl,
      },
      response: {
        ok: reportDetailResponse.ok,
        status: reportDetailResponse.status,
        body: detailBody,
      },
      capturedAt: new Date().toISOString(),
    });

    if (reportDetailResponse.ok) {
      onApiCallStatus?.({
        stage: "succeeded",
        queryLabel: "REPORT_DETAIL",
        ...callIdentity,
      });
      const reportDetail = tryParseJson(detailBody) as any;
      if (reportDetail?.datasetId) {
        datasetId = String(reportDetail.datasetId);
      }
    } else {
      onApiCallStatus?.({
        stage: "warning",
        queryLabel: "REPORT_DETAIL",
        ...callIdentity,
        error: `HTTP ${reportDetailResponse.status}`,
      });
    }
  } catch (error) {
    const errorText = formatUnknownError(error);
    onApiCallStatus?.({
      stage: "warning",
      queryLabel: "REPORT_DETAIL",
      ...callIdentity,
      error: errorText,
    });
    // Report detail is best-effort; continue with definition parsing.
  }

  onApiCallStatus?.({
    stage: "started",
    queryLabel: "REPORT_DEFINITION",
    ...callIdentity,
  });
  const definitionResponse = await itemClient.getItemDefinitionWithPolling(workspaceId, reportId);
  const definition = definitionResponse?.definition;
  const parts = Array.isArray(definition?.parts) ? definition.parts : [];
  onApiCallStatus?.({
    stage: "succeeded",
    queryLabel: "REPORT_DEFINITION",
    ...callIdentity,
  });

  onRawApiResponse?.({
    apiType: "report-definition",
    queryLabel: "REPORT_DEFINITION",
    workspaceId,
    datasetId: reportId,
    request: {
      method: "POST",
      url: `/workspaces/${workspaceId}/items/${reportId}/getDefinition`,
    },
    response: {
      ok: true,
      status: 200,
      body: JSON.stringify({
        partCount: parts.length,
        format: definition?.format,
        paths: parts.map((part: any) => part.path),
      }),
    },
    capturedAt: new Date().toISOString(),
  });

  const pagesById = new Map<string, ReportPageMetadata>();
  const visuals: ReportVisualMetadata[] = [];

  const ensurePage = (pageId: string, pageName?: string, displayName?: string): ReportPageMetadata => {
    const normalizedPageId = String(pageId || "").trim();
    const normalizedPageName = String(pageName || normalizedPageId).trim() || normalizedPageId;
    const normalizedDisplayName = String(displayName || normalizedPageName).trim() || normalizedPageName;
    const existing = pagesById.get(normalizedPageId);
    if (existing) {
      if (!existing.displayName && normalizedDisplayName) {
        existing.displayName = normalizedDisplayName;
      }
      return existing;
    }

    const page: ReportPageMetadata = {
      pageId: normalizedPageId,
      pageName: normalizedPageName,
      displayName: normalizedDisplayName,
    };
    pagesById.set(normalizedPageId, page);
    return page;
  };

  for (const part of parts) {
    const rawPath = String((part as any).path || "");
    const path = rawPath.replace(/\\/g, "/");
    const parsed = parseDefinitionPart(part as any);

    const pageMatch = path.match(/pages\/([^/]+)\/page\.json$/i);
    if (pageMatch && parsed && typeof parsed === "object") {
      const pageId = String(pageMatch[1]);
      const pageName = String((parsed as any).name || pageId);
      const displayName = String((parsed as any).displayName || pageName || pageId);
      ensurePage(pageId, pageName, displayName);
      continue;
    }

    const visualMatch = path.match(/pages\/([^/]+)\/visuals\/([^/]+)\/visual\.json$/i);
    if (visualMatch && parsed && typeof parsed === "object") {
      const pageId = String(visualMatch[1]);
      const visualId = String(visualMatch[2]);
      const page = ensurePage(pageId, pageId, pageId);
      visuals.push({
        visualId,
        visualName: String((parsed as any).name || visualId),
        visualType: resolveReportVisualType(parsed, (parsed as any)?.config),
        pageId,
        pageName: page.displayName || page.pageName,
        semanticRefs: extractVisualSemanticRefs(parsed),
      });
      continue;
    }

    const isReportRoot = /report\.json$/i.test(path);
    if (isReportRoot && parsed && typeof parsed === "object") {
      const sections = Array.isArray((parsed as any).sections) ? (parsed as any).sections : [];
      for (const section of sections) {
        const pageId = String((section as any).name || (section as any).id || "").trim();
        if (!pageId) {
          continue;
        }
        const pageDisplay = String((section as any).displayName || (section as any).title || pageId);
        ensurePage(pageId, pageId, pageDisplay);

        const visualContainers = Array.isArray((section as any).visualContainers) ? (section as any).visualContainers : [];
        for (let index = 0; index < visualContainers.length; index += 1) {
          const container = visualContainers[index] as any;
          const visualId = String(container?.name || `visual_${index + 1}`);
          const configParsed = typeof container?.config === "string"
            ? tryParseJson(container.config) || container.config
            : container?.config;

          const title = String((configParsed as any)?.singleVisual?.vcObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value || visualId);
          const visualType = resolveReportVisualType(container, configParsed);

          visuals.push({
            visualId,
            visualName: title,
            visualType,
            pageId,
            pageName: pageDisplay,
            semanticRefs: extractVisualSemanticRefs(configParsed),
          });
        }
      }
    }
  }

  return {
    reportId,
    reportName,
    workspaceId,
    datasetId,
    pages: Array.from(pagesById.values()),
    visuals,
  };
}

function extractTablePathInfoFromOneLakePath(pathName: string, artifactId: string): { schemaName?: string; tableName?: string } {
  const normalized = String(pathName || "").replace(/\\/g, "/").trim();
  if (!normalized) {
    return {};
  }

  const segments = normalized.split("/").filter(Boolean);
  const tablesIndex = segments.findIndex((segment) => segment.toLowerCase() === "tables");
  if (tablesIndex >= 0) {
    const afterTables = segments.slice(tablesIndex + 1).filter(Boolean);
    if (afterTables.length >= 2) {
      return {
        schemaName: afterTables[0],
        tableName: afterTables[1],
      };
    }
    if (afterTables.length === 1) {
      return {
        tableName: afterTables[0],
      };
    }
  }

  if (segments.length >= 2 && segments[0].toLowerCase() === artifactId.toLowerCase()) {
    return {
      tableName: segments[segments.length - 1],
    };
  }

  if (segments.length >= 1) {
    return {
      tableName: segments[segments.length - 1],
    };
  }

  return {};
}

async function loadTabularArtifactTablesDirect(
  oneLakeStorageClient: OneLakeStorageClient,
  workspaceId: string,
  artifactId: string,
  artifactType: "lakehouse" | "warehouse",
  addRawApiResponseSnapshot?: (snapshot: RawApiResponseSnapshot) => void,
  onApiCallStatus?: (event: DirectApiCallEvent) => void
): Promise<Array<{
  schemaName?: string;
  tableName: string;
  storagePath?: string;
  isShortcut?: boolean;
  lastModified?: string;
  contentLength?: number;
}>> {
  try {
    const oneLakeDirectory = `${artifactId}/Tables`;
    onApiCallStatus?.({
      stage: "started",
      queryLabel: `ONELAKE_${artifactType.toUpperCase()}_TABLES`,
      datasetId: artifactId,
      workspaceId,
    });
    const listing = await oneLakeStorageClient.getPathMetadata(
      workspaceId,
      oneLakeDirectory,
      true,
      true
    );
    onApiCallStatus?.({
      stage: "succeeded",
      queryLabel: `ONELAKE_${artifactType.toUpperCase()}_TABLES`,
      datasetId: artifactId,
      workspaceId,
    });
    if (addRawApiResponseSnapshot) {
      addRawApiResponseSnapshot({
        apiType: "onelake-path-metadata",
        queryLabel: `Onelake ${artifactType} tables`,
        workspaceId,
        datasetId: artifactId,
        request: {
          method: "GET",
          url: `/onelake/${workspaceId}?directory=${encodeURIComponent(oneLakeDirectory)}&recursive=false&resource=filesystem&getShortcutMetadata=true`,
        },
        response: {
          ok: true,
          status: 200,
          body: JSON.stringify(listing),
        },
        capturedAt: new Date().toISOString(),
      });
    }
    const paths = Array.isArray(listing?.paths) ? listing.paths : [];
    const tables = new Map<string, {
      schemaName?: string;
      tableName: string;
      storagePath?: string;
      isShortcut?: boolean;
      lastModified?: string;
      contentLength?: number;
    }>();

    for (const entry of paths) {
      if ((entry as any)?.isDirectory === false) {
        continue;
      }
      const pathName = String((entry as any)?.name || "");
      const tableInfo = extractTablePathInfoFromOneLakePath(pathName, artifactId);
      const tableName = tableInfo.tableName;
      if (!tableName) {
        continue;
      }

      const schemaName = tableInfo.schemaName?.trim();
      const key = `${(schemaName || "").toLowerCase()}|${tableName.toLowerCase()}`;
      if (!tables.has(key)) {
        tables.set(key, {
          schemaName,
          tableName,
          storagePath: pathName,
          isShortcut: Boolean((entry as any)?.isShortcut),
          lastModified: typeof (entry as any)?.lastModified === "string" ? (entry as any).lastModified : undefined,
          contentLength: typeof (entry as any)?.contentLength === "number" ? (entry as any).contentLength : undefined,
        });
      }
    }

    return Array.from(tables.values());
  } catch (error) {
    const formattedError = formatUnknownError(error);
    onApiCallStatus?.({
      stage: "failed",
      queryLabel: `ONELAKE_${artifactType.toUpperCase()}_TABLES`,
      datasetId: artifactId,
      workspaceId,
      error: formattedError,
    });
    console.warn("[LineageExtraction] Unable to list tabular artifact tables", {
      workspaceId,
      artifactId,
      artifactType,
      error: formattedError,
    });
    return [];
  }
}

const useStyles = makeStyles({
  root: {
    padding: tokens.spacingVerticalXL,
    maxWidth: "720px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXL,
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: tokens.spacingVerticalS,
  },
  sectionBody: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  runSection: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalL,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  progressItem: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalS,
  },
});

interface LineageWorkbenchItemExtractionViewProps {
  workloadClient: WorkloadClientAPI;
  workspaceId: string;
  extraction: LineageWorkbenchExtractionConfig;
  onExtractionChange: (next: LineageWorkbenchExtractionConfig) => void;
  onSave?: () => Promise<void>;
}

export function LineageWorkbenchItemExtractionView(props: LineageWorkbenchItemExtractionViewProps) {
  const { workloadClient, workspaceId, extraction, onExtractionChange, onSave } = props;
  const { t } = useTranslation();
  const styles = useStyles();
  const frontendAppId = process.env.FRONTEND_APPID || "";
  const configuredTenantId = process.env.TENANT_ID || "";

  const openInNewTab = (path: string) => {
    window.open(path, "_blank", "noopener,noreferrer");
  };

  const [isRunning, setIsRunning] = useState(false);
  const [currentRun, setCurrentRun] = useState<string | null>(null);
  const [completedRuns, setCompletedRuns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isWorkspaceWizardOpen, setIsWorkspaceWizardOpen] = useState(false);
  const [isArtifactWizardOpen, setIsArtifactWizardOpen] = useState(false);
  const [isTestingAzureOpenAI, setIsTestingAzureOpenAI] = useState(false);
  const [azureOpenAITestStatus, setAzureOpenAITestStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);
  const [saveIndicator, setSaveIndicator] = useState<{ status: "idle" | "saving" | "saved" | "error"; message?: string }>({
    status: "idle",
  });
  const saveRequestIdRef = useRef(0);
  const [runQueue, setRunQueue] = useState<string[]>([]);
  const [apiCallStats, setApiCallStats] = useState<ApiCallStats>({
    attempted: 0,
    succeeded: 0,
    failed: 0,
    warnings: 0,
    failures: [],
    warningMessages: [],
    callLog: [],
    datasets: {},
  });
  const apiCallStatsRef = useRef<ApiCallStats>({
    attempted: 0,
    succeeded: 0,
    failed: 0,
    warnings: 0,
    failures: [],
    warningMessages: [],
    callLog: [],
    datasets: {},
  });
  const datasetNamesRef = useRef<Record<string, string>>({});
  const inferredAuthTenantId = extractTenantIdFromAuthErrorMessage(error);
  const authErrorTenantId = inferredAuthTenantId || configuredTenantId || null;
  const adminConsentUrl = buildAdminConsentUrl(authErrorTenantId, frontendAppId);
  const [lastRunApiCallStats, setLastRunApiCallStats] = useState<ApiCallStats | null>(null);

  const RUN_LABEL_BY_NAME = useMemo<Record<string, string>>(() => ({
    "1_LineageWorkbench_Extract_And_Build": t("LineageWorkbench_Extraction_Notebook1_Label", "Start extraction"),
  }), [t]);

  const RUN_DESCRIPTION_BY_NAME = useMemo<Record<string, string>>(() => ({
    "1_LineageWorkbench_Extract_And_Build": t(
      "LineageWorkbench_Extraction_Notebook1_Description",
      "Extracts raw metadata from the selected workspaces and builds the core lineage tables."
    ),
  }), [t]);

  const extractionRunOrder = ["1_LineageWorkbench_Extract_And_Build"];

  const testAzureOpenAIConfiguration = useCallback(async () => {
    setAzureOpenAITestStatus(null);

    const config = extraction.azureOpenAI;
    const normalizedEndpoint = String(config?.endpoint ?? "").trim();
    const normalizedApiKey = String(config?.apiKey ?? "").trim();
    const normalizedDeploymentName = String(config?.deploymentName ?? "gpt-4").trim();

    if (!config?.enabled) {
      setAzureOpenAITestStatus({
        success: false,
        message: t("LineageWorkbench_Extraction_AzureOpenAI_Test_NotEnabled", "Enable Azure OpenAI first."),
      });
      return;
    }

    if (!normalizedEndpoint || !normalizedApiKey || !normalizedDeploymentName) {
      setAzureOpenAITestStatus({
        success: false,
        message: t(
          "LineageWorkbench_Extraction_AzureOpenAI_Test_MissingFields",
          "Endpoint, API key, and deployment name are required for testing."
        ),
      });
      return;
    }

    setIsTestingAzureOpenAI(true);
    try {
      setAzureOpenAITestStatus({
        success: true,
        message:
          [
            t(
              "LineageWorkbench_Extraction_AzureOpenAI_Test_ClientOnly",
              "Configuration looks ready. Connection testing is disabled in client-only mode."
            ),
          ]
            .filter(Boolean)
            .join("\n"),
      });
    } catch (testError) {
      const message = formatUnknownError(testError);
      setAzureOpenAITestStatus({ success: false, message });
    } finally {
      setIsTestingAzureOpenAI(false);
    }
  }, [extraction.azureOpenAI, t]);

  const updateApiCallStats = useCallback((event: DirectApiCallEvent) => {
    const next = {
      ...apiCallStatsRef.current,
      datasets: { ...apiCallStatsRef.current.datasets },
    };
    const datasetName = datasetNamesRef.current[event.datasetId] || event.datasetId;
    const capturedAt = event.capturedAt || new Date().toISOString();
    const datasetSummary = next.datasets[event.datasetId] || {
      datasetId: event.datasetId,
      datasetName,
      workspaceId: event.workspaceId,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      warnings: 0,
      failures: [],
      warningMessages: [],
    };

    if (event.stage === "started") {
      next.attempted += 1;
      datasetSummary.attempted += 1;
    } else if (event.stage === "succeeded") {
      next.succeeded += 1;
      datasetSummary.succeeded += 1;
    } else if (event.stage === "failed") {
      next.failed += 1;
      datasetSummary.failed += 1;
      const message = formatApiIssueMessage(event);
      next.failures = [...next.failures, message].slice(-MAX_STATUS_MESSAGES);
      datasetSummary.failures = [...datasetSummary.failures, message].slice(-MAX_STATUS_MESSAGES);
    } else if (event.stage === "warning") {
      next.warnings += 1;
      datasetSummary.warnings += 1;
      const message = formatApiIssueMessage(event);
      next.warningMessages = [...next.warningMessages, message].slice(-MAX_STATUS_MESSAGES);
      datasetSummary.warningMessages = [...datasetSummary.warningMessages, message].slice(-MAX_STATUS_MESSAGES);
    }

    const logEntry: ApiCallLogEntry = {
      sequence: next.callLog.length + 1,
      stage: event.stage,
      queryLabel: event.queryLabel,
      datasetId: event.datasetId,
      datasetName,
      workspaceId: event.workspaceId,
      error: event.error,
      capturedAt,
    };
    next.callLog = [...next.callLog, logEntry].slice(-MAX_STATUS_CALL_LOG);

    next.datasets[event.datasetId] = datasetSummary;

    apiCallStatsRef.current = next;
    setApiCallStats(next);
  }, []);

  const persistExtractionChange = useCallback(
    (next: LineageWorkbenchExtractionConfig): void => {
      onExtractionChange(next);
      if (onSave) {
        const requestId = ++saveRequestIdRef.current;
        setSaveIndicator({ status: "saving" });
        setTimeout(() => {
          void onSave()
            .then(() => {
              if (saveRequestIdRef.current === requestId) {
                setSaveIndicator({ status: "saved" });
              }
            })
            .catch((error) => {
              if (saveRequestIdRef.current === requestId) {
                const message = formatUnknownError(error);
                setSaveIndicator({ status: "error", message });
              }
            });
        }, 100);
      } else {
        setSaveIndicator({ status: "saved" });
      }
    },
    [onExtractionChange, onSave]
  );
  const handleSelectArtifacts = async () => {
    setIsArtifactWizardOpen(true);
  };

  const handleArtifactSelectionComplete = (result: ArtifactSelectionResult) => {
    persistExtractionChange({
      ...extraction,
      selectedArtifactIds: result.selectedArtifactIds,
      selectedArtifactLabels: result.selectedArtifactLabels,
      artifactSelector: result.artifactSelector,
    });
  };

  const handleSelectWorkspaces = () => {
    setIsWorkspaceWizardOpen(true);
  };

  const formatExtractionRunError = (error: unknown): string => {
    const getWorkloadAuthErrorMessage = (code: number): string => {
      switch (code) {
        case 0:
          return "Authentication is not available in the current Fabric context.";
        case 1:
          return "User interaction failed during authentication.";
        case 2:
          return "Workload authentication is misconfigured (redirect URI or audience mismatch).";
        case 3:
          return "Unknown authentication error while acquiring Fabric access token.";
        case 4:
          return "Invalid or unsupported authentication scopes were requested.";
        default:
          return `Authentication failed with error code ${code}.`;
      }
    };

    if (!error) {
      return "Unknown error";
    }

    if (error instanceof Error) {
      return error.message || "Unknown error";
    }

    if (typeof error === "object") {
      const payload = error as Record<string, unknown>;
      const workloadAuthErrorCode = typeof payload.error === "number" ? payload.error : undefined;

      const status = payload.status ?? payload.statusCode;
      const topMessage = typeof payload.message === "string" ? payload.message : "";

      const nestedError = payload.error as Record<string, unknown> | number | string | undefined;
      const nestedMessage =
        typeof nestedError === "object" && nestedError !== null && typeof nestedError.message === "string"
          ? nestedError.message
          : "";

      const nestedCode =
        typeof nestedError === "object" && nestedError !== null && typeof nestedError.code === "string"
          ? nestedError.code
          : typeof nestedError === "number"
            ? `WorkloadAuthError.${nestedError}`
            : "";

      if (workloadAuthErrorCode !== undefined) {
        return `${getWorkloadAuthErrorMessage(workloadAuthErrorCode)} Please refresh Fabric, sign in again, and retry extraction.`;
      }

      if (topMessage && status) {
        return `${status}: ${topMessage}`;
      }

      if (nestedCode && nestedMessage) {
        return `${nestedCode}: ${nestedMessage}`;
      }

      if (topMessage) {
        return topMessage;
      }

      if (nestedMessage) {
        return nestedMessage;
      }

      if (typeof nestedError === "string" && nestedError.trim()) {
        return nestedError;
      }

      if (status) {
        return String(status);
      }

      try {
        return JSON.stringify(error);
      } catch {
        return "Unknown error";
      }
    }

    return String(error);
  };

  const logVerboseExtractionError = (phase: string, error: unknown): void => {
    if (!error || typeof error !== "object") {
      console.error("[LineageExtraction] Failure", { phase, raw: error });
      return;
    }

    const payload = error as Record<string, unknown>;
    const nested = typeof payload.error === "object" && payload.error !== null
      ? (payload.error as Record<string, unknown>)
      : undefined;

    console.error("[LineageExtraction] Failure", {
      phase,
      status: payload.status ?? payload.statusCode,
      message: payload.message,
      topLevelError: payload.error,
      nestedCode: nested?.code,
      nestedMessage: nested?.message,
      nestedDetails: nested?.details,
      rawPayload: payload,
    });
  };

  const handleWorkspaceSelectionComplete = (result: WorkspaceSelectionResult) => {
    persistExtractionChange({
      ...extraction,
      targetWorkspaces: result.workspaceIds,
      targetWorkspaceNames: result.workspaceNames,
      targetWorkspaceTypes: result.workspaceTypes,
    });
  };

  const runExtraction = useCallback(async (runName: string) => {
    const needsWorkspaces = runName === "1_LineageWorkbench_Extract_And_Build";

    if (needsWorkspaces && (!extraction.targetWorkspaces || extraction.targetWorkspaces.length === 0)) {
      setError("Please select at least one source workspace before running the extraction flow.");
      return;
    }

    setIsRunning(true);
    setError(null);
    setCurrentRun(runName);
    setCompletedRuns([]);
    setRunQueue([runName]);
    const initialCallStats: ApiCallStats = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      warnings: 0,
      failures: [],
      warningMessages: [],
      callLog: [],
      datasets: {},
    };
    datasetNamesRef.current = {};
    apiCallStatsRef.current = initialCallStats;
    setApiCallStats(initialCallStats);
    setLastRunApiCallStats(null);

    try {
      // Establish auth context first, then request additional scopes progressively,
      // following the Fabric authentication guidance. Don't hard-fail if this warmup
      // request is rejected by host-specific scope validation.
      try {
        await callAcquireFrontendAccessToken(workloadClient, "");
      } catch (authContextError) {
        console.warn("[LineageExtraction] Initial auth context token request failed; continuing with scoped requests", authContextError);
      }

      // Acquire required scopes immediately from the user action path so consent opens
      // in the expected Fabric auth window before long-running extraction starts.
      await acquireFabricTokenWithScopes(workloadClient, [POWER_BI_XMLA_SCOPE]);
      await acquireFabricTokenWithScopes(workloadClient, [POWER_BI_REPORT_SCOPE]);

      const itemClient = new ItemClient(workloadClient);
      const selectedWorkspaces = extraction.targetWorkspaces && extraction.targetWorkspaces.length > 0
        ? extraction.targetWorkspaces
        : [workspaceId];

      const workspaceArtifacts: Array<{ id: string; displayName: string; type: string; workspaceId: string }> = [];
      for (const workspaceIdToScan of selectedWorkspaces) {
        const items = await itemClient.listItems(workspaceIdToScan);
        for (const item of items.value ?? []) {
          if (!item?.id || !item?.displayName) continue;
          const type = String(item.type ?? "artifact");
          if (["Report", "SemanticModel", "Lakehouse", "Warehouse", "Notebook", "Dataflow", "Pipeline"].includes(type)) {
            workspaceArtifacts.push({
              id: item.id,
              displayName: item.displayName,
              type,
              workspaceId: workspaceIdToScan,
            });
          }
        }
      }

      const semanticModelDataByModelId: Record<string, {
        entities?: Array<{
          id: string;
          name: string;
          type: string;
          tableName?: string;
          dataType?: string;
          expression?: string;
        }>;
        dependencies?: Array<{
          sourceId: string;
          targetId: string;
          dependencyType?: string;
        }>;
      }> = {};
      const reportDataByReportId: Record<string, {
        datasetId?: string;
        pages?: Array<{ pageId: string; pageName: string; displayName?: string }>;
        visuals?: Array<{
          visualId: string;
          visualName: string;
          visualType?: string;
          pageId: string;
          pageName: string;
          semanticRefs?: Array<{ tableName?: string; objectName: string; objectType?: string }>;
        }>;
      }> = {};
      const lakehouseDataByArtifactId: Record<string, {
        tables?: Array<{
          schemaName?: string;
          tableName: string;
          storagePath?: string;
          isShortcut?: boolean;
          lastModified?: string;
          contentLength?: number;
        }>;
      }> = {};
      const warehouseDataByArtifactId: Record<string, {
        tables?: Array<{
          schemaName?: string;
          tableName: string;
          storagePath?: string;
          lastModified?: string;
          contentLength?: number;
        }>;
      }> = {};
      const semanticApiResultSnapshots: Array<Record<string, unknown>> = [];
      const rawApiResponseSnapshots: RawApiResponseSnapshot[] = [];

      const addRawApiResponseSnapshot = (snapshot: RawApiResponseSnapshot): void => {
        rawApiResponseSnapshots.push(snapshot);
      };

      const selectedArtifactIdsSet = new Set((extraction.selectedArtifactIds || []).filter(Boolean));
      const explicitArtifactIdsSet = new Set<string>();
      Object.values(extraction.artifactSelector || {}).forEach((list) => {
        (list || []).filter(Boolean).forEach((id) => explicitArtifactIdsSet.add(id));
      });

      const isArtifactSelected = (artifact: { id: string }): boolean => {
        if (selectedArtifactIdsSet.size > 0 && !selectedArtifactIdsSet.has(artifact.id)) {
          return false;
        }
        if (explicitArtifactIdsSet.size > 0 && !explicitArtifactIdsSet.has(artifact.id)) {
          return false;
        }
        return true;
      };

      const semanticModelArtifacts = workspaceArtifacts.filter((artifact) =>
        String(artifact.type).toLowerCase() === "semanticmodel" && isArtifactSelected(artifact)
      );
      datasetNamesRef.current = semanticModelArtifacts.reduce<Record<string, string>>((acc, artifact) => {
        acc[artifact.id] = artifact.displayName || artifact.id;
        return acc;
      }, {});
      for (const semanticModel of semanticModelArtifacts) {
        try {
          const modelData = await loadSemanticModelEntitiesDirect(
            workloadClient,
            semanticModel.workspaceId,
            semanticModel.id,
            updateApiCallStats,
            {
              datasetName: semanticModel.displayName,
              workspaceName: extraction.targetWorkspaceNames?.[
                (extraction.targetWorkspaces || []).indexOf(semanticModel.workspaceId)
              ],
            },
            addRawApiResponseSnapshot
          );

          semanticModelDataByModelId[semanticModel.id] = {
            entities: (modelData.entities ?? []).map((entity) => ({
              id: entity.id,
              name: entity.name,
              type: entity.type,
              tableName: entity.tableName,
              dataType: entity.dataType,
              expression: entity.expression,
            })),
            dependencies: (modelData.dependencies ?? []).map((dep) => ({
              sourceId: dep.sourceId,
              targetId: dep.targetId,
              dependencyType: dep.dependencyType,
            })),
          };

          if (semanticModel.displayName) {
            semanticModelDataByModelId[semanticModel.displayName.toLowerCase()] = semanticModelDataByModelId[semanticModel.id];
          }

          semanticApiResultSnapshots.push({
            datasetId: semanticModel.id,
            datasetName: semanticModel.displayName,
            workspaceId: semanticModel.workspaceId,
            source: modelData.source,
            entityCount: modelData.entities?.length || 0,
            dependencyCount: modelData.dependencies?.length || 0,
            entities: modelData.entities || [],
            dependencies: modelData.dependencies || [],
            extractedAt: new Date().toISOString(),
          });
        } catch (semanticError) {
          const errorMessage = formatUnknownError(semanticError);
          console.warn("[LineageExtraction] Failed to load semantic model entities", {
            modelId: semanticModel.id,
            workspaceId: semanticModel.workspaceId,
            modelName: semanticModel.displayName,
            error: errorMessage,
          });

          semanticApiResultSnapshots.push({
            datasetId: semanticModel.id,
            datasetName: semanticModel.displayName,
            workspaceId: semanticModel.workspaceId,
            source: "failed",
            entityCount: 0,
            dependencyCount: 0,
            entities: [],
            dependencies: [],
            error: errorMessage,
            extractedAt: new Date().toISOString(),
          });
        }
      }

      const reportArtifacts = workspaceArtifacts.filter((artifact) =>
        String(artifact.type).toLowerCase() === "report" && isArtifactSelected(artifact)
      );

      for (const report of reportArtifacts) {
        try {
          const reportData = await loadReportMetadataDirect(
            workloadClient,
            itemClient,
            report.workspaceId,
            report.id,
            report.displayName,
            addRawApiResponseSnapshot,
            updateApiCallStats
          );

          reportDataByReportId[report.id] = {
            datasetId: reportData.datasetId,
            pages: reportData.pages,
            visuals: reportData.visuals,
          };

          if (report.displayName) {
            reportDataByReportId[report.displayName.toLowerCase()] = reportDataByReportId[report.id];
          }

          semanticApiResultSnapshots.push({
            reportId: report.id,
            reportName: report.displayName,
            workspaceId: report.workspaceId,
            source: "report-definition",
            pageCount: reportData.pages.length,
            visualCount: reportData.visuals.length,
            semanticRefCount: reportData.visuals.reduce((sum, visual) => sum + (visual.semanticRefs?.length || 0), 0),
            datasetId: reportData.datasetId,
            extractedAt: new Date().toISOString(),
          });
        } catch (reportError) {
          const errorMessage = formatUnknownError(reportError);
          console.warn("[LineageExtraction] Failed to load report metadata", {
            reportId: report.id,
            workspaceId: report.workspaceId,
            reportName: report.displayName,
            error: errorMessage,
          });

          semanticApiResultSnapshots.push({
            reportId: report.id,
            reportName: report.displayName,
            workspaceId: report.workspaceId,
            source: "report-definition-failed",
            pageCount: 0,
            visualCount: 0,
            semanticRefCount: 0,
            error: errorMessage,
            extractedAt: new Date().toISOString(),
          });
        }
      }

      const oneLakeStorageClient = new OneLakeStorageClient(workloadClient);
      const lakehouseArtifacts = workspaceArtifacts.filter((artifact) =>
        String(artifact.type).toLowerCase() === "lakehouse" && isArtifactSelected(artifact)
      );
      for (const lakehouse of lakehouseArtifacts) {
        const tables = await loadTabularArtifactTablesDirect(
          oneLakeStorageClient,
          lakehouse.workspaceId,
          lakehouse.id,
          "lakehouse",
          addRawApiResponseSnapshot,
          updateApiCallStats
        );

        lakehouseDataByArtifactId[lakehouse.id] = { tables };
        if (lakehouse.displayName) {
          lakehouseDataByArtifactId[lakehouse.displayName.toLowerCase()] = lakehouseDataByArtifactId[lakehouse.id];
        }

        semanticApiResultSnapshots.push({
          artifactType: "lakehouse",
          artifactId: lakehouse.id,
          artifactName: lakehouse.displayName,
          workspaceId: lakehouse.workspaceId,
          source: "onelake-path-metadata",
          tableCount: tables.length,
          tables,
          extractedAt: new Date().toISOString(),
        });
      }

      const warehouseArtifacts = workspaceArtifacts.filter((artifact) =>
        String(artifact.type).toLowerCase() === "warehouse" && isArtifactSelected(artifact)
      );
      for (const warehouse of warehouseArtifacts) {
        const tables = await loadTabularArtifactTablesDirect(
          oneLakeStorageClient,
          warehouse.workspaceId,
          warehouse.id,
          "warehouse",
          addRawApiResponseSnapshot,
          updateApiCallStats
        );

        warehouseDataByArtifactId[warehouse.id] = { tables };
        if (warehouse.displayName) {
          warehouseDataByArtifactId[warehouse.displayName.toLowerCase()] = warehouseDataByArtifactId[warehouse.id];
        }

        semanticApiResultSnapshots.push({
          artifactType: "warehouse",
          artifactId: warehouse.id,
          artifactName: warehouse.displayName,
          workspaceId: warehouse.workspaceId,
          source: "onelake-path-metadata",
          tableCount: tables.length,
          tables,
          extractedAt: new Date().toISOString(),
        });
      }

      const snapshot = buildNotebooklessGraphSnapshot(
        {
          workspaceIds: selectedWorkspaces,
          selectedArtifactIds: extraction.selectedArtifactIds,
          artifactSelector: extraction.artifactSelector,
          artifactTypes: extraction.artifactTypes,
          semanticModelDataByModelId,
          reportDataByReportId,
          lakehouseDataByArtifactId,
          warehouseDataByArtifactId,
        },
        workspaceArtifacts
      );

      const snapshotWorkspaceId = workspaceId;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      FabricTableLineageStorage.saveGraphSnapshot(
        snapshot,
        snapshotWorkspaceId,
        undefined,
        timestamp
      );

      setCompletedRuns([runName]);
      setCurrentRun(null);
      setLastRunApiCallStats(apiCallStatsRef.current);
      persistExtractionChange({
        ...extraction,
        lastRunAt: new Date().toISOString(),
        lastRunStatus: "success",
        lastRunMessage: `${RUN_LABEL_BY_NAME[runName] || runName} completed successfully via direct API extraction.`,
      });
    } catch (err) {
      logVerboseExtractionError("runExtraction", err);
      const errorMessage = formatExtractionRunError(err);
      setError(errorMessage);
      setLastRunApiCallStats(apiCallStatsRef.current);
      persistExtractionChange({
        ...extraction,
        lastRunStatus: "error",
        lastRunMessage: errorMessage,
      });
    } finally {
      setIsRunning(false);
    }
  }, [extraction, persistExtractionChange, workloadClient, workspaceId, RUN_LABEL_BY_NAME, updateApiCallStats]);

  const createExtractionRunHandler = useCallback(
    (runName: string): (() => void) => {
      return () => {
        void runExtraction(runName);
      };
    },
    [runExtraction]
  );

  const centerContent = (
    <div className={styles.root}>
      <MessageBar intent="info">
        <MessageBarBody>
          {t("LineageWorkbench_Extraction_PhaseNote",
            "Extraction configuration is scaffolded. Actual extraction logic runs through the Fabric API in a future phase.")}
        </MessageBarBody>
      </MessageBar>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {saveIndicator.status === "saving" && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("LineageWorkbench_Extraction_SaveStatus_Saving", "Saving...")}
          </Text>
        )}
        {saveIndicator.status === "saved" && (
          <Text size={200} style={{ color: tokens.colorPaletteGreenForeground1 }}>
            {t("LineageWorkbench_Extraction_SaveStatus_Saved", "Saved")}
          </Text>
        )}
        {saveIndicator.status === "error" && (
          <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }} title={saveIndicator.message}>
            {t("LineageWorkbench_Extraction_SaveStatus_Error", "Save failed")}
          </Text>
        )}
      </div>

      <div>
        <Text className={styles.sectionTitle}>
          {t("LineageWorkbench_Extraction_Section_Workspaces", "Workspaces to extract")}
        </Text>
        <div className={styles.sectionBody}>
          <Field label={t("LineageWorkbench_Extraction_Workspaces", "Source workspaces")}>
            <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalM }}>
              <Button
                appearance="secondary"
                icon={<BuildingRegular />}
                onClick={handleSelectWorkspaces}
              >
                {extraction.targetWorkspaces && extraction.targetWorkspaces.length > 0
                  ? t("LineageWorkbench_Extraction_Workspaces_Selected", "{{count}} workspace(s) selected", { count: extraction.targetWorkspaces.length })
                  : t("LineageWorkbench_Extraction_Workspaces_Select", "Select workspaces")}
              </Button>
            </div>
          </Field>

          {extraction.targetWorkspaces && extraction.targetWorkspaces.length > 0 && (
            <MessageBar intent="success">
              <MessageBarBody>
                <strong>{t("LineageWorkbench_Extraction_SelectedWorkspaces", "Selected workspaces:")} </strong>
                <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                  {(extraction.targetWorkspaceNames && extraction.targetWorkspaceNames.length > 0
                    ? extraction.targetWorkspaceNames
                    : extraction.targetWorkspaces).map((workspaceName, index) => (
                    <li key={`${workspaceName}-${index}`}>
                      <span>{workspaceName}</span>
                      {extraction.targetWorkspaceTypes && extraction.targetWorkspaceTypes[index] && (
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginLeft: tokens.spacingHorizontalS }}>
                          ({extraction.targetWorkspaceTypes[index]})
                        </Text>
                      )}
                      {extraction.targetWorkspaces && extraction.targetWorkspaces[index] && (
                        <Button
                          appearance="subtle"
                          size="small"
                          onClick={() => openInNewTab(`/groups/${extraction.targetWorkspaces?.[index]}`)}
                          style={{ marginLeft: tokens.spacingHorizontalS }}
                        >
                          {t("LineageWorkbench_Extraction_OpenWorkspace", "Open")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </MessageBarBody>
            </MessageBar>
          )}

        </div>
      </div>

      <Divider />
<div>
        <Text className={styles.sectionTitle}>
          {t("LineageWorkbench_Extraction_Section_Artifacts", "Artifacts to extract")}
        </Text>
        <div className={styles.sectionBody}>
          <Field label={t("LineageWorkbench_Extraction_Artifacts", "Artifact selection") }>
            <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalM }}>
              <Button
                appearance="secondary"
                icon={<DocumentRegular />}
                onClick={handleSelectArtifacts}
                disabled={!extraction.targetWorkspaces || extraction.targetWorkspaces.length === 0}
              >
                {extraction.selectedArtifactIds && extraction.selectedArtifactIds.length > 0
                  ? t("LineageWorkbench_Extraction_Artifacts_Selected", "{{count}} artifact(s) selected", { count: extraction.selectedArtifactIds.length })
                  : t("LineageWorkbench_Extraction_Artifacts_Select", "Select artifacts")}
              </Button>
            </div>
          </Field>

          {(!extraction.targetWorkspaces || extraction.targetWorkspaces.length === 0) && (
            <MessageBar intent="warning">
              <MessageBarBody>
                Select workspaces first to load artifacts for selection.
              </MessageBarBody>
            </MessageBar>
          )}

          {extraction.selectedArtifactLabels && extraction.selectedArtifactLabels.length > 0 && (
            <MessageBar intent="success">
              <MessageBarBody>
                <strong>Selected artifacts:</strong>
                <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                  {extraction.selectedArtifactLabels.slice(0, 12).map((label, index) => (
                    <li key={`${label}-${index}`}>{label}</li>
                  ))}
                </ul>
                {extraction.selectedArtifactLabels.length > 12 && (
                  <Text size={200}>+{extraction.selectedArtifactLabels.length - 12} more</Text>
                )}
              </MessageBarBody>
            </MessageBar>
          )}
        </div>
      </div>

      <div className={styles.runSection}>
        <Text className={styles.sectionTitle}>
          {t("LineageWorkbench_Extraction_Section_Run", "Run extraction")}
        </Text>

        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t(
            "LineageWorkbench_Extraction_RunInfo",
            "Runs direct API-based extraction without local deployment or external execution."
          )}
        </Text>
        
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>
              <div>{error}</div>
              <div style={{ marginTop: tokens.spacingVerticalS, fontSize: tokens.fontSizeBase200 }}>
                <strong>{t("LineageWorkbench_Extraction_AuthDiagnostics_Title", "Authentication diagnostics")}</strong>
                <div>{t("LineageWorkbench_Extraction_AuthDiagnostics_AppId", "Frontend App ID")}: {frontendAppId || "unknown"}</div>
                <div>{t("LineageWorkbench_Extraction_AuthDiagnostics_Tenant", "Inferred tenant")}: {authErrorTenantId || "not detected"}</div>
                {adminConsentUrl && (
                  <div style={{ wordBreak: "break-all" }}>
                    {t("LineageWorkbench_Extraction_AuthDiagnostics_ConsentUrl", "Admin consent URL")}: {adminConsentUrl}
                  </div>
                )}
              </div>
              {adminConsentUrl && (
                <div style={{ marginTop: tokens.spacingVerticalS }}>
                  <Button appearance="secondary" size="small" onClick={() => openInNewTab(adminConsentUrl)}>
                    {t("LineageWorkbench_Extraction_AdminConsent_Button", "Open tenant admin consent")}
                  </Button>
                </div>
              )}
              <div style={{ marginTop: tokens.spacingVerticalS }}>
                <Button
                  appearance="secondary"
                  size="small"
                  onClick={() => {
                    void callPromptFrontendConsent(workloadClient, [POWER_BI_XMLA_SCOPE, POWER_BI_REPORT_SCOPE])
                      .then(() => {
                        setError(null);
                      })
                      .catch((consentError) => {
                        const message = consentError instanceof Error ? consentError.message : String(consentError);
                        setError(`Interactive consent/authentication prompt failed. ${message}`);
                      });
                  }}
                >
                  {t("LineageWorkbench_Extraction_ReopenConsent_Button", "Re-open consent/authentication window")}
                </Button>
              </div>
            </MessageBarBody>
          </MessageBar>
        )}

        {extraction.lastRunStatus === "success" && !isRunning && (
          <MessageBar intent="success">
            <MessageBarBody>
              {t("LineageWorkbench_Extraction_LastRun_Success", "✅ Last extraction completed successfully")}
            </MessageBarBody>
          </MessageBar>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalM }}>
          {extractionRunOrder.map((runName, index) => {
            const needsWorkspaces = runName === "1_LineageWorkbench_Extract_And_Build";
            const isCurrentRun = currentRun === runName;
            const isDisabled =
              isRunning ||
              (needsWorkspaces && (!extraction.targetWorkspaces || extraction.targetWorkspaces.length === 0));

            return (
              <Button
                key={runName}
                appearance={index === 0 ? "primary" : "secondary"}
                icon={<PlayRegular />}
                disabled={isDisabled}
                onClick={createExtractionRunHandler(runName)}
              >
                {isCurrentRun
                  ? t("LineageWorkbench_Extraction_Button_Running", "Running {{name}}...", {
                      name: RUN_LABEL_BY_NAME[runName] || runName,
                    })
                  : RUN_LABEL_BY_NAME[runName] || runName}
              </Button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS }}>
          {extractionRunOrder.map((runName) => (
            <Text key={`${runName}-description`} size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              <strong>{RUN_LABEL_BY_NAME[runName] || runName}:</strong> {RUN_DESCRIPTION_BY_NAME[runName] || ""}
            </Text>
          ))}
        </div>

        {isRunning && (
          <MessageBar intent="info">
            <MessageBarBody>
              {t(
                "LineageWorkbench_Extraction_Progress_ApiCalls",
                "Calls made: {{attempted}} | Success: {{succeeded}} | Failed: {{failed}} | Warnings: {{warnings}}",
                {
                  attempted: apiCallStats.attempted,
                  succeeded: apiCallStats.succeeded,
                  failed: apiCallStats.failed,
                  warnings: apiCallStats.warnings,
                }
              )}
            </MessageBarBody>
          </MessageBar>
        )}

        {!isRunning && lastRunApiCallStats && (
          <MessageBar intent={lastRunApiCallStats.failed > 0 ? "warning" : lastRunApiCallStats.warnings > 0 ? "info" : "success"}>
            <MessageBarBody>
              {t(
                "LineageWorkbench_Extraction_LastRun_ApiCallSummary",
                "Last run calls: {{attempted}} | Success: {{succeeded}} | Failed: {{failed}} | Warnings: {{warnings}}",
                {
                  attempted: lastRunApiCallStats.attempted,
                  succeeded: lastRunApiCallStats.succeeded,
                  failed: lastRunApiCallStats.failed,
                  warnings: lastRunApiCallStats.warnings,
                }
              )}
            </MessageBarBody>
          </MessageBar>
        )}

        {(isRunning || (!!lastRunApiCallStats && lastRunApiCallStats.callLog.length > 0)) && (
          <div style={{ overflowX: "auto" }}>
            <Text size={200} style={{ fontWeight: tokens.fontWeightSemibold }}>
              {t("LineageWorkbench_Extraction_AllCallStatus_Title", "All API call status")}
            </Text>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginTop: tokens.spacingVerticalS,
                fontSize: tokens.fontSizeBase200,
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: "right", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_AllCallStatus_Sequence", "#")}
                  </th>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_AllCallStatus_Status", "Status")}
                  </th>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_AllCallStatus_Api", "API")}
                  </th>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_AllCallStatus_Artifact", "Artifact")}
                  </th>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_AllCallStatus_Workspace", "Workspace")}
                  </th>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_AllCallStatus_Details", "Details")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(isRunning ? apiCallStats : lastRunApiCallStats || apiCallStats).callLog
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <tr key={`${entry.sequence}-${entry.queryLabel}-${entry.datasetId}-${entry.stage}-${entry.capturedAt}`}>
                      <td style={{ textAlign: "right", padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {entry.sequence}
                      </td>
                      <td style={{ padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {entry.stage}
                      </td>
                      <td style={{ padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {entry.queryLabel}
                      </td>
                      <td style={{ padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {entry.datasetName}
                      </td>
                      <td style={{ padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {entry.workspaceId}
                      </td>
                      <td style={{ padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {entry.error || "-"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {(isRunning || (!!lastRunApiCallStats && Object.keys(lastRunApiCallStats.datasets).length > 0)) && (
          <div style={{ overflowX: "auto" }}>
            <Text size={200} style={{ fontWeight: tokens.fontWeightSemibold }}>
              {t("LineageWorkbench_Extraction_DatasetStatus_Title", "Per-dataset API status")}
            </Text>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginTop: tokens.spacingVerticalS,
                fontSize: tokens.fontSizeBase200,
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_DatasetStatus_Dataset", "Dataset")}
                  </th>
                  <th style={{ textAlign: "left", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_DatasetStatus_Workspace", "Workspace")}
                  </th>
                  <th style={{ textAlign: "right", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_DatasetStatus_Calls", "Calls")}
                  </th>
                  <th style={{ textAlign: "right", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_DatasetStatus_Success", "Success")}
                  </th>
                  <th style={{ textAlign: "right", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_DatasetStatus_Failed", "Failed")}
                  </th>
                  <th style={{ textAlign: "right", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px" }}>
                    {t("LineageWorkbench_Extraction_DatasetStatus_Warnings", "Warnings")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.values((isRunning ? apiCallStats : lastRunApiCallStats || apiCallStats).datasets)
                  .sort((a, b) => a.datasetName.localeCompare(b.datasetName))
                  .map((dataset) => (
                    <tr key={`${dataset.workspaceId}-${dataset.datasetId}`}>
                      <td style={{ padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {dataset.datasetName}
                      </td>
                      <td style={{ padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {dataset.workspaceId}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {dataset.attempted}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {dataset.succeeded}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {dataset.failed}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                        {dataset.warnings}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {!isRunning && lastRunApiCallStats && lastRunApiCallStats.failures.length > 0 && (
          <MessageBar intent="error">
            <MessageBarBody>
              <strong>{t("LineageWorkbench_Extraction_LastRun_Failures_Title", "Failures")}</strong>
              <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                {lastRunApiCallStats.failures.map((failure, index) => (
                  <li key={`failure-${index}`}>{failure}</li>
                ))}
              </ul>
            </MessageBarBody>
          </MessageBar>
        )}

        {!isRunning && lastRunApiCallStats && lastRunApiCallStats.warningMessages.length > 0 && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <strong>{t("LineageWorkbench_Extraction_LastRun_Warnings_Title", "Warnings")}</strong>
              <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
                {lastRunApiCallStats.warningMessages.map((warningMessage, index) => (
                  <li key={`warning-${index}`}>{warningMessage}</li>
                ))}
              </ul>
            </MessageBarBody>
          </MessageBar>
        )}
        
        {(!extraction.targetWorkspaces || extraction.targetWorkspaces.length === 0) && (
          <MessageBar intent="warning">
            <MessageBarBody>
              {t("LineageWorkbench_Extraction_NoWorkspaces", "Please select at least one workspace to start extraction.")}
            </MessageBarBody>
          </MessageBar>
        )}

        {isRunning && (
          <div>
            <ProgressBar />
            {currentRun && (
              <div className={styles.progressItem}>
                <Spinner size="tiny" />
                <Text>
                  {t("LineageWorkbench_Extraction_Progress_Current", "Running: {{name}}", { name: currentRun })}
                  {` | Calls: ${apiCallStats.attempted}, Success: ${apiCallStats.succeeded}, Failed: ${apiCallStats.failed}, Warnings: ${apiCallStats.warnings}`}
                </Text>
              </div>
            )}
            {runQueue.map((name) => (
              <div key={name} className={styles.progressItem}>
                <Text>
                  {completedRuns.includes(name)
                    ? `✅ ${RUN_LABEL_BY_NAME[name] || name} (calls: ${apiCallStats.attempted}, success: ${apiCallStats.succeeded}, failed: ${apiCallStats.failed}, warnings: ${apiCallStats.warnings})`
                    : currentRun === name
                    ? `⏳ ${RUN_LABEL_BY_NAME[name] || name}`
                    : `⬜ ${RUN_LABEL_BY_NAME[name] || name}`}
                </Text>
              </div>
            ))}
          </div>
        )}
      </div>

      <Divider />

      <div>
        <Text className={styles.sectionTitle}>
          {t("LineageWorkbench_Extraction_Section_AzureOpenAI", "Azure OpenAI Configuration")}
        </Text>
        <div className={styles.sectionBody}>
          <MessageBar intent="info">
            <MessageBarBody>
              {t("LineageWorkbench_Extraction_AzureOpenAI_Info",
                "Configure Azure OpenAI to enable Explain with AI for queries and expressions in the detail view.")}
            </MessageBarBody>
          </MessageBar>

          <Checkbox
            checked={extraction.azureOpenAI?.enabled ?? false}
            onChange={(_, data) =>
              persistExtractionChange({
                ...extraction,
                azureOpenAI: {
                  ...extraction.azureOpenAI,
                  enabled: data.checked as boolean,
                  deploymentName: extraction.azureOpenAI?.deploymentName ?? "gpt-4",
                },
              })
            }
            label={t("LineageWorkbench_Extraction_AzureOpenAI_Enabled", "Enable Azure OpenAI Query Explanation")}
          />

          {extraction.azureOpenAI?.enabled && (
            <>
              <Field 
                label={t("LineageWorkbench_Extraction_AzureOpenAI_Endpoint", "Azure OpenAI Endpoint")}
                required
              >
                <Input
                  value={extraction.azureOpenAI?.endpoint ?? ""}
                  placeholder="https://your-resource.openai.azure.com"
                  onChange={(_, data) =>
                    persistExtractionChange({
                      ...extraction,
                      azureOpenAI: {
                        ...extraction.azureOpenAI,
                        endpoint: data.value,
                      },
                    })
                  }
                />
              </Field>

              <Field 
                label={t("LineageWorkbench_Extraction_AzureOpenAI_ApiKey", "API Key")}
                required
              >
                <Input
                  type="password"
                  value={extraction.azureOpenAI?.apiKey ?? ""}
                  placeholder="Enter your Azure OpenAI API key"
                  onChange={(_, data) =>
                    persistExtractionChange({
                      ...extraction,
                      azureOpenAI: {
                        ...extraction.azureOpenAI,
                        apiKey: data.value,
                      },
                    })
                  }
                />
              </Field>

              <Field label={t("LineageWorkbench_Extraction_AzureOpenAI_DeploymentName", "Deployment Name")}>
                <Input
                  value={extraction.azureOpenAI?.deploymentName ?? ""}
                  placeholder="gpt-4"
                  onChange={(_, data) =>
                    persistExtractionChange({
                      ...extraction,
                      azureOpenAI: {
                        ...extraction.azureOpenAI,
                        deploymentName: data.value,
                      },
                    })
                  }
                />
              </Field>

              <Field label={t("LineageWorkbench_Extraction_AzureOpenAI_MaxTokens", "Max Tokens")}>
                <Input
                  type="number"
                  value={String(extraction.azureOpenAI?.maxTokens ?? 500)}
                  onChange={(_, data) =>
                    persistExtractionChange({
                      ...extraction,
                      azureOpenAI: {
                        ...extraction.azureOpenAI,
                        maxTokens: parseInt(data.value) || 500,
                      },
                    })
                  }
                />
              </Field>

              <Field label={t("LineageWorkbench_Extraction_AzureOpenAI_Temperature", "Temperature (0-1)")}>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={String(extraction.azureOpenAI?.temperature ?? 0.3)}
                  onChange={(_, data) =>
                    persistExtractionChange({
                      ...extraction,
                      azureOpenAI: {
                        ...extraction.azureOpenAI,
                        temperature: parseFloat(data.value) || 0.3,
                      },
                    })
                  }
                />
              </Field>

              <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalM }}>
                <Button
                  appearance="secondary"
                  onClick={testAzureOpenAIConfiguration}
                  disabled={isTestingAzureOpenAI}
                >
                  {isTestingAzureOpenAI
                    ? t("LineageWorkbench_Extraction_AzureOpenAI_Testing", "Testing configuration...")
                    : t("LineageWorkbench_Extraction_AzureOpenAI_TestButton", "Test configuration")}
                </Button>
                {isTestingAzureOpenAI && <Spinner size="tiny" />}
              </div>

              {azureOpenAITestStatus && (
                <MessageBar intent={azureOpenAITestStatus.success ? "success" : "error"}>
                  <MessageBarBody style={{ whiteSpace: "pre-wrap" }}>{azureOpenAITestStatus.message}</MessageBarBody>
                </MessageBar>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <LineageWorkspaceSelectionWizard
        workloadClient={workloadClient}
        currentWorkspaceId={workspaceId}
        preSelectedWorkspaceIds={extraction.targetWorkspaces}
        isOpen={isWorkspaceWizardOpen}
        onClose={() => setIsWorkspaceWizardOpen(false)}
        onComplete={handleWorkspaceSelectionComplete}
      />
      <LineageArtifactSelectionWizard
        workloadClient={workloadClient}
        workspaceIds={extraction.targetWorkspaces && extraction.targetWorkspaces.length > 0 ? extraction.targetWorkspaces : [workspaceId]}
        selectedArtifactIds={extraction.selectedArtifactIds}
        isOpen={isArtifactWizardOpen}
        onClose={() => setIsArtifactWizardOpen(false)}
        onComplete={handleArtifactSelectionComplete}
      />
      <ItemEditorDefaultView center={{ content: centerContent }} />
    </>
  );
}
