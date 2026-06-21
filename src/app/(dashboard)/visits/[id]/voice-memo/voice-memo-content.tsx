'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Mic, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { resolveScheduleVisitRecordId } from '@/lib/offline/evidence-drafts.shared';
import { loadLatestVoiceMemoDraft, saveVoiceMemoDraft } from '@/lib/offline/voice-memo-drafts';
import { cn } from '@/lib/utils';
import {
  MAX_VOICE_MEMO_SECONDS,
  VOICE_MEMO_DEMO_DURATION_SECONDS,
  VOICE_MEMO_DEMO_TRANSCRIPT,
  buildVoiceMemoFileName,
  buildVoiceMemoRecordPatchBody,
  buildVoiceMemoTranscriptHighlights,
  buildVoiceMemoTitle,
  buildVoiceMemoWaveformHeights,
  deriveVoiceMemoView,
  pickPreferredAudioMimeType,
  type VoiceMemoPhase,
} from './voice-memo.shared';

/**
 * p1_11「音声メモ・文字起こし」: 訪問中の口頭メモを録音し、端末に暗号化保存して
 * 転写待ちにする 2 カラム画面(左=録音メモ / 右=文字起こし)。
 *
 * 第一版のスコープ:
 * - 録音(MediaRecorder)→ 端末保存(IndexedDB 暗号化)→ 再生は動作する
 * - 文字起こしエンジン(STT)は外部サービス依存のため未接続(cc:blocked)。
 *   「文字にする」は準備中トースト+説明カードのスタブ。
 *   dev 限定 window フック __phosSeedVoiceMemoDemo で転写済み状態を注入できる。
 * - 「訪問記録へ入れる」は転写テキストを訪問記録 S(主観)の下書きメモへ追記する
 *   (p1_03 と同じ訪問 ID 二段解決 → 既存 PATCH API)。
 */

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('録音データの読み込みに失敗しました'));
    reader.readAsDataURL(blob);
  });
}

export function VoiceMemoContent({ visitId }: { visitId: string }) {
  const orgId = useOrgId();
  const [phase, setPhase] = useState<VoiceMemoPhase>('idle');
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [recordingUnavailable, setRecordingUnavailable] = useState(false);
  const [transcribeRequested, setTranscribeRequested] = useState(false);
  const [appendedRecordId, setAppendedRecordId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  /** 録音/デモ操作後はマウント時のドラフト復元で上書きしない */
  const interactedRef = useRef(false);

  const waveformHeights = useMemo(() => buildVoiceMemoWaveformHeights(), []);
  const view = deriveVoiceMemoView({ phase, transcript });
  const transcriptHighlights = useMemo(
    () => buildVoiceMemoTranscriptHighlights(transcript),
    [transcript],
  );

  // 端末に残っている転写待ちドラフト(最新 1 件)を復元する
  useEffect(() => {
    let cancelled = false;
    loadLatestVoiceMemoDraft(visitId)
      .then((draft) => {
        if (cancelled || !draft || interactedRef.current) return;
        setPhase('recorded');
        setDurationSeconds(draft.durationSeconds);
        setAudioUrl(draft.dataUrl);
      })
      .catch(() => {
        // 復元できなくても新規録音は可能
      });
    return () => {
      cancelled = true;
    };
  }, [visitId]);

  // dev 限定: 撮影・動作確認用に転写済み状態(target の例文+01:23)を注入する
  // (p0_34 の window フックの作法)。デモは音声を持たない。
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const target = window;
    target.__phosSeedVoiceMemoDemo = () => {
      interactedRef.current = true;
      // 録音途中なら確定処理(onstop)を切り離して破棄し、デモ状態を確実にする
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      mediaRecorderRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      setPhase('recorded');
      setDurationSeconds(VOICE_MEMO_DEMO_DURATION_SECONDS);
      setTranscript(VOICE_MEMO_DEMO_TRANSCRIPT);
      setTranscribeRequested(false);
      setPlaying(false);
      // デモは実音声を持たない(旧 blob URL の解放は audioUrl effect の cleanup が行う)
      setAudioUrl(null);
    };
    return () => {
      delete target.__phosSeedVoiceMemoDemo;
    };
  }, []);

  // アンマウント時の後始末(録音タイマー・マイクストリーム・objectURL)
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // objectURL の解放は audioUrl の差し替え時に行う(再生中の URL を生かす)
  useEffect(() => {
    return () => {
      if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  function stopRecordingTimer() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function stopRecording() {
    stopRecordingTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function finalizeRecording(mimeType: string) {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    mediaRecorderRef.current = null;
    const recordedSeconds = elapsedRef.current;

    if (blob.size === 0) {
      setPhase('idle');
      setDurationSeconds(null);
      toast.error('録音データが空でした。もう一度お試しください');
      return;
    }

    setAudioUrl(URL.createObjectURL(blob));
    setTranscript(null); // 新しい録音は転写待ちへ戻す
    setTranscribeRequested(false);
    setAppendedRecordId(null);
    setDurationSeconds(recordedSeconds);
    setPhase('recorded');

    // 端末保存(暗号化)。失敗しても画面上の再生は可能なまま案内する。
    try {
      const recordedAt = new Date();
      await saveVoiceMemoDraft({
        visitId,
        fileName: buildVoiceMemoFileName(recordedAt, mimeType),
        mimeType,
        sizeBytes: blob.size,
        dataUrl: await readBlobAsDataUrl(blob),
        durationSeconds: recordedSeconds,
        recordedAt,
      });
      toast.success('録音メモを端末に保存しました(通信がなくても残ります)');
    } catch {
      toast.warning('端末への保存に失敗しました。このページを離れると録音は残りません');
    }
  }

  async function handleStartRecording() {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setRecordingUnavailable(true);
      toast.error('録音できない環境です');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      interactedRef.current = true;
      const preferredMimeType = pickPreferredAudioMimeType((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void finalizeRecording(recorder.mimeType || preferredMimeType || 'audio/webm');
      };
      mediaRecorderRef.current = recorder;
      streamRef.current = stream;
      recorder.start();

      elapsedRef.current = 0;
      setDurationSeconds(0);
      setPhase('recording');
      setPlaying(false);
      tickRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setDurationSeconds(elapsedRef.current);
        if (elapsedRef.current >= MAX_VOICE_MEMO_SECONDS) {
          toast.info('録音の上限(10分)に達したため停止しました');
          stopRecording();
        }
      }, 1000);
    } catch {
      // マイク権限なし/デバイスなし → 案内+デモ波形のまま
      setRecordingUnavailable(true);
      toast.error('録音できない環境です(マイクの使用が許可されていません)');
    }
  }

  function handlePlayClick() {
    if (!audioUrl) {
      // デモ注入時は実音声を持たない
      toast.info('デモ音声はありません');
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    audio.play().catch(() => {
      toast.error('音声を再生できませんでした');
    });
  }

  function handleTranscribeClick() {
    // 転写ジョブ投入は外部 STT サービス接続後(cc:blocked)のためスタブ
    setTranscribeRequested(true);
    toast.info('文字起こしは外部サービス接続後に利用できます(準備中)');
  }

  // p1_03 と同じ二段解決(訪問予定 → 紐づく記録 / 直接訪問記録 ID)で
  // 追記先の訪問記録を決め、既存 PATCH API で S(主観)へ追記する。
  const appendMutation = useMutation({
    mutationFn: async () => {
      if (!transcript?.trim()) throw new Error('追記できる文字起こしがありません');
      const headers = { 'x-org-id': orgId };

      let recordId: string | null = null;
      let visitResolved = false;
      const scheduleRes = await fetch(`/api/visit-schedules/${visitId}`, { headers });
      if (scheduleRes.ok) {
        visitResolved = true;
        recordId = resolveScheduleVisitRecordId(await scheduleRes.json().catch(() => null));
      } else {
        const recordRes = await fetch(`/api/visit-records/${visitId}`, { headers });
        if (recordRes.ok) {
          visitResolved = true;
          recordId = visitId;
        }
      }

      if (!visitResolved) throw new Error('訪問に紐づく記録を解決できませんでした');
      if (!recordId) {
        throw new Error(
          '訪問記録がまだ作成されていません。訪問モードで記録を保存してからお試しください',
        );
      }

      const detailRes = await fetch(`/api/visit-records/${recordId}`, { headers });
      const detail = await detailRes.json().catch(() => null);
      if (!detailRes.ok) throw new Error('訪問記録の取得に失敗しました');

      const body = buildVoiceMemoRecordPatchBody(detail, transcript);
      if (!body) throw new Error('訪問記録の取得に失敗しました');

      const patchRes = await fetch(`/api/visit-records/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(body),
      });
      if (!patchRes.ok) {
        const patchJson = await patchRes.json().catch(() => null);
        throw new Error(patchJson?.message ?? '訪問記録への追記に失敗しました');
      }
      return recordId;
    },
    onSuccess: (recordId) => {
      setAppendedRecordId(recordId);
      toast.success('訪問記録のメモ(S: 患者の訴え)へ追記しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問記録への追記に失敗しました');
    },
  });

  const title = buildVoiceMemoTitle(durationSeconds);

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-stretch xl:gap-5"
      data-testid="voice-memo-page"
    >
      <h1 className="sr-only">音声メモ・文字起こし</h1>

      {/* 左カラム: 録音メモ */}
      <section
        aria-labelledby="voice-memo-recorder-heading"
        className="flex flex-col rounded-lg border border-border/70 bg-card p-5 lg:min-h-[calc(100dvh-11rem)]"
      >
        <h2 id="voice-memo-recorder-heading" className="text-base font-bold text-foreground">
          録音メモ
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant={phase === 'recorded' ? 'default' : 'outline'}>
            {phase === 'recorded' ? '録音済み' : phase === 'recording' ? '録音中' : '未録音'}
          </Badge>
          {audioUrl || phase === 'recorded' ? <Badge variant="secondary">端末保存</Badge> : null}
        </div>

        {/* 経過時間は毎秒変わるため live region にしない(状態変化はトーストが通知する) */}
        <p
          className="mt-10 text-lg font-bold leading-7 text-foreground"
          data-testid="voice-memo-title"
        >
          {title}
        </p>

        {/* 装飾波形(実波形ではなく target と同じ縦線群。録音中はアニメーション) */}
        <div
          className="mt-14 flex h-11 items-center gap-1"
          data-testid="voice-memo-waveform"
          aria-hidden="true"
        >
          {waveformHeights.map((height, index) => (
            <span
              key={index}
              className={cn(
                'w-[3px] shrink-0 rounded-full',
                phase === 'recorded' || view.waveformAnimated ? 'bg-primary' : 'bg-primary/30',
                view.waveformAnimated && 'animate-pulse',
              )}
              style={{
                height: `${Math.round(height * 100)}%`,
                ...(view.waveformAnimated ? { animationDelay: `${(index % 8) * 90}ms` } : {}),
              }}
            />
          ))}
        </div>

        {/* 操作列(target は録音済み状態の「再生する」「文字にする」) */}
        <div className="mt-14 flex flex-wrap items-center gap-4">
          {view.showStartButton ? (
            <Button
              type="button"
              className="min-h-11 min-w-44 text-[15px] font-bold"
              disabled={recordingUnavailable}
              onClick={() => void handleStartRecording()}
              data-testid="voice-memo-record-button"
            >
              <Mic aria-hidden="true" />
              録音を始める
            </Button>
          ) : null}

          {view.showStopButton ? (
            <Button
              type="button"
              variant="destructive"
              className="min-h-11 min-w-44 text-[15px] font-bold"
              onClick={stopRecording}
              data-testid="voice-memo-stop-button"
            >
              <Square aria-hidden="true" />
              録音を止める
            </Button>
          ) : null}

          {view.showMemoActions ? (
            <>
              <Button
                type="button"
                className="min-h-11 min-w-44 text-[15px] font-bold"
                onClick={handlePlayClick}
                data-testid="voice-memo-play-button"
              >
                {playing ? '停止する' : '再生する'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 min-w-44 text-[15px] font-bold text-primary"
                onClick={handleTranscribeClick}
                data-testid="voice-memo-transcribe-button"
              >
                文字にする
              </Button>
            </>
          ) : null}
        </div>

        {view.showMemoActions ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3 w-fit text-muted-foreground"
            onClick={() => void handleStartRecording()}
            disabled={recordingUnavailable}
            data-testid="voice-memo-rerecord-button"
          >
            <Mic aria-hidden="true" />
            録り直す
          </Button>
        ) : null}

        {/* 録音不可環境の案内(マイク権限なし/非対応) */}
        {recordingUnavailable ? (
          <div
            className="mt-6 rounded-lg border border-state-confirm/30 bg-state-confirm/10 px-4 py-3"
            data-testid="voice-memo-unavailable-note"
          >
            <p className="text-sm font-bold leading-6 text-state-confirm">録音できない環境です</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              マイクの使用が許可されていないか、この端末では録音に対応していません。上の波形は表示確認用のデモです。
            </p>
          </div>
        ) : null}

        <p className="mt-auto pt-6 text-xs leading-5 text-muted-foreground">
          録音メモは端末に暗号化して保存され、通信がなくても残ります。文字起こしは外部サービス接続後に利用できます。
        </p>
      </section>

      {/* 右カラム: 文字起こし */}
      <section
        aria-labelledby="voice-memo-transcript-heading"
        className="flex flex-col rounded-lg border border-border/70 bg-card p-5 lg:min-h-[calc(100dvh-11rem)]"
      >
        <h2 id="voice-memo-transcript-heading" className="text-base font-bold text-foreground">
          文字起こし
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant={view.transcriptReady ? 'default' : 'outline'}>
            {view.transcriptReady ? '転写済み' : '転写待ち'}
          </Badge>
          {appendedRecordId ? <Badge variant="secondary">記録へ反映済み</Badge> : null}
        </div>

        {view.transcriptReady ? (
          <>
            <p
              className="mt-6 rounded-lg border border-border/70 bg-background p-4 text-sm leading-7 text-foreground"
              data-testid="voice-memo-transcript-text"
            >
              {transcript}
            </p>
            <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 p-4">
              <h3 className="text-sm font-bold text-foreground">記録に入れる要点</h3>
              <ul className="mt-3 grid gap-2" data-testid="voice-memo-transcript-highlights">
                {transcriptHighlights.map((highlight) => (
                  <li
                    key={`${highlight.label}-${highlight.text}`}
                    className="rounded-md bg-card p-3"
                  >
                    <p className="text-xs font-bold text-primary">{highlight.label}</p>
                    <p className="mt-1 text-sm leading-6 text-foreground">{highlight.text}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-5">
              <Button
                type="button"
                className="min-h-11 min-w-56 text-[15px] font-bold"
                disabled={appendMutation.isPending || !orgId}
                onClick={() => appendMutation.mutate()}
                data-testid="voice-memo-append-button"
              >
                {appendMutation.isPending ? '追記中...' : '訪問記録へ入れる'}
              </Button>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                S: 患者の訴えの下書きメモへ追記します。反映前に要点と原文を確認してください。
              </p>
              {appendedRecordId ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  訪問記録のメモへ追記しました。
                  <Link
                    href={`/visits/${appendedRecordId}`}
                    className="ml-1 font-medium text-primary underline underline-offset-2"
                  >
                    記録を確認
                  </Link>
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div
            className="mt-5 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-5"
            data-testid="voice-memo-transcript-placeholder"
          >
            <p className="text-sm font-bold leading-6 text-foreground">
              {transcribeRequested ? '文字起こしは準備中です' : 'まだ文字起こしがありません'}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {transcribeRequested
                ? '外部の文字起こしサービス接続後に、録音メモから自動で文字起こしできるようになります。録音メモは転写待ちとして端末に保存されています。'
                : '左の録音メモで「文字にする」を押すと、ここに文字起こし結果が表示されます(外部サービス接続後に利用できます)。'}
            </p>
          </div>
        )}
      </section>

      {/* 再生用(画面には出さない。薬剤師本人の口頭メモのため字幕トラックなし) */}
      {audioUrl ? (
        <audio
          ref={audioRef}
          src={audioUrl}
          className="hidden"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      ) : null}
    </div>
  );
}
