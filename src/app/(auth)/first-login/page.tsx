'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, Info, ShieldCheck } from 'lucide-react';
import {
  COGNITO_CHALLENGE_STORAGE_KEY,
  decodeCognitoChallenge,
} from '@/lib/auth/cognito-challenge';
import { useSafeCallbackUrl, useStoredCognitoChallenge } from '@/lib/auth/browser-auth-state';

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

export default function FirstLoginPage() {
  const router = useRouter();
  const callbackUrl = useSafeCallbackUrl();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const { challenge, error: challengeError } = useStoredCognitoChallenge('NEW_PASSWORD_REQUIRED', {
    missing: '初回パスワード設定セッションが見つかりません。ログインからやり直してください。',
    malformed: '初回パスワード設定セッションが壊れています。ログインからやり直してください。',
    invalid: '初回パスワード設定セッションが無効です。ログインからやり直してください。',
  });
  const error = submitError ?? challengeError;
  const hasChallenge = Boolean(challenge);

  const strength = evaluatePasswordStrength(newPassword);
  const passwordsMatch = newPassword === confirmPassword;
  const isLongEnough = newPassword.length >= 13;

  const canSubmit = isLongEnough && passwordsMatch && confirmPassword.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitError(null);
    setIsLoading(true);

    try {
      if (!challenge) {
        throw new Error('SESSION_MISSING');
      }

      const result = await signIn('credentials', {
        email: challenge.email,
        mode: 'new_password',
        challengeSession: challenge.session,
        newPassword,
        callbackUrl,
        redirect: false,
      });

      if (result?.error) {
        const nextChallenge = decodeCognitoChallenge(result.error);
        if (nextChallenge) {
          window.sessionStorage.setItem(
            COGNITO_CHALLENGE_STORAGE_KEY,
            JSON.stringify(nextChallenge),
          );
          window.location.href = `/mfa?callbackUrl=${encodeURIComponent(callbackUrl)}`;
          return;
        }

        throw new Error(result.error);
      }

      window.sessionStorage.removeItem(COGNITO_CHALLENGE_STORAGE_KEY);
      setPasswordChanged(true);
    } catch {
      setSubmitError('パスワードの設定に失敗しました。もう一度お試しください。');
    } finally {
      setIsLoading(false);
    }
  }

  if (passwordChanged) {
    return (
      <section
        aria-labelledby="first-login-success-title"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
      >
        <div className="border-b border-border/70 bg-slate-50/80 p-5 sm:p-6">
          <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-state-done/20 bg-state-done/10 px-3 text-sm font-semibold text-state-done">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            パスワード設定完了
          </div>
          <div className="mt-5 space-y-2">
            <h2 id="first-login-success-title" className="text-2xl font-semibold text-foreground">
              MFA設定へ進みます
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              パスワードの設定が完了しました。セキュリティ強化のため、二要素認証（MFA）の設定をお願いします。
            </p>
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <Alert className="mb-6 border-tag-info/30 bg-tag-info/10">
            <Info className="h-4 w-4 text-tag-info" />
            <AlertDescription className="text-tag-info">
              MFA設定により、不正アクセスからアカウントを保護できます。 認証アプリ（Google
              Authenticator等）をご準備ください。
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              className="h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
              onClick={() =>
                router.push(`/mfa/setup?callbackUrl=${encodeURIComponent(callbackUrl)}`)
              }
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              MFAを設定する
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (!hasChallenge) {
    return (
      <section
        aria-labelledby="first-login-recovery-title"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
      >
        <div className="border-b border-border/70 bg-slate-50/80 p-5 sm:p-6">
          <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            初回パスワード設定
          </div>
          <div className="mt-5 space-y-2">
            <h2 id="first-login-recovery-title" className="text-2xl font-semibold text-foreground">
              ログインからやり直してください
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              初回設定用のセッションが確認できません。安全のため、もう一度ログインして本人確認をやり直します。
            </p>
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error ??
                '初回パスワード設定セッションが見つかりません。ログインからやり直してください。'}
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
      </section>
    );
  }

  return (
    <section
      aria-labelledby="first-login-title"
      className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
    >
      <div className="border-b border-border/70 bg-slate-50/80 p-5 sm:p-6">
        <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          初回パスワード設定
        </div>
        <div className="mt-5 space-y-2">
          <h2
            id="first-login-title"
            className="text-2xl font-semibold leading-tight text-foreground"
          >
            業務用の新しいパスワードを設定します
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            13文字以上で、他サービスと共有していないパスワードを入力してください。入力内容はエラー後も保持されます。
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
          {/* New password */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="first-new-password">新しいパスワード</Label>
            <div className="relative">
              <Input
                className="h-11 min-h-[44px] pr-12 sm:h-11 sm:min-h-[44px]"
                id="first-new-password"
                type={showNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={isLoading}
                autoFocus
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
            <Label htmlFor="first-confirm-password">新しいパスワード（確認）</Label>
            <Input
              className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
              id="first-confirm-password"
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

          {/* Requirements hint */}
          <div className="space-y-1 rounded-xl border border-border/70 bg-muted/70 p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">パスワード要件:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li className={isLongEnough ? 'text-state-done' : ''}>13文字以上</li>
              <li
                className={
                  /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) ? 'text-state-done' : ''
                }
              >
                大文字と小文字を含む
              </li>
              <li className={/\d/.test(newPassword) ? 'text-state-done' : ''}>数字を含む</li>
              <li className={/[^a-zA-Z0-9]/.test(newPassword) ? 'text-state-done' : ''}>
                記号を含む（推奨）
              </li>
            </ul>
          </div>

          <Button
            type="submit"
            size="lg"
            className="mt-2 h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
            disabled={!canSubmit || isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? '設定中...' : 'パスワードを設定する'}
          </Button>
        </form>
      </div>
      <div className="border-t border-border/70 px-5 py-3 text-center sm:px-6">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ログイン画面に戻る
        </Link>
      </div>
    </section>
  );
}
