'use client';

import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import { offlineDb } from '@/lib/stores/offline-db';

/**
 * p1_11「音声メモ・文字起こし」のオフライン録音ドラフト(p0_48 evidence-drafts の
 * 作法を audio 用に最小拡張)。録音音声は dataURL を AES-GCM 暗号化して IndexedDB に
 * 保存する。既存 files API は音声 mime を受け付けないため、サーバー送信(と転写)は
 * 外部 STT サービス接続後に拡張する(cc:blocked)。第一版は転写待ちのまま端末保持。
 */

export type SaveVoiceMemoDraftInput = {
  /** 録音画面を開いた訪問(visit-schedule または visit-record)ID */
  visitId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** 録音音声の dataURL(保存時に暗号化される) */
  dataUrl: string;
  durationSeconds: number;
  recordedAt: Date;
};

/**
 * 録音音声を端末のオフラインドラフトとして保存する(暗号化必須)。
 * 第一版は「訪問につき最新 1 件」の運用のため、同じ訪問の旧ドラフトは置き換える。
 */
export async function saveVoiceMemoDraft(input: SaveVoiceMemoDraftInput): Promise<void> {
  const payload = await encryptOfflinePayloadRequired(input.dataUrl, 'voice memo draft payload');
  await offlineDb.transaction('rw', offlineDb.voiceMemoDrafts, async () => {
    await offlineDb.voiceMemoDrafts.where('visitId').equals(input.visitId).delete();
    await offlineDb.voiceMemoDrafts.add({
      visitId: input.visitId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      payload,
      durationSeconds: input.durationSeconds,
      recordedAt: input.recordedAt,
      createdAt: new Date(),
      transcriptStatus: 'pending',
    });
  });
}

export type VoiceMemoDraftSnapshot = {
  /** 復号済みの音声 dataURL(再生用) */
  dataUrl: string;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
  /** ISO 文字列 */
  recordedAt: string;
};

/**
 * 訪問に紐づく最新の録音ドラフトを読み込む(再読込後も転写待ちメモを再生できるように)。
 * ドラフトなし・復号不可は null。
 */
export async function loadLatestVoiceMemoDraft(
  visitId: string,
): Promise<VoiceMemoDraftSnapshot | null> {
  const drafts = await offlineDb.voiceMemoDrafts.where('visitId').equals(visitId).toArray();
  const latest = drafts
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .at(-1);
  if (!latest) return null;

  const dataUrl = await decryptOfflinePayload(latest.payload);
  if (!dataUrl) return null;

  return {
    dataUrl,
    fileName: latest.fileName,
    mimeType: latest.mimeType,
    durationSeconds: latest.durationSeconds,
    recordedAt:
      latest.recordedAt instanceof Date
        ? latest.recordedAt.toISOString()
        : String(latest.recordedAt),
  };
}
