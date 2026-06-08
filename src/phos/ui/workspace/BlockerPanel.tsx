'use client';

import { AlertTriangle, CircleAlert, Info, ShieldAlert } from 'lucide-react';
import type { ComponentType, CSSProperties } from 'react';
import { SeverityToken } from '@/phos/contracts/phos_design_tokens';
import { PhosActionLabel, PhosBlockerMessageLabel } from '@/phos/contracts/phos_copy.ja';
import { BlockerSeverity, UserRole } from '@/phos/contracts/phos_contracts';
import type { BlockerView } from '@/phos/contracts/phos_contracts';

export type BlockerPanelProps = {
  blockers: BlockerView[];
};

const SeverityIcon = {
  [BlockerSeverity.INFO]: Info,
  [BlockerSeverity.WARNING]: AlertTriangle,
  [BlockerSeverity.ERROR]: CircleAlert,
  [BlockerSeverity.CRITICAL]: ShieldAlert,
} as const satisfies Record<BlockerSeverity, ComponentType<{ className?: string }>>;

const UserRoleLabel = {
  [UserRole.PHARMACIST]: '薬剤師',
  [UserRole.PHARMACY_CLERK]: '事務',
  [UserRole.DISPENSE_ASSISTANT]: '調剤補助',
  [UserRole.MANAGER]: '管理者',
  [UserRole.ADMIN]: '管理者',
} as const satisfies Record<UserRole, string>;

function tokenStyle(severity: BlockerSeverity): CSSProperties {
  const token = SeverityToken[severity];
  return {
    color: token.fg,
    backgroundColor: token.bg,
    borderColor: token.border,
  };
}

function blockerMessage(blocker: BlockerView): string {
  return PhosBlockerMessageLabel[blocker.message_key] ?? '確認が必要な項目です。';
}

export function BlockerPanel({ blockers }: BlockerPanelProps) {
  const activeBlockers = blockers.filter((blocker) => blocker.active);

  return (
    <aside className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">不足・確認事項</h3>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {activeBlockers.length}件
        </span>
      </div>

      {activeBlockers.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">未解消の不足はありません。</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {activeBlockers.map((blocker) => {
            const Icon = SeverityIcon[blocker.severity];
            return (
              <li
                key={blocker.blocker_code}
                className="rounded-md border px-3 py-2 text-sm"
                style={tokenStyle(blocker.severity)}
              >
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 space-y-1">
                    <p className="break-words font-medium">{blockerMessage(blocker)}</p>
                    <p className="text-xs opacity-85">
                      担当: {UserRoleLabel[blocker.owner_role]} / {blocker.blocker_code}
                    </p>
                    {blocker.required_action_code ? (
                      <p className="text-xs opacity-85">
                        必要操作: {PhosActionLabel[blocker.required_action_code]}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
