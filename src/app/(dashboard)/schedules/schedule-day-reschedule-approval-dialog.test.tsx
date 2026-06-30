// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { Proposal, VisitSchedule } from './day-view.shared';
import {
  buildScheduleDayRescheduleApprovalTargetFromProposal,
  buildScheduleDayRescheduleApprovalTargetFromSchedule,
  ScheduleDayRescheduleApprovalDialog,
  type ScheduleDayRescheduleApprovalTarget,
} from './schedule-day-reschedule-approval-dialog';

setupDomTestEnv();

function schedule(overrides: Partial<VisitSchedule> = {}): VisitSchedule {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    carry_items_status: 'ready',
    scheduled_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 1,
    facility_batch_id: null,
    confirmed_at: '2026-04-08T03:00:00.000Z',
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1' }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都千代田区2-2-2' },
    vehicle_resource: null,
    preparation: null,
    override_request: {
      id: 'override_1',
      status: 'pending',
      reason: '緊急訪問が割り込んだため',
      requested_at: '2026-04-09T07:00:00.000Z',
      approved_at: null,
      approved_by: null,
      impact_summary: {
        impacted_schedule_count: 2,
        proposed_replacements: 1,
        impacted_patient_names: ['佐藤太郎', '鈴木花子'],
      },
    },
    applied_override: null,
    facility_hint: null,
    workload_hint: { daily_visit_count: 1, urgent_visit_count: 0 },
    handoff_hint: null,
    ...overrides,
  };
}

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'reschedule_pending',
    patient_contact_status: 'pending',
    proposed_date: '2026-04-10',
    time_window_start: '2026-04-10T13:00:00.000Z',
    time_window_end: '2026-04-10T14:00:00.000Z',
    proposed_pharmacist_id: 'pharmacist_1',
    proposed_pharmacist: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: 1,
    route_distance_score: 1.4,
    updated_at: '2026-04-09T08:00:00.000Z',
    medication_end_date: '2026-04-12',
    visit_deadline_date: '2026-04-11',
    proposal_reason: '緊急訪問が割り込んだため / 再提案',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: 'schedule_1',
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1' }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都千代田区2-2-2' },
    vehicle_resource: null,
    finalized_schedule: null,
    reschedule_source_schedule: {
      id: 'schedule_1',
      scheduled_date: '2026-04-09',
      pharmacist_id: 'pharmacist_1',
      override_request: {
        status: 'pending',
        impact_summary: {
          impacted_schedule_count: 2,
          proposed_replacements: 1,
          impacted_patient_names: ['佐藤太郎'],
        },
      },
    },
    contact_logs: [],
    ...overrides,
  };
}

function target(overrides: Partial<ScheduleDayRescheduleApprovalTarget> = {}) {
  return {
    scheduleId: 'schedule_1',
    sourceLabel: '確定予定',
    patientName: '山田花子',
    currentScheduleLabel: '2026/04/09(木) 18:00 - 19:00',
    proposedScheduleLabel: null,
    reason: '緊急訪問が割り込んだため',
    impactCount: 2,
    proposedReplacementCount: 1,
    impactedPatientNames: ['佐藤太郎', '鈴木花子'],
    medicationSummary: [],
    ...overrides,
  };
}

function expectTextExcludesSensitiveDetails(text: string | null | undefined) {
  expect(text ?? '').not.toContain('アムロジピン');
  expect(text ?? '').not.toContain('処方詳細');
  expect(text ?? '').not.toContain('09:00-12:00');
}

describe('ScheduleDayRescheduleApprovalDialog', () => {
  it('builds confirmation target details from a confirmed schedule', () => {
    const result = buildScheduleDayRescheduleApprovalTargetFromSchedule(schedule(), '確定予定');

    expect(result.scheduleId).toBe('schedule_1');
    expect(result.patientName).toBe('山田花子');
    expect(result.sourceLabel).toBe('確定予定');
    expect(result.reason).toBe('緊急訪問が割り込んだため');
    expect(result.impactCount).toBe(2);
    expect(result.proposedReplacementCount).toBe(1);
    expect(result.impactedPatientNames).toEqual(['佐藤太郎', '鈴木花子']);
  });

  it('builds confirmation target details from a reschedule proposal', () => {
    const result = buildScheduleDayRescheduleApprovalTargetFromProposal(proposal());

    expect(result).toMatchObject({
      scheduleId: 'schedule_1',
      sourceLabel: '候補一覧',
      patientName: '山田花子',
      reason: '緊急訪問が割り込んだため / 再提案',
      impactCount: 2,
      proposedReplacementCount: 1,
      impactedPatientNames: ['佐藤太郎'],
    });
    expect(result?.proposedScheduleLabel).toContain('2026/04/10');
    expect(result?.medicationSummary).toEqual([
      { label: '服薬最終日', value: '2026/04/12' },
      { label: '開始日前配薬', value: '2026/04/11までの候補' },
      { label: '薬剤根拠', value: '候補理由に根拠未記録' },
      { label: 'ルート', value: '順路 1' },
    ]);
  });

  it('separates prescription-sensitive proposal reasons into a safe medication summary', () => {
    const result = buildScheduleDayRescheduleApprovalTargetFromProposal(
      proposal({
        medication_end_date: '2026-04-10',
        proposal_reason:
          '緊急訪問が割り込んだため / アムロジピン増量 / 処方詳細 変更 / 患者条件 09:00-12:00',
      }),
    );

    expect(result?.reason).toBe('緊急訪問が割り込んだため');
    expect(result?.medicationSummary).toEqual([
      { label: '服薬最終日', value: '2026/04/10' },
      { label: '開始日前配薬', value: '2026/04/11までの候補' },
      { label: '薬剤根拠', value: '候補理由に根拠あり' },
      { label: 'ルート', value: '患者希望枠で順路 1' },
    ]);

    render(
      <ScheduleDayRescheduleApprovalDialog
        target={result}
        approving={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('薬剤判断: 服薬最終日')).toBeTruthy();
    expect(screen.getByText('2026/04/10')).toBeTruthy();
    expect(screen.getByText('薬剤判断: 開始日前配薬')).toBeTruthy();
    expect(screen.getByText('2026/04/11までの候補')).toBeTruthy();
    expect(screen.getByText('薬剤判断: 薬剤根拠')).toBeTruthy();
    expect(screen.getByText('候補理由に根拠あり')).toBeTruthy();
    expectTextExcludesSensitiveDetails(screen.getByRole('dialog').textContent);
  });

  it('does not build a proposal target without a source schedule id', () => {
    expect(
      buildScheduleDayRescheduleApprovalTargetFromProposal(
        proposal({ reschedule_source_schedule_id: null }),
      ),
    ).toBeNull();
  });

  it('shows the confirmation details and only confirms from the final button', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ScheduleDayRescheduleApprovalDialog
        target={target()}
        approving={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('山田花子さんの確定済み訪問を変更します')).toBeTruthy();
    expect(screen.getByText('緊急訪問が割り込んだため')).toBeTruthy();
    expect(screen.getByText('影響予定 2 件 / 再提案候補 1 件')).toBeTruthy();
    expect(screen.getByText('佐藤太郎、鈴木花子')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '山田花子さんの変更を承認' }));
    expect(onConfirm).toHaveBeenCalledWith('schedule_1');
  });

  it('cancels and disables the final approval while pending', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ScheduleDayRescheduleApprovalDialog
        target={target()}
        approving
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    const finalButton = screen.getByRole<HTMLButtonElement>('button', { name: '承認中...' });
    expect(finalButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
