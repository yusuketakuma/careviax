'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  COGNITO_CHALLENGE_STORAGE_KEY,
  decodeCognitoChallenge,
} from '@/lib/auth/cognito-challenge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';

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
    <section
      aria-labelledby="login-entry-title"
      className="w-full max-w-5xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
    >
      <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
        <aside className="order-2 border-t border-border/70 bg-slate-50/80 p-5 sm:p-6 lg:order-1 lg:border-r lg:border-t-0 lg:p-8">
          <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            MFA保護された入口
          </div>
          <div className="mt-6 space-y-3">
            <p className="text-sm font-semibold text-muted-foreground">PH-OS secure sign-in</p>
            <h2
              id="login-entry-title"
              className="text-2xl font-semibold leading-tight text-foreground"
            >
              薬局業務を始める前に、本人確認を完了します
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              メールアドレスとパスワードで確認後、必要に応じて6桁コードへ進みます。端末変更や初回利用時も同じ手順です。
            </p>
          </div>

          <div className="mt-7 grid gap-3 text-sm">
            {[
              { icon: KeyRound, title: '1. 認証情報', text: 'メールアドレスとパスワードを入力' },
              {
                icon: Smartphone,
                title: '2. 確認コード',
                text: 'スマホまたはメールの6桁コードを確認',
              },
              {
                icon: CheckCircle2,
                title: '3. 業務開始',
                text: '薬局・担当モードを選んでワークベンチへ',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="grid grid-cols-[2.75rem_1fr] items-center gap-3 rounded-xl border border-border/70 bg-background/80 p-3"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold text-foreground">{item.title}</span>
                  <span className="block leading-5 text-muted-foreground">{item.text}</span>
                </span>
              </div>
            ))}
          </div>
        </aside>

        <div className="order-1 p-5 sm:p-6 lg:order-2 lg:p-8">
          <div className="mb-6">
            <p className="text-sm font-semibold text-primary">ログイン</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              職員アカウントで入室してください。入力内容はエラー後も保持されます。
            </p>
          </div>

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
              <Input
                className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
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
                className="h-11 min-h-[44px] sm:h-11 sm:min-h-[44px]"
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
              className="mt-2 h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
              disabled={isLoading}
              aria-busy={isLoading}
            >
              {isLoading ? 'ログイン中...' : 'ログインする'}
            </Button>
          </form>

          <div className="mt-4 flex justify-center">
            <Link
              href="/password/reset"
              className="inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              パスワードを忘れた方
            </Link>
          </div>

          <div className="mt-4 rounded-xl border border-tag-info/30 bg-tag-info/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Smartphone className="h-4 w-4 text-tag-info" aria-hidden="true" />
              確認コードが必要な場合
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              スマホまたはメールに届いた6桁のコードを入力します。手元に端末がない場合は、ログインせず管理者へ連絡してください。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-5xl">
          <div className="h-[31rem] animate-pulse rounded-2xl bg-muted" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
