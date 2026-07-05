import { format } from 'date-fns';
import type {
  ProposalDiagnosticsAction,
  ProposalGenerationDiagnosticsCardData,
} from '@/components/features/visits/visit-proposal-diagnostics-card';

function hasReason(
  diagnostics: ProposalGenerationDiagnosticsCardData | null | undefined,
  codes: string[],
) {
  return (
    diagnostics?.rejected.some((item) => item.reason_code && codes.includes(item.reason_code)) ??
    false
  );
}

function nextDateLabel(value: string | null | undefined) {
  if (!value) return '';
  const next = new Date(new Date(value).getTime() + 24 * 60 * 60 * 1000);
  return format(next, 'yyyy-MM-dd');
}

export function buildDashboardDiagnosticActions(args: {
  diagnostics: ProposalGenerationDiagnosticsCardData | null;
  travelMode: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
  nextBillableDate: string | null;
  currentStartDate: string;
  onSetTravelMode: (value: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER') => void;
  onSetCandidateCount: (value: string) => void;
  onSetStartDate: (value: string) => void;
  onExpandTimeWindow: () => void;
  onSetPriorityEmergency: () => void;
  onOpenOptimizer: () => void;
  onScrollToReproposal: () => void;
}) {
  const actions: ProposalDiagnosticsAction[] = [];
  const diagnostics = args.diagnostics;

  if (hasReason(diagnostics, ['travel_limit'])) {
    actions.push({
      label: args.travelMode === 'DRIVE' ? '候補数を5件へ拡張' : '移動手段を車で再評価',
      onClick: () =>
        args.travelMode === 'DRIVE' ? args.onSetCandidateCount('5') : args.onSetTravelMode('DRIVE'),
    });
  }
  if (hasReason(diagnostics, ['not_selected'])) {
    actions.push({
      label: '候補数を5件へ拡張',
      onClick: () => args.onSetCandidateCount('5'),
      variant: 'outline',
    });
  }
  if (hasReason(diagnostics, ['billing_constraint']) && args.nextBillableDate) {
    actions.push({
      label: `算定可能日 ${args.nextBillableDate} に寄せる`,
      onClick: () => args.onSetStartDate(args.nextBillableDate ?? ''),
    });
  }
  if (hasReason(diagnostics, ['beyond_deadline'])) {
    actions.push({
      label: '優先度を緊急へ切替',
      onClick: args.onSetPriorityEmergency,
    });
  }
  if (
    hasReason(diagnostics, [
      'weekday_mismatch',
      'business_holiday',
      'pharmacy_holiday',
      'pharmacy_regular_closed',
      'invalid_pharmacy_operating_window',
      'outside_pharmacy_operating_window',
      'invalid_visit_window',
      'outside_pharmacist_shift_window',
      'no_slot',
      'daily_capacity',
      'weekly_capacity',
      'locked_date_mismatch',
    ])
  ) {
    actions.push({
      label: '開始日を翌日にずらす',
      onClick: () => args.onSetStartDate(nextDateLabel(args.currentStartDate)),
      variant: 'outline',
    });
    actions.push({
      label: '時間帯を09:00-18:00へ広げる',
      onClick: args.onExpandTimeWindow,
      variant: 'outline',
    });
  }
  if (hasReason(diagnostics, ['emergency_capability'])) {
    actions.push({
      label: '週次最適化で担当セルを見直す',
      onClick: args.onOpenOptimizer,
      variant: 'outline',
    });
  }

  actions.push({
    label: '再提案条件へ',
    onClick: args.onScrollToReproposal,
    variant: 'outline',
  });

  return actions;
}

export function buildOptimizerDiagnosticActions(args: {
  diagnostics: ProposalGenerationDiagnosticsCardData | null;
  onExpandTimeWindow: () => void;
  onSwitchToDrive: () => void;
  onMoveSelectionToNextDay: () => void;
  onSelectAlternatePharmacist: () => void;
}) {
  const actions: ProposalDiagnosticsAction[] = [];
  const diagnostics = args.diagnostics;

  if (
    hasReason(diagnostics, [
      'weekday_mismatch',
      'business_holiday',
      'pharmacy_holiday',
      'pharmacy_regular_closed',
      'invalid_pharmacy_operating_window',
      'outside_pharmacy_operating_window',
      'invalid_visit_window',
      'outside_pharmacist_shift_window',
      'no_slot',
      'daily_capacity',
      'weekly_capacity',
      'locked_date_mismatch',
    ])
  ) {
    actions.push({
      label: '希望枠を09:00-18:00へ広げる',
      onClick: args.onExpandTimeWindow,
    });
    actions.push({
      label: '翌日セルへ切替',
      onClick: args.onMoveSelectionToNextDay,
      variant: 'outline',
    });
  }
  if (hasReason(diagnostics, ['travel_limit'])) {
    actions.push({
      label: '車で再評価',
      onClick: args.onSwitchToDrive,
      variant: 'outline',
    });
  }
  if (hasReason(diagnostics, ['emergency_capability', 'not_selected', 'beyond_deadline'])) {
    actions.push({
      label: '別薬剤師セルを選ぶ',
      onClick: args.onSelectAlternatePharmacist,
      variant: 'outline',
    });
  }

  return actions;
}
