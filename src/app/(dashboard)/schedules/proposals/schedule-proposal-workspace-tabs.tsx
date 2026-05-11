import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buildScheduleProposalHref, type ScheduleProposalWorkspace } from './proposal-query-state';

type WorkspaceTabsProps = {
  activeWorkspace: ScheduleProposalWorkspace;
  searchParams?: Record<string, string | string[] | undefined>;
};

const WORKSPACE_LABELS: Record<ScheduleProposalWorkspace, string> = {
  dashboard: '候補ダッシュボード',
  optimizer: '週次最適化',
};

export function ScheduleProposalWorkspaceTabs({
  activeWorkspace,
  searchParams,
}: WorkspaceTabsProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/95 p-2">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(WORKSPACE_LABELS) as ScheduleProposalWorkspace[]).map((workspace) => {
          const active = workspace === activeWorkspace;
          return (
            <Link
              key={workspace}
              href={buildScheduleProposalHref({
                params: searchParams,
                patch: {
                  workspace,
                },
              })}
              className={[
                'inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground',
              ].join(' ')}
              aria-current={active ? 'page' : undefined}
            >
              {WORKSPACE_LABELS[workspace]}
              {active ? <Badge variant="outline">作業中</Badge> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
