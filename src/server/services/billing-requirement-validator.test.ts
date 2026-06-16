import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findActiveVisitConsentMock, findCurrentManagementPlanMock, prismaMock } = vi.hoisted(
  () => ({
    findActiveVisitConsentMock: vi.fn(),
    findCurrentManagementPlanMock: vi.fn(),
    prismaMock: {
      visitSchedule: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
      },
    },
  }),
);

vi.mock('./management-plans', () => ({
  findActiveVisitConsent: findActiveVisitConsentMock,
  findCurrentManagementPlan: findCurrentManagementPlanMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import {
  validateBillingRequirements,
  getBillingCadencePreview,
  type ValidateBillingRequirementsArgs,
} from './billing-requirement-validator';

const baseArgs: ValidateBillingRequirementsArgs = {
  orgId: 'org_1',
  caseId: 'case_1',
  patientId: 'patient_1',
  pharmacistId: 'pharmacist_1',
  visitType: 'regular',
  proposedDate: new Date('2026-04-15'),
  payerBasis: 'medical',
};

// baseArgs: regular visit, not special → only 2 count calls (monthly + weekly pharmacist)
// emergency visit → 3 count calls (monthly + weekly pharmacist + existing regular)
// specialCapEligible → 3 count calls (monthly + weekly pharmacist + weekly patient)
// emergency + special → 4 count calls

describe('validateBillingRequirements', () => {
  beforeEach(() => {
    prismaMock.visitSchedule.count.mockReset();
    prismaMock.user.findFirst.mockReset();
    findActiveVisitConsentMock.mockReset();
    findCurrentManagementPlanMock.mockReset();
    // Default: no existing schedules, valid consent, approved plan
    prismaMock.visitSchedule.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue({ max_weekly_visits: 40 });
    findActiveVisitConsentMock.mockResolvedValue({
      id: 'consent_1',
      expiry_date: new Date('2027-01-01'),
    });
    findCurrentManagementPlanMock.mockResolvedValue({
      current: { id: 'plan_1', status: 'approved' },
      reviewOverdue: false,
    });
  });

  it('returns empty alerts when all requirements are met', async () => {
    const alerts = await validateBillingRequirements(baseArgs);
    expect(alerts).toEqual([]);
  });

  // ── Alert #1: Monthly cap exceeded ──

  it('returns error when monthly cap (4) is exceeded', async () => {
    // baseArgs (regular, not special) → 2 count calls
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(4) // monthly: already at cap
      .mockResolvedValueOnce(5); // weekly pharmacist

    const alerts = await validateBillingRequirements(baseArgs);
    const monthlyAlert = alerts.find((a) => a.type === 'monthly_cap_exceeded');
    expect(monthlyAlert).toBeDefined();
    expect(monthlyAlert!.severity).toBe('error');
    expect(monthlyAlert!.details.cap).toBe(4);
    expect(monthlyAlert!.details.projected_count).toBe(5);
  });

  it('uses special monthly cap (8) when specialCapEligible', async () => {
    // special, not emergency → 3 count calls
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(7) // monthly: 7 of 8
      .mockResolvedValueOnce(5) // weekly pharmacist
      .mockResolvedValueOnce(0); // weekly patient

    const alerts = await validateBillingRequirements({
      ...baseArgs,
      specialCapEligible: true,
    });
    const monthlyAlert = alerts.find((a) => a.type === 'monthly_cap_exceeded');
    // 7 + 1 = 8, at cap but not exceeded
    expect(monthlyAlert).toBeUndefined();
  });

  it('fires monthly_cap_exceeded when special cap (8) is exceeded', async () => {
    // special, not emergency → 3 count calls
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(8) // monthly: already at special cap
      .mockResolvedValueOnce(5) // weekly pharmacist
      .mockResolvedValueOnce(1); // weekly patient count

    const alerts = await validateBillingRequirements({
      ...baseArgs,
      specialCapEligible: true,
    });
    const monthlyAlert = alerts.find((a) => a.type === 'monthly_cap_exceeded');
    expect(monthlyAlert).toBeDefined();
    expect(monthlyAlert!.details.cap).toBe(8);
  });

  // ── Alert #2: Pharmacist weekly capacity ──

  it('warns when pharmacist weekly capacity >= 95%', async () => {
    // baseArgs → 2 count calls
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(0) // monthly
      .mockResolvedValueOnce(38); // weekly pharmacist: 39/40 = 97.5%

    const alerts = await validateBillingRequirements(baseArgs);
    const capAlert = alerts.find((a) => a.type === 'pharmacist_weekly_capacity');
    expect(capAlert).toBeDefined();
    expect(capAlert!.severity).toBe('warning');
  });

  it('uses pharmacist custom weekly cap when set', async () => {
    // baseArgs → 2 count calls
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(0) // monthly
      .mockResolvedValueOnce(18); // weekly pharmacist: 19/20 = 95%
    prismaMock.user.findFirst.mockResolvedValue({ max_weekly_visits: 20 });

    const alerts = await validateBillingRequirements(baseArgs);
    const capAlert = alerts.find((a) => a.type === 'pharmacist_weekly_capacity');
    // 19/20 = 95%, exactly at threshold
    expect(capAlert).toBeDefined();
  });

  it('uses prefetched pharmacist weekly cap without loading the user row', async () => {
    prismaMock.visitSchedule.count.mockResolvedValueOnce(0).mockResolvedValueOnce(17);

    const alerts = await validateBillingRequirements({
      ...baseArgs,
      pharmacistWeeklyCap: 18,
    });

    const capAlert = alerts.find((a) => a.type === 'pharmacist_weekly_capacity');
    expect(capAlert).toBeDefined();
    expect(capAlert!.details.cap).toBe(18);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('does not warn when pharmacist capacity is below threshold', async () => {
    // baseArgs → 2 count calls
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(0) // monthly
      .mockResolvedValueOnce(30); // weekly pharmacist: 31/40 = 77.5%

    const alerts = await validateBillingRequirements(baseArgs);
    const capAlert = alerts.find((a) => a.type === 'pharmacist_weekly_capacity');
    expect(capAlert).toBeUndefined();
  });

  // ── Alert #3: Emergency/regular concurrent ──

  it('warns when emergency visit has concurrent regular visits in month', async () => {
    // emergency, not special → 3 count calls
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(2) // monthly
      .mockResolvedValueOnce(5) // weekly pharmacist
      .mockResolvedValueOnce(3); // existing regular visits

    const alerts = await validateBillingRequirements({
      ...baseArgs,
      visitType: 'emergency',
    });
    const concurrentAlert = alerts.find((a) => a.type === 'emergency_regular_concurrent');
    expect(concurrentAlert).toBeDefined();
    expect(concurrentAlert!.severity).toBe('warning');
    expect(concurrentAlert!.details.regular_count).toBe(3);
  });

  it('does not warn about concurrent billing for non-emergency visits', async () => {
    // baseArgs (regular) → 2 count calls, no regular-in-month check
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(2) // monthly
      .mockResolvedValueOnce(5); // weekly pharmacist

    const alerts = await validateBillingRequirements(baseArgs);
    const concurrentAlert = alerts.find((a) => a.type === 'emergency_regular_concurrent');
    expect(concurrentAlert).toBeUndefined();
  });

  // ── Alert #4: Missing management plan ──

  it('warns when management plan does not exist', async () => {
    findCurrentManagementPlanMock.mockResolvedValue({
      current: null,
      reviewOverdue: false,
    });

    const alerts = await validateBillingRequirements(baseArgs);
    const planAlert = alerts.find((a) => a.type === 'missing_management_plan');
    expect(planAlert).toBeDefined();
    expect(planAlert!.severity).toBe('warning');
    expect(planAlert!.details.plan_exists).toBe(false);
  });

  it('warns when management plan is not approved', async () => {
    findCurrentManagementPlanMock.mockResolvedValue({
      current: { id: 'plan_1', status: 'draft' },
      reviewOverdue: false,
    });

    const alerts = await validateBillingRequirements(baseArgs);
    const planAlert = alerts.find((a) => a.type === 'missing_management_plan');
    expect(planAlert).toBeDefined();
    expect(planAlert!.message).toContain('draft');
  });

  it('warns when management plan review is overdue', async () => {
    findCurrentManagementPlanMock.mockResolvedValue({
      current: { id: 'plan_1', status: 'approved' },
      reviewOverdue: true,
    });

    const alerts = await validateBillingRequirements(baseArgs);
    const planAlert = alerts.find((a) => a.type === 'missing_management_plan');
    expect(planAlert).toBeDefined();
    expect(planAlert!.details.review_overdue).toBe(true);
  });

  // ── Alert #5: Consent expired or missing ──

  it('warns when consent is missing', async () => {
    findActiveVisitConsentMock.mockResolvedValue(null);

    const alerts = await validateBillingRequirements(baseArgs);
    const consentAlert = alerts.find((a) => a.type === 'consent_expired_or_missing');
    expect(consentAlert).toBeDefined();
    expect(consentAlert!.severity).toBe('warning');
    expect(consentAlert!.details.consent_exists).toBe(false);
  });

  it('warns when consent is expired', async () => {
    findActiveVisitConsentMock.mockResolvedValue({
      id: 'consent_1',
      expiry_date: new Date('2025-01-01'), // past date
    });

    const alerts = await validateBillingRequirements(baseArgs);
    const consentAlert = alerts.find((a) => a.type === 'consent_expired_or_missing');
    expect(consentAlert).toBeDefined();
    expect(consentAlert!.details.consent_exists).toBe(true);
  });

  it('warns when consent expires before the proposed visit date even if it is not yet expired today', async () => {
    findActiveVisitConsentMock.mockResolvedValue({
      id: 'consent_1',
      expiry_date: new Date('2026-04-10T00:00:00.000Z'),
    });

    const alerts = await validateBillingRequirements({
      ...baseArgs,
      proposedDate: new Date('2026-04-15T09:00:00.000Z'),
    });
    const consentAlert = alerts.find((a) => a.type === 'consent_expired_or_missing');
    expect(consentAlert).toBeDefined();
    expect(consentAlert!.message).toContain('訪問予定日時点');
    expect(consentAlert!.details.proposed_date).toBe('2026-04-15T09:00:00.000Z');
  });

  it('does not warn when consent has no expiry', async () => {
    findActiveVisitConsentMock.mockResolvedValue({
      id: 'consent_1',
      expiry_date: null,
    });

    const alerts = await validateBillingRequirements(baseArgs);
    const consentAlert = alerts.find((a) => a.type === 'consent_expired_or_missing');
    expect(consentAlert).toBeUndefined();
  });

  // ── Alert #6: Special patient weekly cap ──

  it('warns when special patient exceeds weekly cap (2)', async () => {
    // special, not emergency → 3 count calls
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(3) // monthly
      .mockResolvedValueOnce(5) // weekly pharmacist
      .mockResolvedValueOnce(2); // weekly patient: already at cap

    const alerts = await validateBillingRequirements({
      ...baseArgs,
      specialCapEligible: true,
    });
    const weeklyAlert = alerts.find((a) => a.type === 'special_patient_weekly_cap');
    expect(weeklyAlert).toBeDefined();
    expect(weeklyAlert!.severity).toBe('warning');
    expect(weeklyAlert!.details.cap).toBe(2);
  });

  it('does not check weekly cap for non-special patients', async () => {
    const alerts = await validateBillingRequirements(baseArgs);
    const weeklyAlert = alerts.find((a) => a.type === 'special_patient_weekly_cap');
    expect(weeklyAlert).toBeUndefined();
  });

  // ── Multiple alerts ──

  it('can return multiple alerts simultaneously', async () => {
    // baseArgs → 2 count calls
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(4) // monthly: exceeded
      .mockResolvedValueOnce(38); // weekly pharmacist: near cap
    findActiveVisitConsentMock.mockResolvedValue(null);
    findCurrentManagementPlanMock.mockResolvedValue({
      current: null,
      reviewOverdue: false,
    });

    const alerts = await validateBillingRequirements(baseArgs);
    expect(alerts.length).toBeGreaterThanOrEqual(3);
    const types = alerts.map((a) => a.type);
    expect(types).toContain('monthly_cap_exceeded');
    expect(types).toContain('pharmacist_weekly_capacity');
    expect(types).toContain('consent_expired_or_missing');
    expect(types).toContain('missing_management_plan');
  });

  it('includes as_of timestamp in all alerts', async () => {
    // baseArgs → 2 count calls, default fallback returns 0 after Once consumed
    prismaMock.visitSchedule.count
      .mockResolvedValueOnce(10) // monthly: exceeded
      .mockResolvedValueOnce(0);
    findActiveVisitConsentMock.mockResolvedValue(null);

    const alerts = await validateBillingRequirements(baseArgs);
    for (const alert of alerts) {
      expect(alert.as_of).toBeDefined();
      expect(() => new Date(alert.as_of)).not.toThrow();
    }
  });
});

describe('getBillingCadencePreview', () => {
  beforeEach(() => {
    prismaMock.visitSchedule.findMany.mockReset();
  });

  it('returns correct monthly counts and cap for regular patient', async () => {
    const scheduled = [
      { scheduled_date: new Date('2026-04-03') },
      { scheduled_date: new Date('2026-04-10') },
      { scheduled_date: new Date('2026-04-17') },
    ];
    prismaMock.visitSchedule.findMany.mockResolvedValue(scheduled);

    const preview = await getBillingCadencePreview(baseArgs);
    expect(preview.monthly_cap).toBe(4);
    expect(preview.current_month_count).toBe(3);
    expect(preview.remaining_month_count).toBe(1);
    expect(preview.scheduled_dates_current_month).toHaveLength(3);
    expect(preview.weekly_cap).toBeNull();
  });

  it('returns special cap (8) and weekly cap (2) for special patients', async () => {
    prismaMock.visitSchedule.findMany.mockResolvedValue([]);

    const preview = await getBillingCadencePreview({
      ...baseArgs,
      specialCapEligible: true,
    });
    expect(preview.monthly_cap).toBe(8);
    expect(preview.weekly_cap).toBe(2);
  });

  it('suggests next billable dates when current month is full', async () => {
    const scheduled = [
      { scheduled_date: new Date('2026-04-01') },
      { scheduled_date: new Date('2026-04-08') },
      { scheduled_date: new Date('2026-04-15') },
      { scheduled_date: new Date('2026-04-22') },
    ];
    prismaMock.visitSchedule.findMany.mockResolvedValue(scheduled);

    const preview = await getBillingCadencePreview({
      ...baseArgs,
      proposedDate: new Date('2026-04-25'),
    });
    expect(preview.remaining_month_count).toBe(0);
    // Next billable should be in May
    if (preview.next_billable_date) {
      expect(preview.next_billable_date).toMatch(/^2026-05/);
    }
  });

  it('returns suggested_dates with up to 3 entries', async () => {
    prismaMock.visitSchedule.findMany.mockResolvedValue([]);

    const preview = await getBillingCadencePreview(baseArgs);
    expect(preview.suggested_dates.length).toBeLessThanOrEqual(3);
    expect(preview.suggested_dates.length).toBeGreaterThan(0);
  });

  it('returns null next_billable_date when no dates available in 120 days', async () => {
    // Create schedules filling every month for 120 days
    const dates: { scheduled_date: Date }[] = [];
    for (let i = 0; i < 120; i++) {
      const d = new Date('2026-04-15');
      d.setDate(d.getDate() + i);
      dates.push({ scheduled_date: d });
    }
    prismaMock.visitSchedule.findMany.mockResolvedValue(dates);

    const preview = await getBillingCadencePreview(baseArgs);
    // With 120 visits, every month would be full
    expect(preview.next_billable_date).toBeNull();
    expect(preview.reason).toContain('提案できませんでした');
  });

  it('returns correct week count for proposed date', async () => {
    // Monday 2026-04-13 to Sunday 2026-04-19
    const scheduled = [
      { scheduled_date: new Date('2026-04-13') },
      { scheduled_date: new Date('2026-04-14') },
      { scheduled_date: new Date('2026-04-16') },
    ];
    prismaMock.visitSchedule.findMany.mockResolvedValue(scheduled);

    const preview = await getBillingCadencePreview({
      ...baseArgs,
      proposedDate: new Date('2026-04-15'), // Wednesday in same week
    });
    expect(preview.current_week_count).toBe(3);
  });

  it('uses weekly buckets when suggesting dates for special patients', async () => {
    prismaMock.visitSchedule.findMany.mockResolvedValue([
      { scheduled_date: new Date('2026-04-13') },
      { scheduled_date: new Date('2026-04-14') },
      { scheduled_date: new Date('2026-04-21') },
    ]);

    const preview = await getBillingCadencePreview({
      ...baseArgs,
      proposedDate: new Date('2026-04-15'),
      specialCapEligible: true,
    });

    expect(prismaMock.visitSchedule.findMany).toHaveBeenCalledTimes(1);
    expect(preview.current_week_count).toBe(2);
    expect(preview.next_billable_date).toBe('2026-04-20');
    expect(preview.suggested_dates[0]).toBe('2026-04-20');
  });
});
