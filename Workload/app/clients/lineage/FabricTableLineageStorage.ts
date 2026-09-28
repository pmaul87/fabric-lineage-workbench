export interface LineageGraphSnapshotPayload {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  dimensions?: Record<string, unknown>;
}

const STORAGE_PREFIX = "fabric-lineage-table:";
const STORAGE_INDEX_KEY = `${STORAGE_PREFIX}index`;

type SnapshotEnvelope = {
  savedAt: string;
  runId: string;
  snapshot: LineageGraphSnapshotPayload;
};

function makeKey(workspaceId?: string, lakehouseId?: string): string {
  const parts = [workspaceId || "unknown", lakehouseId || "unknown"];
  return `${STORAGE_PREFIX}${parts.join("::")}`;
}

export class FabricTableLineageStorage {
  private static getStorages(): Storage[] {
    if (typeof window === "undefined") {
      return [];
    }

    const storages: Storage[] = [];
    if (window.sessionStorage) {
      storages.push(window.sessionStorage);
    }
    if (window.localStorage) {
      storages.push(window.localStorage);
    }
    return storages;
  }

  private static upsertIndex(storage: Storage, key: string): void {
    const existingRaw = storage.getItem(STORAGE_INDEX_KEY) || "[]";
    const existing = JSON.parse(existingRaw) as string[];
    const next = Array.from(new Set([key, ...existing]));
    storage.setItem(STORAGE_INDEX_KEY, JSON.stringify(next));
  }

  private static parseEnvelope(raw: string | null): SnapshotEnvelope | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as SnapshotEnvelope;
      if (!parsed?.snapshot || !Array.isArray(parsed.snapshot.nodes) || !Array.isArray(parsed.snapshot.edges)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private static loadEnvelope(storage: Storage, key: string): SnapshotEnvelope | null {
    return this.parseEnvelope(storage.getItem(key));
  }

  private static loadLatestEnvelope(storage: Storage): SnapshotEnvelope | null {
    const indexRaw = storage.getItem(STORAGE_INDEX_KEY) || "[]";
    const keys = JSON.parse(indexRaw) as string[];
    if (!Array.isArray(keys) || keys.length === 0) {
      return null;
    }

    for (const key of keys) {
      const envelope = this.loadEnvelope(storage, key);
      if (envelope) {
        return envelope;
      }
    }

    return null;
  }

  static saveGraphSnapshot(
    snapshot: LineageGraphSnapshotPayload,
    workspaceId?: string,
    lakehouseId?: string,
    runId?: string
  ): void {
    const storages = this.getStorages();
    if (storages.length === 0) {
      return;
    }

    const key = makeKey(workspaceId, lakehouseId);
    const envelope: SnapshotEnvelope = {
      savedAt: new Date().toISOString(),
      runId: runId || "manual",
      snapshot,
    };

    for (const storage of storages) {
      storage.setItem(key, JSON.stringify(envelope));
      this.upsertIndex(storage, key);
    }
  }

  static loadGraphSnapshot(workspaceId?: string, lakehouseId?: string): LineageGraphSnapshotPayload | null {
    const storages = this.getStorages();
    if (storages.length === 0) {
      return null;
    }

    const key = makeKey(workspaceId, lakehouseId);
    for (const storage of storages) {
      const exact = this.loadEnvelope(storage, key);
      if (exact) {
        return exact.snapshot;
      }
    }

    for (const storage of storages) {
      const latest = this.loadLatestEnvelope(storage);
      if (latest) {
        return latest.snapshot;
      }
    }

    return null;
  }
}
