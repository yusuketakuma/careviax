'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getCycleWorkspaceAction } from '@/lib/prescription/cycle-workspace';
import type { PatientWorkspace } from './patient-detail.types';

/**
 * p0_08「工程」タブ。8 工程の進行ストリップと現在工程の主操作を表示する。
 */

const PROCESS_STEPS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'intake', label: '処方箋応需', statuses: ['intake_received', 'structuring'] },
  { key: 'inquiry', label: '疑義照会', statuses: ['inquiry_pending', 'inquiry_resolved'] },
  { key: 'dispensing', label: '調剤', statuses: ['ready_to_dispense', 'dispensing'] },
  { key: 'audit', label: '調剤鑑査', statuses: ['dispensed', 'audit_pending'] },
  { key: 'set', label: '薬剤セット', statuses: ['audited'] },
  { key: 'set_audit', label: 'セット監査', statuses: ['setting'] },
  { key: 'visit', label: '訪問', statuses: ['set_audited', 'visit_ready'] },
  { key: 'report', label: '報告', statuses: ['visit_completed', 'reported'] },
];

function stepIndexOf(status: string): number {
  const index = PROCESS_STEPS.findIndex((step) => step.statuses.includes(status));
  return index === -1 ? 0 : index;
}

export function ProcessTab({ workspace }: { workspace: PatientWorkspace | null }) {
  if (!workspace) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          進行中の処方サイクルはありません。処方を受け付けると工程がここに表示されます。
        </CardContent>
      </Card>
    );
  }

  const action = getCycleWorkspaceAction(workspace.overall_status);
  const currentIndex = stepIndexOf(workspace.overall_status);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <h3 className="font-heading text-base font-semibold text-foreground">工程の進み方</h3>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-wrap items-center gap-y-3" role="list">
            {PROCESS_STEPS.map((step, index) => {
              const state =
                index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
              return (
                <li key={step.key} className="flex items-center">
                  <span className="flex flex-col items-center gap-1 px-1.5">
                    <span
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full border text-xs font-semibold',
                        state === 'done' && 'border-primary/40 bg-primary/10 text-primary',
                        state === 'current' &&
                          'border-primary bg-primary text-primary-foreground',
                        state === 'upcoming' &&
                          'border-border bg-muted/40 text-muted-foreground',
                      )}
                      aria-hidden="true"
                    >
                      {state === 'done' ? <Check className="size-3.5" /> : index + 1}
                    </span>
                    <span
                      className={cn(
                        'whitespace-nowrap text-[11px]',
                        state === 'current'
                          ? 'font-semibold text-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {step.label}
                    </span>
                  </span>
                  {index < PROCESS_STEPS.length - 1 && (
                    <span
                      className={cn(
                        'mb-4 h-px w-4 sm:w-6',
                        index < currentIndex ? 'bg-primary/50' : 'bg-border',
                      )}
                      aria-hidden="true"
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-heading text-base font-semibold text-foreground">現在の工程</h3>
            <Badge variant="secondary">{action?.statusLabel ?? workspace.overall_status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {action ? (
            <>
              <p className="text-sm leading-6 text-muted-foreground">{action.description}</p>
              <Link href={action.actionHref} className={buttonVariants({ className: 'min-h-11' })}>
                {action.actionLabel}
              </Link>
            </>
          ) : null}
        </CardContent>
      </Card>

      {workspace.open_exceptions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <h3 className="font-heading text-base font-semibold text-foreground">
              止まっている理由
            </h3>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm" role="list">
              {workspace.open_exceptions.map((exception) => (
                <li
                  key={exception.id}
                  className={
                    exception.severity === 'critical' ? 'text-destructive' : 'text-amber-600'
                  }
                >
                  {exception.description}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
