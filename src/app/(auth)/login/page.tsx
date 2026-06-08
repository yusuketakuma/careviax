'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  COGNITO_CHALLENGE_STORAGE_KEY,
  decodeCognitoChallenge,
} from '@/lib/auth/cognito-challenge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ShieldCheck } from 'lucide-react';

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
  const rawCallback = searchParams.get('callbackUrl') ?? '/dashboard';
  const callbackUrl = rawCallback.startsWith('/') ? rawCallback : '/dashboard';
  const errorCode = searchParams.get('error') ?? '';
  const noticeCode = searchParams.get('notice') ?? '';
  const notice = noticeCode ? (NOTICE_MESSAGES[noticeCode] ?? null) : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>ログイン</CardTitle>
          <CardDescription>アカウント情報を入力してください</CardDescription>
        </CardHeader>
        <CardContent>
          {notice && (
            <Alert className="mb-4 border-blue-200 bg-blue-50 text-blue-900">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              <AlertDescription>{notice}</AlertDescription>
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
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="example@pharmacy.jp"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="mt-2 w-full bg-blue-600 hover:bg-blue-700"
              disabled={isLoading}
              aria-busy={isLoading}
            >
              {isLoading ? 'ログイン中...' : 'ログイン'}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link
              href="/password/reset"
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              パスワードを忘れた方
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-md">
          <div className="h-72 animate-pulse rounded-xl bg-slate-100" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
