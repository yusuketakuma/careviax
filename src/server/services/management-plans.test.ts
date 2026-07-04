import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  consentRecordFindFirstMock,
  consentRecordFindManyMock,
  dispatchNotificationEventMock,
  managementPlanFindFirstMock,
  managementPlanFindManyMock,
  upsertOperationalTaskMock,
} = vi.hoisted(() => ({
  consentRecordFindFirstMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('./notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('./operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
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
  scheduleManagementPlanReviewAlert,
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

  it('does not mark a review due today in Japan as overdue under a non-Tokyo runtime TZ', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const plan = {
        id: 'plan-1',
        next_review_date: new Date('2026-06-12T00:00:00.000Z'),
        approved_at: new Date(),
      };
      managementPlanFindFirstMock.mockResolvedValue(plan);

      const result = await findCurrentManagementPlan(makeGateDb(), {
        orgId: 'org-1',
        caseId: 'case-1',
        asOf: new Date('2026-06-12T14:30:00.000Z'),
      });

      expect(result.current).toEqual(plan);
      expect(result.reviewOverdue).toBe(false);
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it('marks a review due yesterday in Japan as overdue under a non-Tokyo runtime TZ', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const plan = {
        id: 'plan-1',
        next_review_date: new Date('2026-06-12T00:00:00.000Z'),
        approved_at: new Date(),
      };
      managementPlanFindFirstMock.mockResolvedValue(plan);

      const result = await findCurrentManagementPlan(makeGateDb(), {
        orgId: 'org-1',
        caseId: 'case-1',
        asOf: new Date('2026-06-12T15:30:00.000Z'),
      });

      expect(result.current).toEqual(plan);
      expect(result.reviewOverdue).toBe(true);
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
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

  it('uses Japan business-day review boundaries for batch workflow gates under a non-Tokyo runtime TZ', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      consentRecordFindManyMock.mockResolvedValue([
        {
          id: 'consent-1',
          expiry_date: null,
          obtained_date: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
      managementPlanFindManyMock.mockResolvedValue([
        {
          id: 'plan-1',
          next_review_date: new Date('2026-06-12T00:00:00.000Z'),
          effective_from: new Date('2026-06-01T00:00:00.000Z'),
          version: 1,
          approved_at: new Date('2026-05-20T00:00:00.000Z'),
        },
      ]);

      const result = await evaluateVisitWorkflowGates(makeGateDb(), {
        orgId: 'org-1',
        patientId: 'p-1',
        caseId: 'case-1',
        asOfDates: [new Date('2026-06-12T14:30:00.000Z'), new Date('2026-06-12T15:30:00.000Z')],
      });

      expect(result[0]).toMatchObject({
        ok: true,
        issues: [],
        managementPlanId: 'plan-1',
      });
      expect(result[1]).toMatchObject({
        ok: false,
        issues: ['management_plan_review_overdue'],
        managementPlanId: 'plan-1',
      });
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
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

describe('scheduleManagementPlanReviewAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchNotificationEventMock.mockResolvedValue([]);
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task-1' });
  });

  it('encodes notification patient links while preserving raw task and notification identity', async () => {
    const rawPatientId = 'patient/1?tab=x#frag';
    const encodedPatientHref = `/patients/${encodeURIComponent(rawPatientId)}`;
    const tx = {} as Parameters<typeof scheduleManagementPlanReviewAlert>[0];
    const dueDate = new Date('2026-04-30T00:00:00.000Z');

    await scheduleManagementPlanReviewAlert(tx, {
      orgId: 'org_1',
      planId: 'plan_1',
      caseId: 'case_1',
      patientId: rawPatientId,
      dueDate,
      assignedTo: 'pharmacist_1',
    });

    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'management_plan_review',
        assignedTo: 'pharmacist_1',
        dueDate,
        slaDueAt: dueDate,
        dedupeKey: 'management-plan-review:plan_1',
        relatedEntityType: 'management_plan',
        relatedEntityId: 'plan_1',
        metadata: {
          case_id: 'case_1',
          patient_id: rawPatientId,
        },
      }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'management_plan_review_due',
        link: encodedPatientHref,
        explicitUserIds: ['pharmacist_1'],
        dedupeKey: 'management-plan-review:plan_1',
        metadata: {
          plan_id: 'plan_1',
          case_id: 'case_1',
          patient_id: rawPatientId,
        },
      }),
    );
  });
});
