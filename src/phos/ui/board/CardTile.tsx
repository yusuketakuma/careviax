'use client';

import { AlertTriangle, CircleAlert, Info, ShieldAlert } from 'lucide-react';
import type { ComponentType, CSSProperties, MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { SeverityToken, CardTileDims, TagToken } from '@/phos/contracts/phos_design_tokens';
import {
  PhosActionLabel,
  PhosCurrentStepLabel,
  PhosDisplayStatusLabel,
} from '@/phos/contracts/phos_copy.ja';
import { BlockerSeverity } from '@/phos/contracts/phos_contracts';
import type {
  ActionCode,
  CardSummaryView,
  NextActionView,
  TagView,
} from '@/phos/contracts/phos_contracts';
import { selectVisibleTags } from '@/phos/domain/tags/selectVisibleTags';

export type CardTileProps = {
  card: CardSummaryView;
  next_action: NextActionView;
  blocker_summary?: CardSummaryView['blocker_summary'];
  tags: TagView[];
  selected?: boolean;
  onOpen(cardId: string): void;
  onPrimaryAction(cardId: string, action: ActionCode): void;
};

const SeverityIcon = {
  [BlockerSeverity.INFO]: Info,
  [BlockerSeverity.WARNING]: AlertTriangle,
  [BlockerSeverity.ERROR]: CircleAlert,
  [BlockerSeverity.CRITICAL]: ShieldAlert,
} as const satisfies Record<BlockerSeverity, ComponentType<{ className?: string }>>;

function tokenStyle(severity: BlockerSeverity): CSSProperties {
  const token = SeverityToken[severity];
  return {
    color: token.fg,
    backgroundColor: token.bg,
    borderColor: token.border,
  };
}

function stopPrimaryPropagation(event: MouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

function TagBadge({ tag }: { tag: TagView }) {
  const severity = TagToken[tag.code]?.severity ?? tag.severity;
  const Icon = SeverityIcon[severity];
  return (
    <span
      className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-tight"
      style={tokenStyle(severity)}
      data-safety-critical={tag.safety_critical ? 'true' : 'false'}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{tag.label}</span>
    </span>
  );
}

export function CardTile({
  card,
  next_action,
  blocker_summary,
  tags,
  selected = false,
  onOpen,
  onPrimaryAction,
}: CardTileProps) {
  const visibleTags = selectVisibleTags(tags);
  const blocker = blocker_summary?.top;
  const BlockerIcon = blocker ? SeverityIcon[blocker.severity] : null;
  const actionLabel = PhosActionLabel[next_action.code];

  return (
    <article
      className={cn(
        'flex min-h-[120px] flex-col overflow-hidden rounded-lg border border-border/70 bg-card text-card-foreground shadow-sm',
        selected ? 'ring-2 ring-ring/40' : null,
      )}
      style={{ gap: CardTileDims.gap }}
      data-card-id={card.card_id}
    >
      <button
        data-phos-card-body="true"
        type="button"
        className="flex flex-1 flex-col gap-3 p-4 text-left outline-none transition hover:bg-muted/35 focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => onOpen(card.card_id)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="truncate text-base font-semibold leading-snug text-foreground">
              {card.patient_name}
            </h3>
            <p className="truncate text-sm text-muted-foreground">
              {[card.facility_name, card.room, card.visit_time].filter(Boolean).join(' / ') ||
                card.card_id}
            </p>
          </div>
          <span className="shrink-0 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
            {PhosDisplayStatusLabel[card.display_status]}
          </span>
        </div>

        <div className="grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs font-medium">
              {PhosCurrentStepLabel[card.current_step]}
            </span>
            <span className="min-w-0 truncate text-muted-foreground">{actionLabel}</span>
          </div>
          {blocker ? (
            <div
              className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs font-medium"
              style={tokenStyle(blocker.severity)}
            >
              {BlockerIcon ? (
                <BlockerIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              ) : null}
              <span className="min-w-0">{blocker.message_key}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {visibleTags.visible.map((tag) => (
            <TagBadge key={tag.code} tag={tag} />
          ))}
          {visibleTags.hidden_non_safety_count > 0 ? (
            <span className="inline-flex min-h-6 items-center rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              +{visibleTags.hidden_non_safety_count}
            </span>
          ) : null}
        </div>

        {card.assigned_user ? (
          <p className="truncate text-xs text-muted-foreground">担当: {card.assigned_user}</p>
        ) : null}
      </button>

      <button
        type="button"
        className="mx-4 mb-4 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 data-[enabled=false]:cursor-not-allowed data-[enabled=false]:bg-muted data-[enabled=false]:text-muted-foreground"
        style={{ minHeight: CardTileDims.primaryButtonHeight }}
        data-enabled={next_action.enabled ? 'true' : 'false'}
        aria-label={next_action.enabled ? actionLabel : `${actionLabel}（実行不可）`}
        onClick={(event) => {
          stopPrimaryPropagation(event);
          if (!next_action.enabled) return;
          onPrimaryAction(card.card_id, next_action.code);
        }}
      >
        {actionLabel}
      </button>
    </article>
  );
}
