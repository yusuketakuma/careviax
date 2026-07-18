'use client';

import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Clock, Lock, Phone } from 'lucide-react';

import { resolveSupportContact } from './support-contact';

// SSOT 6.3: lockout の連絡先にプレースホルダ固定値(03-XXXX-XXXX 等)を出さない。
// 未認証画面で org 解決は不可能なため、導入先ごとに build 時 env で注入し、
// 未設定時は捏造せず「自施設の管理者へ」の一般文言にフォールバックする。
const SUPPORT_CONTACT = resolveSupportContact();

export default function LockoutPage() {
  return (
    <section
      aria-labelledby="lockout-title"
      className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm"
    >
      <div className="border-b border-border/70 bg-slate-50/80 p-4 sm:p-6">
        <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-destructive/20 bg-destructive/10 px-3 text-sm font-semibold text-destructive">
          <Lock className="h-4 w-4" aria-hidden="true" />
          ログイン保護
        </div>
        <div className="mt-4 space-y-2">
          <h2
            id="lockout-title"
            className="text-xl font-semibold leading-tight text-foreground sm:text-2xl"
          >
            アカウントを一時ロックしました
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            ログイン試行が上限を超えたため、本人確認が完了するまで操作を止めています。
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-6">
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
          <Lock className="h-4 w-4" />
          <AlertTitle>アカウントがロックされています</AlertTitle>
          <AlertDescription>
            ログイン試行回数が上限を超えたため、アカウントが一時的にロックされました。
          </AlertDescription>
        </Alert>

        <div className="rounded-xl border border-border/70 bg-muted/70 p-3 text-sm text-muted-foreground sm:p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-foreground sm:mb-3">
            <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
            ロック解除方法
          </div>
          <ul className="space-y-2 sm:space-y-3">
            <li className="flex items-start gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-tag-info/20 bg-tag-info/10 text-sm font-semibold text-tag-info">
                1
              </span>
              <span className="pt-0.5">
                一定時間が経過すると、自動的にロックが解除されます。時間をおいて再度お試しください。
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-tag-info/20 bg-tag-info/10 text-sm font-semibold text-tag-info">
                2
              </span>
              <span className="pt-0.5">お急ぎの場合は、システム管理者にご連絡ください。</span>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border-l-4 border-border/70 border-l-tag-info bg-card p-3 text-sm sm:p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold text-tag-info">
            <Phone className="h-4 w-4" aria-hidden="true" />
            管理者連絡先
          </div>
          {SUPPORT_CONTACT.hasContact ? (
            <div className="space-y-1 leading-6 text-foreground">
              {SUPPORT_CONTACT.name ? <p>{SUPPORT_CONTACT.name}</p> : null}
              {SUPPORT_CONTACT.phone ? (
                <p>
                  TEL:{' '}
                  <a className="underline underline-offset-2" href={`tel:${SUPPORT_CONTACT.phone}`}>
                    {SUPPORT_CONTACT.phone}
                  </a>
                </p>
              ) : null}
              {SUPPORT_CONTACT.email ? (
                <p>
                  Email:{' '}
                  <a
                    className="underline underline-offset-2"
                    href={`mailto:${SUPPORT_CONTACT.email}`}
                  >
                    {SUPPORT_CONTACT.email}
                  </a>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="leading-6 text-muted-foreground">
              {/* 実在しない機能(ロック解除画面等)を約束しない(SSOT 2.11 片翼禁止)。 */}
              ご利用の施設のシステム管理者にお問い合わせください。本人確認後の対応を依頼してください。
            </p>
          )}
        </div>

        <Link href="/login">
          <Button
            variant="outline"
            size="lg"
            className="h-11 min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            ログイン画面に戻る
          </Button>
        </Link>
      </div>
    </section>
  );
}
