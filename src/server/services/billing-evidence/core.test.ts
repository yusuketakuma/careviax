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

vi.mock('../home-care-billing-ssot', () => ({
  ensureHomeCareBillingSsot: ensureHomeCareBillingSsotMock,
  buildBillingCandidateSpecs: buildBillingCandidateSpecsMock,
  HOME_CARE_BILLING_RULESET_VERSION: 'home-care-ssot-registry-v2',
}));

vi.mock('../management-plans', () => ({
  findActiveVisitConsent: findActiveVisitConsentMock,
  findCurrentManagementPlan: findCurrentManagementPlanMock,
}));

vi.mock('../operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

import { upsertBillingEvidenceForVisit } from './core';

// ── Test Helpers ──

function makeVisitRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'visit_1',
    org_id: 'org_1',
    patient_id: 'patient_1',
    visit_date: new Date('2026-03-20T10:00:00.000Z'),
    outcome_status: 'completed',
    schedule: {
      cycle_id: 'cycle_1',
      case_id: 'case_1',
      pharmacist_id: 'pharm_1',
      visit_type: 'regular',
      site_id: null,
    },
    ...overrides,
  };
}

function makePatient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'patient_1',
    medical_insurance_number: 'med_1',
    care_insurance_number: null,
    birth_date: new Date('1960-01-01T00:00:00.000Z'),
    cases: [{ required_visit_support: null }],
    ...overrides,
  };
}

function makeTx(overrides: Record<string, unknown> = {}) {
  const baseTx = {
    visitRecord: {
      findFirst: vi.fn().mockResolvedValue(makeVisitRecord()),
      count: vi.fn().mockResolvedValue(1),
    },
    patient: {
      findFirst: vi.fn().mockResolvedValue(makePatient()),
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
      findMany: vi.fn().mockResolvedValue([{ id: 'report_1', status: 'sent' }]),
    },
    deliveryRecord: {
      findMany: vi.fn().mockResolvedValue([{ id: 'delivery_1', report_id: 'report_1', status: 'sent' }]),
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
      upsert: vi.fn().mockResolvedValue({ id: 'evidence_1', claimable: true }),
    },
    patientInsurance: {
      // Default: medical insurance present (matching makePatient's medical_insurance_number)
      findFirst: vi.fn().mockImplementation(
        ({ where }: { where: { insurance_type: string } }) =>
          Promise.resolve(
            where?.insurance_type === 'medical'
              ? { id: 'ins_1', number: 'med_1', insurance_type: 'medical', is_active: true }
              : null,
          ),
      ),
    },
  };

  // Deep merge overrides
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'object' && value !== null && key in baseTx) {
      (baseTx as Record<string, unknown>)[key] = {
        ...(baseTx as Record<string, Record<string, unknown>>)[key],
        ...(value as Record<string, unknown>),
      };
    } else {
      (baseTx as Record<string, unknown>)[key] = value;
    }
  }

  return baseTx;
}

describe('billing-evidence/core: upsertBillingEvidenceForVisit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureHomeCareBillingSsotMock.mockResolvedValue(undefined);
    buildBillingCandidateSpecsMock.mockResolvedValue([]);
    findActiveVisitConsentMock.mockResolvedValue({ id: 'consent_1' });
    findCurrentManagementPlanMock.mockResolvedValue({
      current: { id: 'plan_1' },
      reviewOverdue: false,
    });
    upsertOperationalTaskMock.mockResolvedValue(undefined);
    resolveOperationalTasksMock.mockResolvedValue(undefined);
  });

  // ── 1. Normal visit → generates BillingEvidence + BillingCandidates ──
  it('generates billing evidence with claimable=true for a normal visit', async () => {
    const tx = makeTx();

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: true,
          exclusion_reason: null,
          validation_notes: '同意・管理計画書・報告送付を満たしています',
        }),
      }),
    );
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ status: 'completed' }),
    );
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        claimable: true,
        exclusionReason: null,
      }),
    );
  });

  // ── 2. Missing visit consent → blocker ──
  it('sets claimable=false with missing_visit_consent blocker', async () => {
    findActiveVisitConsentMock.mockResolvedValue(null);
    const tx = makeTx();

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: false,
          exclusion_reason: '訪問薬剤管理の有効同意がありません',
        }),
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalled();
  });

  // ── 3. Missing management plan → blocker ──
  it('sets claimable=false with missing_management_plan blocker', async () => {
    findCurrentManagementPlanMock.mockResolvedValue({
      current: null,
      reviewOverdue: false,
    });
    const tx = makeTx();

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: false,
          exclusion_reason: '承認済み管理計画書がありません',
        }),
      }),
    );
  });

  // ── 4. Management plan review overdue → blocker ──
  it('sets claimable=false when management plan review is overdue', async () => {
    findCurrentManagementPlanMock.mockResolvedValue({
      current: { id: 'plan_1' },
      reviewOverdue: true,
    });
    // consent is missing too, so missing_visit_consent takes priority
    // To test review overdue specifically, consent must be present
    findActiveVisitConsentMock.mockResolvedValue({ id: 'consent_1' });
    const tx = makeTx();

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: false,
          exclusion_reason: '管理計画書の見直し期限を超過しています',
        }),
      }),
    );
  });

  // ── 5. Initial home visit assessment missing → blocker ──
  it('sets claimable=false when initial home visit assessment is missing', async () => {
    // Override visitRecord.count to return 0 for prior visits (first visit)
    const tx = makeTx();
    tx.visitRecord.count = vi.fn().mockResolvedValue(0);
    // evaluateInitialHomeVisitAssessmentRequirement calls visitRecord.count then findFirst
    // When count returns 0 (no prior visits), it checks for initial visit record
    tx.visitRecord.findFirst = vi
      .fn()
      .mockResolvedValueOnce(makeVisitRecord()) // main query
      .mockResolvedValueOnce(null); // evaluateInitialHomeVisitAssessmentRequirement findFirst → no record

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: false,
          exclusion_reason: '初回算定月のため、初回訪問前日までの患家訪問・環境聴取記録が必要です',
        }),
      }),
    );
  });

  // ── 6. Report delivery incomplete → blocker ──
  it('sets claimable=false when report delivery is incomplete', async () => {
    const tx = makeTx({
      careReport: {
        findMany: vi.fn().mockResolvedValue([{ id: 'report_1', status: 'draft' }]),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: false,
          exclusion_reason: '報告書送付が未完了です',
        }),
      }),
    );
  });

  it('keeps legacy sent reports claimable when delivery records are not backfilled yet', async () => {
    const tx = makeTx({
      careReport: {
        findMany: vi.fn().mockResolvedValue([{ id: 'report_1', status: 'sent' }]),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: true,
          exclusion_reason: null,
        }),
      }),
    );
  });

  // ── 7. Multiple blockers simultaneously ──
  it('picks the highest-priority blocker when multiple exist', async () => {
    findActiveVisitConsentMock.mockResolvedValue(null);
    findCurrentManagementPlanMock.mockResolvedValue({
      current: null,
      reviewOverdue: false,
    });
    const tx = makeTx({
      careReport: {
        findMany: vi.fn().mockResolvedValue([{ id: 'report_1', status: 'draft' }]),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    // missing_visit_consent has highest priority
    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: false,
          exclusion_reason: '訪問薬剤管理の有効同意がありません',
        }),
      }),
    );
    // same_month_exclusion_flags should contain all blockers
    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          same_month_exclusion_flags: expect.objectContaining({
            missing_visit_consent: true,
            missing_management_plan: true,
            report_delivery_incomplete: true,
          }),
        }),
      }),
    );
  });

  // ── 8. Conference billing rule mapping (退院時共同指導料 B011-6) ──
  it('maps conference billing candidate B011-6 to recommended rule key', async () => {
    const tx = makeTx({
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            billing_code: 'B011-6',
            status: 'candidate',
            source_snapshot: {
              source_type: 'conference_note',
              conference_note_id: 'note_1',
            },
          },
        ]),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'note_1', metadata: {}, generated_report_id: null },
        ]),
      },
    });

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          recommended_rule_keys: expect.arrayContaining([
            'medical.discharge_joint_guidance',
          ]),
        }),
      }),
    );
  });

  // ── 9. Conference billing rule mapping (服薬情報等提供料2 ハ) ──
  it('maps conference billing candidate MED_INFO_PROVISION_2_HA to recommended rule key', async () => {
    const tx = makeTx({
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            billing_code: 'MED_INFO_PROVISION_2_HA',
            status: 'candidate',
            source_snapshot: {
              source_type: 'conference_note',
              conference_note_id: 'note_2',
            },
          },
        ]),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'note_2', metadata: {}, generated_report_id: null },
        ]),
      },
    });

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          recommended_rule_keys: expect.arrayContaining([
            'medical.information_provision.2_care_manager',
          ]),
        }),
      }),
    );
  });

  // ── 10. Conference billing rule mapping (ターミナルケア加算 C013) ──
  it('maps conference billing candidate C013 to recommended rule key', async () => {
    const tx = makeTx({
      billingCandidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            billing_code: 'C013',
            status: 'candidate',
            source_snapshot: {
              source_type: 'conference_note',
              conference_note_id: 'note_3',
            },
          },
        ]),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'note_3', metadata: {}, generated_report_id: null },
        ]),
      },
    });

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          recommended_rule_keys: expect.arrayContaining([
            'medical.addition.terminal_care',
          ]),
        }),
      }),
    );
  });

  // ── 11. isUnderAge: exactly 6 years old on birthday → under 6 is false ──
  it('treats a child exactly on their 6th birthday as NOT under 6 (infantEligible=false)', async () => {
    // Visit date is 2026-03-20, birth_date is 2020-03-20 → exactly 6 years old
    const tx = makeTx();
    tx.patient.findFirst = vi.fn().mockResolvedValue(
      makePatient({ birth_date: new Date('2020-03-20T00:00:00.000Z') }),
    );

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    // isUnderAge(2020-03-20, 2026-03-20, 6): ageYears=6, hadBirthday=true, 6 < 6 = false
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        infantEligible: false,
      }),
    );
  });

  // ── 12. isUnderAge: day before 6th birthday → under 6 is true ──
  it('treats a child the day before their 6th birthday as under 6 (infantEligible=true)', async () => {
    // Visit date is 2026-03-20, birth_date is 2020-03-21 → still 5 years old
    const tx = makeTx();
    tx.patient.findFirst = vi.fn().mockResolvedValue(
      makePatient({ birth_date: new Date('2020-03-21T00:00:00.000Z') }),
    );

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    // isUnderAge(2020-03-21, 2026-03-20, 6): ageYears=6, hadBirthday=false, 6-1=5 < 6 = true
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        infantEligible: true,
      }),
    );
  });

  // ── 13. resolveAfterHoursVisitCategory: local 22:00 → midnight ──
  it('categorizes a 22:00 local-time visit as midnight (深夜加算)', async () => {
    // Construct a date where getHours() returns 22 in local time
    const visitDate = new Date(2026, 2, 20, 22, 0, 0); // March 20, 2026 22:00 local
    const tx = makeTx();
    tx.visitRecord.findFirst = vi.fn().mockResolvedValue(
      makeVisitRecord({ visit_date: visitDate }),
    );

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        afterHoursVisit: 'midnight',
      }),
    );
  });

  // ── 14. resolveAfterHoursVisitCategory: Sunday/holiday → holiday ──
  it('categorizes a Sunday visit as holiday', async () => {
    // 2026-03-22 is a Sunday in local time
    const visitDate = new Date(2026, 2, 22, 10, 0, 0); // Sunday, 10:00 local
    const tx = makeTx();
    tx.visitRecord.findFirst = vi.fn().mockResolvedValue(
      makeVisitRecord({ visit_date: visitDate }),
    );

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        afterHoursVisit: 'holiday',
      }),
    );
  });

  // ── 15. resolveAfterHoursVisitCategory: 10:00 weekday → null ──
  it('returns null afterHoursVisit for a 10:00 weekday visit', async () => {
    // 2026-03-20 is a Friday (weekday), 10:00 local is normal hours (8-18)
    const visitDate = new Date(2026, 2, 20, 10, 0, 0); // Friday 10:00 local
    const tx = makeTx();
    tx.visitRecord.findFirst = vi.fn().mockResolvedValue(
      makeVisitRecord({ visit_date: visitDate }),
    );

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        afterHoursVisit: null,
      }),
    );
  });

  // ── 16. Validation layers state transitions ──
  it('passes claimable and exclusionReason to buildBillingCandidateSpecs for validation layer derivation', async () => {
    // When claimable=true: evidence layer → passed
    const tx = makeTx();

    await upsertBillingEvidenceForVisit(tx as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        claimable: true,
        exclusionReason: null,
      }),
    );

    // When claimable=false (consent missing) → blocked
    vi.clearAllMocks();
    ensureHomeCareBillingSsotMock.mockResolvedValue(undefined);
    buildBillingCandidateSpecsMock.mockResolvedValue([]);
    findActiveVisitConsentMock.mockResolvedValue(null);
    findCurrentManagementPlanMock.mockResolvedValue({
      current: { id: 'plan_1' },
      reviewOverdue: false,
    });
    upsertOperationalTaskMock.mockResolvedValue(undefined);
    resolveOperationalTasksMock.mockResolvedValue(undefined);

    const tx2 = makeTx();

    await upsertBillingEvidenceForVisit(tx2 as never, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx2,
      expect.objectContaining({
        claimable: false,
        exclusionReason: '訪問薬剤管理の有効同意がありません',
      }),
    );
    // Operational task should be created for blocked evidence
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      tx2,
      expect.objectContaining({
        taskType: 'billing_evidence_review',
        priority: 'high',
      }),
    );
  });
});
