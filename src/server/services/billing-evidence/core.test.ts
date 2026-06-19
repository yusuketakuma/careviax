import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../billing-rules', () => ({
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

import {
  buildValidationLayers,
  describeBillingEvidenceBlockers,
  endOfMonth,
  japanMonthRangeForBillingMonth,
  monthLabel,
  readBillingCandidateWorkflowState,
  reviewBillingCandidate,
  startOfMonth,
  upsertBillingEvidenceForVisit,
  writeBillingCandidateWorkflowState,
  type BillingCandidateWorkflowState,
} from './core';

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

function makeInsuranceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ins_1',
    number: 'med_1',
    insurance_type: 'medical',
    application_status: 'confirmed',
    public_program_code: null,
    previous_care_level: null,
    provisional_care_level: null,
    confirmed_care_level: null,
    is_active: true,
    ...overrides,
  };
}

function makeBillingEvidenceSupportDelegates() {
  return {
    sourceOfTruthMatrix: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    billingRule: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    consentRecord: {
      findFirst: vi.fn().mockResolvedValue({ id: 'consent_1' }),
    },
    managementPlan: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'plan_1',
        status: 'approved',
        next_review_date: null,
      }),
    },
    task: {
      create: vi.fn().mockResolvedValue({ id: 'task_1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({ id: 'task_1' }),
    },
  };
}

function makeTx(overrides: Record<string, unknown> = {}) {
  const baseTx = {
    ...makeBillingEvidenceSupportDelegates(),
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
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'delivery_1', report_id: 'report_1', status: 'sent' }]),
    },
    billingCandidate: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    prescriptionIntake: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    medicationIssue: {
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
      findFirst: vi
        .fn()
        .mockImplementation(({ where }: { where: { insurance_type: string } }) =>
          Promise.resolve(where?.insurance_type === 'medical' ? makeInsuranceRecord() : null),
        ),
      findMany: vi.fn().mockResolvedValue([]),
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

function makeCareCertificationTx(careLevel: string) {
  return makeTx({
    patient: {
      findFirst: vi.fn().mockResolvedValue(
        makePatient({
          cases: [
            {
              required_visit_support: {
                home_visit_intake: {
                  care_level: careLevel,
                },
              },
            },
          ],
        }),
      ),
    },
    patientInsurance: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { insurance_type: string } }) =>
        Promise.resolve(
          where?.insurance_type === 'care'
            ? makeInsuranceRecord({
                id: 'ins_care_1',
                number: 'care_1',
                insurance_type: 'care',
              })
            : makeInsuranceRecord({
                id: 'ins_med_1',
                number: 'med_1',
                insurance_type: 'medical',
              }),
        ),
      ),
    },
  });
}

describe('billing-evidence/core: billing month date helpers', () => {
  const originalTimeZone = process.env.TZ;

  afterEach(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  it('keeps canonical UTC billing months stable in Asia/Tokyo', () => {
    process.env.TZ = 'Asia/Tokyo';

    const billingMonth = new Date('2026-06-01T00:00:00.000Z');

    expect(startOfMonth(billingMonth).toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(endOfMonth(billingMonth).toISOString()).toBe('2026-06-30T23:59:59.999Z');
    expect(monthLabel(startOfMonth(billingMonth))).toBe('2026-06');
  });

  it('handles December to January month boundaries in UTC', () => {
    const billingMonth = new Date('2026-12-01T00:00:00.000Z');

    expect(startOfMonth(billingMonth).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(endOfMonth(billingMonth).toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });
});

describe('reviewBillingCandidate', () => {
  const currentUpdatedAt = new Date('2026-06-18T00:00:00.000Z');

  function makeReviewTx(
    overrides: {
      candidateUpdatedAt?: Date;
      updateCount?: number;
    } = {},
  ) {
    const candidate = {
      id: 'candidate_1',
      org_id: 'org_1',
      status: 'candidate',
      source_snapshot: null,
      exclusion_reason: null,
      updated_at: overrides.candidateUpdatedAt ?? currentUpdatedAt,
    };
    const updatedCandidate = {
      ...candidate,
      status: 'confirmed',
      updated_at: new Date('2026-06-18T00:01:00.000Z'),
    };
    return {
      billingCandidate: {
        findFirst: vi.fn().mockResolvedValueOnce(candidate).mockResolvedValueOnce(updatedCandidate),
        updateMany: vi.fn().mockResolvedValue({ count: overrides.updateCount ?? 1 }),
      },
    };
  }

  it('updates only when expectedUpdatedAt matches the current candidate version', async () => {
    const tx = makeReviewTx();

    const result = await reviewBillingCandidate(tx as never, {
      orgId: 'org_1',
      billingCandidateId: 'candidate_1',
      action: 'confirm',
      actorId: 'user_1',
      expectedUpdatedAt: currentUpdatedAt,
    });

    expect(tx.billingCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'candidate_1',
          org_id: 'org_1',
          updated_at: currentUpdatedAt,
        },
        data: expect.objectContaining({
          status: 'confirmed',
        }),
      }),
    );
    expect(result.status).toBe('confirmed');
  });

  it('rejects stale expectedUpdatedAt before updating', async () => {
    const tx = makeReviewTx();

    await expect(
      reviewBillingCandidate(tx as never, {
        orgId: 'org_1',
        billingCandidateId: 'candidate_1',
        action: 'confirm',
        actorId: 'user_1',
        expectedUpdatedAt: new Date('2026-06-17T00:00:00.000Z'),
      }),
    ).rejects.toThrow('BILLING_CANDIDATE_STALE');

    expect(tx.billingCandidate.updateMany).not.toHaveBeenCalled();
  });

  it('rejects races that update the candidate after the initial read', async () => {
    const tx = makeReviewTx({ updateCount: 0 });

    await expect(
      reviewBillingCandidate(tx as never, {
        orgId: 'org_1',
        billingCandidateId: 'candidate_1',
        action: 'confirm',
        actorId: 'user_1',
        expectedUpdatedAt: currentUpdatedAt,
      }),
    ).rejects.toThrow('BILLING_CANDIDATE_STALE');
  });
});

describe('billing-evidence/core: blocker descriptions', () => {
  it('describes care certification pending blockers with a patient action', () => {
    expect(
      describeBillingEvidenceBlockers({
        claimable: false,
        exclusionReason: '介護保険認定が申請中です',
        sameMonthExclusionFlags: { care_certification_pending: true },
      }),
    ).toEqual([
      {
        key: 'care_certification_pending',
        reason: '介護保険認定が申請中です',
        action_href: '/patients',
        action_label: '介護認定を確認',
        severity: 'high',
      },
    ]);
  });

  it('describes public subsidy application pending blockers with a patient action', () => {
    expect(
      describeBillingEvidenceBlockers({
        claimable: false,
        exclusionReason: '公費54が申請中です',
        sameMonthExclusionFlags: { public_subsidy_application_pending: true },
      }),
    ).toEqual([
      {
        key: 'public_subsidy_application_pending',
        reason: '公費54が申請中です',
        action_href: '/patients',
        action_label: '公費資格を確認',
        severity: 'high',
      },
    ]);
  });
});

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

    await upsertBillingEvidenceForVisit(tx, {
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

  it('persists visit schedule site attribution in billing evidence calculation context', async () => {
    const tx = makeTx({
      visitRecord: {
        findFirst: vi.fn().mockResolvedValue(
          makeVisitRecord({
            schedule: {
              cycle_id: 'cycle_1',
              case_id: 'case_1',
              pharmacist_id: 'pharm_1',
              visit_type: 'regular',
              site_id: 'site_1',
            },
          }),
        ),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          calculation_context: expect.objectContaining({
            site_id: 'site_1',
          }),
        }),
      }),
    );
  });

  it('blocks billing evidence when care certification is still applying', async () => {
    const tx = makeCareCertificationTx('applying');

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          payer_basis: 'care',
          claimable: false,
          exclusion_reason:
            '介護保険認定が申請中です。認定結果の確定まで請求保留または確認が必要です',
          same_month_exclusion_flags: expect.objectContaining({
            care_certification_pending: true,
          }),
          calculation_context: expect.objectContaining({
            care_level: 'applying',
            care_level_category: null,
            care_certification_status: 'applying',
          }),
        }),
      }),
    );
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        payerBasis: 'care',
        claimable: false,
        exclusionReason: '介護保険認定が申請中です。認定結果の確定まで請求保留または確認が必要です',
      }),
    );
  });

  it('blocks care billing evidence when care insurance care level change is pending', async () => {
    const tx = makeCareCertificationTx('care_1');
    tx.patientInsurance.findFirst = vi
      .fn()
      .mockImplementation(({ where }: { where: { insurance_type: string } }) =>
        Promise.resolve(
          where?.insurance_type === 'care'
            ? makeInsuranceRecord({
                id: 'ins_care_1',
                number: 'care_1',
                insurance_type: 'care',
                application_status: 'change_pending',
                previous_care_level: 'care_1',
                provisional_care_level: 'care_2',
              })
            : makeInsuranceRecord({
                id: 'ins_med_1',
                number: 'med_1',
                insurance_type: 'medical',
              }),
        ),
      );

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    const reason = '介護保険区分変更中です。認定結果の確定まで請求保留または確認が必要です';
    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          payer_basis: 'care',
          claimable: false,
          exclusion_reason: reason,
          same_month_exclusion_flags: expect.objectContaining({
            care_certification_pending: true,
          }),
          calculation_context: expect.objectContaining({
            care_level: 'care_1',
            care_certification_status: 'change_pending',
            care_insurance_application_status: 'change_pending',
            care_insurance_previous_care_level: 'care_1',
            care_insurance_provisional_care_level: 'care_2',
          }),
        }),
      }),
    );
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        payerBasis: 'care',
        claimable: false,
        exclusionReason: reason,
      }),
    );
  });

  it('blocks billing evidence when care insurance is pending even before care number is assigned', async () => {
    const tx = makeCareCertificationTx('care_1');
    tx.patientInsurance.findFirst = vi
      .fn()
      .mockImplementation(({ where }: { where: { insurance_type: string } }) =>
        Promise.resolve(
          where?.insurance_type === 'care'
            ? makeInsuranceRecord({
                id: 'ins_care_1',
                number: null,
                insurance_type: 'care',
                application_status: 'applying',
                provisional_care_level: 'care_1',
              })
            : makeInsuranceRecord({
                id: 'ins_med_1',
                number: 'med_1',
                insurance_type: 'medical',
              }),
        ),
      );

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    const reason = '介護保険資格が申請中です。認定結果の確定まで請求保留または確認が必要です';
    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          payer_basis: 'medical',
          claimable: false,
          exclusion_reason: reason,
          same_month_exclusion_flags: expect.objectContaining({
            care_certification_pending: true,
          }),
          calculation_context: expect.objectContaining({
            care_level: 'care_1',
            care_certification_status: 'applying',
            care_insurance_application_status: 'applying',
            care_insurance_provisional_care_level: 'care_1',
          }),
        }),
      }),
    );
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        payerBasis: 'medical',
        claimable: false,
        exclusionReason: reason,
      }),
    );
  });

  it('blocks billing evidence when public subsidy 21/54 application is pending', async () => {
    const tx = makeTx({
      patientInsurance: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: { insurance_type: string } }) =>
          Promise.resolve(
            where?.insurance_type === 'public_subsidy'
              ? makeInsuranceRecord({
                  id: 'ins_public_1',
                  number: '54001234',
                  insurance_type: 'public_subsidy',
                  application_status: 'applying',
                  public_program_code: '54',
                })
              : where?.insurance_type === 'medical'
                ? makeInsuranceRecord({
                    id: 'ins_med_1',
                    number: 'med_1',
                    insurance_type: 'medical',
                  })
                : null,
          ),
        ),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    const reason =
      '公費54が申請中です。公費負担者番号・受給者番号と適用開始日の確定まで請求保留または確認が必要です';
    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          payer_basis: 'medical',
          claimable: false,
          exclusion_reason: reason,
          same_month_exclusion_flags: expect.objectContaining({
            public_subsidy_application_pending: true,
          }),
          calculation_context: expect.objectContaining({
            public_subsidy_application_status: 'applying',
            public_subsidy_program_code: '54',
          }),
        }),
      }),
    );
    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        payerBasis: 'medical',
        claimable: false,
        exclusionReason: reason,
      }),
    );
  });

  it('blocks billing evidence when any active public subsidy is pending even if another subsidy is confirmed', async () => {
    const tx = makeTx({
      patientInsurance: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: { insurance_type: string } }) =>
          Promise.resolve(
            where?.insurance_type === 'public_subsidy'
              ? makeInsuranceRecord({
                  id: 'ins_public_21',
                  number: '21001234',
                  insurance_type: 'public_subsidy',
                  application_status: 'confirmed',
                  public_program_code: '21',
                })
              : where?.insurance_type === 'medical'
                ? makeInsuranceRecord({
                    id: 'ins_med_1',
                    number: 'med_1',
                    insurance_type: 'medical',
                  })
                : null,
          ),
        ),
        findMany: vi.fn().mockResolvedValue([
          makeInsuranceRecord({
            id: 'ins_public_54',
            number: null,
            insurance_type: 'public_subsidy',
            application_status: 'applying',
            public_program_code: '54',
          }),
        ]),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    const reason =
      '公費54が申請中です。公費負担者番号・受給者番号と適用開始日の確定まで請求保留または確認が必要です';
    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          payer_basis: 'medical',
          claimable: false,
          exclusion_reason: reason,
          same_month_exclusion_flags: expect.objectContaining({
            public_subsidy_application_pending: true,
          }),
          calculation_context: expect.objectContaining({
            public_subsidy_application_status: 'applying',
            public_subsidy_program_code: '54',
          }),
        }),
      }),
    );
    expect(tx.patientInsurance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          insurance_type: 'public_subsidy',
          application_status: { in: ['applying', 'change_pending'] },
        }),
        take: 1,
      }),
    );
  });

  it.each([
    ['not_applied', '介護保険認定が未申請です。介護保険請求として確定できません'],
    ['not_eligible', '介護保険認定が非該当です。介護保険請求として確定できません'],
  ])('blocks care billing evidence when care certification is %s', async (careLevel, reason) => {
    const tx = makeCareCertificationTx(careLevel);

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          payer_basis: 'care',
          claimable: false,
          exclusion_reason: reason,
          same_month_exclusion_flags: expect.objectContaining({
            care_certification_pending: true,
          }),
          calculation_context: expect.objectContaining({
            care_level: careLevel,
            care_level_category: null,
            care_certification_status: careLevel,
          }),
        }),
      }),
    );
  });

  it('keeps generated billing evidence and monthly count bounds on the UTC billing month', async () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      const tx = makeTx();
      tx.visitRecord.findFirst = vi.fn().mockResolvedValue(
        makeVisitRecord({
          visit_date: new Date('2026-03-01T00:00:00.000Z'),
        }),
      );

      await upsertBillingEvidenceForVisit(tx, {
        orgId: 'org_1',
        visitRecordId: 'visit_1',
      });

      expect(tx.visitRecord.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            org_id: 'org_1',
            patient_id: 'patient_1',
            visit_date: {
              gte: new Date('2026-02-28T15:00:00.000Z'),
              lt: new Date('2026-03-31T15:00:00.000Z'),
            },
          }),
        }),
      );
      expect(tx.billingCandidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id: 'org_1',
            patient_id: 'patient_1',
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
          },
          select: {
            billing_code: true,
            status: true,
            source_snapshot: true,
          },
        }),
      );
      expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
          }),
        }),
      );
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
  });

  it('passes completed 2026 home-visit evidence flags to billing candidate derivation', async () => {
    const tx = makeTx();
    tx.visitRecord.findFirst = vi.fn().mockResolvedValue(
      makeVisitRecord({
        structured_soap: {
          home_visit_2026: {
            physician_simultaneous: {
              performed: true,
              patient_consent: true,
              physician_name: '山田医師',
              medication_adjustment_discussed: true,
              discussion_summary: '残薬調整を協議',
              same_day_exclusion_checked: true,
            },
            multi_staff_visit: {
              performed: true,
              patient_consent: true,
              physician_need_confirmed: true,
              safety_reason: 'agitation',
              companion_name: '佐藤薬剤師',
              necessity_summary: '興奮が強く単独訪問では安全確保が難しい',
            },
            initial_transition_management: {
              target: true,
              pre_visit_environment_assessed: true,
              medication_risk_assessed: true,
              transition_support_summary: '退院直後の生活環境と服薬支援者を確認',
            },
          },
        },
      }),
    );

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(buildBillingCandidateSpecsMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        initialTransitionEligible: true,
        multiStaffVisitEligible: true,
        physicianSimultaneousEligible: true,
      }),
    );
  });

  // ── 2. Missing visit consent → blocker ──
  it('sets claimable=false with missing_visit_consent blocker', async () => {
    findActiveVisitConsentMock.mockResolvedValue(null);
    const tx = makeTx();

    await upsertBillingEvidenceForVisit(tx, {
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

  it('sets claimable=false when QR insurance review candidates remain unresolved', async () => {
    const tx = makeTx({
      medicationIssue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'issue_qr_insurance_1',
          title: 'QR由来の保険情報確認候補',
        }),
      },
      billingEvidence: {
        upsert: vi.fn().mockResolvedValue({ id: 'evidence_1', claimable: false }),
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
          exclusion_reason:
            '処方QR由来の保険・公費情報確認候補が未解決です。資格確認結果と照合してから請求してください',
          same_month_exclusion_flags: expect.objectContaining({
            qr_insurance_review_pending: true,
          }),
        }),
      }),
    );
  });

  // ── 3. Missing management plan → blocker ──
  it('sets claimable=false with missing_management_plan blocker', async () => {
    findCurrentManagementPlanMock.mockResolvedValue({
      current: null,
      reviewOverdue: false,
    });
    const tx = makeTx();

    await upsertBillingEvidenceForVisit(tx, {
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

    await upsertBillingEvidenceForVisit(tx, {
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

    await upsertBillingEvidenceForVisit(tx, {
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

    await upsertBillingEvidenceForVisit(tx, {
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

    await upsertBillingEvidenceForVisit(tx, {
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

  it('does not treat pharmacist-confirmed reports as delivered without send evidence', async () => {
    const tx = makeTx({
      careReport: {
        findMany: vi.fn().mockResolvedValue([{ id: 'report_1', status: 'confirmed' }]),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: false,
          exclusion_reason: '報告書送付が未完了です',
          same_month_exclusion_flags: expect.objectContaining({
            report_delivery_incomplete: true,
          }),
        }),
      }),
    );
  });

  it('sets claimable=false when sent reports only have failed delivery records', async () => {
    const tx = makeTx({
      careReport: {
        findMany: vi.fn().mockResolvedValue([{ id: 'report_1', status: 'sent' }]),
      },
      deliveryRecord: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'delivery_1', report_id: 'report_1', status: 'failed' }]),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          claimable: false,
          exclusion_reason: '報告書送付が未完了です',
          same_month_exclusion_flags: expect.objectContaining({
            report_delivery_incomplete: true,
          }),
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

    await upsertBillingEvidenceForVisit(tx, {
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
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'note_1', metadata: {}, generated_report_id: null }]),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          recommended_rule_keys: expect.arrayContaining(['medical.discharge_joint_guidance']),
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
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'note_2', metadata: {}, generated_report_id: null }]),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
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
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'note_3', metadata: {}, generated_report_id: null }]),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          recommended_rule_keys: expect.arrayContaining(['medical.addition.terminal_care']),
        }),
      }),
    );
  });

  it('resolves 2026 home comprehensive level 2 to イ for single-building visits', async () => {
    const tx = makeTx({
      visitRecord: {
        findFirst: vi.fn().mockResolvedValue(
          makeVisitRecord({
            visit_date: new Date('2026-06-15T10:00:00.000Z'),
            schedule: {
              cycle_id: 'cycle_1',
              case_id: 'case_1',
              pharmacist_id: 'pharm_1',
              visit_type: 'regular',
              site_id: 'site_1',
            },
          }),
        ),
      },
      pharmacySiteInsuranceConfig: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cfg_2026',
          revision_code: '2026',
          config: { home_comprehensive_level: 'level_2' },
        }),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          applied_rule_keys: expect.arrayContaining(['site.medical.home_comprehensive_2_i']),
        }),
      }),
    );
  });

  it('resolves 2026 home comprehensive level 2 to ロ for multi-building visits', async () => {
    const tx = makeTx({
      visitRecord: {
        findFirst: vi.fn().mockResolvedValue(
          makeVisitRecord({
            visit_date: new Date('2026-06-15T10:00:00.000Z'),
            schedule: {
              cycle_id: 'cycle_1',
              case_id: 'case_1',
              pharmacist_id: 'pharm_1',
              visit_type: 'regular',
              site_id: 'site_1',
            },
          }),
        ),
      },
      residence: {
        findFirst: vi.fn().mockResolvedValue({
          building_id: 'building_1',
          facility_id: null,
          facility_unit_id: null,
          facility: null,
          unit_name: '201',
        }),
        count: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1),
      },
      pharmacySiteInsuranceConfig: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cfg_2026',
          revision_code: '2026',
          config: { home_comprehensive_level: 'level_2' },
        }),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          applied_rule_keys: expect.arrayContaining(['site.medical.home_comprehensive_2_ro']),
        }),
      }),
    );
  });

  it('ignores malformed candidate breakdowns when promoting eligible care region add-ons', async () => {
    buildBillingCandidateSpecsMock.mockResolvedValue([
      {
        ssotKey: 'care.addition.malformed',
        code: 'CARE_REGION_MALFORMED',
        name: '不正な地域加算',
        status: 'excluded',
        points: 0,
        exclusionReason: '地域加算対象外',
        calculationBreakdown: null,
        sourceSnapshot: {},
      },
      {
        ssotKey: 'care.addition.special_15',
        code: 'CARE_REGION_SPECIAL_15',
        name: '特別地域加算',
        status: 'excluded',
        points: 15,
        exclusionReason: '地域加算対象外',
        calculationBreakdown: {
          conditions: { region_add_on: 'special_15' },
        },
        sourceSnapshot: {},
      },
      {
        ssotKey: 'care.addition.unknown',
        code: 'CARE_REGION_UNKNOWN',
        name: '未知の地域加算',
        status: 'excluded',
        points: 5,
        exclusionReason: '地域加算対象外',
        calculationBreakdown: {
          conditions: { region_add_on: 'unknown_region' },
        },
        sourceSnapshot: {},
      },
    ]);

    const tx = makeTx({
      visitRecord: {
        findFirst: vi.fn().mockResolvedValue(
          makeVisitRecord({
            schedule: {
              cycle_id: 'cycle_1',
              case_id: 'case_1',
              pharmacist_id: 'pharm_1',
              visit_type: 'regular',
              site_id: 'site_1',
            },
          }),
        ),
      },
      patient: {
        findFirst: vi.fn().mockResolvedValue(
          makePatient({
            medical_insurance_number: null,
            care_insurance_number: 'care_1',
          }),
        ),
      },
      patientInsurance: {
        findFirst: vi
          .fn()
          .mockImplementation(({ where }: { where: { insurance_type: string } }) =>
            Promise.resolve(
              where?.insurance_type === 'care'
                ? { id: 'ins_care', number: 'care_1', insurance_type: 'care', is_active: true }
                : null,
            ),
          ),
      },
      pharmacySiteInsuranceConfig: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cfg_care',
          revision_code: '2024',
          config: { region_special_15: true },
        }),
      },
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });

    expect(tx.billingEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          recommended_rule_keys: ['care.addition.special_15'],
        }),
      }),
    );
  });

  // ── 11. isUnderAge: exactly 6 years old on birthday → under 6 is false ──
  it('treats a child exactly on their 6th birthday as NOT under 6 (infantEligible=false)', async () => {
    // Visit date is 2026-03-20, birth_date is 2020-03-20 → exactly 6 years old
    const tx = makeTx();
    tx.patient.findFirst = vi
      .fn()
      .mockResolvedValue(makePatient({ birth_date: new Date('2020-03-20T00:00:00.000Z') }));

    await upsertBillingEvidenceForVisit(tx, {
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
    tx.patient.findFirst = vi
      .fn()
      .mockResolvedValue(makePatient({ birth_date: new Date('2020-03-21T00:00:00.000Z') }));

    await upsertBillingEvidenceForVisit(tx, {
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
    tx.visitRecord.findFirst = vi
      .fn()
      .mockResolvedValue(makeVisitRecord({ visit_date: visitDate }));

    await upsertBillingEvidenceForVisit(tx, {
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
    tx.visitRecord.findFirst = vi
      .fn()
      .mockResolvedValue(makeVisitRecord({ visit_date: visitDate }));

    await upsertBillingEvidenceForVisit(tx, {
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
    tx.visitRecord.findFirst = vi
      .fn()
      .mockResolvedValue(makeVisitRecord({ visit_date: visitDate }));

    await upsertBillingEvidenceForVisit(tx, {
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

    await upsertBillingEvidenceForVisit(tx, {
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

    await upsertBillingEvidenceForVisit(tx2, {
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
        assignedTo: 'pharm_1',
      }),
    );
  });
});

describe('billing-evidence/core: readBillingCandidateWorkflowState', () => {
  const defaults: BillingCandidateWorkflowState = {
    review_state: 'pending',
    resolution_state: 'unresolved',
    reviewed_at: null,
    reviewed_by: null,
    closed_at: null,
    closed_by: null,
    note: null,
  };

  it('returns defaults when source_snapshot is null', () => {
    expect(readBillingCandidateWorkflowState(null)).toEqual(defaults);
  });

  it('returns defaults when source_snapshot is undefined', () => {
    expect(readBillingCandidateWorkflowState(undefined)).toEqual(defaults);
  });

  it('returns defaults when source_snapshot is an array', () => {
    expect(readBillingCandidateWorkflowState([{ review_state: 'reviewed' }])).toEqual(defaults);
  });

  it('returns defaults when source_snapshot is a non-object primitive', () => {
    expect(readBillingCandidateWorkflowState('reviewed')).toEqual(defaults);
    expect(readBillingCandidateWorkflowState(42)).toEqual(defaults);
  });

  it('returns defaults when billing_close is missing', () => {
    expect(readBillingCandidateWorkflowState({ other: 'value' })).toEqual(defaults);
  });

  it('returns defaults when billing_close is not an object', () => {
    expect(readBillingCandidateWorkflowState({ billing_close: 'reviewed' })).toEqual(defaults);
    expect(readBillingCandidateWorkflowState({ billing_close: [] })).toEqual(defaults);
  });

  it('coerces an invalid review_state to pending', () => {
    expect(
      readBillingCandidateWorkflowState({ billing_close: { review_state: 'bogus' } }).review_state,
    ).toBe('pending');
  });

  it('coerces an invalid resolution_state to unresolved', () => {
    expect(
      readBillingCandidateWorkflowState({ billing_close: { resolution_state: 'bogus' } })
        .resolution_state,
    ).toBe('unresolved');
  });

  it('preserves valid review_state and resolution_state values', () => {
    expect(
      readBillingCandidateWorkflowState({
        billing_close: { review_state: 'reviewed', resolution_state: 'confirmed' },
      }),
    ).toMatchObject({ review_state: 'reviewed', resolution_state: 'confirmed' });

    expect(
      readBillingCandidateWorkflowState({
        billing_close: { resolution_state: 'excluded' },
      }).resolution_state,
    ).toBe('excluded');
  });

  it('preserves valid string fields and nulls non-string fields', () => {
    expect(
      readBillingCandidateWorkflowState({
        billing_close: {
          review_state: 'reviewed',
          resolution_state: 'confirmed',
          reviewed_at: '2026-06-18T00:00:00.000Z',
          reviewed_by: 'user_1',
          closed_at: '2026-06-19T00:00:00.000Z',
          closed_by: 'user_2',
          note: 'looks good',
        },
      }),
    ).toEqual({
      review_state: 'reviewed',
      resolution_state: 'confirmed',
      reviewed_at: '2026-06-18T00:00:00.000Z',
      reviewed_by: 'user_1',
      closed_at: '2026-06-19T00:00:00.000Z',
      closed_by: 'user_2',
      note: 'looks good',
    });

    expect(
      readBillingCandidateWorkflowState({
        billing_close: {
          reviewed_at: 123,
          reviewed_by: null,
          note: { nested: true },
        },
      }),
    ).toMatchObject({ reviewed_at: null, reviewed_by: null, note: null });
  });
});

describe('billing-evidence/core: writeBillingCandidateWorkflowState', () => {
  it('writes a full default workflow when source_snapshot is empty', () => {
    expect(writeBillingCandidateWorkflowState(null, {})).toEqual({
      billing_close: {
        review_state: 'pending',
        resolution_state: 'unresolved',
        reviewed_at: null,
        reviewed_by: null,
        closed_at: null,
        closed_by: null,
        note: null,
      },
    });
  });

  it('merges a partial workflow onto read defaults', () => {
    const result = writeBillingCandidateWorkflowState(null, {
      review_state: 'reviewed',
      resolution_state: 'confirmed',
      reviewed_by: 'user_1',
    });

    expect(result.billing_close).toEqual({
      review_state: 'reviewed',
      resolution_state: 'confirmed',
      reviewed_at: null,
      reviewed_by: 'user_1',
      closed_at: null,
      closed_by: null,
      note: null,
    });
  });

  it('merges onto an existing workflow read from the snapshot', () => {
    const existing = {
      billing_close: {
        review_state: 'reviewed',
        resolution_state: 'confirmed',
        reviewed_by: 'user_1',
      },
    };

    const result = writeBillingCandidateWorkflowState(existing, { note: 'closed out' });

    expect(result.billing_close).toEqual({
      review_state: 'reviewed',
      resolution_state: 'confirmed',
      reviewed_at: null,
      reviewed_by: 'user_1',
      closed_at: null,
      closed_by: null,
      note: 'closed out',
    });
  });

  it('preserves sibling keys under source_snapshot', () => {
    const result = writeBillingCandidateWorkflowState(
      {
        source_type: 'conference_note',
        conference_note_id: 'note_1',
        billing_close: { review_state: 'reviewed' },
      },
      { resolution_state: 'excluded' },
    );

    expect(result).toMatchObject({
      source_type: 'conference_note',
      conference_note_id: 'note_1',
    });
    expect(result.billing_close).toMatchObject({
      review_state: 'reviewed',
      resolution_state: 'excluded',
    });
  });

  it('drops non-object snapshots (array/primitive) but still writes billing_close', () => {
    expect(writeBillingCandidateWorkflowState([1, 2, 3], { note: 'x' })).toEqual({
      billing_close: expect.objectContaining({ note: 'x' }),
    });
    expect(writeBillingCandidateWorkflowState('not-an-object', {})).toEqual({
      billing_close: expect.any(Object),
    });
  });
});

describe('billing-evidence/core: buildValidationLayers', () => {
  const baseWorkflow: BillingCandidateWorkflowState = {
    review_state: 'pending',
    resolution_state: 'unresolved',
    reviewed_at: null,
    reviewed_by: null,
    closed_at: null,
    closed_by: null,
    note: null,
  };

  function build(
    overrides: {
      evidencePassed?: boolean;
      candidateStatus?: string;
      workflow?: Partial<BillingCandidateWorkflowState>;
    } = {},
  ) {
    return buildValidationLayers({
      evidencePassed: overrides.evidencePassed ?? true,
      evidenceMessage: 'evidence-msg',
      ruleMessage: 'rule-msg',
      candidateStatus: overrides.candidateStatus ?? 'confirmed',
      workflow: { ...baseWorkflow, ...overrides.workflow },
    });
  }

  it('sets evidence layer based on evidencePassed', () => {
    expect(build({ evidencePassed: true }).evidence).toMatchObject({
      label: '請求根拠',
      state: 'passed',
      message: 'evidence-msg',
    });
    expect(build({ evidencePassed: false }).evidence.state).toBe('blocked');
  });

  it('close_review passes when candidate status is exported', () => {
    const layers = build({ candidateStatus: 'exported' });
    expect(layers.close_review).toMatchObject({
      label: '月次締めレビュー',
      state: 'passed',
      message: 'レビュー完了',
    });
  });

  it('close_review passes when closed_at is set regardless of review state', () => {
    const layers = build({
      candidateStatus: 'candidate',
      workflow: { closed_at: '2026-06-19T00:00:00.000Z' },
    });
    expect(layers.close_review.state).toBe('passed');
  });

  it('close_review passes when reviewed and confirmed', () => {
    const layers = build({
      candidateStatus: 'candidate',
      workflow: { review_state: 'reviewed', resolution_state: 'confirmed' },
    });
    expect(layers.close_review.state).toBe('passed');
  });

  it('close_review blocks when reviewed and excluded', () => {
    const layers = build({
      candidateStatus: 'candidate',
      workflow: { review_state: 'reviewed', resolution_state: 'excluded' },
    });
    expect(layers.close_review).toMatchObject({
      state: 'blocked',
      message: 'レビューで除外',
    });
  });

  it('close_review requires manual review otherwise', () => {
    const layers = build({ candidateStatus: 'candidate' });
    expect(layers.close_review).toMatchObject({
      state: 'manual_review',
      message: 'レビュー待ち',
    });

    const reviewedUnresolved = build({
      candidateStatus: 'candidate',
      workflow: { review_state: 'reviewed', resolution_state: 'unresolved' },
    });
    expect(reviewedUnresolved.close_review.state).toBe('manual_review');
  });

  it('rule_engine blocks for excluded candidate status', () => {
    const layers = build({ candidateStatus: 'excluded' });
    expect(layers.rule_engine).toMatchObject({
      label: '算定ルール',
      state: 'blocked',
      message: 'rule-msg',
      version: 'home-care-ssot-registry-v2',
    });
  });

  it('rule_engine requires manual review for candidate status', () => {
    expect(build({ candidateStatus: 'candidate' }).rule_engine.state).toBe('manual_review');
  });

  it('rule_engine passes for other statuses', () => {
    expect(build({ candidateStatus: 'confirmed' }).rule_engine.state).toBe('passed');
    expect(build({ candidateStatus: 'exported' }).rule_engine.state).toBe('passed');
  });
});

describe('billing-evidence/core: japanMonthRangeForBillingMonth', () => {
  it('computes JST month boundaries for 2026-06', () => {
    const billingMonth = startOfMonth(new Date('2026-06-01T00:00:00.000Z'));
    const range = japanMonthRangeForBillingMonth(billingMonth);

    expect(range.start.toISOString()).toBe('2026-05-31T15:00:00.000Z');
    expect(range.nextStart.toISOString()).toBe('2026-06-30T15:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-06-30T14:59:59.999Z');
  });

  it('is stable regardless of the day component within the billing month', () => {
    const range = japanMonthRangeForBillingMonth(new Date('2026-06-15T08:30:00.000Z'));

    expect(range.start.toISOString()).toBe('2026-05-31T15:00:00.000Z');
    expect(range.nextStart.toISOString()).toBe('2026-06-30T15:00:00.000Z');
  });
});
