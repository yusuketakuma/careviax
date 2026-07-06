'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  COGNITO_CHALLENGE_STORAGE_KEY,
  decodeCognitoChallenge,
} from '@/lib/auth/cognito-challenge';
import { sanitizeLocalCallbackUrl } from '@/lib/auth/browser-auth-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { Skeleton } from '@/components/ui/loading';

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'メールアドレスまたはパスワードが正しくありません。',
  AccessDenied: 'アクセスが拒否されました。管理者にお問い合わせください。',
  UserNotConfirmed: 'メールアドレスの確認が完了していません。',
  PasswordResetRequired: 'パスワードのリセットが必要です。',
  UserLambdaValidationException: 'アカウントがロックされています。しばらくお待ちください。',
  AccountLocked: 'アカウントがロックされています。',
  NotAuthorizedException: 'メールアドレスまたはパスワードが正しくありません。',
  UserNotFoundException: 'メールアドレスまたはパスワードが正しくありません。',
  PasswordResetRequiredException: 'パスワードのリセットが必要です。',
  UserNotConfirmedException: 'メールアドレスの確認が完了していません。',
};

const LOCKOUT_ERROR_CODES = new Set([
  'AccountLocked',
  'UserLambdaValidationException',
  'TooManyFailedAttemptsException',
  'PasswordAttemptsExceeded',
]);

const NOTICE_MESSAGES: Record<string, string> = {
  mfa_recovery_reset: 'リカバリーコードでMFAを解除しました。ログイン後にMFAを再設定してください。',
};

function canonicalizeLocalLoginHost() {
  if (window.location.hostname !== '127.0.0.1') return;

  const url = new URL(window.location.href);
  url.hostname = 'localhost';
  window.location.replace(url.toString());
}

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = sanitizeLocalCallbackUrl(searchParams.get('callbackUrl'));
  const errorCode = searchParams.get('error') ?? '';
  const noticeCode = searchParams.get('notice') ?? '';
  const notice = noticeCode ? (NOTICE_MESSAGES[noticeCode] ?? null) : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    errorCode ? (ERROR_MESSAGES[errorCode] ?? 'ログインに失敗しました。') : null,
  );

  useEffect(() => {
    canonicalizeLocalLoginHost();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setShowPassword(false);
    setIsLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        mode: 'password',
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        if (LOCKOUT_ERROR_CODES.has(result.error)) {
          window.location.href = '/lockout';
          return;
        }

        const challenge = decodeCognitoChallenge(result.error);
        if (challenge) {
          window.sessionStorage.setItem(COGNITO_CHALLENGE_STORAGE_KEY, JSON.stringify(challenge));
          window.location.href =
            challenge.type === 'NEW_PASSWORD_REQUIRED'
              ? `/first-login?callbackUrl=${encodeURIComponent(callbackUrl)}`
              : `/mfa?callbackUrl=${encodeURIComponent(callbackUrl)}`;
          return;
        }

        setError(ERROR_MESSAGES[result.error] ?? 'ログインに失敗しました。');
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      setError('ネットワークエラーが発生しました。接続を確認してください。');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section
      aria-labelledby="login-entry-title"
      className="w-full max-w-md overflow-hidden rounded-lg border border-border/80 bg-card text-card-foreground shadow-sm"
    >
      <div className="border-b border-border/70 px-5 py-5 sm:px-6">
        <div className="space-y-2">
          <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-xs font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            職員アカウント
          </div>
          <h2
            id="login-entry-title"
            className="text-2xl font-semibold leading-tight tracking-normal text-foreground"
          >
            ログイン
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            メールアドレスとパスワードで本人確認します。
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {notice && (
          <Alert className="mb-4 border-tag-info/30 bg-tag-info/10 text-tag-info">
            <ShieldCheck className="h-4 w-4 text-tag-info" />
            <AlertDescription className="text-tag-info">{notice}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">メールアドレス</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                className="h-11 min-h-[44px] pl-9 sm:h-11 sm:min-h-[44px]"
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="password">パスワード</Label>
              <Link
                href="/password/reset"
                className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                忘れた方
              </Link>
            </div>
            <div className="relative">
              <LockKeyhole
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                className="h-11 min-h-[44px] pl-9 pr-12 sm:h-11 sm:min-h-[44px]"
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
              <button
                type="button"
                className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setShowPassword((current) => !current)}
                disabled={isLoading}
                aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            className="mt-1 h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? '確認中...' : 'ログイン'}
          </Button>
        </form>

        <div className="mt-5 border-t border-border/70 pt-4">
          <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-tag-info" aria-hidden="true" />
            共有端末では、ログイン後に画面を離れる前に必ずログアウトしてください。
          </p>
        </div>

        <div className="mt-2 flex flex-wrap justify-center">
          <Link
            href="/terms"
            className="inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-muted-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            利用規約
          </Link>
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-muted-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            プライバシーポリシー
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="ログイン画面を読み込み中" className="w-full max-w-md">
          <Skeleton className="h-[27rem] rounded-xl" />
          <span className="sr-only">ログイン画面を読み込み中...</span>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
