// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { Proposal, VisitSchedule } from '../day-view.shared';
import { WeeklyCellInspector } from './weekly-cell-inspector';

setupDomTestEnv();

vi.mock('@/components/features/visits/visit-route-preview-panel', () => ({
  VisitRoutePreviewPanel: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('@/components/features/visits/visit-proposal-diagnostics-card', () => ({
  VisitProposalDiagnosticsCard: ({
    actions,
  }: {
    actions: Array<{ label: string; onClick: () => void }>;
  }) => (
    <div>
      diagnostics-card
      {actions.map((action) => (
        <button key={action.label} onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

describe('WeeklyCellInspector', () => {
  it('renders selected cell sections and reason-aware actions', () => {
    const generateMock = vi.fn();
    const expandMock = vi.fn();
    const driveMock = vi.fn();
    const schedule: VisitSchedule = {
      id: 'schedule_1',
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: '2026-04-09',
      time_window_start: '2026-04-09T09:00:00',
      time_window_end: '2026-04-09T10:00:00',
      pharmacist_id: 'pharmacist_1',
      assignment_mode: 'primary',
      route_order: 1,
      facility_batch_id: null,
      confirmed_at: null,
      carry_items_status: 'unknown',
      case_: { patient: { id: 'patient_1', name: '患者A', residences: [] } },
      site: null,
      vehicle_resource: null,
      preparation: null,
      override_request: null,
      applied_override: null,
      facility_hint: null,
      workload_hint: {
        daily_visit_count: 1,
        urgent_visit_count: 0,
      },
      handoff_hint: null,
    };
    const proposal: Proposal = {
      id: 'proposal_1',
      case_id: 'case_2',
      visit_type: 'regular',
      priority: 'normal',
      proposal_status: 'proposed',
      patient_contact_status: 'pending',
      proposed_date: '2026-04-09',
      time_window_start: '2026-04-09T11:00:00',
      time_window_end: '2026-04-09T12:00:00',
      proposed_pharmacist_id: 'pharmacist_1',
      proposed_pharmacist: null,
      assignment_mode: 'primary',
      route_order: 2,
      route_distance_score: 1.2,
      medication_end_date: null,
      visit_deadline_date: null,
      proposal_reason: '',
      escalation_reason: null,
      finalized_schedule_id: null,
      reschedule_source_schedule_id: null,
      case_: { patient: { id: 'patient_2', name: '患者B', residences: [] } },
      site: null,
      vehicle_resource: null,
      finalized_schedule: null,
      reschedule_source_schedule: null,
      contact_logs: [],
    };

    render(
      <WeeklyCellInspector
        title="セルインスペクタ"
        description="desc"
        selectionLabel="薬剤師A / 2026-04-09"
        pharmacistOptions={[{ id: 'pharmacist_1', name: '薬剤師A', siteName: '本店' }]}
        selectedPharmacistId="pharmacist_1"
        onSelectPharmacist={vi.fn()}
        dayOptions={[{ value: '2026-04-09', label: '4/9(木)' }]}
        selectedDateKey="2026-04-09"
        onSelectDate={vi.fn()}
        travelMode="DRIVE"
        onTravelModeChange={vi.fn()}
        onMoveSelectionToNextDay={vi.fn()}
        onSelectAlternatePharmacist={vi.fn()}
        plan={null}
        points={[]}
        site={null}
        currentOrderedIds={[]}
        draftOrderedIds={[]}
        onMoveRouteItem={vi.fn()}
        onResetRouteDraft={vi.fn()}
        routeDiffCount={0}
        routeLoading={false}
        routeError={null}
        onApplyRoute={vi.fn()}
        applyRouteDisabled
        applyRoutePending={false}
        schedules={[schedule]}
        proposals={[proposal]}
        selectedCaseId="case_1"
        onGenerateForCell={generateMock}
        generateDisabled={false}
        diagnostics={{
          accepted: [],
          rejected: [
            {
              pharmacist_id: 'pharmacist_1',
              pharmacist_name: '薬剤師A',
              proposed_date: '2026-04-09',
              reason_code: 'travel_limit',
              reason_label: '移動上限超過',
              detail: '移動が重い',
            },
            {
              pharmacist_id: 'pharmacist_1',
              pharmacist_name: '薬剤師A',
              proposed_date: '2026-04-09',
              reason_code: 'no_slot',
              reason_label: '空き枠なし',
              detail: '枠がありません',
            },
          ],
        }}
        onApplyTimeExpansion={expandMock}
        onSwitchToDrive={driveMock}
      />,
    );

    expect(screen.getByText('セルインスペクタ')).toBeTruthy();
    expect(screen.getByText('選択セルのルートプレビュー')).toBeTruthy();
    expect(screen.getByText('確定予定')).toBeTruthy();
    expect(screen.getByText('未確定候補')).toBeTruthy();
    expect(screen.getByText('09:00 - 10:00')).toBeTruthy();
    expect(screen.getByText('11:00 - 12:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'このセルに提案' }));
    expect(generateMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '希望枠を09:00-18:00へ広げる' }));
    fireEvent.click(screen.getByRole('button', { name: '車で再評価' }));
    expect(expandMock).toHaveBeenCalledTimes(1);
    expect(driveMock).toHaveBeenCalledTimes(1);
  });
});
