'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ArrowLeft, Check, Eye, EyeOff, KeyRound } from 'lucide-react';

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

export default function PasswordChangePage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const strength = evaluatePasswordStrength(newPassword);
  const passwordsMatch = newPassword === confirmPassword;
  const isLongEnough = newPassword.length >= 13;

  const canSubmit =
    currentPassword.length > 0 && isLongEnough && passwordsMatch && confirmPassword.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'パスワードの変更に失敗しました');
      }

      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'パスワードの変更に失敗しました。現在のパスワードを確認してください。',
      );
    } finally {
      setIsLoading(false);
    }
  }

  if (success) {
    return (
      <section
        aria-labelledby="password-change-success-title"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
      >
        <div className="p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-state-done/15">
            <Check className="h-6 w-6 text-state-done" />
          </div>
          <h2
            id="password-change-success-title"
            className="mt-4 text-lg font-semibold text-foreground"
          >
            パスワードを変更しました
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
      aria-labelledby="password-change-title"
      className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
    >
      <div className="border-b border-border/70 bg-slate-50/80 p-5 sm:p-6">
        <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          パスワード変更
        </div>
        <div className="mt-5 space-y-2">
          <h2
            id="password-change-title"
            className="text-2xl font-semibold leading-tight text-foreground"
          >
            安全にパスワードを更新します
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            現在のパスワードで本人確認し、13文字以上の新しいパスワードを設定してください。
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Current password */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-password">現在のパスワード</Label>
            <div className="relative">
              <Input
                className="h-11 min-h-[44px] pr-12 sm:h-11 sm:min-h-[44px]"
                id="current-password"
                type={showCurrentPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                disabled={isLoading}
              />
              <button
                type="button"
                className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                aria-label={showCurrentPassword ? 'パスワードを隠す' : 'パスワードを表示'}
              >
                {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* New password */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">新しいパスワード</Label>
            <div className="relative">
              <Input
                className="h-11 min-h-[44px] pr-12 sm:h-11 sm:min-h-[44px]"
                id="new-password"
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

            {/* Password strength indicator */}
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
            <Label htmlFor="confirm-password">新しいパスワード（確認）</Label>
            <Input
              className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
              id="confirm-password"
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

          <Button
            type="submit"
            size="lg"
            className="mt-2 h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
            disabled={!canSubmit || isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? '変更中...' : 'パスワードを変更'}
          </Button>
        </form>

        <div className="mt-4">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            ログインに戻る
          </Link>
        </div>
      </div>
    </section>
  );
}
