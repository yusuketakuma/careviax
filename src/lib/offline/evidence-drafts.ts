'use client';

import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import { encodePathSegment } from '@/lib/http/path-segment';
import { offlineDb, type OfflineEvidenceDraft } from '@/lib/stores/offline-db';
import { createFetchTimeout } from '@/lib/utils/abort-timeout';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import {
  MAX_EVIDENCE_SYNC_RETRIES,
  mergeVisitRecordAttachmentRefs,
  pickSyncableEvidenceDrafts,
  resolveScheduleVisitRecordId,
} from './evidence-drafts.shared';

/**
 * p0_48「スマホで写真・証跡を撮る」のオフライン写真ドラフト。
 * 撮影した画像は dataURL を AES-GCM 暗号化して IndexedDB に保存し、
 * オンライン復帰時に既存の files API(presigned-upload → PUT → complete)で
 * アップロードして訪問記録の添付へ紐づける(p0_31/p0_22 と同じ作法)。
 */

export type SaveEvidenceDraftInput = {
  orgId: string;
  scheduleId: string;
  patientId?: string;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** 撮影画像の dataURL(保存時に暗号化される) */
  dataUrl: string;
  capturedAt: Date;
};

/** 撮影画像を端末のオフラインドラフトとして保存する(暗号化必須)。 */
export async function saveEvidenceDraft(input: SaveEvidenceDraftInput): Promise<void> {
  await offlineDb.evidenceDrafts.add({
    orgId: input.orgId,
    scheduleId: input.scheduleId,
    patientId: input.patientId,
    category: input.category,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    payload: await encryptOfflinePayloadRequired(input.dataUrl, 'evidence draft photo payload'),
    capturedAt: input.capturedAt,
    createdAt: new Date(),
    synced: false,
    retryCount: 0,
  });
}

export type EvidenceDraftSummary = {
  id: number | null;
  scheduleId: string;
  category: string;
  fileName: string;
  /** ISO 文字列(ギャラリーの「撮影 HH:MM」表示用) */
  capturedAt: string;
};

function hasOrgId(orgId: unknown): orgId is string {
  return typeof orgId === 'string' && orgId.trim().length > 0;
}

/** 未同期ドラフトのメタデータ一覧(画像 payload は復号しない)。 */
export async function listEvidenceDraftSummaries(orgId: string): Promise<EvidenceDraftSummary[]> {
  if (!hasOrgId(orgId)) return [];

  const drafts = await offlineDb.evidenceDrafts
    .where('retryCount')
    .aboveOrEqual(0)
    .and((draft) => draft.orgId === orgId && !draft.synced)
    .toArray();
  return mapEvidenceDraftSummaries(drafts);
}

/** 指定訪問の未同期ドラフトのメタデータ一覧(画像 payload は復号しない)。 */
export async function listEvidenceDraftSummariesForSchedule(
  scheduleId: string,
  orgId: string,
): Promise<EvidenceDraftSummary[]> {
  if (!hasOrgId(orgId)) return [];

  const drafts = await offlineDb.evidenceDrafts
    .where('scheduleId')
    .equals(scheduleId)
    .and((draft) => draft.orgId === orgId && !draft.synced && draft.retryCount >= 0)
    .toArray();
  return mapEvidenceDraftSummaries(drafts);
}

function mapEvidenceDraftSummaries(drafts: OfflineEvidenceDraft[]): EvidenceDraftSummary[] {
  return drafts.map((draft) => ({
    id: draft.id ?? null,
    scheduleId: draft.scheduleId,
    category: draft.category,
    fileName: draft.fileName,
    capturedAt:
      draft.capturedAt instanceof Date ? draft.capturedAt.toISOString() : String(draft.capturedAt),
  }));
}

type EvidenceSyncConfig = { orgId: string };
const DEFAULT_EVIDENCE_SYNC_FETCH_TIMEOUT_MS = 15_000;
const MAX_EVIDENCE_SYNC_FETCH_TIMEOUT_MS = 60_000;
const activeEvidenceSyncRuns = new Map<string, Promise<EvidenceSyncResult>>();

type PresignedUploadPayload = {
  id: string;
  uploadUrl: string;
  headers?: Record<string, string>;
};

const GENERIC_EVIDENCE_SYNC_ERROR_MESSAGE = '証跡写真の同期に失敗しました';
const SAFE_EVIDENCE_SYNC_ERROR_MESSAGES = new Set([
  '写真データを復号できませんでした',
  'アップロードURLの取得に失敗しました',
  '写真のアップロードに失敗しました',
  '写真のアップロード確定に失敗しました',
  '写真のアップロード結果が不正です',
  '訪問記録の取得に失敗しました',
  '訪問記録への添付紐づけに失敗しました',
  '証跡写真の同期がタイムアウトしました',
]);

export type EvidenceSyncResult = {
  synced: number;
  /** 訪問記録が未作成などで保留(未同期のまま端末に残る) */
  skipped: number;
  failed: number;
};

function emptyEvidenceSyncResult(): EvidenceSyncResult {
  return { synced: 0, skipped: 0, failed: 0 };
}

function evidenceSyncFetchTimeoutMs() {
  return normalizePositiveTimeoutMs(process.env.NEXT_PUBLIC_EVIDENCE_SYNC_FETCH_TIMEOUT_MS, {
    fallbackMs: DEFAULT_EVIDENCE_SYNC_FETCH_TIMEOUT_MS,
    maxMs: MAX_EVIDENCE_SYNC_FETCH_TIMEOUT_MS,
  });
}

function parsePresignedUploadPayload(payload: unknown): PresignedUploadPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const { id, uploadUrl, headers } = data as {
    id?: unknown;
    uploadUrl?: unknown;
    headers?: unknown;
  };
  if (typeof id !== 'string') return null;
  if (typeof uploadUrl !== 'string') return null;
  const normalizedId = id.trim();
  const normalizedUploadUrl = uploadUrl.trim();
  if (normalizedId.length === 0) return null;
  if (normalizedUploadUrl.length === 0) return null;
  if (headers !== undefined) {
    if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) return null;
    if (!Object.values(headers).every((value) => typeof value === 'string')) return null;
  }
  return {
    id: normalizedId,
    uploadUrl: normalizedUploadUrl,
    headers: headers as Record<string, string> | undefined,
  };
}

function safeEvidenceSyncErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC_EVIDENCE_SYNC_ERROR_MESSAGE;
  return SAFE_EVIDENCE_SYNC_ERROR_MESSAGES.has(error.message)
    ? error.message
    : GENERIC_EVIDENCE_SYNC_ERROR_MESSAGE;
}

async function fetchEvidenceSync(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const abort = createFetchTimeout(
    evidenceSyncFetchTimeoutMs(),
    new Error('EVIDENCE_SYNC_TIMEOUT'),
  );
  try {
    return await fetch(input, { ...init, signal: abort.signal });
  } catch (error) {
    if (abort.signal.aborted) {
      throw new Error('証跡写真の同期がタイムアウトしました');
    }
    throw error;
  } finally {
    abort.clear();
  }
}

/**
 * ドラフトの訪問(予定)ID から添付先の訪問記録 ID を解決する。
 * 予定にまだ記録が無ければ null(=保留)。記録 ID で撮影された場合の
 * フォールバックとして、ID が訪問記録として直接引けるかも確認する。
 */
async function resolveVisitRecordIdForDraft(
  scheduleId: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const schedulePathId = encodePathSegment(scheduleId);
  const scheduleRes = await fetchEvidenceSync(`/api/visit-schedules/${schedulePathId}`, {
    headers,
  });
  if (scheduleRes.ok) {
    return resolveScheduleVisitRecordId(await scheduleRes.json().catch(() => null));
  }
  const recordRes = await fetchEvidenceSync(`/api/visit-records/${schedulePathId}`, { headers });
  return recordRes.ok ? scheduleId : null;
}

/** 1 ドラフトをアップロードし、訪問記録の添付へ紐づける(失敗時は throw)。 */
async function uploadEvidenceDraft(
  draft: OfflineEvidenceDraft,
  visitRecordId: string,
  orgId: string,
): Promise<void> {
  const jsonHeaders = { 'Content-Type': 'application/json', 'x-org-id': orgId };
  const visitRecordPathId = encodePathSegment(visitRecordId);
  let fileAssetId =
    draft.uploadedVisitRecordId === visitRecordId ? (draft.uploadedFileAssetId ?? null) : null;

  if (!fileAssetId) {
    const dataUrl = await decryptOfflinePayload(draft.payload);
    if (!dataUrl) throw new Error('写真データを復号できませんでした');
    const blob = await (await fetchEvidenceSync(dataUrl)).blob();

    // 1. presigned-upload → 2. PUT → 3. complete(p0_31 残薬写真と同じ作法)
    const presignRes = await fetchEvidenceSync('/api/files/presigned-upload', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        purpose: 'visit-photo',
        file_name: draft.fileName,
        mime_type: draft.mimeType,
        size_bytes: draft.sizeBytes,
        visit_record_id: visitRecordId,
      }),
    });
    const presignJson = await presignRes.json().catch(() => null);
    if (!presignRes.ok) {
      throw new Error('アップロードURLの取得に失敗しました');
    }
    const presignedUpload = parsePresignedUploadPayload(presignJson);
    if (!presignedUpload) {
      throw new Error('アップロードURLの取得に失敗しました');
    }

    const uploadRes = await fetchEvidenceSync(presignedUpload.uploadUrl, {
      method: 'PUT',
      headers: presignedUpload.headers,
      body: blob,
    });
    if (!uploadRes.ok) throw new Error('写真のアップロードに失敗しました');

    const completeRes = await fetchEvidenceSync('/api/files/complete', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        file_id: presignedUpload.id,
        etag: uploadRes.headers.get('etag') ?? undefined,
      }),
    });
    if (!completeRes.ok) throw new Error('写真のアップロード確定に失敗しました');

    const completedFileAssetId = presignedUpload.id;
    if (typeof completedFileAssetId !== 'string' || !completedFileAssetId) {
      throw new Error('写真のアップロード結果が不正です');
    }
    fileAssetId = completedFileAssetId;
    await offlineDb.evidenceDrafts.update(draft.id!, {
      uploadedFileAssetId: fileAssetId,
      uploadedVisitRecordId: visitRecordId,
      lastError: undefined,
    });
  }

  if (!fileAssetId) throw new Error('写真のアップロード結果が不正です');

  // 4. 訪問記録 attachments へ紐づけ(既存添付とマージ、楽観ロック version 必須)
  const detailRes = await fetchEvidenceSync(`/api/visit-records/${visitRecordPathId}`, {
    headers: { 'x-org-id': orgId },
  });
  const detail = await detailRes.json().catch(() => null);
  if (!detailRes.ok || typeof detail?.version !== 'number') {
    throw new Error('訪問記録の取得に失敗しました');
  }

  const patchRes = await fetchEvidenceSync(`/api/visit-records/${visitRecordPathId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({
      version: detail.version,
      attachments: mergeVisitRecordAttachmentRefs(detail.attachments, fileAssetId),
    }),
  });
  if (!patchRes.ok) {
    throw new Error('訪問記録への添付紐づけに失敗しました');
  }
}

/**
 * 未同期の写真ドラフトを送信する。訪問記録が未作成の訪問は保留(skipped)とし、
 * 端末上は「未同期」のまま残す。成功したドラフトは削除する。
 */
async function syncEvidenceDraftsOnce(config: EvidenceSyncConfig): Promise<EvidenceSyncResult> {
  const result = emptyEvidenceSyncResult();
  if (!hasOrgId(config.orgId)) return result;
  if (typeof window !== 'undefined' && !window.navigator.onLine) return result;

  const drafts = pickSyncableEvidenceDrafts(
    await offlineDb.evidenceDrafts
      .where('retryCount')
      .below(MAX_EVIDENCE_SYNC_RETRIES)
      .and((draft) => draft.orgId === config.orgId && !draft.synced)
      .toArray(),
  );
  if (drafts.length === 0) return result;

  const headers = { 'x-org-id': config.orgId };
  const recordIdByScheduleId = new Map<string, string | null>();

  for (const draft of drafts) {
    try {
      let recordId = recordIdByScheduleId.get(draft.scheduleId);
      if (recordId === undefined) {
        recordId = await resolveVisitRecordIdForDraft(draft.scheduleId, headers);
        recordIdByScheduleId.set(draft.scheduleId, recordId);
      }

      if (!recordId) {
        result.skipped += 1;
        continue;
      }

      await uploadEvidenceDraft(draft, recordId, config.orgId);
      await offlineDb.evidenceDrafts.delete(draft.id!);
      result.synced += 1;
    } catch (error) {
      await offlineDb.evidenceDrafts.update(draft.id!, {
        retryCount: draft.retryCount + 1,
        lastError: safeEvidenceSyncErrorMessage(error),
      });
      result.failed += 1;
    }
  }

  return result;
}

export async function syncEvidenceDrafts(config: EvidenceSyncConfig): Promise<EvidenceSyncResult> {
  if (!hasOrgId(config?.orgId)) return emptyEvidenceSyncResult();

  const activeRun = activeEvidenceSyncRuns.get(config.orgId);
  if (activeRun) return activeRun;
  const run = syncEvidenceDraftsOnce(config).finally(() => {
    activeEvidenceSyncRuns.delete(config.orgId);
  });
  activeEvidenceSyncRuns.set(config.orgId, run);
  return run;
}

/**
 * リトライ上限に達した未同期写真を再送対象へ戻す。
 * アップロード済み file metadata は retry resume に必要なため保持する。
 */
export async function resetFailedEvidenceDraftRetries(config: EvidenceSyncConfig): Promise<number> {
  if (!hasOrgId(config?.orgId)) return 0;

  const failedDrafts = await offlineDb.evidenceDrafts
    .where('retryCount')
    .aboveOrEqual(MAX_EVIDENCE_SYNC_RETRIES)
    .and((draft) => draft.orgId === config.orgId && !draft.synced)
    .toArray();
  await Promise.all(
    failedDrafts.map((draft) =>
      offlineDb.evidenceDrafts.update(draft.id!, { retryCount: 0, lastError: undefined }),
    ),
  );
  return failedDrafts.length;
}

/** online 復帰時の自動送信(p0_48「戻ったら自動で送信します」)。teardown を返す。 */
export function setupEvidenceAutoSync(config: EvidenceSyncConfig): () => void {
  const handler = () => {
    syncEvidenceDrafts(config).catch((error) => {
      console.warn('[offline-evidence] automatic sync failed', safeEvidenceSyncErrorMessage(error));
    });
  };

  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}
