'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { StateBadge } from '@/components/ui/state-badge';
import { ISSUE_STATUS_ROLE } from '@/lib/constants/status-labels';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';
import { cn } from '@/lib/utils';
import type { CareTrend } from '@/types/visit-brief';

type IssueItem = CareTrend['issue_timeline'][number];

const MAX_VISIBLE = 5;

const STATUS_LABELS: Record<string, string> = {
  open: '未解決',
  in_progress: '対応中',
  resolved: '解決済',
};

function resolveIssueRole(status: string): StatusRole {
  const role = ISSUE_STATUS_ROLE[status];
  return role && role !== 'neutral' ? role : 'readonly';
}

function IssueNode({ issue }: { issue: IssueItem }) {
  const role = resolveIssueRole(issue.current_status);
  const label = STATUS_LABELS[issue.current_status] ?? issue.current_status;

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* vertical line */}
      <div
        className="absolute left-[7px] top-4 h-full w-px bg-border last:hidden"
        aria-hidden="true"
      />
      {/* dot */}
      <div
        className={cn(
          'mt-1 size-3.5 shrink-0 rounded-full ring-2 ring-background',
          STATUS_TOKENS[role].dotClassName,
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge role={role} className="py-0 text-[10px] font-medium">
            {label}
          </StateBadge>
          <span className="text-[11px] text-muted-foreground">
            {issue.identified_at.slice(0, 10)}
            {issue.resolved_at ? ` → ${issue.resolved_at.slice(0, 10)}` : ''}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">{issue.title}</p>
      </div>
    </li>
  );
}

export function IssueTimeline({ issues }: { issues: CareTrend['issue_timeline'] }) {
  const [expanded, setExpanded] = useState(false);

  if (issues.length === 0) {
    return <p className="text-xs text-muted-foreground">課題の記録はありません。</p>;
  }

  const visible = expanded ? issues : issues.slice(0, MAX_VISIBLE);
  const hasMore = issues.length > MAX_VISIBLE;

  return (
    <div className="space-y-2">
      <ul className="space-y-0">
        {visible.map((issue) => (
          <IssueNode key={issue.issue_id} issue={issue} />
        ))}
      </ul>
      {hasMore && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '折りたたむ' : `さらに${issues.length - MAX_VISIBLE}件を表示`}
        </Button>
      )}
    </div>
  );
}
