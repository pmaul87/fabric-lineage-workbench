import React from "react";
import { Route, Router, Switch } from "react-router-dom";
import { History } from "history";
import { WorkloadClientAPI } from "@ms-fabric/workload-client";
// Removed: import { LineageViewerItemEditor } from "./items/LineageViewerItem";
import { LineageWorkbenchItemEditor } from "./items/LineageWorkbenchItem";
import { ConditionalPlaygroundRoutes } from "./playground/ConditionalPlaygroundRoutes";
import { getWorkloadConfiguration } from "./controller/ConfigurationController";

/*
    Add your Item Editor in the Route section of the App function below
*/

interface AppProps {
    history: History;
    workloadClient: WorkloadClientAPI;
}

export interface PageProps {
    workloadClient: WorkloadClientAPI;
    history?: History
}

export interface ContextProps {
    itemObjectId?: string;
    workspaceObjectId?: string
    source?: string;
}

export interface SharedState {
    message: string;
}

export function App({ history, workloadClient }: AppProps) {
    const workloadVersion = getWorkloadConfiguration().version || "unknown";
    const footerText = "Fabric Lineage Workbench preview. Validate the workload configuration, extraction behavior, and deployment flow in a non-production Fabric tenant before broader use.";

    return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
            <div style={{ flex: 1 }}>
                <Router history={history}>
                    <Switch>
                        {/* Routings for the LineageViewer Item Editor */}
                        {/* Removed: Standalone LineageViewerItemEditor route */}

                        {/* Routings for the LineageWorkbench Item Editor */}
                        <Route path="/LineageWorkbenchItem-editor/:itemObjectId">
                            <LineageWorkbenchItemEditor
                                workloadClient={workloadClient} data-testid="LineageWorkbenchItem-editor" />
                        </Route>

                        {/* Conditionally loaded playground routes (only in development) */}
                        <ConditionalPlaygroundRoutes workloadClient={workloadClient} />
                    </Switch>
                </Router>
            </div>

            <div
                style={{
                    padding: "8px 12px",
                    textAlign: "center",
                    fontSize: "11px",
                    lineHeight: 1.5,
                    color: "#605e5c",
                    background: "#f3f2f1",
                    borderTop: "1px solid #edebe9",
                    wordBreak: "break-word",
                }}
            >
                <div>{footerText}</div>
                <div>Current version: {workloadVersion}</div>
            </div>
        </div>
    );
}