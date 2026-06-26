'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ArrowLeft, Check, Eye, EyeOff, KeyRound, Mail } from 'lucide-react';

interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
  bgColor: string;
}

function evaluatePasswordStrength(password: string): PasswordStrength {
  let score = 0;
  if (password.length >= 13) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  const capped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;

  const levels: Record<number, Omit<PasswordStrength, 'score'>> = {
    0: { label: '非常に弱い', color: 'text-state-blocked', bgColor: 'bg-state-blocked' },
    1: { label: '弱い', color: 'text-state-blocked', bgColor: 'bg-state-blocked' },
    2: { label: '中', color: 'text-state-confirm', bgColor: 'bg-state-confirm' },
    3: { label: '強い', color: 'text-tag-info', bgColor: 'bg-tag-info' },
    4: { label: '非常に強い', color: 'text-state-done', bgColor: 'bg-state-done' },
  };

  return { score: capped, ...levels[capped] };
}

export default function PasswordResetPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const setRef = useCallback(
    (index: number) => (el: HTMLInputElement | null) => {
      inputRefs.current[index] = el;
    },
    [],
  );

  const strength = evaluatePasswordStrength(newPassword);
  const passwordsMatch = newPassword === confirmPassword;
  const isLongEnough = newPassword.length >= 13;

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

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/password/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'メールの送信に失敗しました');
      }
      setStep(2);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'メールの送信に失敗しました。メールアドレスを確認してください。',
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    const code = digits.join('');
    if (code.length !== 6) {
      setError('6桁の確認コードを入力してください。');
      return;
    }
    if (!isLongEnough) {
      setError('パスワードは13文字以上で入力してください。');
      return;
    }
    if (!passwordsMatch) {
      setError('パスワードが一致しません。');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/password/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          code,
          newPassword,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'パスワードのリセットに失敗しました');
      }
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'パスワードのリセットに失敗しました。確認コードを確認してください。',
      );
    } finally {
      setIsLoading(false);
    }
  }

  if (success) {
    return (
      <section
        aria-labelledby="password-reset-success-title"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
      >
        <div className="p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-state-done/15">
            <Check className="h-6 w-6 text-state-done" />
          </div>
          <h2
            id="password-reset-success-title"
            className="mt-4 text-lg font-semibold text-foreground"
          >
            パスワードをリセットしました
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            新しいパスワードでログインしてください。
          </p>
          <Button
            size="lg"
            className="mt-6 h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
            onClick={() => router.push('/login')}
          >
            ログイン画面へ
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="password-reset-title"
      className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
    >
      <div className="border-b border-border/70 bg-slate-50/80 p-5 sm:p-6">
        <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary">
          {step === 1 ? (
            <Mail className="h-4 w-4" aria-hidden="true" />
          ) : (
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          )}
          パスワード復旧
        </div>
        <div className="mt-5 space-y-2">
          <h2
            id="password-reset-title"
            className="text-2xl font-semibold leading-tight text-foreground"
          >
            {step === 1
              ? '確認コードの送信先を確認します'
              : '確認コードと新しいパスワードを入力します'}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {step === 1
              ? 'アカウントに登録されたメールアドレスへ、6桁の確認コードを送信します。'
              : `${email} に送信された確認コードを入力し、13文字以上の新しいパスワードを設定してください。`}
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step 1: Email */}
        {step === 1 && (
          <form onSubmit={handleSendCode} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reset-email">メールアドレス</Label>
              <Input
                className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
                id="reset-email"
                type="email"
                autoComplete="email"
                placeholder="example@pharmacy.jp"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="mt-2 h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
              disabled={!email || isLoading}
              aria-busy={isLoading}
            >
              <Mail className="mr-2 h-4 w-4" />
              {isLoading ? '送信中...' : '確認コードを送信'}
            </Button>

            <div className="mt-2">
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                ログインに戻る
              </Link>
            </div>
          </form>
        )}

        {/* Step 2: Code + New Password */}
        {step === 2 && (
          <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
            {/* Verification code */}
            <div className="flex flex-col gap-1.5">
              <Label>確認コード</Label>
              <div className="flex justify-center gap-2" role="group" aria-label="確認コード入力">
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
                    aria-label={`確認コード ${index + 1}桁目`}
                    disabled={isLoading}
                    autoFocus={index === 0}
                  />
                ))}
              </div>
            </div>

            {/* New password */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reset-new-password">新しいパスワード</Label>
              <div className="relative">
                <Input
                  className="h-11 min-h-[44px] pr-12 sm:h-11 sm:min-h-[44px]"
                  id="reset-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  aria-label={showNewPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {newPassword.length > 0 && (
                <div className="mt-1 space-y-1.5">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          i < strength.score ? strength.bgColor : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs ${strength.color}`}>パスワード強度: {strength.label}</p>
                </div>
              )}

              {newPassword.length > 0 && !isLongEnough && (
                <p className="text-xs text-destructive">パスワードは13文字以上で入力してください</p>
              )}
            </div>

            {/* Confirm password */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reset-confirm-password">新しいパスワード（確認）</Label>
              <Input
                className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isLoading}
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-destructive">パスワードが一致しません</p>
              )}
            </div>

            <div className="mt-2 flex gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 min-h-[44px] flex-1 sm:h-11 sm:min-h-[44px]"
                onClick={() => {
                  setStep(1);
                  setDigits(['', '', '', '', '', '']);
                  setNewPassword('');
                  setConfirmPassword('');
                  setError(null);
                }}
              >
                戻る
              </Button>
              <Button
                type="submit"
                size="lg"
                className="h-11 min-h-[44px] flex-1 sm:h-11 sm:min-h-[44px]"
                disabled={
                  isLoading || digits.join('').length !== 6 || !isLongEnough || !passwordsMatch
                }
                aria-busy={isLoading}
              >
                {isLoading ? 'リセット中...' : 'パスワードをリセット'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
