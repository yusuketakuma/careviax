import { describe, expect, it } from 'vitest';
import {
  adaptBillingEvidenceBlockerToRiskFinding,
  adaptCareReportToRiskFinding,
  adaptConsentPlanLifecycleToRiskFindings,
  adaptDispenseTaskToRiskFinding,
  adaptNotificationToRiskFinding,
  adaptOperationalTaskToRiskFinding,
  adaptPatientMcsIntegrationToRiskFinding,
  adaptPatientFoundationItemToRiskFinding,
  adaptPrescriptionLineReconciliationToRiskFinding,
  adaptResidenceGeocodeToRiskFinding,
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

  it('maps dispense tasks into dispensing risks with encoded task hrefs', () => {
    const urgent = adaptDispenseTaskToRiskFinding(
      {
        id: 'dispense/1?x=1',
        priority: 'emergency',
        status: 'pending',
        assigned_to: 'user_1',
        due_date: new Date('2026-07-08T00:00:00.000Z'),
      },
      { patientId: 'patient_1', caseId: 'case_1', now: new Date('2026-07-06T00:00:00.000Z') },
    );
    const overdue = adaptDispenseTaskToRiskFinding(
      {
        id: 'dispense_2',
        priority: 'normal',
        status: 'in_progress',
        due_date: new Date('2026-07-01T00:00:00.000Z'),
      },
      { patientId: 'patient_1', caseId: 'case_1', now: new Date('2026-07-06T00:00:00.000Z') },
    );

    expect(urgent).toMatchObject({
      key: 'dispense_task:dispense/1?x=1',
      domain: 'dispensing',
      severity: 'urgent',
      title: '調剤・監査タスクが未完了です',
      related_entity_type: 'dispense_task',
      related_entity_id: 'dispense/1?x=1',
      action_label: '調剤タスクを確認',
    });
    expect(urgent.action_href).toBe(`/dispense?taskId=${encodeURIComponent('dispense/1?x=1')}`);
    expect(overdue).toMatchObject({
      severity: 'urgent',
      due_at: '2026-07-01T00:00:00.000Z',
    });
    expect(JSON.stringify(urgent)).not.toContain('provider raw error');
  });

  it('maps prescription line reconciliation gaps without exposing drug names', () => {
    const missingMaster = adaptPrescriptionLineReconciliationToRiskFinding(
      {
        id: 'line/1?x=1',
        drug_master_id: null,
        drug_resolution_status: 'code_not_found',
      },
      { patientId: 'patient_1', caseId: 'case_1' },
    );
    const provisional = adaptPrescriptionLineReconciliationToRiskFinding(
      {
        id: 'line_2',
        drug_master_id: 'drug_1',
        drug_resolution_status: 'ambiguous_code',
      },
      { patientId: 'patient_1', caseId: 'case_1' },
    );

    expect(missingMaster).toMatchObject({
      key: 'drug_master_reconciliation:line/1?x=1',
      domain: 'medication',
      severity: 'urgent',
      title: '薬剤マスタ照合が必要です',
      related_entity_type: 'prescription_line',
      related_entity_id: 'line/1?x=1',
      action_label: '薬剤マスタを照合',
    });
    expect(missingMaster.action_href).toBe(
      `/medications/reconciliation?line_id=${encodeURIComponent('line/1?x=1')}`,
    );
    expect(provisional).toMatchObject({
      severity: 'warning',
    });
    expect(JSON.stringify([missingMaster, provisional])).not.toContain('アムロジピン');
  });

  it('maps unread notifications without exposing persisted notification body', () => {
    const urgent = adaptNotificationToRiskFinding(
      {
        id: 'notification/1?x=1',
        type: 'urgent',
        event_type: 'medication_run_out',
        link: '/patients/patient_1',
        created_at: '2026-07-06T00:00:00.000Z',
      },
      { patientId: 'patient_1', caseId: 'case_1' },
    );
    const business = adaptNotificationToRiskFinding(
      {
        id: 'notification_2',
        type: 'business',
        event_type: 'schedule_patient_confirmation',
        link: '/patients/patient_1/visits',
        created_at: null,
      },
      { patientId: 'patient_1', caseId: 'case_1' },
    );

    expect(urgent).toMatchObject({
      key: 'notification:notification/1?x=1',
      domain: 'notification',
      severity: 'urgent',
      title: '未読の重要通知があります',
      related_entity_type: 'notification',
      related_entity_id: 'notification/1?x=1',
      due_at: '2026-07-06T00:00:00.000Z',
      action_label: '通知を確認',
    });
    expect(urgent.action_href).toBe(
      `/notifications?notification_id=${encodeURIComponent('notification/1?x=1')}`,
    );
    expect(business).toMatchObject({
      severity: 'warning',
      due_at: null,
    });
    expect(JSON.stringify([urgent, business])).not.toContain('患者 太郎');
    expect(JSON.stringify([urgent, business])).not.toContain('薬が切れそう');
  });

  it('maps residence geocode quality gaps without exposing addresses', () => {
    const zero = adaptResidenceGeocodeToRiskFinding(
      {
        id: 'residence/1',
        lat: 0,
        lng: 0,
        geocode_status: 'review_required',
        geocode_accuracy: 'low',
        updated_at: '2026-07-06T00:00:00.000Z',
      },
      { patientId: 'patient/1?x=1', caseId: 'case_1' },
    );
    const valid = adaptResidenceGeocodeToRiskFinding(
      {
        id: 'residence_2',
        lat: 35.681236,
        lng: 139.767125,
        geocode_status: 'resolved',
        geocode_accuracy: 'high',
      },
      { patientId: 'patient_1', caseId: 'case_1' },
    );
    const missing = adaptResidenceGeocodeToRiskFinding(
      {
        id: 'residence_3',
        lat: null,
        lng: 139.767125,
        geocode_status: null,
        geocode_accuracy: null,
      },
      { patientId: 'patient_1', caseId: 'case_1' },
    );

    expect(zero).toMatchObject({
      key: 'residence_geocode:residence/1:zero_coordinates',
      domain: 'data_quality',
      severity: 'urgent',
      title: '患者住所に仮座標が残っています',
      related_entity_type: 'residence',
      related_entity_id: 'residence/1',
      due_at: '2026-07-06T00:00:00.000Z',
      action_label: '住所座標を確認',
    });
    expect(zero?.action_href).toBe(
      `/patients/${encodeURIComponent('patient/1?x=1')}/edit?section=visit#intake.address`,
    );
    expect(valid).toBeNull();
    expect(missing).toMatchObject({
      key: 'residence_geocode:residence_3:missing_coordinates',
      severity: 'warning',
    });
    expect(JSON.stringify([zero, missing])).not.toContain('東京都千代田区');
  });

  it('maps patient MCS sync failures without exposing provider errors or external URLs', () => {
    const failed = adaptPatientMcsIntegrationToRiskFinding(
      {
        id: 'mcs/1?x=1',
        last_sync_status: 'failed',
        last_sync_attempt_at: '2026-07-06T00:00:00.000Z',
        last_synced_at: null,
        updated_at: '2026-07-05T00:00:00.000Z',
      },
      { patientId: 'patient/1?x=1', caseId: 'case_1' },
    );
    const transient = adaptPatientMcsIntegrationToRiskFinding(
      {
        id: 'mcs_2',
        last_sync_status: 'failed',
        last_sync_attempt_at: '2026-07-06T00:00:00.000Z',
        last_synced_at: '2026-07-01T00:00:00.000Z',
      },
      { patientId: 'patient_1', caseId: 'case_1' },
    );
    const success = adaptPatientMcsIntegrationToRiskFinding(
      {
        id: 'mcs_3',
        last_sync_status: 'success',
        last_sync_attempt_at: '2026-07-06T00:00:00.000Z',
        last_synced_at: '2026-07-06T00:00:00.000Z',
      },
      { patientId: 'patient_1', caseId: 'case_1' },
    );

    expect(failed).toMatchObject({
      key: 'patient_mcs_sync:mcs/1?x=1',
      domain: 'integration',
      severity: 'urgent',
      title: 'MCS連携の同期確認が必要です',
      related_entity_type: 'patient_mcs_link',
      related_entity_id: 'mcs/1?x=1',
      due_at: '2026-07-06T00:00:00.000Z',
      action_label: 'MCS連携を確認',
    });
    expect(failed?.action_href).toBe(`/patients/${encodeURIComponent('patient/1?x=1')}/mcs`);
    expect(transient).toMatchObject({
      severity: 'warning',
    });
    expect(success).toBeNull();
    expect(JSON.stringify([failed, transient])).not.toContain('medical-care.net');
    expect(JSON.stringify([failed, transient])).not.toContain('provider error');
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
