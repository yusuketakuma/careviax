'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { HelpPopover } from '@/components/ui/help-popover';
import {
  useWorkflowPhaseAccess,
  type WorkflowPhaseAccessItem,
  type WorkflowPhaseKey,
} from '@/lib/hooks/use-workflow-phase-access';
import { cn } from '@/lib/utils';

const TONE_CLASS: Record<WorkflowPhaseAccessItem['tone'], string> = {
  default: 'border-border/70 bg-background',
  warning: 'border-amber-200 bg-amber-50/60',
  danger: 'border-red-200 bg-red-50/60',
};

type WorkflowPhasePanelProps = {
  currentPhase?: WorkflowPhaseKey;
  phaseKeys?: WorkflowPhaseKey[];
  title?: string;
  description?: string;
  className?: string;
  phaseAccess?: Record<WorkflowPhaseKey, WorkflowPhaseAccessItem> | null;
};

export function WorkflowPhasePanel({
  currentPhase,
  phaseKeys = [
    'prescriptions',
    'dispensing',
    'auditing',
    'medication_sets',
    'set_audit',
    'schedules',
    'visits',
    'reports',
  ],
  title = '工程ショートカット',
  description = '件数と次の 1 件を見ながら、途中中断してもすぐ復帰できます。',
  className,
  phaseAccess: phaseAccessProp,
}: WorkflowPhasePanelProps) {
  const { phaseAccess: fetchedPhaseAccess } = useWorkflowPhaseAccess();
  const phaseAccess = phaseAccessProp ?? fetchedPhaseAccess;

  if (!phaseAccess) return null;

  const phases = phaseKeys
    .map((key) => ({
      key,
      ...phaseAccess[key],
    }))
    .filter((phase) => phase.pending_count > 0 || phase.key === currentPhase);

  if (phases.length === 0) return null;

  return (
    <Card className={cn('border-border/70', className)} data-testid="workflow-phase-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <HelpPopover title={title} description={description} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 xl:grid-cols-3">
        {phases.map((phase) => (
          <div
            key={phase.key}
            data-testid={`workflow-phase-panel-${phase.key}`}
            className={cn(
              'rounded-2xl border px-3 py-3',
              TONE_CLASS[phase.tone],
              phase.key === currentPhase && 'ring-2 ring-primary/20'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{phase.label}</p>
                  <HelpPopover title={phase.label} description={phase.summary} />
                </div>
              </div>
              <Badge variant={phase.pending_count > 0 ? 'default' : 'outline'}>
                {phase.pending_count}件
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={phase.href}
                data-testid={`workflow-phase-panel-${phase.key}-open`}
                className={buttonVariants({
                  size: 'sm',
                  variant: phase.key === currentPhase ? 'default' : 'outline',
                })}
              >
                フェーズを開く
              </Link>
              {phase.next_action ? (
                <Link
                  href={phase.next_action.href}
                  data-testid={`workflow-phase-panel-${phase.key}-next`}
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  {phase.next_action.label}
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
