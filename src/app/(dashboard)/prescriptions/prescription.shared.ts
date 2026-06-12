import { CYCLE_STATUS_LABELS } from '@/lib/prescription/cycle-workspace';

// ---------------------------------------------------------------------------
// Cycle status config — CLAUDE.md 配色ルール準拠
// ワークフロー状態: 待ち=青、進行中=緑、差戻し=赤、完了=灰
// ---------------------------------------------------------------------------

export const CYCLE_STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: 'default' | 'secondary' | 'outline' | 'destructive';
    className?: string;
  }
> = {
  intake_received: { label: CYCLE_STATUS_LABELS.intake_received, variant: 'secondary' },
  structuring: {
    label: CYCLE_STATUS_LABELS.structuring,
    variant: 'secondary',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  inquiry_pending: {
    label: CYCLE_STATUS_LABELS.inquiry_pending,
    variant: 'destructive',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  inquiry_resolved: { label: CYCLE_STATUS_LABELS.inquiry_resolved, variant: 'outline' },
  ready_to_dispense: {
    label: CYCLE_STATUS_LABELS.ready_to_dispense,
    variant: 'default',
    className: 'bg-green-100 text-green-800 border-green-200',
  },
  dispensing: { label: CYCLE_STATUS_LABELS.dispensing, variant: 'default' },
  dispensed: {
    label: CYCLE_STATUS_LABELS.dispensed,
    variant: 'outline',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  },
  audit_pending: { label: CYCLE_STATUS_LABELS.audit_pending, variant: 'secondary' },
  audited: {
    label: CYCLE_STATUS_LABELS.audited,
    variant: 'outline',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  },
  on_hold: {
    label: CYCLE_STATUS_LABELS.on_hold,
    variant: 'outline',
    className: 'bg-orange-100 text-orange-800 border-orange-200',
  },
  cancelled: { label: CYCLE_STATUS_LABELS.cancelled, variant: 'destructive' },
};
