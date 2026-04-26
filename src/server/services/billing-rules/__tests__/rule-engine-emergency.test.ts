import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureHomeCareBillingSsotMock } = vi.hoisted(() => ({
  ensureHomeCareBillingSsotMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../seeder', async () => {
  const actual = await vi.importActual<typeof import('../seeder')>('../seeder');
  return {
    ...actual,
    ensureHomeCareBillingSsot: ensureHomeCareBillingSsotMock,
  };
});

import { MEDICAL_RULES_2024 } from '../revisions/medical/2024';
import { MEDICAL_RULES_2026 } from '../revisions/medical/2026';
import { buildBillingCandidateSpecs } from '../rule-engine';

describe('buildBillingCandidateSpecs emergency category selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects emergency visit 1 when the intake marks planned_disease_exacerbation', async () => {
    const tx = {
      sourceOfTruthMatrix: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingRule: {
        findMany: vi.fn().mockResolvedValue(
          MEDICAL_RULES_2024.map((rule) => ({
            ...rule,
            id: rule.ssot_key,
            billing_scope: 'home_care_ssot',
            is_active: true,
          })),
        ),
      },
    } as never;

    const specs = await buildBillingCandidateSpecs(tx, {
      orgId: 'org_1',
      payerBasis: 'medical',
      serviceType: 'medical_home_visit',
      providerScope: 'pharmacy',
      buildingPatientCount: 1,
      monthlyVisitCount: 1,
      weeklyVisitCount: 1,
      claimable: true,
      visitType: 'emergency',
      emergencyCategory: 'planned_disease_exacerbation',
      onlineEligible: false,
    });

    expect(specs[0]).toMatchObject({
      code: 'MED_EMERGENCY_VISIT_1',
      points: 500,
    });
  });

  it('selects emergency online billing when the intake marks online', async () => {
    const tx = {
      sourceOfTruthMatrix: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingRule: {
        findMany: vi.fn().mockResolvedValue(
          MEDICAL_RULES_2024.map((rule) => ({
            ...rule,
            id: rule.ssot_key,
            billing_scope: 'home_care_ssot',
            is_active: true,
          })),
        ),
      },
    } as never;

    const specs = await buildBillingCandidateSpecs(tx, {
      orgId: 'org_1',
      payerBasis: 'medical',
      serviceType: 'medical_home_visit',
      providerScope: 'pharmacy',
      buildingPatientCount: 1,
      monthlyVisitCount: 1,
      weeklyVisitCount: 1,
      claimable: true,
      visitType: 'emergency',
      emergencyCategory: 'online',
      onlineEligible: true,
    });

    expect(specs[0]).toMatchObject({
      code: 'MED_EMERGENCY_VISIT_ONLINE',
      points: 59,
    });
  });

  it('suggests the night emergency add-on when after-hours conditions match', async () => {
    const tx = {
      sourceOfTruthMatrix: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingRule: {
        findMany: vi.fn().mockResolvedValue(
          MEDICAL_RULES_2024.map((rule) => ({
            ...rule,
            id: rule.ssot_key,
            billing_scope: 'home_care_ssot',
            is_active: true,
          })),
        ),
      },
    } as never;

    const specs = await buildBillingCandidateSpecs(tx, {
      orgId: 'org_1',
      payerBasis: 'medical',
      serviceType: 'medical_home_visit',
      providerScope: 'pharmacy',
      buildingPatientCount: 1,
      monthlyVisitCount: 1,
      weeklyVisitCount: 1,
      claimable: true,
      visitType: 'emergency',
      emergencyCategory: 'planned_disease_exacerbation',
      afterHoursVisit: 'night',
      specialCapEligible: true,
      onlineEligible: false,
    });

    expect(specs.some((spec) => spec.code === 'MED_EMERGENCY_VISIT_NIGHT')).toBe(true);
  });

  it('requires structured initial transition evidence before suggesting the 2026 initial transition add-on', async () => {
    const tx = {
      sourceOfTruthMatrix: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingRule: {
        findMany: vi.fn().mockResolvedValue(
          MEDICAL_RULES_2026.map((rule) => ({
            ...rule,
            id: rule.ssot_key,
            billing_scope: 'home_care_ssot',
            is_active: true,
          })),
        ),
      },
    } as never;

    const commonContext = {
      orgId: 'org_1',
      payerBasis: 'medical' as const,
      serviceType: 'medical_home_visit' as const,
      providerScope: 'pharmacy' as const,
      buildingPatientCount: 1,
      monthlyVisitCount: 1,
      weeklyVisitCount: 1,
      claimable: true,
      visitType: 'initial',
      onlineEligible: false,
    };

    const withoutEvidence = await buildBillingCandidateSpecs(tx, {
      ...commonContext,
      initialTransitionEligible: false,
    });
    const withEvidence = await buildBillingCandidateSpecs(tx, {
      ...commonContext,
      initialTransitionEligible: true,
    });

    expect(
      withoutEvidence.find((spec) => spec.code === 'MED_HOME_TRANSITION_INITIAL'),
    ).toMatchObject({
      status: 'excluded',
    });
    expect(withEvidence.find((spec) => spec.code === 'MED_HOME_TRANSITION_INITIAL')).toMatchObject({
      status: 'candidate',
      points: 230,
    });
  });
});
