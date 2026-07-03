import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import type { PlatformOperatorRole } from '@prisma/client';

const OPERATOR_ROLE_LABEL: Record<PlatformOperatorRole, string> = {
  platform_support: '運営サポート（閲覧のみ）',
  platform_admin: '運営管理者',
  platform_owner: '運営オーナー',
};

/**
 * Shell for the platform-operator console: persistent break-glass banner +
 * a minimal header. Deliberately does not reuse `AppShell` (tenant sidebar /
 * org switcher / offline sync UI — none of which apply to a cross-tenant
 * operator).
 */
export function PlatformShell({
  children,
  operatorRole,
}: {
  children: ReactNode;
  operatorRole: PlatformOperatorRole;
}) {
  return (
    <div className="min-h-dvh bg-muted/30">
      <div
        role="alert"
        className="flex items-center justify-center gap-2 border-b border-tag-hazard/30 bg-tag-hazard/10 px-4 py-2 text-center text-sm font-medium text-foreground"
      >
        <ShieldAlert className="size-4 shrink-0 text-tag-hazard" aria-hidden="true" />
        <span>これは監査付きブレークグラス・コンソールです。全アクセスが記録されます。</span>
      </div>
      <header className="border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/platform" className="text-base font-semibold text-foreground">
            プラットフォーム運営者コンソール
          </Link>
          <span className="text-xs text-muted-foreground">{OPERATOR_ROLE_LABEL[operatorRole]}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
