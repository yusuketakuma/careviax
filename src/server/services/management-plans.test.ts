import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  consentRecordFindFirstMock,
  managementPlanFindFirstMock,
} = vi.hoisted(() => ({
  consentRecordFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
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
  formatVisitWorkflowGateIssues,
  getVisitWorkflowGuidance,
  buildManagementPlanReviewTaskKey,
} from './management-plans';

function makeGateDb() {
  return {
    consentRecord: { findFirst: consentRecordFindFirstMock },
    managementPlan: { findFirst: managementPlanFindFirstMock },
  } as unknown as Parameters<typeof evaluateVisitWorkflowGate>[0];
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
    expect(buildManagementPlanReviewTaskKey('plan-123')).toBe(
      'management-plan-review:plan-123'
    );
  });
});
