'use client';

import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import { readJsonResponseBody } from '@/lib/api/response-body';
import { parseJsonOrNull, readJsonObject } from '@/lib/db/json';
import { offlineDb, type OfflineSyncQueue } from './offline-db';

const MAX_RETRIES = 3;

type SyncConfig = {
  orgId: string;
  endpoints: Record<string, string>;
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  visit_record: '/api/visit-records',
  residual_medication: '/api/residual-medications',
};

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
export async function processSyncQueue(config: SyncConfig): Promise<{
  synced: number;
  failed: number;
}> {
  const endpoints = { ...DEFAULT_ENDPOINTS, ...config.endpoints };
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

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': config.orgId,
        },
        body: payload.body,
      });

      if (res.ok) {
        await offlineDb.syncQueue.delete(item.id!);
        if (item.entityType === 'visit_record' && item.scope_id) {
          await offlineDb.visitDrafts.where('scheduleId').equals(item.scope_id).delete();
        }
        synced++;
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
    await offlineDb.syncQueue.delete(itemId);
    if (item.scope_id) {
      await offlineDb.visitDrafts.where('scheduleId').equals(item.scope_id).delete();
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
    processSyncQueue(config).catch(() => {
      // Silently fail — will retry next time
    });
  };

  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}
