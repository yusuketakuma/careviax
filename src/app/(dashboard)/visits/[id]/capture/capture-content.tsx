'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  saveEvidenceDraft,
  setupEvidenceAutoSync,
  syncEvidenceDrafts,
} from '@/lib/offline/evidence-drafts';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { cn } from '@/lib/utils';
import { pickVisitPatientId } from '../brief/visit-brief-review.shared';
import type { EvidenceCategoryId } from '../../evidence/evidence-gallery.shared';
import {
  CAPTURE_CATEGORY_OPTIONS,
  DEFAULT_CAPTURE_CATEGORY,
  buildCaptureStatusSummary,
  buildEvidenceDraftFileName,
  resolveCapturePatientContext,
  type CapturePatientContext,
} from './capture.shared';

/**
 * p0_48「スマホで写真・証跡を撮る」: 訪問先で証跡写真を撮るモバイル没入型画面。
 * 実カメラ(getUserMedia)の起動を試み、権限なし/非対応環境では target と同じ
 * 黒枠+「カメラ」プレースホルダーを表示する(その場合の撮影はネイティブカメラ/
 * ファイル選択へフォールバック)。撮影画像は暗号化してオフラインドラフトに保存し、
 * オンライン復帰時に既存 files API で自動送信する。
 */

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.readAsDataURL(blob);
  });
}

export function EvidenceCaptureContent({
  visitId,
  initialPatientContext = null,
}: {
  visitId: string;
  initialPatientContext?: CapturePatientContext | null;
}) {
  const orgId = useOrgId();
  const [selectedCategory, setSelectedCategory] =
    useState<EvidenceCategoryId>(DEFAULT_CAPTURE_CATEGORY);
  const [cameraActive, setCameraActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 訪問予定 ID(標準導線)→ 見つからなければ訪問記録 ID として患者名を解決する
  // (/visits/[id]/brief と同じ二段解決)。
  const patientQuery = useQuery<CapturePatientContext>({
    queryKey: ['visit-capture-patient', visitId, orgId],
    enabled: !!orgId && !!visitId,
    initialData: initialPatientContext ?? undefined,
    queryFn: async () => {
      const headers = { 'x-org-id': orgId };
      const scheduleRes = await fetch(`/api/visit-schedules/${visitId}`, { headers });
      if (scheduleRes.ok) {
        const context = resolveCapturePatientContext(await scheduleRes.json());
        if (context.patientName || context.patientId) return context;
      }

      const recordRes = await fetch(`/api/visit-records/${visitId}`, { headers });
      if (recordRes.ok) {
        const patientId = pickVisitPatientId(await recordRes.json());
        if (patientId) {
          const patientRes = await fetch(buildPatientApiPath(patientId), { headers });
          const patient = patientRes.ok ? await patientRes.json().catch(() => null) : null;
          const patientName = typeof patient?.name === 'string' ? patient.name : null;
          return { patientId, patientName, visitRecordId: visitId };
        }
      }

      throw new Error('訪問に紐づく患者を解決できませんでした');
    },
  });
  const patientContext = patientQuery.data ?? null;

  // 実カメラの起動を試みる(権限なし/非対応はプレースホルダー表示のまま)
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          if (!cancelled) setCameraActive(true);
        }
      } catch {
        // 権限なし/カメラなし → target と同じ「カメラ」プレースホルダーのまま
      }
    }

    void startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // オンライン復帰時の自動送信(「戻ったら自動で送信します」)
  useEffect(() => {
    if (!orgId) return;
    return setupEvidenceAutoSync({ orgId });
  }, [orgId]);

  const persistCapturedImage = useCallback(
    async (blob: Blob, mimeType: string) => {
      const capturedAt = new Date();
      const dataUrl = await readBlobAsDataUrl(blob);
      await saveEvidenceDraft({
        scheduleId: visitId,
        patientId: patientContext?.patientId ?? undefined,
        category: selectedCategory,
        fileName: buildEvidenceDraftFileName(selectedCategory, capturedAt, mimeType),
        mimeType,
        sizeBytes: blob.size,
        dataUrl,
        capturedAt,
      });
      setSavedCount((count) => count + 1);
      toast.success('端末に保存しました(通信がなくても残ります)');

      // オンラインなら即時送信を試みる(訪問記録が未作成の間は未同期のまま保留)
      if (orgId && typeof navigator !== 'undefined' && navigator.onLine) {
        syncEvidenceDrafts({ orgId })
          .then((result) => {
            if (result.synced > 0) toast.success(`写真を${result.synced}枚送信しました`);
          })
          .catch(() => {
            // 失敗しても online 復帰時に再試行する
          });
      }
    },
    [orgId, patientContext?.patientId, selectedCategory, visitId],
  );

  /** カメラ映像の現フレームを JPEG 化(カメラ非起動時は null) */
  const captureFromVideo = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!cameraActive || !video || video.videoWidth === 0 || video.videoHeight === 0) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(null);
        return;
      }
      context.drawImage(video, 0, 0);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    });
  }, [cameraActive]);

  async function handleShutterClick() {
    if (saving) return;
    setSaving(true);
    try {
      const blob = await captureFromVideo();
      if (blob) {
        await persistCapturedImage(blob, 'image/jpeg');
        return;
      }
      // カメラ未起動 → ネイティブカメラ/ファイル選択へフォールバック
      fileInputRef.current?.click();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '写真を保存できませんでした');
    } finally {
      setSaving(false);
    }
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSaving(true);
    try {
      await persistCapturedImage(file, file.type || 'image/jpeg');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '写真を保存できませんでした');
    } finally {
      setSaving(false);
    }
  }

  const patientLoading = !orgId || patientQuery.isPending;
  const captureSummary = buildCaptureStatusSummary({
    categoryId: selectedCategory,
    patientName: patientContext?.patientName,
    savedCount,
  });

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background px-6 pb-10 pt-6"
      data-testid="evidence-capture-page"
    >
      {/* 専用ヘッダー(没入型: アプリシェルなし) */}
      <h1 className="text-lg font-bold leading-7 text-primary">PH-OS 写真</h1>
      {patientLoading ? (
        <p className="mt-4 text-[15px] font-bold leading-6 text-muted-foreground">
          患者情報を取得中...
        </p>
      ) : patientContext?.patientName ? (
        <p
          className="mt-4 text-[15px] font-bold leading-6 text-foreground"
          data-testid="capture-patient-name"
        >
          {patientContext.patientName} 様
        </p>
      ) : (
        <p className="mt-4 text-[15px] font-bold leading-6 text-muted-foreground">
          患者情報を取得できませんでした
        </p>
      )}

      {/* カメラプレビュー(起動不可時は黒枠+「カメラ」) */}
      <section
        aria-label="カメラプレビュー"
        className="relative mt-4 aspect-[7/5] w-full overflow-hidden rounded-2xl bg-slate-900"
        data-testid="capture-camera-preview"
      >
        {/* カメラのライブプレビュー(字幕対象の音声なし) */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn('h-full w-full object-cover', cameraActive ? 'block' : 'hidden')}
        />
        {cameraActive ? null : (
          <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-white">
            カメラ
          </span>
        )}
      </section>

      {/* 種類チップ(単一選択) */}
      <div className="mt-5 flex flex-wrap gap-3" role="group" aria-label="証跡の種類">
        {CAPTURE_CATEGORY_OPTIONS.map((option) => {
          const selected = option.id === selectedCategory;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              data-testid="capture-category-chip"
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-4 text-[13px] font-bold transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                'text-foreground',
                selected
                  ? 'border-primary/25 bg-primary/10'
                  : 'border-transparent bg-muted hover:bg-muted/70',
              )}
              onClick={() => setSelectedCategory(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <section
        aria-label="撮影内容の確認"
        className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-muted-foreground"
        data-testid="capture-status-summary"
      >
        <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
          {captureSummary.categoryLabel}
        </span>
        <span className="rounded-full bg-muted px-3 py-1 text-foreground">
          {captureSummary.savedDraftLabel}
        </span>
        <span className="text-[12px] font-medium">端末保存後、画像・証跡へ同期</span>
      </section>

      {/* フォールバック用(モバイル実機ではネイティブカメラが開く) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileSelected}
      />

      <Button
        type="button"
        size="lg"
        className="mt-6 h-12 w-full text-[15px] font-bold"
        disabled={saving || patientLoading}
        onClick={handleShutterClick}
        data-testid="capture-shutter"
      >
        {captureSummary.categoryLabel}を撮る
      </Button>

      {/* オフライン保存の説明(target どおりの文言) */}
      <section
        aria-label="オフライン保存の説明"
        className="mt-5 rounded-xl border border-state-confirm/30 bg-state-confirm/10 px-5 py-4"
        data-testid="capture-offline-note"
      >
        <h2 className="text-[15px] font-bold leading-6 text-state-confirm">
          通信がなくても保存します
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">戻ったら自動で送信します。</p>
      </section>

      {/* 保存結果(撮影後のみ表示) */}
      <div role="status" aria-live="polite" className="mt-4">
        {savedCount > 0 ? (
          <p className="text-sm leading-6 text-muted-foreground" data-testid="capture-saved-status">
            この訪問で {savedCount} 枚を端末に保存しました。
            <Link
              href="/visits/evidence"
              className="ml-1 font-medium text-primary underline underline-offset-2"
            >
              画像・証跡で確認
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
