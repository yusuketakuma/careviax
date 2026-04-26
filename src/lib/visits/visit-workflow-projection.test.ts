import { describe, expect, it } from 'vitest';
import {
  buildConferenceReportLines,
  buildPostVisitWorkflowActions,
  extractConferenceProposalOrigin,
} from './visit-workflow-projection';

describe('visit-workflow-projection', () => {
  it('detects conference-derived proposal origins', () => {
    expect(extractConferenceProposalOrigin('conference-visit-proposal:note_1')).toMatchObject({
      label: '会議由来',
    });
    expect(extractConferenceProposalOrigin('conference-recurrence-proposal:note_1')).toMatchObject({
      label: '会議後の継続訪問',
    });
    expect(extractConferenceProposalOrigin('cadence:auto')).toBeNull();
  });

  it('builds report lines from conference handoff context', () => {
    expect(
      buildConferenceReportLines([
        {
          id: 'note_1',
          note_type: 'pre_discharge',
          title: '退院前共有',
          conference_date: '2026-04-20T00:00:00.000Z',
          highlights: ['退院後の服薬支援を薬局で確認'],
          action_items: ['残薬を初回訪問で確認'],
        },
      ]),
    ).toEqual([
      '退院前カンファ: 退院前共有 / 退院後の服薬支援を薬局で確認',
      '退院前カンファ: 退院前共有 / 合意事項: 残薬を初回訪問で確認',
    ]);
  });

  it('projects one visit record into post-visit workflow actions', () => {
    const actions = buildPostVisitWorkflowActions({
      recordId: 'record_1',
      scheduleId: 'schedule_1',
      patientId: 'patient_1',
      soapComplete: true,
      collaborationMentioned: true,
      medicationManagementComplete: false,
      missingMedicationManagementLabels: ['副作用確認'],
      billingBlockerCount: 1,
      billingBlockers: [
        {
          reason: '同意未取得',
          action_href: '/visits/schedule_1/record',
          action_label: '同意を確認',
        },
      ],
      billingCandidateCount: 0,
      billingMonth: '2026-04-01',
      careTeamContactCount: 2,
      hasNextVisitSuggestion: true,
      nextVisitSuggestionDate: '2026-05-01',
      reports: [
        {
          id: 'report_1',
          report_type: 'physician_report',
          status: 'draft',
        },
      ],
      conferenceContext: [
        {
          id: 'note_1',
          note_type: 'service_manager',
          title: '担当者会議',
          conference_date: '2026-04-20T00:00:00.000Z',
          action_items: ['服薬カレンダーを見直す'],
        },
      ],
    });

    expect(actions.map((action) => action.key)).toEqual([
      'report',
      'care_team_share',
      'billing_review',
      'next_visit',
      'conference_followup',
    ]);
    expect(actions.find((action) => action.key === 'billing_review')).toMatchObject({
      status: 'blocked',
      primary_action: {
        operation: 'review_billing_blockers',
        label: '同意を確認',
        href: '/visits/schedule_1/record',
      },
      evidence: ['ブロッカー 1件'],
    });
    expect(actions.find((action) => action.key === 'report')).toMatchObject({
      primary_action: {
        operation: 'open_report',
        href: '/reports/report_1',
      },
    });
    expect(actions.find((action) => action.key === 'next_visit')).toMatchObject({
      primary_action: {
        operation: 'create_next_visit',
      },
      details: [{ label: '提案日', value: '2026-05-01', tone: 'info' }],
    });
    expect(actions.find((action) => action.key === 'conference_followup')).toMatchObject({
      status: 'needs_review',
      primary_action: {
        operation: 'open_conference',
        href: '/conferences?patient_id=patient_1',
      },
      evidence: expect.arrayContaining(['合意事項 1件']),
    });
  });

  it('keeps billing confirmation on the monthly workbench after candidate generation', () => {
    const actions = buildPostVisitWorkflowActions({
      recordId: 'record_1',
      scheduleId: 'schedule_1',
      patientId: 'patient_1',
      soapComplete: true,
      collaborationMentioned: false,
      medicationManagementComplete: true,
      billingBlockerCount: 0,
      billingCandidateCount: 2,
      billingMonth: '2026-04-01',
      careTeamContactCount: 0,
      hasNextVisitSuggestion: false,
    });

    expect(actions.find((action) => action.key === 'billing_review')).toMatchObject({
      primary_action: {
        operation: 'open_billing_candidates',
        label: '請求候補を確認',
        href: '/billing/candidates?billing_month=2026-04-01&patient_id=patient_1',
      },
    });
  });
});
