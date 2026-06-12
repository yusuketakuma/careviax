import { beforeEach, describe, expect, it, vi } from 'vitest';

const listBillingEvidenceBlockersMock = vi.hoisted(() => vi.fn());
const listCommunicationQueueMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/billing-evidence', () => ({
  listBillingEvidenceBlockers: listBillingEvidenceBlockersMock,
}));

vi.mock('@/server/services/communication-queue', () => ({
  listCommunicationQueue: listCommunicationQueueMock,
}));

import { getPatientCommunicationsData } from './patient-detail-communications';

function buildDb() {
  return {
    patient: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'patient_1',
        cases: [{ id: 'case_1' }],
      }),
    },
    visitRecord: {
      findMany: vi.fn().mockResolvedValue([{ id: 'visit_record_1' }]),
    },
    medicationCycle: {
      findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
    },
    task: {
      findMany: vi.fn().mockResolvedValue([{ id: 'task_1', title: '連絡確認' }]),
    },
    medicationIssue: {
      findMany: vi.fn().mockResolvedValue([{ id: 'issue_1', title: '残薬確認' }]),
    },
    billingEvidence: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'evidence_1',
          billing_month: new Date('2026-04-01T00:00:00.000Z'),
          claimable: false,
          exclusion_reason: 'missing_record',
          validation_notes: '訪問記録不足',
          calculation_context: {
            effective_revision_code: '2026',
            site_config_status: 'ready',
          },
        },
        {
          id: 'evidence_2',
          billing_month: new Date('2026-04-01T00:00:00.000Z'),
          claimable: true,
          exclusion_reason: null,
          validation_notes: null,
          calculation_context: {},
        },
      ]),
    },
    billingCandidate: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'candidate_1',
          billing_month: new Date('2026-04-01T00:00:00.000Z'),
          billing_code: 'B001',
          billing_name: '在宅患者訪問薬剤管理指導料',
          points: 650,
          status: 'candidate',
          exclusion_reason: null,
          source_snapshot: {
            revision_code: '2026',
            site_config_status: 'ready',
          },
        },
      ]),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listBillingEvidenceBlockersMock.mockResolvedValue([
    { id: 'evidence_1', blockers: ['訪問記録が不足しています。'] },
  ]);
  listCommunicationQueueMock.mockResolvedValue({
    items: [{ id: 'queue_1', kind: 'callback' }],
  });
});

describe('getPatientCommunicationsData', () => {
  it('builds communications queues and billing summaries from assigned case refs', async () => {
    const db = buildDb();

    const result = await getPatientCommunicationsData(db as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'pharmacist_1',
    });

    expect(db.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'patient_1',
          org_id: 'org_1',
        }),
      }),
    );
    expect(db.visitRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          schedule: {
            case_id: { in: ['case_1'] },
          },
        },
      }),
    );
    expect(db.billingEvidence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          OR: [{ visit_record_id: { in: ['visit_record_1'] } }, { cycle_id: { in: ['cycle_1'] } }],
        },
      }),
    );
    expect(listBillingEvidenceBlockersMock).toHaveBeenCalledWith(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      visitRecordIds: ['visit_record_1'],
      cycleIds: ['cycle_1'],
      limit: 6,
    });
    expect(listCommunicationQueueMock).toHaveBeenCalledWith(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseIds: ['case_1'],
      limit: 6,
    });
    expect(result).toMatchObject({
      communication_queue: {
        items: [{ id: 'queue_1', kind: 'callback' }],
      },
      open_tasks: [{ id: 'task_1', title: '連絡確認' }],
      medication_issues: [{ id: 'issue_1', title: '残薬確認' }],
      billing_summary: {
        claimable_count: 1,
        blocked_count: 1,
        evidence: [
          expect.objectContaining({
            id: 'evidence_1',
            effective_revision_code: '2026',
            site_config_status: 'ready',
            blockers: ['訪問記録が不足しています。'],
          }),
          expect.objectContaining({
            id: 'evidence_2',
            blockers: [],
          }),
        ],
        candidates: [
          expect.objectContaining({
            id: 'candidate_1',
            effective_revision_code: '2026',
            site_config_status: 'ready',
          }),
        ],
      },
    });
  });
});
