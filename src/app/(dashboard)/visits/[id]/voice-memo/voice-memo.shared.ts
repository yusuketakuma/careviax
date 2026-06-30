import { format } from 'date-fns';
import { appendVoiceTranscript } from '@/lib/voice-recognition';

/**
 * p1_11「音声メモ・文字起こし」の表示モデル(純関数)。
 * 録音(MediaRecorder)→ 端末保存 → 転写待ち → 訪問記録へ反映のワークフローのうち、
 * 射影・状態遷移・PATCH ボディ組み立てをここに置き vitest で検証する。
 * 文字起こしエンジン(STT)は外部サービス依存のため第一版には含めない(cc:blocked)。
 */

/** 録音フェーズ(idle=未録音 / recording=録音中 / recorded=録音済み) */
export type VoiceMemoPhase = 'idle' | 'recording' | 'recorded';

/** 録音上限(第一版: メモリ保護のため 10 分で自動停止) */
export const MAX_VOICE_MEMO_SECONDS = 600;

/** 装飾波形の縦線本数(target の青い縦線群と同程度の密度) */
export const VOICE_MEMO_WAVEFORM_BAR_COUNT = 56;

/** dev 撮影用デモ(target の例文と 01:23)。__phosSeedVoiceMemoDemo から注入する。 */
export const VOICE_MEMO_DEMO_DURATION_SECONDS = 83;
export const VOICE_MEMO_DEMO_TRANSCRIPT =
  '夕食後の薬は家族が声をかけると飲めている。便秘は続いているが、腹痛はなし。次回も便通を確認する。';

/** 手入力文字起こしの上限。訪問中メモ用途なので長文カルテ化を防ぐ。 */
export const VOICE_MEMO_MANUAL_TRANSCRIPT_MAX_LENGTH = 2000;

const TRANSCRIPT_HIGHLIGHT_LABELS = ['服薬', '症状', '次回確認'] as const;

/** MediaRecorder へ渡す候補 mime(対応順。全滅ならブラウザ既定 = undefined) */
const PREFERRED_AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const;

/** 秒数 → 「mm:ss」(負値は 00:00、99:59 で飽和) */
export function formatVoiceMemoDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const capped = Math.min(safeSeconds, 99 * 60 + 59);
  const minutes = Math.floor(capped / 60);
  const seconds = capped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 見出し「訪問中メモ 01:23」(未録音時は時間なしの「訪問中メモ」) */
export function buildVoiceMemoTitle(durationSeconds: number | null): string {
  if (durationSeconds === null) return '訪問中メモ';
  return `訪問中メモ ${formatVoiceMemoDuration(durationSeconds)}`;
}

export type VoiceMemoTranscriptHighlight = {
  label: (typeof TRANSCRIPT_HIGHLIGHT_LABELS)[number] | 'メモ';
  text: string;
};

/** 転写文を訪問記録へ入れる前に確認しやすい短い要点へ分ける。 */
export function buildVoiceMemoTranscriptHighlights(
  transcript: string | null,
): VoiceMemoTranscriptHighlight[] {
  const sentences = (transcript ?? '')
    .split(/(?<=[。！？!?])\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3);

  return sentences.map((text, index) => ({
    label: TRANSCRIPT_HIGHLIGHT_LABELS[index] ?? 'メモ',
    text,
  }));
}

/** STT未接続時の手入力文字起こしを、訪問記録へ入れられる形へ正規化する。 */
export function normalizeVoiceMemoManualTranscript(value: string): string | null {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, VOICE_MEMO_MANUAL_TRANSCRIPT_MAX_LENGTH);
}

/** MediaRecorder の isTypeSupported から優先 mime を選ぶ(未対応のみなら undefined) */
export function pickPreferredAudioMimeType(
  isTypeSupported: (type: string) => boolean,
): string | undefined {
  for (const candidate of PREFERRED_AUDIO_MIME_TYPES) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      // isTypeSupported 自体が throw する環境はブラウザ既定に任せる
      return undefined;
    }
  }
  return undefined;
}

/** 録音 mime → ファイル拡張子(codec 付き mime は基底で判定。未知は webm) */
export function audioMimeTypeToExtension(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  switch (base) {
    case 'audio/mp4':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    default:
      return 'webm';
  }
}

/** 録音ファイル名「音声メモ_{yyyyMMdd-HHmmss}.{拡張子}」(p0_48 のファイル名作法) */
export function buildVoiceMemoFileName(recordedAt: Date, mimeType: string): string {
  return `音声メモ_${format(recordedAt, 'yyyyMMdd-HHmmss')}.${audioMimeTypeToExtension(mimeType)}`;
}

/**
 * 装飾波形の高さ(0.18〜1.0)を決定的な疑似乱数で生成する。
 * 実波形ではなく target と同じ見た目の縦線群を再現する(撮影の再現性のため決定的)。
 */
export function buildVoiceMemoWaveformHeights(
  barCount = VOICE_MEMO_WAVEFORM_BAR_COUNT,
  seed = 7,
): number[] {
  const safeCount = Number.isInteger(barCount) && barCount > 0 ? barCount : 0;
  return Array.from({ length: safeCount }, (_, index) => {
    const noise = Math.abs(Math.sin(seed + (index + 1) * 12.9898) * 43758.5453) % 1;
    // 中央が高めの緩い起伏 + ノイズ(target の波形らしさ)
    const envelope = 0.55 + 0.45 * Math.sin((index / Math.max(1, safeCount - 1)) * Math.PI);
    const height = 0.18 + 0.82 * noise * envelope;
    return Math.round(Math.min(1, Math.max(0.18, height)) * 100) / 100;
  });
}

/**
 * 訪問記録 PATCH ボディの組み立て: 転写テキストを S(主観)の下書きメモへ追記する。
 * 楽観ロックのため detail レスポンスの version が必須(欠落・転写空は null = 追記不可)。
 */
export function buildVoiceMemoRecordPatchBody(
  detail: unknown,
  transcript: string,
): { version: number; soap_subjective: string } | null {
  const trimmed = transcript.trim();
  if (!trimmed) return null;
  if (typeof detail !== 'object' || detail === null) return null;
  const source = detail as { version?: unknown; soap_subjective?: unknown };
  if (
    typeof source.version !== 'number' ||
    !Number.isInteger(source.version) ||
    source.version <= 0
  ) {
    return null;
  }
  const current = typeof source.soap_subjective === 'string' ? source.soap_subjective : '';
  return {
    version: source.version,
    soap_subjective: appendVoiceTranscript(current, trimmed),
  };
}

/** フェーズ+転写有無からの表示派生(左カードのボタン群・右カードの状態) */
export type VoiceMemoView = {
  /** 「録音を始める」を出す(未録音) */
  showStartButton: boolean;
  /** 「録音を止める」を出す(録音中) */
  showStopButton: boolean;
  /** 「再生する」「文字にする」を出す(録音済み or デモ注入後) */
  showMemoActions: boolean;
  /** 波形をアニメーションさせる(録音中のみ) */
  waveformAnimated: boolean;
  /** 右カラム: 転写テキスト+「訪問記録へ入れる」を表示 */
  transcriptReady: boolean;
  /** 右カラム: 準備中の説明カードを表示(転写なし) */
  showTranscriptPlaceholder: boolean;
};

export function deriveVoiceMemoView(input: {
  phase: VoiceMemoPhase;
  transcript: string | null;
}): VoiceMemoView {
  const transcriptReady = Boolean(input.transcript && input.transcript.trim().length > 0);
  return {
    showStartButton: input.phase === 'idle',
    showStopButton: input.phase === 'recording',
    showMemoActions: input.phase === 'recorded',
    waveformAnimated: input.phase === 'recording',
    transcriptReady,
    showTranscriptPlaceholder: !transcriptReady,
  };
}
