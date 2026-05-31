'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import {
  COGNITO_CHALLENGE_STORAGE_KEY,
  readStoredCognitoChallenge,
  type CognitoChallengePayload,
} from '@/lib/auth/cognito-challenge';

export default function MfaPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<CognitoChallengePayload | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const setRef = useCallback(
    (index: number) => (el: HTMLInputElement | null) => {
      inputRefs.current[index] = el;
    },
    [],
  );

  useEffect(() => {
    const raw = window.sessionStorage.getItem(COGNITO_CHALLENGE_STORAGE_KEY);
    if (!raw) {
      setError('MFA認証セッションが見つかりません。ログインからやり直してください。');
      return;
    }

    const parsed = readStoredCognitoChallenge(raw);
    if (!parsed) {
      setError('MFA認証セッションが壊れています。ログインからやり直してください。');
      return;
    }
    if (parsed.type !== 'SOFTWARE_TOKEN_MFA') {
      setError('MFA認証セッションが無効です。ログインからやり直してください。');
      return;
    }
    setChallenge(parsed);
  }, []);

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

    setError(null);
    setIsLoading(true);

    try {
      if (!challenge) {
        throw new Error('SESSION_MISSING');
      }

      if (mode === 'recovery') {
        if (!recoveryCode.trim()) {
          setError('リカバリーコードを入力してください。');
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
        setError('6桁のコードを入力してください。');
        return;
      }

      const callbackUrl =
        new URLSearchParams(window.location.search).get('callbackUrl') ?? '/dashboard';
      const result = await signIn('credentials', {
        email: challenge.email,
        mode: 'mfa',
        code,
        challengeSession: challenge.session,
        callbackUrl: callbackUrl.startsWith('/') ? callbackUrl : '/dashboard',
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
      setError(
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
    <div className="w-full max-w-md">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" aria-hidden="true" />
            <CardTitle>二要素認証</CardTitle>
          </div>
          <CardDescription>認証アプリに表示された6桁のコードを入力してください</CardDescription>
        </CardHeader>
        <CardContent>
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
                className="flex-1"
                onClick={() => {
                  setMode('totp');
                  setError(null);
                }}
              >
                認証コード
              </Button>
              <Button
                type="button"
                variant={mode === 'recovery' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => {
                  setMode('recovery');
                  setError(null);
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
                    className="h-12 w-12 text-center text-lg font-semibold"
                    aria-label={`コード ${index + 1}桁目`}
                    disabled={isLoading}
                    autoFocus={index === 0}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                  <KeyRound className="h-4 w-4 text-amber-600" />
                  <AlertDescription>
                    リカバリーコードを使うと現在のMFA設定を一時解除します。再ログイン後に再設定してください。
                  </AlertDescription>
                </Alert>
                <Input
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
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
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={
                isLoading ||
                (mode === 'totp' ? digits.join('').length !== 6 : recoveryCode.trim().length === 0)
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
              className="text-slate-500"
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              ログインに戻る
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
