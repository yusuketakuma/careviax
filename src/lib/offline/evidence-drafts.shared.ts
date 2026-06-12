/**
 * p0_48「スマホで写真・証跡を撮る」のオフライン写真ドラフト同期の純関数部分。
 * dexie / fetch に依存しない射影・判定だけをここに置き、vitest で検証する。
 */

/** 同期リトライ上限(sync-engine の MAX_RETRIES と同じ方針) */
export const MAX_EVIDENCE_SYNC_RETRIES = 3;

/** 訪問予定詳細 API レスポンスから、紐づく訪問記録 ID を安全に取り出す。 */
export function resolveScheduleVisitRecordId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const visitRecord = (payload as { visit_record?: unknown }).visit_record;
  if (typeof visitRecord !== 'object' || visitRecord === null) return null;
  const id = (visitRecord as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * 訪問記録 PATCH 用の attachments 参照を組み立てる。
 * 既存添付(detail レスポンスの attachments)の file_id を順序維持・重複除去で残し、
 * 新規 file_id を末尾に追加する(PATCH は配列全置換のためマージが必須)。
 */
export function mergeVisitRecordAttachmentRefs(
  existing: unknown,
  newFileId: string,
): Array<{ file_id: string }> {
  const fileIds: string[] = [];

  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item !== 'object' || item === null) continue;
      const fileId = (item as { file_id?: unknown }).file_id;
      if (typeof fileId === 'string' && fileId.length > 0 && !fileIds.includes(fileId)) {
        fileIds.push(fileId);
      }
    }
  }

  if (newFileId.length > 0 && !fileIds.includes(newFileId)) {
    fileIds.push(newFileId);
  }

  return fileIds.map((fileId) => ({ file_id: fileId }));
}

/** 送信対象(未同期かつリトライ上限内)のドラフトだけを残す。 */
export function pickSyncableEvidenceDrafts<T extends { synced: boolean; retryCount: number }>(
  drafts: T[],
): T[] {
  return drafts.filter((draft) => !draft.synced && draft.retryCount < MAX_EVIDENCE_SYNC_RETRIES);
}
