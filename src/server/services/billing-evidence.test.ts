import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ensureHomeCareBillingSsotMock,
  buildBillingCandidateSpecsMock,
  findActiveVisitConsentMock,
  findCurrentManagementPlanMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  ensureHomeCareBillingSsotMock: vi.fn(),
  buildBillingCandidateSpecsMock: vi.fn(),
  findActiveVisitConsentMock: vi.fn(),
  findCurrentManagementPlanMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
}));

vi.mock('./home-care-billing-ssot', () => ({
  ensureHomeCareBillingSsot: ensureHomeCareBillingSsotMock,
  buildBillingCandidateSpecs: buildBillingCandidateSpecsMock,
  HOME_CARE_BILLING_RULESET_VERSION: 'home-care-ssot-registry-v2',
}));

vi.mock('./management-plans', () => ({
  findActiveVisitConsent: findActiveVisitConsentMock,
  findCurrentManagementPlan: findCurrentManagementPlanMock,
}));

vi.mock('./operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

import {
  closeBillingCandidatesForMonth,
  generateBillingCandidatesForMonth,
  getBillingCandidateWorkbenchSummary,
  upsertBillingEvidenceForVisit,
} from './billing-evidence';

describe('billing-evidence service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureHomeCareBillingSsotMock.mockResolvedValue(undefined);
    findActiveVisitConsentMock.mockResolvedValue({ id: 'consent_1' });
    findCurrentManagementPlanMock.mockResolvedValue({
      current: { id: 'plan_1' },
      reviewOverdue: false,
    });
    upsertOperationalTaskMock.mockResolvedValue(undefined);
    resolveOperationalTasksMock.mockResolvedValue(undefined);
  });

  it('skips candidate creation for unclaimable billing evidence and removes stale non-exported rows', async () => {
    const billingMonth = new Date(2026, 2, 1);
    const upsertMock = vi.fn().mockResolvedValue({ id: 'candidate_1', status: 'confirmed' });
    const deleteManyMock = vi.fn().mockResolvedValue({ count: 1 });

    buildBillingCandidateSpecsMock.mockResolvedValue([
      {
        ssotKey: 'medical.home_visit.single',
        code: 'MED_HOME_VISIT_SINGLE',
        name: '在宅患者訪問薬剤管理指導料 単一建物1人',
        status: 'confirmed',
        points: 650,
        exclusionReason: null,
        calculationBreakdown: {},
        sourceSnapshot: {},
      },
    ]);

    const tx = {
      residence: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            building_id: 'building_a',
            unit_name: '201',
          })
          .mockResolvedValueOnce({
            building_id: 'building_b',
            unit_name: null,
          }),
        count: vi
          .fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1),
      },
      billingEvidence: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'evidence_blocked',
            patient_id: 'patient_1',
            cycle_id: 'cycle_1',
            payer_basis: 'medical',
            billing_service_type: 'medical_home_visit',
            provider_scope: 'pharmacy',
            building_patient_count: 1,
            monthly_count_snapshot: 1,
            weekly_count_snapshot: 1,
            claimable: false,
            exclusion_reason: '訪問薬剤管理の有効同意がありません',
          },
          {
            id: 'evidence_ok',
            patient_id: 'patient_2',
            cycle_id: 'cycle_2',
            payer_basis: 'medical',
            billing_service_type: 'medical_home_visit',
            provider_scope: 'pharmacy',
            building_patient_count: 1,
            monthly_count_snapshot: 1,
            weekly_count_snapshot: 1,
            claimable: true,
            exclusion_reason: null,
            calculation_context: {
              building_id: 'building_b',
              unit_name: null,
              assignment_scope: 'patient',
              building_patient_count: 1,
              unit_patient_count: 1,
            },
          },
        ]),
      },
      billingRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rule_1',
            ssot_key: 'medical.home_visit.single',
          },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: upsertMock,
        deleteMany: deleteManyMock,
      },
      tracingReport: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      inquiryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const created = await generateBillingCandidatesForMonth(tx as never, {
      orgId: 'org_1',
      billingMonth,
    });

    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledTimes(1);
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      claimable: true,
      exclusionReason: null,
    }));
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source_snapshot: expect.objectContaining({
            billing_assignment: expect.objectContaining({
              building_id: 'building_b',
              unit_name: null,
              assignment_scope: 'patient',
              building_patient_count: 1,
              unit_patient_count: 1,
            }),
          }),
        }),
      })
    );
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        billing_month: billingMonth,
        evidence_id: { in: ['evidence_blocked'] },
        status: { not: 'exported' },
      },
    });
    expect(created).toHaveLength(1);
  });

  it('includes unclaimable billing evidence in blocker summary even when no billing candidates exist', async () => {
    const tx = {
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      billingEvidence: {
        findMany: vi.fn().mockResolvedValue([
          { exclusion_reason: '訪問薬剤管理の有効同意がありません' },
          { exclusion_reason: '訪問薬剤管理の有効同意がありません' },
          { exclusion_reason: '承認済み管理計画書がありません' },
        ]),
      },
    };

    const summary = await getBillingCandidateWorkbenchSummary(tx as never, {
      orgId: 'org_1',
      billingMonth: new Date('2026-03-01T00:00:00.000Z'),
    });

    expect(summary.total).toBe(0);
    expect(summary.blocked_from_close).toBe(3);
    expect(summary.blocker_reasons).toEqual([
      { reason: '訪問薬剤管理の有効同意がありません', count: 2 },
      { reason: '承認済み管理計画書がありません', count: 1 },
    ]);
  });

  it('blocks monthly close when unclaimable billing evidence remains even if no candidate is pending', async () => {
    const tx = {
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'candidate_1',
            status: 'confirmed',
            source_snapshot: null,
          },
        ]),
      },
      billingEvidence: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          { exclusion_reason: '報告書送付が未完了です' },
          { exclusion_reason: '訪問薬剤管理の有効同意がありません' },
        ]),
      },
      auditLog: {
        create: vi.fn(),
      },
    };

    const result = await closeBillingCandidatesForMonth(tx as never, {
      orgId: 'org_1',
      billingMonth: new Date(2026, 2, 1),
      actorId: 'user_1',
    });

    expect(result.blocked).toBe(true);
    expect(result.blockingCount).toBe(2);
    expect(result.summary.blocked_from_close).toBe(2);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('generates information provision and duplicate-interaction candidates with validation layers', async () => {
    const billingMonth = new Date(2026, 2, 1);
    const upsertMock = vi.fn().mockImplementation(({ create }) => Promise.resolve({
      id: create.dedupe_key,
      status: create.status,
      billing_code: create.billing_code,
      source_snapshot: create.source_snapshot,
    }));

    buildBillingCandidateSpecsMock.mockResolvedValue([]);

    const tx = {
      billingEvidence: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'evidence_medical',
            patient_id: 'patient_home',
            cycle_id: 'cycle_home',
            payer_basis: 'medical',
            billing_service_type: 'medical_home_visit',
            provider_scope: 'pharmacy',
            building_patient_count: 1,
            monthly_count_snapshot: 1,
            weekly_count_snapshot: 1,
            claimable: true,
            exclusion_reason: null,
            calculation_context: {
              building_id: 'building_a',
              unit_name: '201',
              assignment_scope: 'building',
              building_patient_count: 3,
              unit_patient_count: 1,
            },
          },
        ]),
      },
      billingRule: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'rule_info_2_i', ssot_key: 'medical.information_provision.2_medical' },
          { id: 'rule_dup_1_i', ssot_key: 'medical.home_duplicate_interaction.change_other' },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: upsertMock,
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      tracingReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'trace_1',
            patient_id: 'patient_other',
            case_id: 'case_1',
            content: { billing_fee_type: '2_i' },
            status: 'sent',
            sent_at: new Date('2026-03-15T09:00:00.000Z'),
          },
          {
            id: 'trace_2',
            patient_id: 'patient_home',
            case_id: 'case_2',
            content: { billing_fee_type: '2_i' },
            status: 'sent',
            sent_at: new Date('2026-03-16T09:00:00.000Z'),
          },
        ]),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      inquiryRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'inq_1',
            cycle_id: 'cycle_other',
            reason: '相互作用',
            result: 'changed',
            change_detail: '処方変更済み',
            cycle: { patient_id: 'patient_other' },
            issue: { category: 'interaction' },
          },
          {
            id: 'inq_2',
            cycle_id: 'cycle_other',
            reason: '相互作用',
            result: 'changed',
            change_detail:
              '訪問前提案が反映された | proposal_origin:pre_issuance | residual_adjustment:true',
            cycle: { patient_id: 'patient_other' },
            issue: { category: 'interaction' },
          },
        ]),
      },
    };

    const created = await generateBillingCandidatesForMonth(tx as never, {
      orgId: 'org_1',
      billingMonth,
    });

    expect(created).toHaveLength(4);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          billing_code: 'MED_INFO_PROVISION_2_I',
          exclusion_reason: null,
          source_snapshot: expect.objectContaining({
            validation_layers: expect.objectContaining({
              evidence: expect.objectContaining({ state: 'passed' }),
              rule_engine: expect.objectContaining({ version: 'home-care-ssot-registry-v2' }),
            }),
          }),
        }),
      })
    );
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          patient_id: 'patient_home',
          billing_code: 'MED_INFO_PROVISION_2_I',
          exclusion_reason:
            '同月に在宅患者訪問薬剤管理指導料等を算定しているため服薬情報等提供料は算定できません',
        }),
      })
    );
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          patient_id: 'patient_other',
          billing_code: 'MED_HOME_DUPLICATE_CHANGE_OTHER',
          exclusion_reason: null,
        }),
      })
    );
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          patient_id: 'patient_other',
          billing_code: 'MED_HOME_DUPLICATE_PROPOSAL_RESIDUAL',
          exclusion_reason: null,
        }),
      })
    );
  });

  it('links same-month conference candidates into billing evidence and carries conference delivery refs', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ id: 'evidence_1', claimable: true });
    const visitRecordCountMock = vi.fn().mockResolvedValue(1);
    const careReportFindManyMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'report_conf_1',
          status: 'sent',
        },
      ]);
    const deliveryRecordFindManyMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'delivery_conf_1',
          report_id: 'report_conf_1',
          status: 'sent',
        },
      ]);

    buildBillingCandidateSpecsMock.mockResolvedValue([]);

    const tx = {
      visitRecord: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'visit_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
          visit_date: new Date('2026-03-20T09:00:00.000Z'),
          outcome_status: 'completed',
          schedule: {
            cycle_id: 'cycle_1',
            case_id: 'case_1',
            pharmacist_id: 'pharm_1',
            visit_type: 'regular',
            site_id: null,
          },
        }),
        count: visitRecordCountMock,
      },
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          medical_insurance_number: 'med_1',
          care_insurance_number: null,
          birth_date: new Date('1960-01-01T00:00:00.000Z'),
          cases: [
            {
              required_visit_support: null,
            },
          ],
        }),
      },
      residence: {
        findFirst: vi.fn().mockResolvedValue({
          building_id: null,
          facility_id: null,
          facility_unit_id: null,
          facility: null,
          unit_name: null,
        }),
        count: vi.fn().mockResolvedValue(1),
      },
      careReport: {
        findMany: careReportFindManyMock,
      },
      deliveryRecord: {
        findMany: deliveryRecordFindManyMock,
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            billing_code: 'MED_INFO_PROVISION_2_HA',
            status: 'candidate',
            source_snapshot: {
              source_type: 'conference_note',
              conference_note_id: 'note_conf_1',
            },
          },
        ]),
      },
      prescriptionIntake: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      businessHoliday: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'note_conf_1',
            metadata: {
              generated_report_id: 'report_conf_1',
            },
          },
        ]),
      },
      pharmacySiteInsuranceConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingEvidence: {
        upsert: upsertMock,
      },
    };

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          conference_note_ref: 'note_conf_1',
          report_delivery_ref: 'delivery_conf_1',
          recommended_rule_keys: ['medical.information_provision.2_care_manager'],
        }),
        update: expect.objectContaining({
          conference_note_ref: 'note_conf_1',
          report_delivery_ref: 'delivery_conf_1',
          recommended_rule_keys: ['medical.information_provision.2_care_manager'],
        }),
      })
    );
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        claimable: true,
        exclusionReason: null,
      })
    );
  });

  it('counts primary residents by facility_id when building patient count is calculated', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ id: 'evidence_1', claimable: true });
    const residenceFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({
        building_id: null,
        facility_id: 'facility_1',
        facility_unit_id: null,
        facility: {
          id: 'facility_1',
          facility_type: 'nursing_home',
          total_units: null,
          units: [],
        },
        unit_name: null,
      })
      .mockResolvedValueOnce({
        building_id: null,
        unit_name: null,
      });
    const residenceCountMock = vi
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);

    buildBillingCandidateSpecsMock.mockResolvedValue([]);

    const tx = {
      visitRecord: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'visit_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
          visit_date: new Date('2026-03-20T09:00:00.000Z'),
          outcome_status: 'completed',
          schedule: {
            cycle_id: 'cycle_1',
            case_id: 'case_1',
            pharmacist_id: 'pharm_1',
            visit_type: 'regular',
            site_id: null,
          },
        }),
        count: vi.fn().mockResolvedValue(1),
      },
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          medical_insurance_number: 'med_1',
          care_insurance_number: null,
          birth_date: new Date('1960-01-01T00:00:00.000Z'),
          cases: [
            {
              required_visit_support: null,
            },
          ],
        }),
      },
      residence: {
        findFirst: residenceFindFirstMock,
        count: residenceCountMock,
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'report_1',
            status: 'sent',
          },
        ]),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'delivery_1',
            report_id: 'report_1',
            status: 'sent',
          },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      prescriptionIntake: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      businessHoliday: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      pharmacySiteInsuranceConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingEvidence: {
        upsert: upsertMock,
      },
    };

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(residenceCountMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        facility_id: 'facility_1',
        is_primary: true,
      },
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          building_patient_count: 3,
        }),
        update: expect.objectContaining({
          building_patient_count: 3,
        }),
      })
    );
  });

  it('treats pharmacy site insurance config effective_to as inclusive for the visit date', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ id: 'evidence_1', claimable: true });
    const siteConfigFindFirstMock = vi.fn().mockResolvedValue({
      id: 'site_config_1',
      config: {},
    });

    buildBillingCandidateSpecsMock.mockResolvedValue([]);

    const tx = {
      visitRecord: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'visit_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
          visit_date: new Date('2026-03-20T09:00:00.000Z'),
          outcome_status: 'completed',
          schedule: {
            cycle_id: 'cycle_1',
            patient_id: 'patient_1',
            site_id: 'site_1',
            visit_type: 'regular',
          },
          cycle: {
            id: 'cycle_1',
            patient_id: 'patient_1',
            overall_status: 'visit_completed',
          },
          patient: {
            id: 'patient_1',
            birth_date: null,
            medical_insurance_number: 'med-1',
            care_insurance_number: null,
            cases: [
              {
                required_visit_support: null,
              },
            ],
          },
        }),
        count: vi.fn().mockResolvedValue(1),
      },
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          birth_date: null,
          medical_insurance_number: 'med-1',
          care_insurance_number: null,
          cases: [
            {
              required_visit_support: {
                home_visit_intake: {
                  special_medical_procedures: ['terminal_pain'],
                },
              },
            },
          ],
        }),
      },
      residence: {
        findFirst: vi.fn().mockResolvedValue({
          building_id: 'building_a',
          unit_name: '101',
        }),
        count: vi.fn().mockResolvedValue(1),
      },
      consentRecord: {
        findFirst: vi.fn(),
      },
      managementPlan: {
        findMany: vi.fn(),
      },
      careReport: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'report_1', status: 'sent' },
        ]),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'delivery_1', report_id: 'report_1', status: 'sent' },
        ]),
      },
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      prescriptionIntake: {
        findFirst: vi.fn().mockResolvedValue({
          prescription_category: 'emergency',
          emergency_category: 'planned_disease_exacerbation',
        }),
      },
      businessHoliday: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      pharmacySiteInsuranceConfig: {
        findFirst: siteConfigFindFirstMock,
      },
      billingEvidence: {
        upsert: upsertMock,
      },
    };

    findActiveVisitConsentMock.mockResolvedValueOnce({ id: 'consent_1' });
    findCurrentManagementPlanMock.mockResolvedValueOnce({
      current: { id: 'plan_1' },
      reviewOverdue: false,
    });

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(siteConfigFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        site_id: 'site_1',
        insurance_type: 'medical',
        effective_from: { lte: new Date('2026-03-20T00:00:00.000Z') },
        OR: [{ effective_to: null }, { effective_to: { gte: new Date('2026-03-20T00:00:00.000Z') } }],
      },
      orderBy: { effective_from: 'desc' },
    });
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        emergencyCategory: 'planned_disease_exacerbation',
        afterHoursVisit: 'night',
        specialCapEligible: true,
        onlineEligible: false,
      }),
    );
  });
});
