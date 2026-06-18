'use client';

import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import { readJsonResponseBody } from '@/lib/api/response-body';
import { parseJsonOrNull, readJsonObject } from '@/lib/db/json';
import { offlineDb, type OfflineSyncQueue } from './offline-db';

const MAX_RETRIES = 3;
const activeSyncQueueRuns = new Map<string, Promise<{ synced: number; failed: number }>>();

type SyncConfig = {
  orgId: string;
  endpoints: Record<string, string>;
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  visit_record: '/api/visit-records',
  residual_medication: '/api/residual-medications',
};

type SyncQueueCompletionResult =
  | { status: 'deleted' }
  | { status: 'missing' }
  | { status: 'stale' };

type VisitRecordConflictSnapshot = {
  local: Record<string, unknown>;
  server: {
    id: string;
    version: number;
    patient_id: string;
    visit_date: string;
    outcome_status: string;
    soap_subjective?: string | null;
    soap_objective?: string | null;
    soap_assessment?: string | null;
    soap_plan?: string | null;
    next_visit_suggestion_date?: string | null;
    residual_medications?: Array<{
      drug_name: string;
      drug_code?: string | null;
      prescribed_quantity?: number | null;
      prescribed_daily_dose?: number | null;
      remaining_quantity: number;
      is_prohibited_reduction: boolean;
    }>;
  } | null;
};

export type SyncQueueItemSummary = Omit<OfflineSyncQueue, 'payload' | 'conflict_payload'> & {
  payload: Record<string, unknown>;
  conflict: VisitRecordConflictSnapshot | null;
};

function readString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readOptionalString(value: unknown) {
  return value === undefined || value === null || typeof value === 'string' ? value : undefined;
}

function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalFiniteNumber(value: unknown) {
  return value === undefined ||
    value === null ||
    (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined;
}

function normalizeResidualMedication(value: unknown) {
  const object = readJsonObject(value);
  if (!object) return null;

  const drugName = readString(object.drug_name);
  const remainingQuantity = readFiniteNumber(object.remaining_quantity);
  const drugCode = readOptionalString(object.drug_code);
  const prescribedQuantity = readOptionalFiniteNumber(object.prescribed_quantity);
  const prescribedDailyDose = readOptionalFiniteNumber(object.prescribed_daily_dose);
  if (
    !drugName ||
    remainingQuantity === null ||
    typeof object.is_prohibited_reduction !== 'boolean' ||
    drugCode === undefined ||
    prescribedQuantity === undefined ||
    prescribedDailyDose === undefined
  ) {
    return null;
  }

  return {
    drug_name: drugName,
    ...(drugCode !== undefined ? { drug_code: drugCode } : {}),
    ...(prescribedQuantity !== undefined ? { prescribed_quantity: prescribedQuantity } : {}),
    ...(prescribedDailyDose !== undefined ? { prescribed_daily_dose: prescribedDailyDose } : {}),
    remaining_quantity: remainingQuantity,
    is_prohibited_reduction: object.is_prohibited_reduction,
  };
}

function normalizeConflictServer(value: unknown): VisitRecordConflictSnapshot['server'] {
  if (value === null) return null;
  const object = readJsonObject(value);
  if (!object) return null;

  const id = readString(object.id);
  const version = readFiniteNumber(object.version);
  const patientId = readString(object.patient_id);
  const visitDate = readString(object.visit_date);
  const outcomeStatus = readString(object.outcome_status);
  const soapSubjective = readOptionalString(object.soap_subjective);
  const soapObjective = readOptionalString(object.soap_objective);
  const soapAssessment = readOptionalString(object.soap_assessment);
  const soapPlan = readOptionalString(object.soap_plan);
  const nextVisitSuggestionDate = readOptionalString(object.next_visit_suggestion_date);

  if (
    !id ||
    version === null ||
    !Number.isInteger(version) ||
    !patientId ||
    !visitDate ||
    !outcomeStatus ||
    soapSubjective === undefined ||
    soapObjective === undefined ||
    soapAssessment === undefined ||
    soapPlan === undefined ||
    nextVisitSuggestionDate === undefined
  ) {
    return null;
  }

  let residualMedications:
    | NonNullable<VisitRecordConflictSnapshot['server']>['residual_medications']
    | undefined;
  if (object.residual_medications !== undefined) {
    if (!Array.isArray(object.residual_medications)) return null;
    residualMedications = [];
    for (const item of object.residual_medications) {
      const medication = normalizeResidualMedication(item);
      if (!medication) return null;
      residualMedications.push(medication);
    }
  }

  return {
    id,
    version,
    patient_id: patientId,
    visit_date: visitDate,
    outcome_status: outcomeStatus,
    ...(soapSubjective !== undefined ? { soap_subjective: soapSubjective } : {}),
    ...(soapObjective !== undefined ? { soap_objective: soapObjective } : {}),
    ...(soapAssessment !== undefined ? { soap_assessment: soapAssessment } : {}),
    ...(soapPlan !== undefined ? { soap_plan: soapPlan } : {}),
    ...(nextVisitSuggestionDate !== undefined
      ? { next_visit_suggestion_date: nextVisitSuggestionDate }
      : {}),
    ...(residualMedications !== undefined ? { residual_medications: residualMedications } : {}),
  };
}

function normalizeVisitRecordConflictSnapshot(value: unknown): VisitRecordConflictSnapshot | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const local = readJsonObject(object.local);
  const server = normalizeConflictServer(object.server);
  if (!local || (object.server !== null && server === null)) return null;

  return { local, server };
}

function readExistingRecordFromConflictResponse(
  value: unknown,
): VisitRecordConflictSnapshot['server'] {
  const object = readJsonObject(value);
  const details = readJsonObject(object?.details);
  if (!details || !('existing_record' in details)) return null;
  return normalizeConflictServer(details.existing_record);
}

async function readSyncPayload(payload: string | null | undefined) {
  const raw = (await decryptOfflinePayload(payload)) ?? payload;
  if (!raw) return null;
  const parsed = parseJsonOrNull(raw);
  const object = readJsonObject(parsed);
  return object ? { object, body: JSON.stringify(object) } : null;
}

async function readSyncConflictPayload(payload: string | null | undefined) {
  return normalizeVisitRecordConflictSnapshot(
    parseJsonOrNull(await decryptOfflinePayload(payload)),
  );
}

/**
 * Process all pending items in the sync queue.
 * Called when the browser comes back online.
 */
function syncConfigKey(config: SyncConfig) {
  const endpoints = resolveSyncEndpoints(config);
  return JSON.stringify({
    orgId: config.orgId,
    endpoints: Object.keys(endpoints)
      .sort()
      .map((key) => [key, endpoints[key]]),
  });
}

function resolveSyncEndpoints(config: SyncConfig) {
  return { ...DEFAULT_ENDPOINTS, ...config.endpoints };
}

async function processSyncQueueOnce(config: SyncConfig): Promise<{
  synced: number;
  failed: number;
}> {
  const endpoints = resolveSyncEndpoints(config);
  const pending = await offlineDb.syncQueue.where('retryCount').below(MAX_RETRIES).toArray();

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const endpoint = endpoints[item.entityType];
      if (!endpoint) {
        failed++;
        continue;
      }

      const payload = await readSyncPayload(item.payload);
      if (!payload) {
        await offlineDb.syncQueue.update(item.id!, {
          retryCount: item.retryCount + 1,
          lastError: 'Invalid sync payload',
          conflict_state: undefined,
          conflict_payload: undefined,
        });
        failed++;
        continue;
      }

      const preflight = await verifyQueueItemCurrent(item);
      if (preflight.status === 'stale') {
        failed++;
        continue;
      }
      if (preflight.status === 'missing') {
        continue;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': config.orgId,
        },
        body: payload.body,
      });

      if (res.ok) {
        const completion = await deleteSyncedQueueItem(item);
        if (completion.status === 'deleted') {
          synced++;
        } else if (completion.status === 'stale') {
          failed++;
        }
      } else if (res.status === 409) {
        const server = readExistingRecordFromConflictResponse(await readJsonResponseBody(res));
        // Keep the draft in queue so the user can resolve the conflict later.
        await offlineDb.syncQueue.update(item.id!, {
          retryCount: MAX_RETRIES,
          lastError: 'HTTP 409 conflict',
          conflict_state: 'server_conflict',
          conflict_payload: await encryptOfflinePayloadRequired(
            JSON.stringify({
              local: payload.object,
              server,
            } satisfies VisitRecordConflictSnapshot),
            'sync queue conflict payload',
          ),
        });
        failed++;
      } else {
        await offlineDb.syncQueue.update(item.id!, {
          retryCount: item.retryCount + 1,
          lastError: `HTTP ${res.status}`,
          conflict_state: undefined,
          conflict_payload: undefined,
        });
        failed++;
      }
    } catch (err) {
      await offlineDb.syncQueue.update(item.id!, {
        retryCount: item.retryCount + 1,
        lastError: err instanceof Error ? err.message : 'Unknown error',
      });
      failed++;
    }
  }

  return { synced, failed };
}

function readDateTime(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function isSameQueueItemForCompletion(current: OfflineSyncQueue, completed: OfflineSyncQueue) {
  const currentCreatedAt = readDateTime(current.createdAt);
  const completedCreatedAt = readDateTime(completed.createdAt);
  if (currentCreatedAt === null || completedCreatedAt === null) return false;

  return (
    current.entityType === completed.entityType &&
    current.scope_id === completed.scope_id &&
    current.payload === completed.payload &&
    currentCreatedAt === completedCreatedAt &&
    current.retryCount === completed.retryCount &&
    current.lastError === completed.lastError &&
    current.conflict_state === completed.conflict_state &&
    current.conflict_payload === completed.conflict_payload
  );
}

async function deleteSyncedQueueItem(item: OfflineSyncQueue): Promise<SyncQueueCompletionResult> {
  if (item.id === undefined) return { status: 'missing' };
  const itemId = item.id;
  return offlineDb.transaction('rw', offlineDb.syncQueue, offlineDb.visitDrafts, async () => {
    const current = await offlineDb.syncQueue.get(itemId);
    if (!current) return { status: 'missing' };
    if (!isSameQueueItemForCompletion(current, item)) return { status: 'stale' };

    await offlineDb.syncQueue.delete(itemId);
    if (
      current.entityType === 'visit_record' &&
      item.entityType === 'visit_record' &&
      current.scope_id &&
      current.scope_id === item.scope_id
    ) {
      await offlineDb.visitDrafts.where('scheduleId').equals(current.scope_id).delete();
    }
    return { status: 'deleted' };
  });
}

async function verifyQueueItemCurrent(
  item: OfflineSyncQueue,
): Promise<{ status: 'current' } | { status: 'missing' } | { status: 'stale' }> {
  if (item.id === undefined) return { status: 'missing' };
  const current = await offlineDb.syncQueue.get(item.id);
  if (!current) return { status: 'missing' };
  if (!isSameQueueItemForCompletion(current, item)) return { status: 'stale' };
  return { status: 'current' };
}

export async function processSyncQueue(config: SyncConfig): Promise<{
  synced: number;
  failed: number;
}> {
  const key = syncConfigKey(config);
  const activeRun = activeSyncQueueRuns.get(key);
  if (activeRun) return activeRun;

  const run = processSyncQueueOnce(config).finally(() => {
    activeSyncQueueRuns.delete(key);
  });
  activeSyncQueueRuns.set(key, run);
  return run;
}

/**
 * Enqueue a draft for sync when online.
 */
export async function enqueueForSync(
  entityType: OfflineSyncQueue['entityType'],
  payload: Record<string, unknown>,
): Promise<void> {
  await offlineDb.syncQueue.add({
    entityType,
    payload: await encryptOfflinePayloadRequired(
      JSON.stringify(payload),
      `sync queue ${entityType} payload`,
    ),
    scope_id:
      typeof payload.schedule_id === 'string'
        ? payload.schedule_id
        : typeof payload.patient_id === 'string'
          ? payload.patient_id
          : undefined,
    createdAt: new Date(),
    retryCount: 0,
  });
}

/**
 * Get count of pending sync items.
 */
export async function getPendingSyncCount(): Promise<number> {
  return offlineDb.syncQueue.count();
}

export async function listSyncQueueItems(): Promise<SyncQueueItemSummary[]> {
  const items = await offlineDb.syncQueue.orderBy('createdAt').reverse().toArray();
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      payload: (await readSyncPayload(item.payload))?.object ?? {},
      conflict: await readSyncConflictPayload(item.conflict_payload),
    })),
  );
}

export async function registerVisitRecordConflict(args: {
  scheduleId: string;
  payload: Record<string, unknown>;
  server: VisitRecordConflictSnapshot['server'];
}): Promise<void> {
  const existing = await offlineDb.syncQueue
    .where('scope_id')
    .equals(args.scheduleId)
    .and((item) => item.entityType === 'visit_record')
    .first();

  const data = {
    entityType: 'visit_record' as const,
    payload: await encryptOfflinePayloadRequired(
      JSON.stringify(args.payload),
      'sync queue visit_record payload',
    ),
    scope_id: args.scheduleId,
    createdAt: new Date(),
    retryCount: MAX_RETRIES,
    lastError: 'HTTP 409 conflict',
    conflict_state: 'server_conflict' as const,
    conflict_payload: await encryptOfflinePayloadRequired(
      JSON.stringify({
        local: args.payload,
        server: args.server,
      } satisfies VisitRecordConflictSnapshot),
      'sync queue conflict payload',
    ),
  };

  if (existing?.id) {
    await offlineDb.syncQueue.update(existing.id, data);
    return;
  }

  await offlineDb.syncQueue.add(data);
}

/**
 * 失敗(リトライ上限到達)アイテムの retryCount を 0 に戻し、再送対象へ復帰させる。
 * 競合(server_conflict)は解決操作が必要なため対象外。戻り値はリセット件数。
 */
export async function resetFailedSyncQueueRetries(): Promise<number> {
  const failed = await offlineDb.syncQueue
    .where('retryCount')
    .aboveOrEqual(MAX_RETRIES)
    .and((item) => item.conflict_state !== 'server_conflict')
    .toArray();
  await Promise.all(
    failed.map((item) =>
      offlineDb.syncQueue.update(item.id!, { retryCount: 0, lastError: undefined }),
    ),
  );
  return failed.length;
}

export async function discardSyncQueueItem(itemId: number): Promise<void> {
  const item = await offlineDb.syncQueue.get(itemId);
  if (!item) return;

  await offlineDb.syncQueue.delete(itemId);
  if (item.entityType === 'visit_record' && item.scope_id) {
    await offlineDb.visitDrafts.where('scheduleId').equals(item.scope_id).delete();
  }
}

export async function overwriteVisitRecordConflict(
  config: SyncConfig,
  itemId: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const item = await offlineDb.syncQueue.get(itemId);
  if (!item) return { ok: false, message: '競合対象が見つかりません' };
  if (item.entityType !== 'visit_record') {
    return { ok: false, message: '訪問記録以外の競合は上書きできません' };
  }

  const payload = (await readSyncPayload(item.payload))?.object ?? null;
  const conflict = await readSyncConflictPayload(item.conflict_payload);
  if (!payload || !conflict?.server) {
    return { ok: false, message: '競合情報が不足しています' };
  }

  const preflight = await verifyQueueItemCurrent(item);
  if (preflight.status === 'missing') return { ok: false, message: '競合対象が見つかりません' };
  if (preflight.status === 'stale') {
    return {
      ok: false,
      message: '同期対象が更新されています。最新の状態を確認してから再実行してください',
    };
  }

  const endpoint = config.endpoints.visit_record ?? DEFAULT_ENDPOINTS.visit_record;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': config.orgId,
    },
    body: JSON.stringify({
      ...payload,
      conflict_resolution: 'overwrite',
      existing_record_id: conflict.server.id,
      expected_version: conflict.server.version,
    }),
  });

  if (res.ok) {
    const completion = await deleteSyncedQueueItem(item);
    if (completion.status === 'stale') {
      return {
        ok: false,
        message: '同期対象が更新されています。最新の状態を確認してから再実行してください',
      };
    }
    return { ok: true };
  }

  if (res.status === 409) {
    const server = readExistingRecordFromConflictResponse(await readJsonResponseBody(res));
    await offlineDb.syncQueue.update(itemId, {
      retryCount: MAX_RETRIES,
      lastError: 'HTTP 409 conflict',
      conflict_state: 'server_conflict',
      conflict_payload: await encryptOfflinePayloadRequired(
        JSON.stringify({
          local: payload,
          server: server ?? conflict.server,
        } satisfies VisitRecordConflictSnapshot),
        'sync queue conflict payload',
      ),
    });
    return { ok: false, message: 'サーバー側の記録が更新されました。差分を確認してください' };
  }

  return { ok: false, message: `上書き保存に失敗しました (HTTP ${res.status})` };
}

/**
 * Setup online listener that triggers sync automatically.
 */
export function setupAutoSync(config: SyncConfig): () => void {
  const handler = () => {
    processSyncQueue(config).catch((error) => {
      console.warn('[offline-sync] automatic sync failed', error);
    });
  };

  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}
