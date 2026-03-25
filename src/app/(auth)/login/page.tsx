'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'メールアドレスまたはパスワードが正しくありません。',
  AccessDenied: 'アクセスが拒否されました。管理者にお問い合わせください。',
  UserNotConfirmed: 'メールアドレスの確認が完了していません。',
  PasswordResetRequired: 'パスワードのリセットが必要です。',
  UserLambdaValidationException: 'アカウントがロックされています。しばらくお待ちください。',
};

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';
  const errorCode = searchParams.get('error') ?? '';

  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    try {
      await signIn('cognito', { callbackUrl });
    } finally {
      setIsLoading(false);
    }
  }

  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? 'ログインに失敗しました。')
    : null;

  return (
    <div className="w-full max-w-sm px-4">
      <div className="mb-8 text-center">
        <div className="mb-3 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
            <svg
              className="h-7 w-7 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-slate-800">CareViaX</h1>
        <p className="mt-1 text-sm text-slate-500">在宅訪問薬局プラットフォーム</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ログイン</CardTitle>
          <CardDescription>アカウント情報を入力してください</CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {errorMessage}
            </div>
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
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-xs text-slate-400">
        3省2ガイドライン準拠 / ISMAP準拠 AWS基盤
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-sm px-4">
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
