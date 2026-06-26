import type { SyncQueueItemSummary } from '@/lib/stores/sync-engine';

/**
 * p0_34/p0_35 オフライン同期センターの表示モデル(純関数)。
 * 同期キューの生アイテムを「種類/患者さん/状態/次にやること」の行と、
 * 競合比較(あなたの入力/最新の内容)のビューモデルに変換する。
 */

const SYNC_MAX_RETRIES = 3;

export type OfflineSyncRowStatusKey = 'conflict' | 'failed' | 'queued';

export type OfflineSyncRow = {
  id: number | null;
  kindLabel: string;
  patientLabel: string;
  scopeId: string | null;
  statusKey: OfflineSyncRowStatusKey;
  statusLabel: string;
  nextActionKey: 'resolve_conflict' | 'retry' | 'keep';
  nextActionLabel: string;
  lastError: string | null;
};

export type OfflineSyncSummary = {
  total: number;
  conflict: number;
  failed: number;
  queued: number;
  needsAction: number;
};

const ENTITY_KIND_LABELS: Record<string, string> = {
  visit_record: '訪問メモ',
  residual_medication: '残薬調整',
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function collectOfflineSyncScheduleIds(items: SyncQueueItemSummary[]): string[] {
  const scheduleIds = new Set<string>();
  for (const item of items) {
    const scheduleId = readString(item.payload.schedule_id) ?? readString(item.scope_id);
    if (scheduleId) scheduleIds.add(scheduleId);
  }
  return Array.from(scheduleIds);
}

export function resolveSyncRowPatientLabel(
  item: Pick<SyncQueueItemSummary, 'payload' | 'scope_id'>,
  patientNameByScheduleId: ReadonlyMap<string, string>,
): string {
  const scheduleId = readString(item.payload.schedule_id) ?? readString(item.scope_id);
  if (scheduleId) {
    const name = patientNameByScheduleId.get(scheduleId);
    if (name) return name;
  }
  return readString(item.payload.patient_id) ?? scheduleId ?? '対象不明';
}

export function buildOfflineSyncRows(
  items: SyncQueueItemSummary[],
  patientNameByScheduleId: ReadonlyMap<string, string>,
): OfflineSyncRow[] {
  return items.map((item) => {
    const statusKey: OfflineSyncRowStatusKey =
      item.conflict_state === 'server_conflict'
        ? 'conflict'
        : item.retryCount >= SYNC_MAX_RETRIES
          ? 'failed'
          : 'queued';

    return {
      id: typeof item.id === 'number' ? item.id : null,
      kindLabel:
        readString(item.payload.display_kind) ??
        ENTITY_KIND_LABELS[item.entityType] ??
        item.entityType,
      patientLabel: resolveSyncRowPatientLabel(item, patientNameByScheduleId),
      scopeId: readString(item.scope_id),
      statusKey,
      statusLabel:
        readString(item.payload.display_status) ??
        (statusKey === 'conflict' ? '競合' : statusKey === 'failed' ? '失敗' : '同期待ち'),
      nextActionKey:
        statusKey === 'conflict' ? 'resolve_conflict' : statusKey === 'failed' ? 'retry' : 'keep',
      nextActionLabel:
        readString(item.payload.display_next_action) ??
        (statusKey === 'conflict' ? '内容を確認' : statusKey === 'failed' ? '再試行' : 'そのまま'),
      lastError: readString(item.lastError),
    };
  });
}

export function buildOfflineSyncSummary(rows: OfflineSyncRow[]): OfflineSyncSummary {
  const summary: OfflineSyncSummary = {
    total: rows.length,
    conflict: 0,
    failed: 0,
    queued: 0,
    needsAction: 0,
  };

  for (const row of rows) {
    summary[row.statusKey] += 1;
  }
  summary.needsAction = summary.conflict + summary.failed;
  return summary;
}

/** 訪問メモ本文(SOAP の入力済みフィールドを連結)。 */
function summarizeVisitText(source: Record<string, unknown>): string {
  const parts = [
    readString(source.soap_subjective),
    readString(source.soap_objective),
    readString(source.soap_assessment),
    readString(source.soap_plan),
  ].filter((value): value is string => value !== null);
  if (parts.length === 0) return '訪問メモの入力はありません。';
  return parts.join(' / ');
}

export type OfflineSyncConflictView = {
  itemId: number;
  patientLabel: string;
  localText: string;
  localOutcome: string | null;
  serverText: string;
  serverOutcome: string | null;
  serverVisitDate: string | null;
  canOverwrite: boolean;
};

export function getOfflineSyncRetryAllDisabledReason({
  isPending,
  rowCount,
}: {
  isPending: boolean;
  rowCount: number;
}) {
  if (isPending) return null;
  if (rowCount === 0) return '未同期のデータはありません。';
  return null;
}

export function getOfflineSyncLocalOverwriteDisabledReason({
  canOverwrite,
  isPending,
}: {
  canOverwrite: boolean;
  isPending: boolean;
}) {
  if (isPending) return null;
  if (!canOverwrite) return 'サーバー側の記録を取得できないため上書きできません。';
  return null;
}

export function buildOfflineSyncConflictView(
  item: SyncQueueItemSummary,
  patientNameByScheduleId: ReadonlyMap<string, string>,
): OfflineSyncConflictView | null {
  if (typeof item.id !== 'number' || !item.conflict) return null;

  const server = item.conflict.server;
  return {
    itemId: item.id,
    patientLabel: resolveSyncRowPatientLabel(item, patientNameByScheduleId),
    localText: summarizeVisitText(item.conflict.local),
    localOutcome: readString(item.conflict.local.outcome_status),
    serverText: server
      ? summarizeVisitText(server as unknown as Record<string, unknown>)
      : 'サーバー側の記録を取得できませんでした。',
    serverOutcome: server?.outcome_status ?? null,
    serverVisitDate: server?.visit_date ?? null,
    canOverwrite: Boolean(server),
  };
}
