'use client';

import { decryptOfflinePayload, encryptOfflinePayloadRequired } from '@/lib/offline/crypto';
import { offlineDb, type OfflineVoiceMemoDraft } from '@/lib/stores/offline-db';

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

const VOICE_MEMO_AUDIO_CONTEXT = 'voice memo draft payload';
const VOICE_MEMO_TRANSCRIPT_CONTEXT = 'voice memo manual transcript payload';

function selectLatestVoiceMemoDraft(
  drafts: OfflineVoiceMemoDraft[],
): OfflineVoiceMemoDraft | undefined {
  return drafts
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .at(-1);
}

/**
 * 録音音声を端末のオフラインドラフトとして保存する(暗号化必須)。
 * 第一版は「訪問につき最新 1 件」の運用のため、同じ訪問の旧ドラフトは置き換える。
 */
export async function saveVoiceMemoDraft(input: SaveVoiceMemoDraftInput): Promise<void> {
  const payload = await encryptOfflinePayloadRequired(input.dataUrl, VOICE_MEMO_AUDIO_CONTEXT);
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

/**
 * STT 未接続時の手入力転写を、最新の録音ドラフトへ暗号化して保存する。
 * 録音ドラフトが無い場合は false を返し、画面上の即時反映は妨げない。
 */
export async function saveVoiceMemoManualTranscript(
  visitId: string,
  transcript: string,
): Promise<boolean> {
  const trimmed = transcript.trim();
  if (!trimmed) return false;

  const drafts = await offlineDb.voiceMemoDrafts.where('visitId').equals(visitId).toArray();
  const latest = selectLatestVoiceMemoDraft(drafts);
  if (typeof latest?.id !== 'number') return false;

  const transcriptPayload = await encryptOfflinePayloadRequired(
    trimmed,
    VOICE_MEMO_TRANSCRIPT_CONTEXT,
  );
  await offlineDb.voiceMemoDrafts.update(latest.id, {
    transcriptPayload,
    transcriptStatus: 'done',
  });
  return true;
}

export type VoiceMemoDraftSnapshot = {
  /** 復号済みの音声 dataURL(再生用) */
  dataUrl: string;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
  /** ISO 文字列 */
  recordedAt: string;
  /** 復号済みの手入力転写。保存前・復号不可は null。 */
  manualTranscript: string | null;
};

/**
 * 訪問に紐づく最新の録音ドラフトを読み込む(再読込後も転写待ちメモを再生できるように)。
 * ドラフトなし・復号不可は null。
 */
export async function loadLatestVoiceMemoDraft(
  visitId: string,
): Promise<VoiceMemoDraftSnapshot | null> {
  const drafts = await offlineDb.voiceMemoDrafts.where('visitId').equals(visitId).toArray();
  const latest = selectLatestVoiceMemoDraft(drafts);
  if (!latest) return null;

  const dataUrl = await decryptOfflinePayload(latest.payload);
  if (!dataUrl) return null;
  const manualTranscript = latest.transcriptPayload
    ? await decryptOfflinePayload(latest.transcriptPayload)
    : null;

  return {
    dataUrl,
    fileName: latest.fileName,
    mimeType: latest.mimeType,
    durationSeconds: latest.durationSeconds,
    recordedAt:
      latest.recordedAt instanceof Date
        ? latest.recordedAt.toISOString()
        : String(latest.recordedAt),
    manualTranscript: manualTranscript?.trim() ? manualTranscript : null,
  };
}
