'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  QrCode,
  ShieldCheck,
  LoaderCircle,
} from 'lucide-react';
import { useSafeCallbackUrl } from '@/lib/auth/browser-auth-state';

type Step = 1 | 2 | 3;

export default function MfaSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const callbackUrl = useSafeCallbackUrl();
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secretCode, setSecretCode] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [setupLoading, setSetupLoading] = useState(true);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // コピー完了トグルのタイマーを unmount 時に確実にクリア（unmount 後 setState 防止）
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  const setRef = useCallback(
    (index: number) => (el: HTMLInputElement | null) => {
      inputRefs.current[index] = el;
    },
    [],
  );

  const stepLabels = ['シークレット取得', '確認コード入力', '設定完了'];

  useEffect(() => {
    let cancelled = false;

    async function loadSetup() {
      try {
        const response = await fetch('/api/me/mfa/setup', {
          method: 'POST',
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? 'MFA設定情報の取得に失敗しました');
        }

        const payload = (await response.json()) as {
          secretCode: string;
          otpauthUri: string;
        };

        if (cancelled) return;
        setSecretCode(payload.secretCode);
        setOtpauthUri(payload.otpauthUri);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'MFA設定情報の取得に失敗しました');
        }
      } finally {
        if (!cancelled) {
          setSetupLoading(false);
        }
      }
    }

    loadSetup();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function buildQrCode() {
      if (!otpauthUri) return;

      try {
        const QRCode = await import('qrcode');
        const dataUrl = await QRCode.toDataURL(otpauthUri, {
          margin: 1,
          width: 192,
        });

        if (!cancelled) {
          setQrCodeDataUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setQrCodeDataUrl('');
        }
      }
    }

    void buildQrCode();
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  function handleDigitChange(index: number, value: string) {
    if (value.length > 1) {
      const pasted = value.replace(/\D/g, '').slice(0, 6);
      if (pasted.length > 0) {
        const newDigits = [...digits];
        for (let i = 0; i < pasted.length && i + index < 6; i++) {
          newDigits[i + index] = pasted[i];
        }
        setDigits(newDigits);
        const nextIndex = Math.min(index + pasted.length, 5);
        inputRefs.current[nextIndex]?.focus();
        return;
      }
    }

    const digit = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      const newDigits = [...digits];
      newDigits[index - 1] = '';
      setDigits(newDigits);
      inputRefs.current[index - 1]?.focus();
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const code = digits.join('');
    if (code.length !== 6) {
      setError('6桁のコードを入力してください。');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/me/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? '確認コードが正しくありません');
      }
      const payload = (await response.json()) as {
        recoveryCodes?: string[];
      };
      setRecoveryCodes(payload.recoveryCodes ?? []);
      setStep(3);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : '確認コードが正しくありません。もう一度お試しください。',
      );
      setDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopySecret() {
    try {
      await navigator.clipboard.writeText(
        recoveryCodes.length > 0 ? recoveryCodes.join('\n') : secretCode || otpauthUri,
      );
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 2000);
    } catch {
      // Fallback: select text for manual copy
    }
  }

  function handleDownloadRecoveryCodes() {
    if (recoveryCodes.length === 0) return;

    const content = [
      'PH-OS MFA Recovery Codes',
      'このコードは1回のみ使用できます。安全な場所に保存してください。',
      '',
      ...recoveryCodes,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'ph-os-mfa-recovery-codes.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <section
      aria-labelledby="mfa-setup-title"
      className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
    >
      {/* Step indicator */}
      <div className="border-b border-border/70 bg-slate-50/80 p-4 sm:p-6">
        <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          MFA設定
        </div>
        <div className="mt-4 space-y-2">
          <h2
            id="mfa-setup-title"
            className="text-xl font-semibold leading-tight text-foreground sm:text-2xl"
          >
            {step === 1 && '認証アプリを登録します'}
            {step === 2 && '6桁の確認コードを入力します'}
            {step === 3 && 'リカバリーコードを保存します'}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {step === 1 &&
              '業務アカウントを保護するため、認証アプリでQRコードを読み取ってください。'}
            {step === 2 && '認証アプリに表示された6桁のコードで、登録できたことを確認します。'}
            {step === 3 && '端末紛失時に使うコードです。この画面を閉じる前に保存してください。'}
          </p>
        </div>
      </div>

      <div className="border-b border-border/70 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center justify-between">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex flex-1 items-center">
              <div className="flex flex-1 flex-col items-center gap-1.5 sm:gap-2">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors sm:h-11 sm:w-11 ${
                    s < step
                      ? 'border-primary bg-primary text-primary-foreground'
                      : s === step
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-muted text-muted-foreground'
                  }`}
                  aria-current={s === step ? 'step' : undefined}
                >
                  {s < step ? <Check className="h-4 w-4" aria-hidden="true" /> : s}
                </div>
                <span className="text-center text-[11px] leading-3 text-muted-foreground sm:text-xs sm:leading-4">
                  {stepLabels[s - 1]}
                </span>
              </div>
              {s < 3 && (
                <div
                  className={`mx-1 mb-5 h-0.5 w-full sm:mx-2 sm:mb-6 ${
                    s < step ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step 1: QR Code */}
        {step === 1 && (
          <div className="flex flex-col items-center gap-4 sm:gap-6">
            <div className="flex h-40 w-40 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted sm:h-48 sm:w-48">
              {setupLoading ? (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <LoaderCircle
                    className="h-10 w-10 animate-spin sm:h-12 sm:w-12"
                    aria-hidden="true"
                  />
                  <span className="text-xs">設定を準備中</span>
                </div>
              ) : qrCodeDataUrl ? (
                <Image
                  src={qrCodeDataUrl}
                  alt="MFA設定用QRコード"
                  className="h-40 w-40 rounded-md bg-background p-2 sm:h-48 sm:w-48"
                  width={192}
                  height={192}
                  unoptimized
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <QrCode className="h-10 w-10 sm:h-12 sm:w-12" aria-hidden="true" />
                  <span className="text-xs">認証アプリで手動登録</span>
                </div>
              )}
            </div>

            <div className="w-full rounded-lg bg-muted p-2.5 sm:p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                手動入力用シークレットキー
              </p>
              <code className="block break-all text-sm font-mono text-foreground">
                {secretCode || '取得中...'}
              </code>
            </div>

            <Button
              size="lg"
              className="h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
              onClick={() => setStep(2)}
              disabled={setupLoading || !secretCode}
            >
              次へ
            </Button>

            <div className="w-full space-y-1.5 text-sm text-muted-foreground sm:space-y-2">
              <p className="font-medium">対応アプリ:</p>
              <ul className="grid grid-cols-1 gap-1 pl-0 sm:list-disc sm:pl-5">
                <li>Google Authenticator</li>
                <li>Microsoft Authenticator</li>
                <li>Authy</li>
              </ul>
            </div>
          </div>
        )}

        {/* Step 2: Verification */}
        {step === 2 && (
          <form onSubmit={handleVerify} className="flex flex-col gap-6">
            <div className="grid grid-cols-6 gap-2" role="group" aria-label="確認コード入力">
              {digits.map((digit, index) => (
                <Input
                  key={index}
                  ref={setRef(index)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={digit}
                  onChange={(e) => handleDigitChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className="h-12 min-h-[48px] w-full min-w-0 text-center text-lg font-semibold"
                  aria-label={`コード ${index + 1}桁目`}
                  disabled={isLoading}
                  autoFocus={index === 0}
                />
              ))}
            </div>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 min-h-[44px] flex-1 sm:h-11 sm:min-h-[44px]"
                onClick={() => {
                  setStep(1);
                  setDigits(['', '', '', '', '', '']);
                  setError(null);
                }}
              >
                戻る
              </Button>
              <Button
                type="submit"
                size="lg"
                className="h-11 min-h-[44px] flex-1 sm:h-11 sm:min-h-[44px]"
                disabled={isLoading || digits.join('').length !== 6}
                aria-busy={isLoading}
              >
                {isLoading ? '確認中...' : '確認する'}
              </Button>
            </div>
          </form>
        )}

        {/* Step 3: Completed */}
        {step === 3 && (
          <div className="flex flex-col gap-6">
            <Alert className="border-state-done/30 bg-state-done/10">
              <ShieldCheck className="h-4 w-4 text-state-done" />
              <AlertDescription className="text-state-done">
                二要素認証の設定が完了しました。次回ログインから認証アプリの6桁コードが必要になります。
              </AlertDescription>
            </Alert>

            <Alert className="border-state-confirm/30 bg-state-confirm/10 text-state-confirm">
              <AlertCircle className="h-4 w-4 text-state-confirm" />
              <AlertDescription className="text-state-confirm">
                以下のリカバリーコードはこの画面でのみ表示されます。印刷または安全な場所に保存してください。
              </AlertDescription>
            </Alert>

            <div className="rounded-lg border bg-muted p-4">
              <p className="mb-3 text-sm font-medium text-foreground">リカバリーコード</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {recoveryCodes.map((code) => (
                  <code
                    key={code}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground"
                  >
                    {code}
                  </code>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                size="lg"
                className="h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
                onClick={handleCopySecret}
              >
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4 text-state-done" />
                    コピーしました
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    コードをコピー
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
                onClick={handleDownloadRecoveryCodes}
              >
                <Download className="mr-2 h-4 w-4" />
                テキスト保存
              </Button>
            </div>

            <Button
              size="lg"
              className="h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
              onClick={() => router.push(callbackUrl)}
            >
              設定を完了する
            </Button>
          </div>
        )}
      </div>

      <div className="border-t border-border/70 px-5 py-4 text-center sm:px-6">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ログイン画面に戻る
        </Link>
      </div>
    </section>
  );
}
