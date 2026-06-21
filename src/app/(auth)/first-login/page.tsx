'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Eye, EyeOff, Info, ShieldCheck } from 'lucide-react';
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
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>MFA設定のご案内</CardTitle>
            </div>
            <CardDescription>
              パスワードの設定が完了しました。セキュリティ強化のため、二要素認証（MFA）の設定をお願いします。
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                className="w-full"
                onClick={() =>
                  router.push(`/mfa/setup?callbackUrl=${encodeURIComponent(callbackUrl)}`)
                }
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                MFAを設定する
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>初回ログイン - パスワード設定</CardTitle>
          <CardDescription>
            セキュリティのため、初回ログイン時にパスワードの変更が必要です。
            13文字以上の安全なパスワードを設定してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
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
            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground space-y-1">
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
              className="mt-2 w-full"
              disabled={!canSubmit || isLoading}
              aria-busy={isLoading}
            >
              {isLoading ? '設定中...' : 'パスワードを設定する'}
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary hover:underline">
          ログイン画面に戻る
        </Link>
      </p>
    </div>
  );
}
