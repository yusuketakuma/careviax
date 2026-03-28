'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Camera,
  CameraOff,
  Upload,
  UserSearch,
  UserPlus,
  Pill,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
} from 'lucide-react';
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
  parseJahisQR,
  type JahisQRData,
  type JahisMedication,
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
  | 'camera' // カメラスキャン中
  | 'parsed' // パース完了、患者照合中
  | 'matched' // 患者照合完了
  | 'saving' // 保存中
  | 'done' // 保存完了
  | 'error'; // エラー

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
  const [qrData, setQrData] = useState<JahisQRData | null>(null);
  const [patients, setPatients] = useState<PatientMatch[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientMatch | null>(null);
  const [showPatientDialog, setShowPatientDialog] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  // ── カメラ停止 ──
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const searchPatients = useCallback(async (data: JahisQRData) => {
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
  }, [orgId]);

  // ── QR 読取結果処理 (ref で循環依存を回避) ──
  const handleQRResultRef = useRef<(text: string) => void>(() => {});

  const handleQRResult = useCallback(
    (text: string) => {
      stopCamera();

      if (!isJahisQR(text)) {
        setCameraError('お薬手帳QRコード（JAHIS形式）ではありません。別のQRコードを読み取ってください。');
        setPhase('camera');
        return;
      }

      const data = parseJahisQR(text);
      setQrData(data);
      setPhase('parsed');

      // 患者照合
      void searchPatients(data);
    },
    [searchPatients, stopCamera]
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

        // BrowserQRCodeReader.decodeFromImageElement でデコード
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

  // ── MedicationProfile 一括保存 ──
  const saveMedications = async (patientId: string) => {
    if (!qrData || qrData.medications.length === 0) return;

    setPhase('saving');
    setSaveError(null);

    try {
      let count = 0;
      for (const med of qrData.medications) {
        const body = {
          patient_id: patientId,
          drug_name: med.drugName,
          dose: formatDose(med),
          frequency: med.usage || undefined,
          prescriber: qrData.pharmacy.doctorName || undefined,
          start_date: qrData.dispensingDate || qrData.prescriptionDate || undefined,
          is_current: true,
          source: 'qr_scan' as const,
        };

        const res = await fetch('/api/medication-profiles', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(orgId ? { 'x-org-id': orgId } : {}),
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.message || `薬剤「${med.drugName}」の保存に失敗しました`);
        }
        count++;
      }

      setSavedCount(count);
      setPhase('done');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存中にエラーが発生しました');
      setPhase('error');
    }
  };

  // ── リセット ──
  const resetScan = useCallback(() => {
    setPhase('camera');
    setQrData(null);
    setPatients([]);
    setSelectedPatient(null);
    setSaveError(null);
    setSavedCount(0);
    setCameraError(null);
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
    if (!qrData) return;
    const params = new URLSearchParams();
    if (qrData.patient.name) params.set('name', qrData.patient.name);
    if (qrData.patient.nameKana) params.set('name_kana', qrData.patient.nameKana);
    if (qrData.patient.birthDate) params.set('birth_date', qrData.patient.birthDate);
    if (qrData.patient.gender) params.set('gender', qrData.patient.gender);
    router.push(`/patients/new?${params.toString()}`);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-20 md:pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground">お薬手帳 QR スキャン</h1>
        {phase !== 'camera' && (
          <Button variant="outline" size="sm" onClick={resetScan}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            やり直す
          </Button>
        )}
      </div>

      {/* ── カメラビュー ── */}
      {phase === 'camera' && (
        <Card>
          <CardContent className="relative p-0">
            {/* カメラ映像 */}
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-xl bg-black">
              <video
                ref={videoRef}
                className={cn(
                  'h-full w-full object-cover',
                  !cameraActive && 'hidden'
                )}
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
                    <div className="absolute -left-0.5 -top-0.5 h-6 w-6 border-l-4 border-t-4 border-primary rounded-tl" />
                    <div className="absolute -right-0.5 -top-0.5 h-6 w-6 border-r-4 border-t-4 border-primary rounded-tr" />
                    <div className="absolute -bottom-0.5 -left-0.5 h-6 w-6 border-b-4 border-l-4 border-primary rounded-bl" />
                    <div className="absolute -bottom-0.5 -right-0.5 h-6 w-6 border-b-4 border-r-4 border-primary rounded-br" />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-1.5 h-4 w-4" />
                画像から読取
              </Button>
              <p className="text-xs text-muted-foreground">
                カメラが使えない場合は画像をアップロード
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── パース結果 + 患者照合 ── */}
      {qrData && phase !== 'camera' && (
        <>
          {/* QR 読取結果 */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Pill className="h-4 w-4 text-primary" />
                読取結果
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 患者情報 */}
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  患者情報
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">氏名: </span>
                    <span className="font-medium">{qrData.patient.name || '---'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">カナ: </span>
                    <span className="font-medium">{qrData.patient.nameKana || '---'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">生年月日: </span>
                    <span className="font-medium">{qrData.patient.birthDate || '---'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">性別: </span>
                    <span className="font-medium">
                      {qrData.patient.gender === 'male'
                        ? '男性'
                        : qrData.patient.gender === 'female'
                          ? '女性'
                          : '---'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 医療機関情報 */}
              {(qrData.pharmacy.institutionName || qrData.pharmacy.doctorName) && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    処方元
                  </p>
                  <div className="text-sm">
                    {qrData.pharmacy.institutionName && (
                      <p>
                        <span className="text-muted-foreground">医療機関: </span>
                        <span className="font-medium">{qrData.pharmacy.institutionName}</span>
                      </p>
                    )}
                    {qrData.pharmacy.doctorName && (
                      <p>
                        <span className="text-muted-foreground">処方医: </span>
                        <span className="font-medium">{qrData.pharmacy.doctorName}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 薬剤一覧 */}
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  薬剤 ({qrData.medications.length}件)
                </p>
                {qrData.medications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">薬剤情報が読み取れませんでした</p>
                ) : (
                  <ul className="space-y-2">
                    {qrData.medications.map((med, i) => (
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

          {/* 患者照合結果 */}
          {phase === 'parsed' && (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <Spinner size="md" />
                <span className="ml-2 text-sm text-muted-foreground">患者を検索中...</span>
              </CardContent>
            </Card>
          )}

          {phase === 'matched' && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <UserSearch className="h-4 w-4 text-primary" />
                  患者照合
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
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
                        {qrData.patient.birthDate &&
                          p.birth_date?.startsWith(qrData.patient.birthDate) && (
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
                      className="flex-1"
                      onClick={() => saveMedications(selectedPatient.id)}
                      disabled={qrData.medications.length === 0}
                    >
                      <Pill className="mr-1.5 h-4 w-4" />
                      薬剤を保存 ({qrData.medications.length}件)
                    </Button>
                  )}
                  <Button variant="outline" className="flex-1" onClick={goToNewPatient}>
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    新規患者登録
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 保存中 */}
          {phase === 'saving' && (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <Spinner size="md" />
                <span className="ml-2 text-sm text-muted-foreground">薬剤情報を保存中...</span>
              </CardContent>
            </Card>
          )}

          {/* 保存完了 */}
          {phase === 'done' && selectedPatient && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                <CheckCircle className="h-10 w-10 text-green-600" />
                <p className="text-sm font-medium">
                  {savedCount}件の薬剤情報を保存しました
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      router.push(`/patients/${selectedPatient.id}/medications`)
                    }
                  >
                    薬剤一覧を確認
                  </Button>
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
                <p className="text-sm text-destructive">{saveError}</p>
                <Button variant="outline" onClick={resetScan}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  やり直す
                </Button>
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
                {qrData?.patient.birthDate &&
                  p.birth_date?.startsWith(qrData.patient.birthDate) && (
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

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function formatDose(med: JahisMedication): string | undefined {
  if (!med.dose) return undefined;
  return med.unit ? `${med.dose}${med.unit}` : med.dose;
}
