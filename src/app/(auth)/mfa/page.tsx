'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { COGNITO_CHALLENGE_STORAGE_KEY } from '@/lib/auth/cognito-challenge';
import { useSafeCallbackUrl, useStoredCognitoChallenge } from '@/lib/auth/browser-auth-state';

export default function MfaPage() {
  const router = useRouter();
  const callbackUrl = useSafeCallbackUrl();
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { challenge, error: challengeError } = useStoredCognitoChallenge('SOFTWARE_TOKEN_MFA', {
    missing: 'MFA認証セッションが見つかりません。ログインからやり直してください。',
    malformed: 'MFA認証セッションが壊れています。ログインからやり直してください。',
    invalid: 'MFA認証セッションが無効です。ログインからやり直してください。',
  });
  const error = submitError ?? challengeError;
  const hasChallenge = Boolean(challenge);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const setRef = useCallback(
    (index: number) => (el: HTMLInputElement | null) => {
      inputRefs.current[index] = el;
    },
    [],
  );

  function handleDigitChange(index: number, value: string) {
    if (value.length > 1) {
      // Handle paste
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setSubmitError(null);
    setIsLoading(true);

    try {
      if (!challenge) {
        throw new Error('SESSION_MISSING');
      }

      if (mode === 'recovery') {
        if (!recoveryCode.trim()) {
          setSubmitError('リカバリーコードを入力してください。');
          return;
        }

        const response = await fetch('/api/auth/mfa/recovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: challenge.email,
            recoveryCode,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? 'リカバリーコードが正しくありません');
        }

        window.sessionStorage.removeItem(COGNITO_CHALLENGE_STORAGE_KEY);
        router.push('/login?notice=mfa_recovery_reset');
        return;
      }

      const code = digits.join('');
      if (code.length !== 6) {
        setSubmitError('6桁のコードを入力してください。');
        return;
      }

      const result = await signIn('credentials', {
        email: challenge.email,
        mode: 'mfa',
        code,
        challengeSession: challenge.session,
        callbackUrl,
        redirect: false,
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      window.sessionStorage.removeItem(COGNITO_CHALLENGE_STORAGE_KEY);
      if (result?.url) {
        window.location.href = result.url;
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : mode === 'recovery'
            ? 'リカバリーコードが正しくありません。'
            : '認証コードが正しくありません。もう一度お試しください。',
      );
      setDigits(['', '', '', '', '', '']);
      setRecoveryCode('');
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section
      aria-labelledby="mfa-title"
      className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
    >
      <div className="border-b border-border/70 bg-slate-50/80 p-5 sm:p-6">
        <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          二要素認証
        </div>
        <div className="mt-5 space-y-2">
          <h2 id="mfa-title" className="text-2xl font-semibold leading-tight text-foreground">
            6桁コードで入室を確認します
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            認証アプリのコードを入力してください。端末が使えない場合は、発行済みのリカバリーコードで復帰できます。
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {!hasChallenge ? (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error ?? 'MFA認証セッションが見つかりません。ログインからやり直してください。'}
              </AlertDescription>
            </Alert>
            <Button
              type="button"
              size="lg"
              className="h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
              onClick={() => router.push('/login')}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              ログインからやり直す
            </Button>
          </div>
        ) : (
          <>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={mode === 'totp' ? 'default' : 'outline'}
                  className="h-11 flex-1 sm:h-11 sm:min-h-[44px]"
                  onClick={() => {
                    setMode('totp');
                    setSubmitError(null);
                  }}
                >
                  認証コード
                </Button>
                <Button
                  type="button"
                  variant={mode === 'recovery' ? 'default' : 'outline'}
                  className="h-11 flex-1 sm:h-11 sm:min-h-[44px]"
                  onClick={() => {
                    setMode('recovery');
                    setSubmitError(null);
                  }}
                >
                  リカバリーコード
                </Button>
              </div>

              {mode === 'totp' ? (
                <div className="flex justify-center gap-2" role="group" aria-label="認証コード入力">
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
                      className="h-12 w-12 text-center text-lg font-semibold sm:h-12 sm:min-h-12"
                      aria-label={`コード ${index + 1}桁目`}
                      disabled={isLoading}
                      autoFocus={index === 0}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <Alert className="border-state-confirm/30 bg-state-confirm/10 text-state-confirm">
                    <KeyRound className="h-4 w-4 text-state-confirm" />
                    <AlertDescription className="text-state-confirm">
                      リカバリーコードを使うと現在のMFA設定を一時解除します。再ログイン後に再設定してください。
                    </AlertDescription>
                  </Alert>
                  <Input
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX"
                    className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={isLoading}
                    aria-label="リカバリーコード"
                  />
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="h-11 w-full sm:h-11 sm:min-h-[44px]"
                disabled={
                  isLoading ||
                  (mode === 'totp'
                    ? digits.join('').length !== 6
                    : recoveryCode.trim().length === 0)
                }
                aria-busy={isLoading}
              >
                {isLoading
                  ? mode === 'recovery'
                    ? '確認中...'
                    : '認証中...'
                  : mode === 'recovery'
                    ? 'リカバリーコードを確認'
                    : '認証する'}
              </Button>
            </form>

            <div className="mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/login')}
                className="min-h-11 text-muted-foreground sm:h-11 sm:min-h-[44px]"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                ログインに戻る
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
