import { describe, expect, it } from 'vitest';
import {
  adaptBillingEvidenceBlockerToRiskFinding,
  adaptCareReportToRiskFinding,
  adaptConsentPlanLifecycleToRiskFindings,
  adaptOperationalTaskToRiskFinding,
  adaptPatientFoundationItemToRiskFinding,
  adaptUpcomingVisitPreparationToRiskFindings,
  adaptVisitReadyTransitionBlockersToRiskFindings,
  riskFindingToTaskDedupeKey,
} from './risk-finding-registry';

describe('risk-finding-registry adapters', () => {
  it('maps every billing blocker key without leaking raw reason text', () => {
    const keys = [
      'missing_visit_consent',
      'missing_management_plan',
      'management_plan_review_overdue',
      'initial_home_visit_assessment_missing',
      'report_delivery_incomplete',
      'care_certification_pending',
      'public_subsidy_application_pending',
      'qr_insurance_review_pending',
      'outcome_not_claimable',
    ] as const;

    const findings = keys.map((key) =>
      adaptBillingEvidenceBlockerToRiskFinding(
        {
          key,
          reason: '患者 山田花子 東京都千代田区1-1-1 アムロジピン provider raw error',
          action_href: '/billing?patient_id=patient_1',
          action_label: '算定を確認',
          severity: key === 'missing_visit_consent' ? 'urgent' : 'high',
        },
        { patientId: 'patient_1', caseId: 'case_1', billingEvidenceId: 'bill_1' },
      ),
    );

    expect(findings).toHaveLength(keys.length);
    expect(findings.map((finding) => finding.key)).toContain(
      'billing:bill_1:missing_visit_consent',
    );
    expect(JSON.stringify(findings)).not.toContain('山田花子');
    expect(JSON.stringify(findings)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(findings)).not.toContain('アムロジピン');
    expect(JSON.stringify(findings)).not.toContain('provider raw error');
    expect(findings[0]).toMatchObject({
      domain: 'billing',
      severity: 'urgent',
      related_entity_type: 'billing_evidence',
      related_entity_id: 'bill_1',
    });
  });

  it('splits visit ready blockers into preparation, foundation, consent-plan, and billing domains', () => {
    const findings = adaptVisitReadyTransitionBlockersToRiskFindings(
      {
        readiness_blockers: ['持参薬・物品確認'],
        onboarding_blockers: [
          { key: 'consent_obtained', label: '同意未取得' },
          { key: 'primary_physician_set', label: '主治医未設定' },
        ],
        billing_blockers: [
          {
            evidence_id: 'bill_1',
            visit_record_id: 'record_1',
            key: 'report_delivery_incomplete',
            reason: '報告書本文 raw text',
            action_href: '/billing',
            action_label: '算定確認',
            severity: 'high',
          },
        ],
      },
      {
        patientId: 'patient/1?x=1',
        caseId: 'case_1',
        scheduleId: 'schedule/1',
        dueAt: '2026-07-07T00:00:00.000Z',
      },
    );

    expect(findings.map((finding) => finding.domain)).toEqual([
      'visit_preparation',
      'consent_plan',
      'patient_foundation',
      'billing',
    ]);
    expect(findings[0]?.key).toBe('visit_ready:readiness:carry_items_confirmed');
    expect(findings.every((finding) => finding.action_href.startsWith('/'))).toBe(true);
    expect(JSON.stringify(findings)).toContain(encodeURIComponent('schedule/1'));
    expect(JSON.stringify(findings)).toContain(encodeURIComponent('patient/1?x=1'));
    expect(JSON.stringify(findings)).not.toContain('報告書本文 raw text');
  });

  it('uses synthetic stable keys for carry-status and missing-schedule readiness labels', () => {
    const findings = adaptVisitReadyTransitionBlockersToRiskFindings({
      readiness_blockers: ['持参物ステータス未解決', '訪問予定が見つかりません'],
      onboarding_blockers: [],
      billing_blockers: [],
    });

    expect(findings.map((finding) => finding.key)).toEqual([
      'visit_ready:readiness:carry_items_status',
      'visit_ready:readiness:schedule_missing',
    ]);
  });

  it('fails closed for unknown readiness labels without leaking them into keys or actions', () => {
    const findings = adaptVisitReadyTransitionBlockersToRiskFindings({
      readiness_blockers: ['患者 山田花子 東京都千代田区1-1-1 アムロジピン確認'],
      onboarding_blockers: [],
      billing_blockers: [],
    });
    const finding = findings[0];

    expect(finding).toMatchObject({
      key: 'visit_ready:readiness:unknown_readiness_blocker_1',
      action_label: '訪問準備を確認',
    });
    expect(JSON.stringify(findings)).not.toContain('山田花子');
    expect(JSON.stringify(findings)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(findings)).not.toContain('アムロジピン');
    expect(riskFindingToTaskDedupeKey(finding!)).not.toContain('山田花子');
    expect(riskFindingToTaskDedupeKey(finding!)).not.toContain(encodeURIComponent('山田花子'));
  });

  it('maps patient foundation items without leaking meta staff names or raw detail', () => {
    const finding = adaptPatientFoundationItemToRiskFinding(
      {
        key: 'contact',
        label: '連絡先',
        status: 'missing',
        detail: '電話 090-1234-5678 住所 東京都千代田区1-1-1',
        action_href: '/patients/patient_1#patient-foundation',
        action_label: '基盤を確認',
        meta: {
          updated_at: '2026-07-01T00:00:00.000Z',
          updated_by_name: '職員 太郎',
          source: 'manual',
          confirmed_at: null,
          confirmed_by_name: null,
          confirmation_status: 'unconfirmed',
          confirmation_detail: '未確認',
          stale: false,
        },
      },
      { patientId: 'patient_1' },
    );

    expect(finding).toMatchObject({
      key: 'patient_foundation:contact',
      domain: 'patient_foundation',
      severity: 'blocking',
      resolution_state: 'open',
    });
    expect(JSON.stringify(finding)).not.toContain('090-1234-5678');
    expect(JSON.stringify(finding)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(finding)).not.toContain('職員 太郎');
  });

  it('maps consent plan lifecycle findings using Japan business dates', () => {
    const findings = adaptConsentPlanLifecycleToRiskFindings(
      {
        consent: null,
        managementPlan: {
          id: 'plan_1',
          next_review_date: new Date('2026-07-05T00:00:00.000Z'),
        },
        firstVisitDocument: { id: 'doc_1', delivered_at: null },
        now: new Date('2026-07-05T15:30:00.000Z'),
      },
      {
        patientId: 'patient/1?x=1',
        caseId: 'case_1',
        patientHref: `/patients/${encodeURIComponent('patient/1?x=1')}`,
      },
    );

    expect(findings.map((finding) => finding.key)).toEqual([
      'missing_visit_consent',
      'management_plan_review_overdue',
      'first_visit_document_not_delivered',
    ]);
    expect(findings[0]).toMatchObject({
      domain: 'consent_plan',
      severity: 'blocking',
      related_entity_type: 'consent_record',
      related_entity_id: null,
      action_label: '同意を整備',
    });
    expect(findings[1]).toMatchObject({
      related_entity_type: 'management_plan',
      related_entity_id: 'plan_1',
      due_at: '2026-07-05T00:00:00.000Z',
      action_label: '計画書を見直す',
    });
    expect(findings[2]).toMatchObject({
      domain: 'patient_foundation',
      severity: 'warning',
      related_entity_type: 'first_visit_document',
      related_entity_id: 'doc_1',
      action_label: '患者正本を確認',
    });
    expect(JSON.stringify(findings)).toContain(encodeURIComponent('patient/1?x=1'));
  });

  it('maps care report delivery states with controlled text and encoded hrefs', () => {
    const failed = adaptCareReportToRiskFinding(
      { id: 'report/1?x=1', status: 'failed' },
      { patientId: 'patient_1', caseId: 'case_1' },
    );
    const waiting = adaptCareReportToRiskFinding(
      { id: 'report_2', status: 'response_waiting' },
      { patientId: 'patient_1', caseId: 'case_1' },
    );
    const sent = adaptCareReportToRiskFinding(
      { id: 'report_3', status: 'sent' },
      { patientId: 'patient_1', caseId: 'case_1' },
    );

    expect(failed).toMatchObject({
      key: 'report_delivery_failed:report/1?x=1',
      domain: 'report_delivery',
      severity: 'urgent',
      related_entity_type: 'care_report',
      related_entity_id: 'report/1?x=1',
      action_label: '報告書を確認',
    });
    expect(failed?.action_href).toBe(`/reports/${encodeURIComponent('report/1?x=1')}`);
    expect(waiting).toMatchObject({
      key: 'report_response_waiting:report_2',
      domain: 'report_delivery',
      severity: 'warning',
      action_label: '返信状況を確認',
    });
    expect(sent).toBeNull();
  });

  it('maps upcoming visit preparation states without leaking schedule labels', () => {
    const noSchedule = adaptUpcomingVisitPreparationToRiskFindings(null, {
      patientId: 'patient/1?x=1',
      caseId: 'case_1',
      patientHref: `/patients/${encodeURIComponent('patient/1?x=1')}`,
    });
    const blockedAndIncomplete = adaptUpcomingVisitPreparationToRiskFindings(
      {
        id: 'schedule/1?x=1',
        scheduled_date: new Date('2026-07-07T00:00:00.000Z'),
        carry_items_status: 'blocked',
        preparation: {
          id: 'prep_1',
          medication_changes_reviewed: false,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: false,
        },
      },
      { patientId: 'patient_1', caseId: 'case_1' },
    );

    expect(noSchedule).toEqual([
      expect.objectContaining({
        key: 'no_upcoming_visit_schedule',
        domain: 'visit_preparation',
        severity: 'info',
        action_href: `/patients/${encodeURIComponent('patient/1?x=1')}?tab=visits`,
      }),
    ]);
    expect(blockedAndIncomplete.map((finding) => finding.key)).toEqual([
      'visit_carry_items_blocked:schedule/1?x=1',
      'visit_preparation_incomplete:schedule/1?x=1',
    ]);
    expect(blockedAndIncomplete[0]?.action_href).toBe(
      `/visits/${encodeURIComponent('schedule/1?x=1')}/preparation`,
    );
    expect(blockedAndIncomplete[1]).toMatchObject({
      related_entity_type: 'visit_preparation',
      related_entity_id: 'prep_1',
      due_at: '2026-07-07T00:00:00.000Z',
      action_label: '未完了チェックを確認',
    });
  });

  it('keeps patient foundation task dedupe keys distinct per patient', () => {
    const baseItem = {
      key: 'contact',
      label: '連絡先',
      status: 'missing',
      detail: 'raw detail',
      action_href: '/patients/patient_1#patient-foundation',
      action_label: '基盤を確認',
      meta: null,
    } as const;
    const patient1 = adaptPatientFoundationItemToRiskFinding(baseItem, { patientId: 'patient_1' });
    const patient1Again = adaptPatientFoundationItemToRiskFinding(baseItem, {
      patientId: 'patient_1',
    });
    const patient2 = adaptPatientFoundationItemToRiskFinding(
      { ...baseItem, action_href: '/patients/patient_2#patient-foundation' },
      { patientId: 'patient_2' },
    );

    expect(riskFindingToTaskDedupeKey(patient1)).toBe(riskFindingToTaskDedupeKey(patient1Again));
    expect(riskFindingToTaskDedupeKey(patient1)).not.toBe(riskFindingToTaskDedupeKey(patient2));
  });

  it('maps operational tasks using controlled presentation labels and stable dedupe keys', () => {
    const finding = adaptOperationalTaskToRiskFinding(
      {
        id: 'task/1',
        task_type: 'patient_foundation_review',
        title: '患者 山田花子 raw task title',
        priority: 'urgent',
        status: 'pending',
        assigned_to: 'user_1',
        due_date: new Date('2026-07-05T00:00:00.000Z'),
        sla_due_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient/1?x=1',
      },
      { patientId: 'patient/1?x=1', now: new Date('2026-07-06T00:00:00.000Z') },
    );

    expect(finding).toMatchObject({
      key: 'task:task/1',
      domain: 'task_sla',
      severity: 'urgent',
      title: '正本確認タスク',
      action_label: '患者基盤を整備',
      related_entity_type: 'task',
      related_entity_id: 'task/1',
      source: 'manual',
    });
    expect(finding.action_href).toContain(encodeURIComponent('patient/1?x=1'));
    expect(JSON.stringify(finding)).not.toContain('山田花子');
    expect(riskFindingToTaskDedupeKey(finding)).toBe(
      'risk:task_sla:task%3Atask%2F1:patient:patient%2F1%3Fx%3D1:task:task%2F1',
    );
  });
});
