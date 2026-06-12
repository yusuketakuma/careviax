'use client';

import Link from 'next/link';
import { ProcessChips } from '@/components/features/workspace/process-chips';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  getCycleWorkspaceAction,
  getProcessStepKeyForStatus,
} from '@/lib/prescription/cycle-workspace';
import type { PatientWorkspace } from './patient-detail.types';

/**
 * p0_08「工程」タブ。新デザイン共通の9工程と現在工程の主操作を表示する。
 */

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
  const currentStep = getProcessStepKeyForStatus(workspace.overall_status);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <h3 className="font-heading text-base font-semibold text-foreground">工程の進み方</h3>
        </CardHeader>
        <CardContent>
          {currentStep ? (
            <ProcessChips currentStep={currentStep} />
          ) : (
            <p className="text-sm text-muted-foreground">
              このサイクルは線形工程の外にあります。現在の工程カードで状態を確認してください。
            </p>
          )}
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
