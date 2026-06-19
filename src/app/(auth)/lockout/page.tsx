'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Lock, Phone } from 'lucide-react';

export default function LockoutPage() {
  return (
    <div className="w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-destructive" aria-hidden="true" />
            アカウントロック
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
            <Lock className="h-4 w-4" />
            <AlertTitle>アカウントがロックされています</AlertTitle>
            <AlertDescription>
              ログイン試行回数が上限を超えたため、アカウントが一時的にロックされました。
            </AlertDescription>
          </Alert>

          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground space-y-3">
            <p className="font-medium text-foreground">ロック解除方法:</p>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-tag-info/15 text-xs font-medium text-tag-info">
                  1
                </span>
                <span>一定時間（30分）経過後、自動的にロックが解除されます。</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-tag-info/15 text-xs font-medium text-tag-info">
                  2
                </span>
                <span>お急ぎの場合は、システム管理者にご連絡ください。</span>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-tag-info/30 bg-tag-info/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-tag-info mb-2">
              <Phone className="h-4 w-4" aria-hidden="true" />
              管理者連絡先
            </div>
            <div className="text-tag-info space-y-1">
              <p>システム管理部門</p>
              <p>TEL: 03-XXXX-XXXX（平日 9:00-18:00）</p>
              <p>Email: admin@example-pharmacy.jp</p>
            </div>
          </div>

          <Link href="/login">
            <Button variant="outline" size="lg" className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              ログイン画面に戻る
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
