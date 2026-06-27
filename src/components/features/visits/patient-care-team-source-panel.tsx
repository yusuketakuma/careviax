'use client';

import { Building2, Phone, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type PatientCareTeamSourceContact = {
  id: string;
  role: string;
  name: string;
  organization_name: string | null;
  phone: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  physician: 'クリニック',
  nurse: '訪問看護',
  care_manager: 'ケアマネ',
  pharmacist: '薬局',
  other: 'その他',
};

const REQUIRED_REPORT_ROLES = ['physician', 'nurse', 'care_manager'] as const;

function normalizeCareTeamRole(role: string) {
  if (['physician', 'doctor', 'clinic', 'prescriber'].includes(role)) return 'physician';
  if (['nurse', 'visiting_nurse', 'home_nurse'].includes(role)) return 'nurse';
  if (['care_manager', 'caremanager', 'cm'].includes(role)) return 'care_manager';
  return role;
}

export function PatientCareTeamSourcePanel({
  contacts,
  compact = false,
  className,
}: {
  contacts: readonly PatientCareTeamSourceContact[];
  compact?: boolean;
  className?: string;
}) {
  const roleSet = new Set(contacts.map((contact) => normalizeCareTeamRole(contact.role)));
  const missingRoles = REQUIRED_REPORT_ROLES.filter((role) => !roleSet.has(role));

  return (
    <Card className={cn('border-border bg-card', className)}>
      <CardHeader className={cn('space-y-2', compact ? 'p-3 pb-2' : undefined)}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-sm text-foreground">
              <UsersRound className="size-4 text-muted-foreground" aria-hidden="true" />
              患者情報から取得した連携先
            </CardTitle>
            <p className="text-xs leading-5 text-muted-foreground">
              クリニック・訪問看護・ケアマネジャーを患者情報から参照し、訪問時メモと報告書送付先の判断に使います。
            </p>
          </div>
          <Badge variant={missingRoles.length === 0 ? 'default' : 'outline'}>
            {contacts.length}件 / 不足 {missingRoles.length}件
          </Badge>
        </div>
      </CardHeader>
      <CardContent className={cn('space-y-3', compact ? 'p-3 pt-0' : undefined)}>
        {contacts.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {contacts.map((contact) => (
              <div key={contact.id} className="rounded-xl border border-border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                    {ROLE_LABELS[normalizeCareTeamRole(contact.role)] ?? contact.role}
                  </Badge>
                  <span className="font-medium text-foreground">{contact.name}</span>
                </div>
                {contact.organization_name ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Building2 className="size-3.5" aria-hidden="true" />
                    {contact.organization_name}
                  </p>
                ) : null}
                {contact.phone ? (
                  <a
                    href={`tel:${contact.phone}`}
                    className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-primary sm:min-h-8"
                  >
                    <Phone className="size-3.5" aria-hidden="true" />
                    {contact.phone}
                  </a>
                ) : (
                  <p className="mt-1 text-xs text-state-confirm">電話番号未登録</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-state-confirm/40 bg-state-confirm/10 px-3 py-2 text-sm text-state-confirm">
            患者情報にクリニック・訪問看護・ケアマネジャーが登録されていません。報告書送付前に連携先を登録してください。
          </p>
        )}

        {missingRoles.length > 0 ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {missingRoles.map((role) => (
              <Badge
                key={role}
                variant="outline"
                className="border-transparent bg-state-confirm/10 text-state-confirm"
              >
                未登録: {ROLE_LABELS[role]}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
