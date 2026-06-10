import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listBillingEvidenceBlockersMock } = vi.hoisted(() => ({
  listBillingEvidenceBlockersMock: vi.fn(),
}));

vi.mock('./billing-evidence', () => ({
  listBillingEvidenceBlockers: listBillingEvidenceBlockersMock,
}));

import {
  evaluateVisitScheduleReadyTransition,
  getVisitReadyTransitionErrorMessage,
  VISIT_READY_CHECKLIST_BLOCKED_MESSAGE,
  VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER,
  VISIT_READY_CONTEXT_BLOCKED_MESSAGE,
  type VisitReadyTransitionBlockers,
} from './visit-preparation-readiness';

const completePreparation = {
  medication_changes_reviewed: true,
  carry_items_confirmed: true,
  previous_issues_reviewed: true,
  route_confirmed: true,
  offline_synced: true,
};

const completePreparationRecord = {
  org_id: 'org_1',
  ...completePreparation,
};

function makeSchedule(
  overrides: Partial<{
    scheduledDate: Date;
    carryItemsStatus: 'ready' | 'partial' | 'blocked' | null;
    preparation: typeof completePreparationRecord | null;
    contacts: Array<{ id: string }>;
    careTeamLinks: Array<{ role: string }>;
  }> = {},
) {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    carry_items_status: overrides.carryItemsStatus ?? 'ready',
    scheduled_date: overrides.scheduledDate ?? new Date('2026-04-15T00:00:00.000Z'),
    preparation: overrides.preparation ?? completePreparationRecord,
    case_: {
      patient: {
        id: 'patient_1',
        org_id: 'org_1',
        contacts: overrides.contacts ?? [{ id: 'contact_1' }],
      },
      care_team_links: overrides.careTeamLinks ?? [{ role: 'physician' }],
    },
  };
}

function makeDb(schedule: ReturnType<typeof makeSchedule> | null = makeSchedule()) {
  return {
    visitSchedule: {
      findFirst: vi.fn().mockResolvedValue(schedule),
    },
    consentRecord: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'consent_1',
        expiry_date: null,
      }),
    },
    firstVisitDocument: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'first_visit_doc_1',
        delivered_at: new Date('2026-04-01T00:00:00.000Z'),
      }),
    },
    managementPlan: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'plan_1',
        status: 'approved',
        next_review_date: null,
      }),
    },
    visitRecord: {
      findMany: vi.fn().mockResolvedValue([{ id: 'visit_record_1' }]),
    },
    medicationCycle: {
      findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
    },
    billingEvidence: {
      findMany: vi.fn(),
    },
  };
}

function asReadyTransitionDb(db: ReturnType<typeof makeDb>) {
  return db as unknown as Parameters<typeof evaluateVisitScheduleReadyTransition>[0];
}

describe('evaluateVisitScheduleReadyTransition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listBillingEvidenceBlockersMock.mockResolvedValue([]);
  });

  it('allows ready transition when checklist, onboarding, and billing blockers are clear', async () => {
    const db = makeDb();

    const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
      orgId: 'org_1',
      scheduleId: 'schedule_1',
    });

    expect(result).toEqual({ ok: true });
    expect(listBillingEvidenceBlockersMock).toHaveBeenCalledWith(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      visitRecordIds: ['visit_record_1'],
      cycleIds: ['cycle_1'],
      limit: 4,
    });
    expect(db.consentRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          OR: [
            { expiry_date: null },
            { expiry_date: { gte: new Date('2026-04-15T00:00:00.000Z') } },
          ],
        }),
      }),
    );
  });

  it('blocks ready transition when checklist items are incomplete', async () => {
    const db = makeDb(
      makeSchedule({
        preparation: {
          ...completePreparationRecord,
          carry_items_confirmed: false,
          offline_synced: false,
        },
      }),
    );

    const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
      orgId: 'org_1',
      scheduleId: 'schedule_1',
    });

    expect(result).toMatchObject({
      ok: false,
      details: {
        readiness_blockers: ['持参薬・物品確認', 'オフライン同期確認'],
        onboarding_blockers: [],
        billing_blockers: [],
      },
    });
    if (!result.ok) {
      expect(getVisitReadyTransitionErrorMessage(result.details)).toBe(
        VISIT_READY_CHECKLIST_BLOCKED_MESSAGE,
      );
    }
  });

  it.each(['partial', 'blocked'] as const)(
    'blocks ready transition when carry_items_status is %s',
    async (carryItemsStatus) => {
      const db = makeDb(makeSchedule({ carryItemsStatus }));

      const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
        orgId: 'org_1',
        scheduleId: 'schedule_1',
      });

      expect(result).toMatchObject({
        ok: false,
        details: {
          readiness_blockers: [VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER],
          onboarding_blockers: [],
          billing_blockers: [],
        },
      });
      if (!result.ok) {
        expect(result.details.readiness_blockers).not.toContain('持参薬・物品確認');
        expect(getVisitReadyTransitionErrorMessage(result.details)).toBe(
          VISIT_READY_CHECKLIST_BLOCKED_MESSAGE,
        );
      }
    },
  );

  it.each(['ready', null] as const)(
    'does not block ready transition when carry_items_status is %s',
    async (carryItemsStatus) => {
      const db = makeDb(makeSchedule({ carryItemsStatus }));

      const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
        orgId: 'org_1',
        scheduleId: 'schedule_1',
      });

      expect(result).toEqual({ ok: true });
    },
  );

  it('blocks ready transition when onboarding prerequisites are missing', async () => {
    const db = makeDb(
      makeSchedule({
        contacts: [],
        careTeamLinks: [{ role: 'care_manager' }],
      }),
    );
    db.consentRecord.findFirst.mockResolvedValueOnce(null);
    db.firstVisitDocument.findFirst.mockResolvedValueOnce(null);
    db.managementPlan.findFirst.mockResolvedValueOnce(null);

    const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
      orgId: 'org_1',
      scheduleId: 'schedule_1',
    });

    expect(result).toMatchObject({
      ok: false,
      details: {
        readiness_blockers: [],
        onboarding_blockers: [
          { key: 'consent_obtained', label: '同意未取得' },
          { key: 'emergency_contact_set', label: '緊急連絡先未登録' },
          { key: 'first_visit_doc_delivered', label: '初回文書未交付' },
          { key: 'management_plan_approved', label: '管理計画未承認' },
          { key: 'primary_physician_set', label: '主治医未設定' },
        ],
        billing_blockers: [],
      },
    });
    if (!result.ok) {
      expect(getVisitReadyTransitionErrorMessage(result.details)).toBe(
        VISIT_READY_CONTEXT_BLOCKED_MESSAGE,
      );
    }
  });

  it('blocks ready transition when consent is expired or the management plan review is overdue', async () => {
    const db = makeDb();
    db.consentRecord.findFirst.mockResolvedValueOnce(null);
    db.managementPlan.findFirst.mockResolvedValueOnce({
      id: 'plan_1',
      status: 'approved',
      next_review_date: new Date('2026-04-01T00:00:00.000Z'),
    });

    const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
      orgId: 'org_1',
      scheduleId: 'schedule_1',
    });

    expect(result).toMatchObject({
      ok: false,
      details: {
        readiness_blockers: [],
        onboarding_blockers: [
          { key: 'consent_obtained', label: '同意未取得' },
          { key: 'management_plan_approved', label: '管理計画未承認' },
        ],
        billing_blockers: [],
      },
    });
  });

  it('blocks ready transition when no management plan is effective on the scheduled date', async () => {
    const db = makeDb();
    db.managementPlan.findFirst.mockResolvedValueOnce(null);

    const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
      orgId: 'org_1',
      scheduleId: 'schedule_1',
    });

    expect(result).toMatchObject({
      ok: false,
      details: {
        readiness_blockers: [],
        onboarding_blockers: [{ key: 'management_plan_approved', label: '管理計画未承認' }],
        billing_blockers: [],
      },
    });
    expect(db.managementPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { effective_from: null },
            { effective_from: { lte: new Date('2026-04-15T00:00:00.000Z') } },
          ],
        }),
      }),
    );
  });

  it('fails closed when the preparation record belongs to another organization', async () => {
    const db = makeDb(
      makeSchedule({
        preparation: {
          ...completePreparationRecord,
          org_id: 'org_other',
        },
      }),
    );

    const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
      orgId: 'org_1',
      scheduleId: 'schedule_1',
    });

    expect(result).toMatchObject({
      ok: false,
      details: {
        readiness_blockers: [
          '薬歴・前回変更の確認',
          '持参薬・物品確認',
          '前回課題の確認',
          'ルート確認',
          'オフライン同期確認',
        ],
        onboarding_blockers: [],
        billing_blockers: [],
      },
    });
  });

  it('accepts normalized physician care-team roles', async () => {
    const db = makeDb(
      makeSchedule({
        careTeamLinks: [{ role: 'doctor' }],
      }),
    );

    const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
      orgId: 'org_1',
      scheduleId: 'schedule_1',
    });

    expect(result).toEqual({ ok: true });
  });

  it('blocks ready transition when billing evidence blockers remain', async () => {
    const billingBlocker = {
      key: 'missing_management_plan',
      reason: '算定根拠が未確認',
      action_href: '/billing',
      action_label: '算定根拠を確認',
      severity: 'high',
    } as const;
    listBillingEvidenceBlockersMock.mockResolvedValueOnce([
      {
        id: 'billing_1',
        visit_record_id: 'visit_record_1',
        validation_notes: null,
        blockers: [billingBlocker],
      },
    ]);
    const db = makeDb();

    const result = await evaluateVisitScheduleReadyTransition(asReadyTransitionDb(db), {
      orgId: 'org_1',
      scheduleId: 'schedule_1',
    });

    expect(result).toMatchObject({
      ok: false,
      details: {
        readiness_blockers: [],
        onboarding_blockers: [],
        billing_blockers: [
          {
            evidence_id: 'billing_1',
            visit_record_id: 'visit_record_1',
            ...billingBlocker,
          },
        ],
      },
    } satisfies { ok: false; details: VisitReadyTransitionBlockers });
  });
});
