import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  consentRecordFindFirstMock,
  consentRecordFindManyMock,
  managementPlanFindFirstMock,
  managementPlanFindManyMock,
} = vi.hoisted(() => ({
  consentRecordFindFirstMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('./notifications', () => ({
  dispatchNotificationEvent: vi.fn().mockResolvedValue([]),
}));

vi.mock('./operational-tasks', () => ({
  upsertOperationalTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
  resolveOperationalTasks: vi.fn().mockResolvedValue({ count: 1 }),
}));

import {
  findActiveVisitConsent,
  findCurrentManagementPlan,
  evaluateVisitWorkflowGate,
  evaluateVisitWorkflowGates,
  formatVisitWorkflowGateIssues,
  getVisitWorkflowGuidance,
  buildManagementPlanReviewTaskKey,
  isVisitWorkflowGateIssue,
  parseVisitWorkflowGateErrorMessage,
} from './management-plans';

function makeGateDb() {
  return {
    consentRecord: { findFirst: consentRecordFindFirstMock, findMany: consentRecordFindManyMock },
    managementPlan: {
      findFirst: managementPlanFindFirstMock,
      findMany: managementPlanFindManyMock,
    },
  };
}

describe('findActiveVisitConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns consent when found', async () => {
    const consent = { id: 'consent-1', consent_type: 'visit_medication_management' };
    consentRecordFindFirstMock.mockResolvedValue(consent);

    const result = await findActiveVisitConsent(makeGateDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    expect(result).toEqual(consent);
    expect(consentRecordFindFirstMock).toHaveBeenCalledOnce();
  });

  it('returns null when no consent exists', async () => {
    consentRecordFindFirstMock.mockResolvedValue(null);

    const result = await findActiveVisitConsent(makeGateDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    expect(result).toBeNull();
  });
});

describe('findCurrentManagementPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns current plan with reviewOverdue=false when date is valid', async () => {
    const plan = {
      id: 'plan-1',
      next_review_date: new Date('2030-01-01'),
      approved_at: new Date(),
    };
    managementPlanFindFirstMock.mockResolvedValue(plan);

    const result = await findCurrentManagementPlan(makeGateDb(), {
      orgId: 'org-1',
      caseId: 'case-1',
    });

    expect(result.current).toEqual(plan);
    expect(result.reviewOverdue).toBe(false);
    expect(managementPlanFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { effective_from: null },
            {
              effective_from: {
                lte: expect.any(Date),
              },
            },
          ],
        }),
        orderBy: [{ effective_from: 'desc' }, { version: 'desc' }, { approved_at: 'desc' }],
      }),
    );
  });

  it('returns reviewOverdue=true when next_review_date is past', async () => {
    const plan = {
      id: 'plan-1',
      next_review_date: new Date('2020-01-01'),
      approved_at: new Date(),
    };
    managementPlanFindFirstMock.mockResolvedValue(plan);

    const result = await findCurrentManagementPlan(makeGateDb(), {
      orgId: 'org-1',
      caseId: 'case-1',
    });

    expect(result.current).toEqual(plan);
    expect(result.reviewOverdue).toBe(true);
  });

  it('returns null current when no approved plan exists', async () => {
    managementPlanFindFirstMock.mockResolvedValue(null);

    const result = await findCurrentManagementPlan(makeGateDb(), {
      orgId: 'org-1',
      caseId: 'case-1',
    });

    expect(result.current).toBeNull();
    expect(result.reviewOverdue).toBe(false);
  });

  it('uses the as-of date when looking up an effective management plan', async () => {
    managementPlanFindFirstMock.mockResolvedValue(null);
    const asOf = new Date('2026-04-15T00:00:00.000Z');

    const result = await findCurrentManagementPlan(makeGateDb(), {
      orgId: 'org-1',
      caseId: 'case-1',
      asOf,
    });

    expect(result.current).toBeNull();
    expect(managementPlanFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ effective_from: null }, { effective_from: { lte: asOf } }],
        }),
      }),
    );
  });
});

describe('evaluateVisitWorkflowGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok=true when consent and plan exist', async () => {
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent-1' });
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan-1',
      next_review_date: new Date('2030-01-01'),
      approved_at: new Date(),
    });

    const result = await evaluateVisitWorkflowGate(makeGateDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
      caseId: 'case-1',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.consentId).toBe('consent-1');
    expect(result.managementPlanId).toBe('plan-1');
  });

  it('returns issues when consent and plan are missing', async () => {
    consentRecordFindFirstMock.mockResolvedValue(null);
    managementPlanFindFirstMock.mockResolvedValue(null);

    const result = await evaluateVisitWorkflowGate(makeGateDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
      caseId: 'case-1',
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain('missing_visit_consent');
    expect(result.issues).toContain('missing_management_plan');
  });

  it('detects management_plan_review_overdue', async () => {
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent-1' });
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan-1',
      next_review_date: new Date('2020-01-01'),
      approved_at: new Date(),
    });

    const result = await evaluateVisitWorkflowGate(makeGateDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
      caseId: 'case-1',
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain('management_plan_review_overdue');
  });
});

describe('evaluateVisitWorkflowGates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('evaluates recurring candidate gates with one consent read and one plan read', async () => {
    consentRecordFindManyMock.mockResolvedValue([
      {
        id: 'consent-1',
        expiry_date: new Date('2026-04-10T00:00:00.000Z'),
        obtained_date: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    managementPlanFindManyMock.mockResolvedValue([
      {
        id: 'plan-1',
        next_review_date: new Date('2026-04-20T00:00:00.000Z'),
        effective_from: new Date('2026-04-01T00:00:00.000Z'),
        version: 1,
        approved_at: new Date('2026-03-20T00:00:00.000Z'),
      },
    ]);

    const result = await evaluateVisitWorkflowGates(makeGateDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
      caseId: 'case-1',
      asOfDates: [new Date('2026-04-07T00:00:00.000Z'), new Date('2026-04-14T00:00:00.000Z')],
    });

    expect(consentRecordFindManyMock).toHaveBeenCalledTimes(1);
    expect(managementPlanFindManyMock).toHaveBeenCalledTimes(1);
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(managementPlanFindFirstMock).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        ok: true,
        issues: [],
        consentId: 'consent-1',
        managementPlanId: 'plan-1',
      },
      {
        ok: false,
        issues: ['missing_visit_consent'],
        consentId: null,
        managementPlanId: 'plan-1',
      },
    ]);
  });

  it('selects the effective approved plan for each as-of date', async () => {
    consentRecordFindManyMock.mockResolvedValue([
      {
        id: 'consent-1',
        expiry_date: null,
        obtained_date: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    managementPlanFindManyMock.mockResolvedValue([
      {
        id: 'plan-new',
        next_review_date: new Date('2026-05-01T00:00:00.000Z'),
        effective_from: new Date('2026-04-15T00:00:00.000Z'),
        version: 2,
        approved_at: new Date('2026-04-10T00:00:00.000Z'),
      },
      {
        id: 'plan-old',
        next_review_date: new Date('2026-04-10T00:00:00.000Z'),
        effective_from: new Date('2026-04-01T00:00:00.000Z'),
        version: 1,
        approved_at: new Date('2026-03-20T00:00:00.000Z'),
      },
    ]);

    const result = await evaluateVisitWorkflowGates(makeGateDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
      caseId: 'case-1',
      asOfDates: [new Date('2026-04-14T00:00:00.000Z'), new Date('2026-04-16T00:00:00.000Z')],
    });

    expect(result[0]).toMatchObject({
      ok: false,
      issues: ['management_plan_review_overdue'],
      managementPlanId: 'plan-old',
    });
    expect(result[1]).toMatchObject({
      ok: true,
      issues: [],
      managementPlanId: 'plan-new',
    });
  });
});

describe('formatVisitWorkflowGateIssues', () => {
  it('formats all issue types', () => {
    const result = formatVisitWorkflowGateIssues([
      'missing_visit_consent',
      'missing_management_plan',
    ]);
    expect(result).toContain('訪問薬剤管理の有効同意がありません');
    expect(result).toContain('承認済みの管理計画書がありません');
  });

  it('returns empty string for no issues', () => {
    const result = formatVisitWorkflowGateIssues([]);
    expect(result).toBe('');
  });

  it('parses only known issue codes from workflow gate error messages', () => {
    expect(isVisitWorkflowGateIssue('missing_visit_consent')).toBe(true);
    expect(isVisitWorkflowGateIssue('unknown_issue')).toBe(false);
    expect(
      parseVisitWorkflowGateErrorMessage(
        'VISIT_WORKFLOW_GATE:missing_visit_consent,unknown_issue,missing_management_plan',
      ),
    ).toEqual(['missing_visit_consent', 'missing_management_plan']);
    expect(parseVisitWorkflowGateErrorMessage('OTHER:missing_visit_consent')).toEqual([]);
  });
});

describe('getVisitWorkflowGuidance', () => {
  it('returns guidance for missing_visit_consent', () => {
    const result = getVisitWorkflowGuidance('missing_visit_consent');
    expect(result.severity).toBe('urgent');
    expect(result.actionHref).toBe('/workflow');
  });

  it('returns guidance for missing_management_plan', () => {
    const result = getVisitWorkflowGuidance('missing_management_plan');
    expect(result.severity).toBe('high');
  });
});

describe('buildManagementPlanReviewTaskKey', () => {
  it('generates expected key format', () => {
    expect(buildManagementPlanReviewTaskKey('plan-123')).toBe('management-plan-review:plan-123');
  });
});
