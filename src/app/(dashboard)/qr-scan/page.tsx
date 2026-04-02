'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Camera,
  CameraOff,
  Upload,
  UserSearch,
  UserPlus,
  Send,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
  ScanLine,
  CircleCheck,
  CircleAlert,
  CircleX,
} from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getQrScanShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/loading';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  isJahisQR,
  parseJahisQRSafe,
  detectMultiQR,
  mergeJahisQRPages,
  parseJahisQR,
  type JahisQRData,
  type JahisParseResult,
} from '@/lib/pharmacy/jahis-qr';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface PatientMatch {
  id: string;
  name: string;
  name_kana: string;
  birth_date: string;
  gender: string;
}

type ScanPhase =
  | 'camera'    // カメラスキャン中
  | 'scanned'   // 1つのQRスキャン完了、続行 or 送信選択
  | 'parsed'    // パース完了、患者照合中
  | 'matched'   // 患者照合完了
  | 'sending'   // API送信中
  | 'done'      // 送信完了
  | 'error';    // エラー

// ────────────────────────────────────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────────────────────────────────────

export default function QRScanPage() {
  const router = useRouter();
  const orgId = useOrgId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<unknown>(null);

  const [phase, setPhase] = useState<ScanPhase>('camera');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Multi-QR state
  const [scannedTexts, setScannedTexts] = useState<string[]>([]);
  const [totalQRCount, setTotalQRCount] = useState<number | null>(null);
  const [mergedQRData, setMergedQRData] = useState<JahisQRData | null>(null);
  const [parseResult, setParseResult] = useState<JahisParseResult | null>(null);

  // Patient matching state
  const [patients, setPatients] = useState<PatientMatch[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientMatch | null>(null);
  const [showPatientDialog, setShowPatientDialog] = useState(false);

  // API state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── カメラ停止 ──
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const searchPatients = useCallback(
    async (data: JahisQRData) => {
      try {
        const q = data.patient.name || '';
        if (!q) {
          setPatients([]);
          setPhase('matched');
          return;
        }

        const res = await fetch(`/api/patients?q=${encodeURIComponent(q)}&limit=10`, {
          headers: orgId ? { 'x-org-id': orgId } : undefined,
        });
        if (!res.ok) throw new Error('患者検索に失敗しました');
        const json = await res.json();
        const matched: PatientMatch[] = json.data ?? [];

        // 生年月日が一致する患者を優先
        if (data.patient.birthDate) {
          matched.sort((a, b) => {
            const aMatch = a.birth_date?.startsWith(data.patient.birthDate!) ? -1 : 0;
            const bMatch = b.birth_date?.startsWith(data.patient.birthDate!) ? -1 : 0;
            return aMatch - bMatch;
          });
        }

        setPatients(matched);
        setPhase('matched');

        // 候補が1件で生年月日も一致する場合は自動選択
        if (
          matched.length === 1 &&
          data.patient.birthDate &&
          matched[0].birth_date?.startsWith(data.patient.birthDate)
        ) {
          setSelectedPatient(matched[0]);
        } else if (matched.length > 0) {
          setShowPatientDialog(true);
        }
      } catch {
        setPatients([]);
        setPhase('matched');
      }
    },
    [orgId]
  );

  // ── 全QRスキャン完了時の処理 ──
  const finalizeScan = useCallback(
    (texts: string[]) => {
      stopCamera();

      // 全テキストをパース・マージ
      const pages = texts.map((t) => parseJahisQR(t));
      const merged = mergeJahisQRPages(pages);
      setMergedQRData(merged);

      // safe parse でエラー/警告収集（最後のページのみ or 全結合テキスト）
      const combinedText = texts.join('\n');
      const result = parseJahisQRSafe(combinedText);
      setParseResult(result);

      setPhase('parsed');
      void searchPatients(merged);
    },
    [searchPatients, stopCamera]
  );

  // ── QR 読取結果処理 (ref で循環依存を回避) ──
  const handleQRResultRef = useRef<(text: string) => void>(() => {});

  const handleQRResult = useCallback(
    (text: string) => {
      stopCamera();

      if (!isJahisQR(text)) {
        setCameraError(
          'お薬手帳QRコード（JAHIS形式）ではありません。別のQRコードを読み取ってください。'
        );
        setPhase('camera');
        return;
      }

      // レコード911からマルチQR情報を検出（JAHIS ver.2.6 仕様）
      const multiInfo = detectMultiQR(text);

      setScannedTexts((prev) => {
        const next = [...prev, text];

        if (multiInfo) {
          setTotalQRCount(multiInfo.splitCount);
          if (next.length >= multiInfo.splitCount) {
            // 全ページ揃った → 自動完了
            finalizeScan(next);
          } else {
            // まだ途中 → 'scanned' フェーズへ（次をスキャン促す）
            setPhase('scanned');
          }
        } else {
          // シングルQR or ページ情報なし → 'scanned' フェーズ（続行 or 完了を選択）
          setTotalQRCount(null);
          setPhase('scanned');
        }

        return next;
      });
    },
    [stopCamera, finalizeScan]
  );

  // ref を最新のコールバックに同期
  useEffect(() => {
    handleQRResultRef.current = handleQRResult;
  }, [handleQRResult]);

  // ── カメラ起動 ──
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }

      // @zxing/browser を dynamic import
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      readerRef.current = reader;

      reader.decodeFromVideoElement(videoRef.current!, (result) => {
        if (result) {
          handleQRResultRef.current(result.getText());
        }
      });
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'カメラへのアクセスが拒否されました。ブラウザの設定でカメラを許可してください。'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'カメラが見つかりません。カメラ付きデバイスをご使用ください。'
            : 'カメラの起動に失敗しました。';
      setCameraError(message);
    }
  }, []);

  // ── ファイルアップロード（フォールバック）──
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        const reader = new BrowserQRCodeReader();

        const img = new Image();
        const url = URL.createObjectURL(file);
        img.src = url;

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
        });

        const result = await reader.decodeFromImageElement(img);
        URL.revokeObjectURL(url);
        handleQRResultRef.current(result.getText());
      } catch {
        setCameraError('QRコードを画像から読み取れませんでした。鮮明な画像をお試しください。');
      }

      // リセット（同じファイル再選択を可能にする）
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    []
  );

  // ── PCに送信 ──
  const sendToDraft = async (patientId: string) => {
    setPhase('sending');
    setSendError(null);

    try {
      const body: Record<string, unknown> = {
        qr_texts: scannedTexts,
        patient_id: patientId,
      };
      if (sessionId) body.session_id = sessionId;

      const res = await fetch('/api/qr-scan-drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(orgId ? { 'x-org-id': orgId } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || 'PCへの送信に失敗しました');
      }

      const json = await res.json();
      if (json.session_id) setSessionId(json.session_id as string);

      setPhase('done');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '送信中にエラーが発生しました');
      setPhase('error');
    }
  };

  // ── リセット ──
  const resetScan = useCallback(() => {
    setPhase('camera');
    setScannedTexts([]);
    setTotalQRCount(null);
    setMergedQRData(null);
    setParseResult(null);
    setPatients([]);
    setSelectedPatient(null);
    setSendError(null);
    setCameraError(null);
    // sessionId は維持（同一セッションで続けてスキャンする場合）
  }, []);

  // ── 次のQRをスキャン（scannedフェーズから戻る）──
  const continueScanning = useCallback(() => {
    setPhase('camera');
  }, []);

  // ── ライフサイクル ──
  useEffect(() => {
    if (phase === 'camera') {
      startCamera();
    }
    return () => stopCamera();
  }, [phase, startCamera, stopCamera]);

  // ── 新規患者登録へ遷移 ──
  const goToNewPatient = () => {
    if (!mergedQRData) return;
    const params = new URLSearchParams();
    if (mergedQRData.patient.name) params.set('name', mergedQRData.patient.name);
    if (mergedQRData.patient.nameKana) params.set('name_kana', mergedQRData.patient.nameKana ?? '');
    if (mergedQRData.patient.birthDate) params.set('birth_date', mergedQRData.patient.birthDate);
    if (mergedQRData.patient.gender) params.set('gender', mergedQRData.patient.gender);
    router.push(`/patients/new?${params.toString()}`);
  };

  // ── スキャン済み枚数表示 ──
  const scannedCount = scannedTexts.length;
  const progressLabel =
    totalQRCount != null
      ? `${scannedCount}/${totalQRCount} スキャン済み`
      : `${scannedCount}枚 スキャン済み`;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-20 md:pb-4">
      {/* Header */}
      <div className="space-y-3">
        <WorkflowBackLink href="/prescriptions" label="処方受付へ戻る" />
        <WorkflowPageHeader
          title="お薬手帳 QR スキャン"
          description="読取後は QR 下書き一覧、処方受付、ワークフローへ横移動できます。"
          className="mb-0"
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            {phase !== 'camera' ? (
              <Button variant="outline" size="sm" onClick={resetScan}>
                <RotateCcw className="mr-1.5 h-4 w-4" />
                やり直す
              </Button>
            ) : null}
            <PageShortcutLinks links={getQrScanShortcutLinks()} />
          </div>
        </WorkflowPageHeader>
      </div>

      {/* ── カメラビュー ── */}
      {phase === 'camera' && (
        <Card>
          <CardContent className="relative p-0">
            {/* スキャン済み進捗バー（2枚目以降） */}
            {scannedCount > 0 && (
              <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
                <ScanLine className="h-4 w-4 text-primary" />
                <span className="font-medium text-primary">{progressLabel}</span>
                <span className="text-muted-foreground">— 次のQRをスキャン</span>
              </div>
            )}

            {/* カメラ映像 */}
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-xl bg-black">
              <video
                ref={videoRef}
                className={cn('h-full w-full object-cover', !cameraActive && 'hidden')}
                playsInline
                muted
                autoPlay
              />
              {!cameraActive && !cameraError && (
                <div className="flex h-full items-center justify-center">
                  <Spinner size="lg" className="text-white" />
                </div>
              )}
              {cameraError && (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <CameraOff className="h-12 w-12 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{cameraError}</p>
                  <Button variant="outline" size="sm" onClick={startCamera}>
                    <Camera className="mr-1.5 h-4 w-4" />
                    再試行
                  </Button>
                </div>
              )}
              {/* ビューファインダー overlay */}
              {cameraActive && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-48 w-48 rounded-lg border-2 border-white/70 shadow-lg md:h-56 md:w-56">
                    {/* 四隅のマーカー */}
                    <div className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl border-l-4 border-t-4 border-primary" />
                    <div className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr border-r-4 border-t-4 border-primary" />
                    <div className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl border-b-4 border-l-4 border-primary" />
                    <div className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br border-b-4 border-r-4 border-primary" />
                  </div>
                </div>
              )}
            </div>

            {/* ファイルアップロードフォールバック */}
            <div className="flex items-center justify-center gap-3 border-t p-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-1.5 h-4 w-4" />
                画像から読取
              </Button>
              <p className="text-xs text-muted-foreground">カメラが使えない場合は画像をアップロード</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── スキャン完了 — 続行 or 終了 ── */}
      {phase === 'scanned' && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="h-4 w-4 text-primary" />
              {progressLabel}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">
              {totalQRCount != null
                ? `このお薬手帳はQRコードが${totalQRCount}枚あります。残りをスキャンするか、この内容で送信してください。`
                : '続けて別のQRコードをスキャンするか、この内容で送信してください。'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="min-h-[44px] flex-1" variant="outline" onClick={continueScanning}>
                <Camera className="mr-1.5 h-4 w-4" />
                次のQRをスキャン
              </Button>
              <Button
                className="min-h-[44px] flex-1"
                onClick={() => finalizeScan(scannedTexts)}
              >
                <CheckCircle className="mr-1.5 h-4 w-4" />
                スキャン完了
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── パース結果 + 患者照合 ── */}
      {mergedQRData && phase !== 'camera' && phase !== 'scanned' && (
        <>
          {/* QR 読取結果 */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanLine className="h-4 w-4 text-primary" />
                読取結果
                <Badge variant="secondary">{scannedCount}枚</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {/* 患者情報 */}
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  患者情報
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">氏名: </span>
                    <span className="font-medium">{mergedQRData.patient.name || '---'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">カナ: </span>
                    <span className="font-medium">{mergedQRData.patient.nameKana || '---'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">生年月日: </span>
                    <span className="font-medium">{mergedQRData.patient.birthDate || '---'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">性別: </span>
                    <span className="font-medium">
                      {mergedQRData.patient.gender === 'male'
                        ? '男性'
                        : mergedQRData.patient.gender === 'female'
                          ? '女性'
                          : '---'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 医療機関情報 */}
              {(mergedQRData.prescribingInstitution.name || mergedQRData.prescribingDoctor) && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    処方元
                  </p>
                  <div className="text-sm">
                    {mergedQRData.prescribingInstitution.name && (
                      <p>
                        <span className="text-muted-foreground">医療機関: </span>
                        <span className="font-medium">
                          {mergedQRData.prescribingInstitution.name}
                        </span>
                      </p>
                    )}
                    {mergedQRData.prescribingDoctor && (
                      <p>
                        <span className="text-muted-foreground">処方医: </span>
                        <span className="font-medium">{mergedQRData.prescribingDoctor}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 薬剤一覧 */}
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  薬剤 ({mergedQRData.medications.length}件)
                </p>
                {mergedQRData.medications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">薬剤情報が読み取れませんでした</p>
                ) : (
                  <ul className="space-y-2">
                    {mergedQRData.medications.map((med, i) => (
                      <li
                        key={i}
                        className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                      >
                        <p className="font-medium">{med.drugName}</p>
                        <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {med.dose && (
                            <span>
                              {med.dose}
                              {med.unit || ''}
                            </span>
                          )}
                          {med.usage && <span>{med.usage}</span>}
                          {med.daysOrTimes && <span>{med.daysOrTimes}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 患者照合 — 検索中 */}
          {phase === 'parsed' && (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <Spinner size="md" />
                <span className="ml-2 text-sm text-muted-foreground">患者を検索中...</span>
              </CardContent>
            </Card>
          )}

          {/* 患者照合 — 結果 */}
          {phase === 'matched' && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserSearch className="h-4 w-4 text-primary" />
                  患者照合
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {selectedPatient ? (
                  <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 p-3">
                    <div>
                      <p className="font-medium">{selectedPatient.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedPatient.name_kana} / {selectedPatient.birth_date}
                      </p>
                    </div>
                    <Badge variant="default">選択済み</Badge>
                  </div>
                ) : patients.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {patients.length}件の候補が見つかりました。患者を選択してください。
                    </p>
                    {patients.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={cn(
                          'flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors',
                          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          'min-h-[44px]'
                        )}
                        onClick={() => setSelectedPatient(p)}
                      >
                        <div>
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.name_kana} / {p.birth_date}
                          </p>
                        </div>
                        {mergedQRData.patient.birthDate &&
                          p.birth_date?.startsWith(mergedQRData.patient.birthDate) && (
                            <Badge variant="secondary">生年月日一致</Badge>
                          )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <AlertTriangle className="h-8 w-8 text-amber-500" />
                    <p className="text-sm text-muted-foreground">
                      該当する患者が見つかりませんでした。
                    </p>
                  </div>
                )}

                {/* アクションボタン */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  {selectedPatient && (
                    <Button
                      className="min-h-[44px] flex-1"
                      onClick={() => sendToDraft(selectedPatient.id)}
                    >
                      <Send className="mr-1.5 h-4 w-4" />
                      PCに送信
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="min-h-[44px] flex-1"
                    onClick={goToNewPatient}
                  >
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    新規患者登録
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 送信中 */}
          {phase === 'sending' && (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <Spinner size="md" />
                <span className="ml-2 text-sm text-muted-foreground">PCに送信中...</span>
              </CardContent>
            </Card>
          )}

          {/* 送信完了 */}
          {phase === 'done' && selectedPatient && (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
                <CheckCircle className="h-10 w-10 text-green-600" />
                <div>
                  <p className="text-base font-semibold">PCに送信しました</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    PCで確認・確定してください
                  </p>
                </div>

                {/* パース結果サマリー */}
                {parseResult && (
                  <div className="w-full space-y-2 rounded-md border p-3 text-left">
                    {/* 成功薬剤 */}
                    {parseResult.success && mergedQRData.medications.length > 0 && (
                      <div className="flex items-center gap-2 text-sm text-green-700">
                        <CircleCheck className="h-4 w-4 shrink-0" />
                        <span>薬剤 {mergedQRData.medications.length}件 を読取</span>
                      </div>
                    )}

                    {/* 警告 */}
                    {parseResult.warnings.length > 0 && (
                      <div className="space-y-1">
                        {parseResult.warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-amber-700">
                            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{w.message}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* エラー（パース失敗） */}
                    {!parseResult.success && parseResult.errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-destructive">
                        <CircleX className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          行{e.lineNumber} ({e.recordType}): {e.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={resetScan}>
                    <Camera className="mr-1.5 h-4 w-4" />
                    次のQRをスキャン
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* エラー */}
          {phase === 'error' && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                <AlertTriangle className="h-10 w-10 text-destructive" />
                <p className="text-sm text-destructive">{sendError}</p>
                <div className="flex gap-2">
                  {selectedPatient && (
                    <Button onClick={() => sendToDraft(selectedPatient.id)}>
                      <Send className="mr-1.5 h-4 w-4" />
                      再送信
                    </Button>
                  )}
                  <Button variant="outline" onClick={resetScan}>
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    やり直す
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── 患者選択ダイアログ ── */}
      <Dialog open={showPatientDialog} onOpenChange={setShowPatientDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>患者を選択</DialogTitle>
            <DialogDescription>
              QR コードの患者情報に一致する候補が複数あります。正しい患者を選択してください。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {patients.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cn(
                  'flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors',
                  'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'min-h-[44px]',
                  selectedPatient?.id === p.id && 'border-primary bg-primary/5'
                )}
                onClick={() => {
                  setSelectedPatient(p);
                  setShowPatientDialog(false);
                }}
              >
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.name_kana} / {p.birth_date}
                  </p>
                </div>
                {mergedQRData?.patient.birthDate &&
                  p.birth_date?.startsWith(mergedQRData.patient.birthDate) && (
                    <Badge variant="secondary">生年月日一致</Badge>
                  )}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPatientDialog(false)}>
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
