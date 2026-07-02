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
      evidence: ['止まっている理由 1件'],
    });
    expect(actions.find((action) => action.key === 'report')).toMatchObject({
      primary_action: {
        operation: 'open_report',
        href: '/reports/report_1',
      },
    });
    expect(actions.find((action) => action.key === 'care_team_share')).toMatchObject({
      primary_action: {
        operation: 'review_share',
        href: '/reports/report_1/share',
      },
      href: '/reports/report_1/share',
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
        href: '/billing/candidates?billing_month=2026-04-01&patient_id=patient_1&workflow_from=visit_record&visit_record_id=record_1&schedule_id=schedule_1',
      },
    });
  });

  it('degrades billing review to needs_review without a generate affordance when billing blockers are unknown', () => {
    // 訪問準備の取得失敗で billingBlockerCount が 0 に化けても、算定レビューを ready にしない(CE02b)。
    const actions = buildPostVisitWorkflowActions({
      recordId: 'record_1',
      scheduleId: 'schedule_1',
      patientId: 'patient_1',
      soapComplete: true,
      collaborationMentioned: false,
      medicationManagementComplete: false,
      billingBlockerCount: 0,
      billingBlockersUnknown: true,
      billingCandidateCount: 0,
      billingMonth: '2026-04-01',
      careTeamContactCount: 0,
      hasNextVisitSuggestion: false,
    });

    const billingReview = actions.find((action) => action.key === 'billing_review');
    expect(billingReview?.status).toBe('needs_review');
    // 破壊的な候補生成は出さず、非破壊の確認導線のみ(件数が不確定のため)。
    expect(billingReview?.primary_action?.operation).toBe('open_billing_candidates');
    expect(billingReview?.primary_action?.operation).not.toBe('generate_billing_candidates');
    expect(billingReview?.evidence).toContain('訪問準備の取得に失敗（請求根拠は不確定）');
  });

  it('encodes dynamic path segments while keeping query identities raw', () => {
    const scheduleId = '../schedule?x=1#frag';
    const reportId = 'report/../x?download=1#frag';
    const patientId = 'patient/1?tab=team#frag';

    const actions = buildPostVisitWorkflowActions({
      recordId: 'record/1?raw=1#frag',
      scheduleId,
      patientId,
      soapComplete: false,
      collaborationMentioned: true,
      medicationManagementComplete: true,
      billingBlockerCount: 1,
      billingCandidateCount: 2,
      billingMonth: '2026-04-01',
      careTeamContactCount: 1,
      hasNextVisitSuggestion: false,
      reports: [
        {
          id: reportId,
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
          action_items: ['共有事項を確認'],
        },
      ],
    });

    const encodedScheduleHref = `/visits/${encodeURIComponent(scheduleId)}/record`;
    const encodedReportHref = `/reports/${encodeURIComponent(reportId)}`;
    const encodedReportShareHref = `/reports/${encodeURIComponent(reportId)}/share`;

    expect(actions.find((action) => action.key === 'report')).toMatchObject({
      primary_action: {
        operation: 'open_report',
        href: encodedReportHref,
      },
      href: encodedReportHref,
    });
    expect(actions.find((action) => action.key === 'care_team_share')).toMatchObject({
      primary_action: {
        operation: 'review_share',
        href: encodedReportShareHref,
      },
      href: encodedReportShareHref,
    });
    expect(actions.find((action) => action.key === 'billing_review')).toMatchObject({
      primary_action: {
        operation: 'review_billing_blockers',
        href: encodedScheduleHref,
      },
      href: encodedScheduleHref,
    });
    expect(actions.find((action) => action.key === 'next_visit')).toMatchObject({
      primary_action: {
        operation: 'edit_next_visit_suggestion',
        href: encodedScheduleHref,
      },
      href: encodedScheduleHref,
    });

    const conferenceHref = actions.find((action) => action.key === 'conference_followup')?.href;
    expect(conferenceHref).toBe(
      `/conferences?${new URLSearchParams({ patient_id: patientId }).toString()}`,
    );
    expect(new URLSearchParams(conferenceHref?.split('?')[1]).get('patient_id')).toBe(patientId);
  });

  it('keeps care-team sharing on patient collaboration when no report exists yet', () => {
    const actions = buildPostVisitWorkflowActions({
      recordId: 'record_1',
      scheduleId: 'schedule_1',
      patientId: 'patient/1?tab=team#frag',
      soapComplete: true,
      collaborationMentioned: true,
      medicationManagementComplete: true,
      billingBlockerCount: 0,
      careTeamContactCount: 1,
      hasNextVisitSuggestion: false,
      reports: [],
    });

    const expectedHref = `/patients/${encodeURIComponent('patient/1?tab=team#frag')}/collaboration`;
    expect(actions.find((action) => action.key === 'care_team_share')).toMatchObject({
      primary_action: {
        operation: 'review_share',
        href: expectedHref,
      },
      href: expectedHref,
    });
  });

  it.each(['.', '..'])('rejects exact dot-segment report id %s', (reportId) => {
    expect(() =>
      buildPostVisitWorkflowActions({
        recordId: 'record_1',
        scheduleId: 'schedule_1',
        patientId: 'patient_1',
        soapComplete: true,
        collaborationMentioned: true,
        medicationManagementComplete: true,
        billingBlockerCount: 0,
        careTeamContactCount: 1,
        hasNextVisitSuggestion: false,
        reports: [
          {
            id: reportId,
            report_type: 'physician_report',
            status: 'draft',
          },
        ],
      }),
    ).toThrow(RangeError);
  });

  it.each(['.', '..'])('rejects exact dot-segment schedule id %s', (scheduleId) => {
    expect(() =>
      buildPostVisitWorkflowActions({
        recordId: 'record_1',
        scheduleId,
        patientId: 'patient_1',
        soapComplete: false,
        collaborationMentioned: true,
        medicationManagementComplete: true,
        billingBlockerCount: 0,
        careTeamContactCount: 1,
        hasNextVisitSuggestion: false,
      }),
    ).toThrow(RangeError);
  });

  it.each(['.', '..'])('rejects exact dot-segment patient id %s for patient hrefs', (patientId) => {
    expect(() =>
      buildPostVisitWorkflowActions({
        recordId: 'record_1',
        scheduleId: 'schedule_1',
        patientId,
        soapComplete: false,
        collaborationMentioned: true,
        medicationManagementComplete: true,
        billingBlockerCount: 0,
        careTeamContactCount: 1,
        hasNextVisitSuggestion: false,
      }),
    ).toThrow(RangeError);
  });

  it('does not prompt candidate generation while billing candidates are still loading', () => {
    const actions = buildPostVisitWorkflowActions({
      recordId: 'record_1',
      scheduleId: 'schedule_1',
      patientId: 'patient_1',
      soapComplete: true,
      collaborationMentioned: false,
      medicationManagementComplete: true,
      billingBlockerCount: 0,
      billingCandidateCount: 0,
      billingCandidatesLoading: true,
      billingMonth: '2026-04-01',
      careTeamContactCount: 0,
      hasNextVisitSuggestion: false,
    });

    expect(actions.find((action) => action.key === 'billing_review')).toMatchObject({
      status: 'waiting',
      primary_action: {
        operation: 'open_billing_candidates',
        label: '請求候補を確認中',
      },
      details: expect.arrayContaining([{ label: '候補', value: '確認中', tone: 'info' }]),
      evidence: ['請求候補を読み込み中'],
    });
  });

  it('does not expose report generation when the report list fetch failed', () => {
    // soapComplete:true は通常 generate_report を提示するが、取得失敗(reportsError)時は
    // 下書きの有無が不確定なため generate を出さず安全な記録確認導線へ倒す(重複生成防止)。
    const actions = buildPostVisitWorkflowActions({
      recordId: 'record_1',
      scheduleId: 'schedule_1',
      patientId: 'patient_1',
      soapComplete: true,
      collaborationMentioned: false,
      medicationManagementComplete: true,
      billingBlockerCount: 0,
      careTeamContactCount: 0,
      hasNextVisitSuggestion: false,
      reports: [],
      reportsError: true,
    });

    const report = actions.find((action) => action.key === 'report');
    expect(report?.primary_action.operation).toBe('edit_visit_record');
    expect(report?.primary_action.operation).not.toBe('generate_report');
    expect(report?.secondary_action).toBeUndefined();
    expect(report).toMatchObject({
      status: 'needs_review',
      details: expect.arrayContaining([{ label: '報告書', value: '取得失敗', tone: 'warning' }]),
    });
    expect(report?.evidence).toContain('報告書の取得に失敗（件数・下書きは不確定）');
  });

  it('does not prompt candidate generation when billing candidates fetch failed', () => {
    // billingCandidateCount:0 は通常 generate_billing_candidates を提示するが、取得失敗時は
    // 0 が「候補なし」確定でないため生成を出さず確認画面への非破壊導線へ倒す(false-zero 生成防止)。
    const actions = buildPostVisitWorkflowActions({
      recordId: 'record_1',
      scheduleId: 'schedule_1',
      patientId: 'patient_1',
      soapComplete: true,
      collaborationMentioned: false,
      medicationManagementComplete: true,
      billingBlockerCount: 0,
      billingCandidateCount: 0,
      billingCandidatesError: true,
      billingMonth: '2026-04-01',
      careTeamContactCount: 0,
      hasNextVisitSuggestion: false,
    });

    const billing = actions.find((action) => action.key === 'billing_review');
    expect(billing?.primary_action.operation).toBe('open_billing_candidates');
    expect(billing?.primary_action.operation).not.toBe('generate_billing_candidates');
    expect(billing).toMatchObject({
      status: 'needs_review',
      details: expect.arrayContaining([{ label: '候補', value: '取得失敗', tone: 'warning' }]),
      evidence: ['請求候補の取得に失敗（件数は不確定）'],
    });
  });
});
