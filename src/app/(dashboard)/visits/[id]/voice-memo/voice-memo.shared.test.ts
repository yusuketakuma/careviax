import { describe, expect, it } from 'vitest';
import {
  MAX_VOICE_MEMO_SECONDS,
  VOICE_MEMO_DEMO_DURATION_SECONDS,
  VOICE_MEMO_DEMO_TRANSCRIPT,
  VOICE_MEMO_MANUAL_TRANSCRIPT_MAX_LENGTH,
  VOICE_MEMO_WAVEFORM_BAR_COUNT,
  audioMimeTypeToExtension,
  buildVoiceMemoFileName,
  buildVoiceMemoRecordPatchBody,
  buildVoiceMemoTitle,
  buildVoiceMemoTranscriptHighlights,
  buildVoiceMemoWaveformHeights,
  deriveVoiceMemoView,
  formatVoiceMemoDuration,
  normalizeVoiceMemoManualTranscript,
  pickPreferredAudioMimeType,
} from './voice-memo.shared';

/** ローカルタイムで固定の録音時刻(タイムゾーン非依存のテストにする) */
const RECORDED_AT = new Date(2026, 5, 13, 10, 30, 45);

describe('formatVoiceMemoDuration / buildVoiceMemoTitle', () => {
  it('秒数を mm:ss へ整形する(83 秒 = target の 01:23)', () => {
    expect(formatVoiceMemoDuration(0)).toBe('00:00');
    expect(formatVoiceMemoDuration(83)).toBe('01:23');
    expect(formatVoiceMemoDuration(VOICE_MEMO_DEMO_DURATION_SECONDS)).toBe('01:23');
    expect(formatVoiceMemoDuration(600)).toBe('10:00');
  });

  it('負値・非数は 00:00、過大値は 99:59 で飽和する', () => {
    expect(formatVoiceMemoDuration(-5)).toBe('00:00');
    expect(formatVoiceMemoDuration(Number.NaN)).toBe('00:00');
    expect(formatVoiceMemoDuration(99 * 60 + 59 + 1)).toBe('99:59');
  });

  it('見出しは「訪問中メモ 01:23」、未録音は時間なし', () => {
    expect(buildVoiceMemoTitle(VOICE_MEMO_DEMO_DURATION_SECONDS)).toBe('訪問中メモ 01:23');
    expect(buildVoiceMemoTitle(null)).toBe('訪問中メモ');
  });
});

describe('pickPreferredAudioMimeType', () => {
  it('opus 付き webm を最優先で選ぶ', () => {
    expect(pickPreferredAudioMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('webm 非対応(Safari 等)は audio/mp4 へフォールバックする', () => {
    expect(pickPreferredAudioMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4');
  });

  it('全滅・判定不能はブラウザ既定(undefined)に任せる', () => {
    expect(pickPreferredAudioMimeType(() => false)).toBeUndefined();
    expect(
      pickPreferredAudioMimeType(() => {
        throw new Error('not implemented');
      }),
    ).toBeUndefined();
  });
});

describe('audioMimeTypeToExtension / buildVoiceMemoFileName', () => {
  it('mime(codec 付き含む)を拡張子へ変換し、未知は webm へ寄せる', () => {
    expect(audioMimeTypeToExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioMimeTypeToExtension('audio/mp4')).toBe('m4a');
    expect(audioMimeTypeToExtension('audio/mpeg')).toBe('mp3');
    expect(audioMimeTypeToExtension('application/octet-stream')).toBe('webm');
  });

  it('ファイル名は「音声メモ_yyyyMMdd-HHmmss.拡張子」', () => {
    expect(buildVoiceMemoFileName(RECORDED_AT, 'audio/webm;codecs=opus')).toBe(
      '音声メモ_20260613-103045.webm',
    );
    expect(buildVoiceMemoFileName(RECORDED_AT, 'audio/mp4')).toBe('音声メモ_20260613-103045.m4a');
  });
});

describe('buildVoiceMemoWaveformHeights', () => {
  it('既定本数で 0.18〜1.0 の高さを決定的に生成する(撮影の再現性)', () => {
    const first = buildVoiceMemoWaveformHeights();
    const second = buildVoiceMemoWaveformHeights();
    expect(first).toHaveLength(VOICE_MEMO_WAVEFORM_BAR_COUNT);
    expect(first).toEqual(second);
    for (const height of first) {
      expect(height).toBeGreaterThanOrEqual(0.18);
      expect(height).toBeLessThanOrEqual(1);
    }
  });

  it('seed を変えると別の波形になり、不正な本数は空配列にする', () => {
    expect(buildVoiceMemoWaveformHeights(56, 7)).not.toEqual(buildVoiceMemoWaveformHeights(56, 8));
    expect(buildVoiceMemoWaveformHeights(0)).toEqual([]);
    expect(buildVoiceMemoWaveformHeights(-1)).toEqual([]);
    expect(buildVoiceMemoWaveformHeights(2.5)).toEqual([]);
  });
});

describe('buildVoiceMemoRecordPatchBody', () => {
  it('転写を S(主観)の既存メモへ改行追記し、楽観ロック version を引き継ぐ', () => {
    expect(
      buildVoiceMemoRecordPatchBody(
        { version: 3, soap_subjective: '本人より食欲はある、と。' },
        VOICE_MEMO_DEMO_TRANSCRIPT,
      ),
    ).toEqual({
      version: 3,
      soap_subjective: `本人より食欲はある、と。\n${VOICE_MEMO_DEMO_TRANSCRIPT}`,
    });
  });

  it('既存メモが空なら転写のみを設定する', () => {
    expect(
      buildVoiceMemoRecordPatchBody({ version: 1, soap_subjective: null }, ' 便通を確認する。 '),
    ).toEqual({ version: 1, soap_subjective: '便通を確認する。' });
  });

  it('version 欠落・不正、転写空は null(追記不可)を返す', () => {
    expect(buildVoiceMemoRecordPatchBody({ soap_subjective: 'メモ' }, '転写')).toBeNull();
    expect(buildVoiceMemoRecordPatchBody({ version: '3' }, '転写')).toBeNull();
    expect(buildVoiceMemoRecordPatchBody({ version: 0 }, '転写')).toBeNull();
    expect(buildVoiceMemoRecordPatchBody(null, '転写')).toBeNull();
    expect(buildVoiceMemoRecordPatchBody({ version: 3 }, '   ')).toBeNull();
  });
});

describe('buildVoiceMemoTranscriptHighlights', () => {
  it('転写文を訪問記録へ入れる前の要点へ分ける', () => {
    expect(buildVoiceMemoTranscriptHighlights(VOICE_MEMO_DEMO_TRANSCRIPT)).toEqual([
      { label: '服薬', text: '夕食後の薬は家族が声をかけると飲めている。' },
      { label: '症状', text: '便秘は続いているが、腹痛はなし。' },
      { label: '次回確認', text: '次回も便通を確認する。' },
    ]);
  });

  it('空の転写は要点なし、長文は先頭3文だけを表示する', () => {
    expect(buildVoiceMemoTranscriptHighlights(null)).toEqual([]);
    expect(buildVoiceMemoTranscriptHighlights('一文目。二文目。三文目。四文目。')).toHaveLength(3);
  });
});

describe('normalizeVoiceMemoManualTranscript', () => {
  it('手入力メモの空行・前後空白・CRLFを訪問記録向けに正規化する', () => {
    expect(
      normalizeVoiceMemoManualTranscript('  夕食後は飲めている。 \r\n\r\n  便秘あり。  '),
    ).toBe('夕食後は飲めている。\n便秘あり。');
  });

  it('空白だけなら null、上限超過は 2000 文字で切る', () => {
    expect(normalizeVoiceMemoManualTranscript('   \n  ')).toBeNull();
    const longText = 'あ'.repeat(VOICE_MEMO_MANUAL_TRANSCRIPT_MAX_LENGTH + 5);
    expect(normalizeVoiceMemoManualTranscript(longText)).toHaveLength(
      VOICE_MEMO_MANUAL_TRANSCRIPT_MAX_LENGTH,
    );
  });
});

describe('deriveVoiceMemoView', () => {
  it('未録音は「録音を始める」+ 準備中カード', () => {
    expect(deriveVoiceMemoView({ phase: 'idle', transcript: null })).toEqual({
      showStartButton: true,
      showStopButton: false,
      showMemoActions: false,
      waveformAnimated: false,
      transcriptReady: false,
      showTranscriptPlaceholder: true,
    });
  });

  it('録音中は停止ボタン+波形アニメーション', () => {
    expect(deriveVoiceMemoView({ phase: 'recording', transcript: null })).toMatchObject({
      showStartButton: false,
      showStopButton: true,
      waveformAnimated: true,
    });
  });

  it('録音済み+転写あり(デモ注入後)は target と同じ操作列+転写表示', () => {
    expect(
      deriveVoiceMemoView({ phase: 'recorded', transcript: VOICE_MEMO_DEMO_TRANSCRIPT }),
    ).toEqual({
      showStartButton: false,
      showStopButton: false,
      showMemoActions: true,
      waveformAnimated: false,
      transcriptReady: true,
      showTranscriptPlaceholder: false,
    });
  });

  it('空白だけの転写は未転写として扱う', () => {
    expect(deriveVoiceMemoView({ phase: 'recorded', transcript: '   ' })).toMatchObject({
      transcriptReady: false,
      showTranscriptPlaceholder: true,
    });
  });
});

describe('録音上限', () => {
  it('自動停止の上限は 10 分', () => {
    expect(MAX_VOICE_MEMO_SECONDS).toBe(600);
  });
});
