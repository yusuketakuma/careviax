// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProposalHumanDecisionFlow } from './proposal-human-decision-flow';
import type { Proposal } from './day-view.shared';

function buildProposal(overrides?: Partial<Proposal>): Proposal {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'patient_contact_pending',
    patient_contact_status: 'attempted',
    proposed_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    proposed_pharmacist_id: 'pharmacist_1',
    proposed_pharmacist: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: 1,
    route_distance_score: 1.4,
    medication_end_date: '2026-04-10',
    visit_deadline_date: '2026-04-09',
    proposal_reason: '担当薬剤師優先 / 服薬期限内',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
      },
    },
    site: {
      id: 'site_1',
      name: '本店',
      address: '東京都千代田区2-2-2',
      lat: 35.0,
      lng: 139.0,
    },
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
    ...overrides,
  };
}

describe('ProposalHumanDecisionFlow', () => {
  it('surfaces the current phone confirmation action before finalization', () => {
    render(<ProposalHumanDecisionFlow proposal={buildProposal()} />);

    expect(screen.getByText('今やること')).toBeTruthy();
    expect(screen.getAllByText('患者電話確認').length).toBeGreaterThan(0);
    expect(screen.getByText('電話確認が必要')).toBeTruthy();
    expect(
      screen.getByText('患者へ電話し、結果を「確認済み」で保存すると日時確定できます。'),
    ).toBeTruthy();
  });

  it('shows fallback escalation as the visit assignment decision', () => {
    render(
      <ProposalHumanDecisionFlow
        proposal={buildProposal({
          assignment_mode: 'fallback',
          escalation_reason: '担当薬剤師が公休のため、薬剤師Bへ代替提案しました。',
        })}
      />,
    );

    expect(screen.getByText('代替薬剤師へエスカレーション')).toBeTruthy();
    expect(screen.getByText('代替薬剤師')).toBeTruthy();
    expect(screen.getByText('担当薬剤師が公休のため、薬剤師Bへ代替提案しました。')).toBeTruthy();
  });

  it('keeps change-requested proposals actionable for reproposal', () => {
    render(
      <ProposalHumanDecisionFlow
        proposal={buildProposal({
          proposal_status: 'reschedule_pending',
          patient_contact_status: 'change_requested',
        })}
      />,
    );

    expect(screen.getByText('変更希望')).toBeTruthy();
    expect(screen.getByText('再提案が必要')).toBeTruthy();
    expect(
      screen.getByText('患者から変更希望があります。希望条件に合わせて再提案してください。'),
    ).toBeTruthy();
    expect(
      screen.queryByText('この候補は終了しています。必要な場合は条件を変えて再提案してください。'),
    ).toBeNull();
  });
});
