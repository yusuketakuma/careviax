'use client';

import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import { offlineDb, type OfflineEvidenceDraft } from '@/lib/stores/offline-db';
import {
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

/** 未同期ドラフトのメタデータ一覧(画像 payload は復号しない)。 */
export async function listEvidenceDraftSummaries(): Promise<EvidenceDraftSummary[]> {
  const drafts = await offlineDb.evidenceDrafts.toArray();
  return drafts
    .filter((draft) => !draft.synced)
    .map((draft) => ({
      id: draft.id ?? null,
      scheduleId: draft.scheduleId,
      category: draft.category,
      fileName: draft.fileName,
      capturedAt:
        draft.capturedAt instanceof Date
          ? draft.capturedAt.toISOString()
          : String(draft.capturedAt),
    }));
}

type EvidenceSyncConfig = { orgId: string };

export type EvidenceSyncResult = {
  synced: number;
  /** 訪問記録が未作成などで保留(未同期のまま端末に残る) */
  skipped: number;
  failed: number;
};

/**
 * ドラフトの訪問(予定)ID から添付先の訪問記録 ID を解決する。
 * 予定にまだ記録が無ければ null(=保留)。記録 ID で撮影された場合の
 * フォールバックとして、ID が訪問記録として直接引けるかも確認する。
 */
async function resolveVisitRecordIdForDraft(
  scheduleId: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const scheduleRes = await fetch(`/api/visit-schedules/${scheduleId}`, { headers });
  if (scheduleRes.ok) {
    return resolveScheduleVisitRecordId(await scheduleRes.json().catch(() => null));
  }
  const recordRes = await fetch(`/api/visit-records/${scheduleId}`, { headers });
  return recordRes.ok ? scheduleId : null;
}

/** 1 ドラフトをアップロードし、訪問記録の添付へ紐づける(失敗時は throw)。 */
async function uploadEvidenceDraft(
  draft: OfflineEvidenceDraft,
  visitRecordId: string,
  orgId: string,
): Promise<void> {
  const dataUrl = await decryptOfflinePayload(draft.payload);
  if (!dataUrl) throw new Error('写真データを復号できませんでした');
  const blob = await (await fetch(dataUrl)).blob();

  const jsonHeaders = { 'Content-Type': 'application/json', 'x-org-id': orgId };

  // 1. presigned-upload → 2. PUT → 3. complete(p0_31 残薬写真と同じ作法)
  const presignRes = await fetch('/api/files/presigned-upload', {
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
    throw new Error(presignJson?.message ?? 'アップロードURLの取得に失敗しました');
  }

  const uploadRes = await fetch(presignJson.data.uploadUrl, {
    method: 'PUT',
    headers: presignJson.data.headers,
    body: blob,
  });
  if (!uploadRes.ok) throw new Error('写真のアップロードに失敗しました');

  const completeRes = await fetch('/api/files/complete', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      file_id: presignJson.data.id,
      etag: uploadRes.headers.get('etag') ?? undefined,
    }),
  });
  if (!completeRes.ok) throw new Error('写真のアップロード確定に失敗しました');

  // 4. 訪問記録 attachments へ紐づけ(既存添付とマージ、楽観ロック version 必須)
  const detailRes = await fetch(`/api/visit-records/${visitRecordId}`, {
    headers: { 'x-org-id': orgId },
  });
  const detail = await detailRes.json().catch(() => null);
  if (!detailRes.ok || typeof detail?.version !== 'number') {
    throw new Error('訪問記録の取得に失敗しました');
  }

  const patchRes = await fetch(`/api/visit-records/${visitRecordId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({
      version: detail.version,
      attachments: mergeVisitRecordAttachmentRefs(detail.attachments, presignJson.data.id),
    }),
  });
  if (!patchRes.ok) {
    const patchJson = await patchRes.json().catch(() => null);
    throw new Error(patchJson?.message ?? '訪問記録への添付紐づけに失敗しました');
  }
}

/**
 * 未同期の写真ドラフトを送信する。訪問記録が未作成の訪問は保留(skipped)とし、
 * 端末上は「未同期」のまま残す。成功したドラフトは削除する。
 */
export async function syncEvidenceDrafts(config: EvidenceSyncConfig): Promise<EvidenceSyncResult> {
  const result: EvidenceSyncResult = { synced: 0, skipped: 0, failed: 0 };
  if (typeof window !== 'undefined' && !window.navigator.onLine) return result;

  const drafts = pickSyncableEvidenceDrafts(await offlineDb.evidenceDrafts.toArray());
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
        lastError: error instanceof Error ? error.message : 'Unknown error',
      });
      result.failed += 1;
    }
  }

  return result;
}

/** online 復帰時の自動送信(p0_48「戻ったら自動で送信します」)。teardown を返す。 */
export function setupEvidenceAutoSync(config: EvidenceSyncConfig): () => void {
  const handler = () => {
    syncEvidenceDrafts(config).catch(() => {
      // 失敗しても次回 online 時に再試行する
    });
  };

  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}
