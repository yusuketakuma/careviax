import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selfReportFindManyMock,
  contactLogFindManyMock,
  communicationRequestFindManyMock,
  deliveryRecordFindManyMock,
  externalAccessGrantFindManyMock,
  careReportFindManyMock,
  tracingReportFindManyMock,
  patientFindFirstMock,
  patientFindManyMock,
  medicationIssueFindManyMock,
} = vi.hoisted(() => ({
  selfReportFindManyMock: vi.fn(),
  contactLogFindManyMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  deliveryRecordFindManyMock: vi.fn(),
  externalAccessGrantFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  tracingReportFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/utils/date', () => ({
  isoOrNull: (v: Date | null | undefined) => (v ? v.toISOString() : null),
}));

import { listCommunicationQueue } from './communication-queue';

function makeDb() {
  return {
    patientSelfReport: { findMany: selfReportFindManyMock },
    visitScheduleContactLog: { findMany: contactLogFindManyMock },
    communicationRequest: { findMany: communicationRequestFindManyMock },
    deliveryRecord: { findMany: deliveryRecordFindManyMock },
    externalAccessGrant: { findMany: externalAccessGrantFindManyMock },
    careReport: { findMany: careReportFindManyMock },
    tracingReport: { findMany: tracingReportFindManyMock },
    patient: {
      findFirst: patientFindFirstMock,
      findMany: patientFindManyMock,
    },
    medicationIssue: { findMany: medicationIssueFindManyMock },
  };
}

function emptyDbMocks() {
  selfReportFindManyMock.mockResolvedValue([]);
  contactLogFindManyMock.mockResolvedValue([]);
  communicationRequestFindManyMock.mockResolvedValue([]);
  deliveryRecordFindManyMock.mockResolvedValue([]);
  externalAccessGrantFindManyMock.mockResolvedValue([]);
  careReportFindManyMock.mockResolvedValue([]);
  tracingReportFindManyMock.mockResolvedValue([]);
  patientFindFirstMock.mockResolvedValue(null);
  patientFindManyMock.mockResolvedValue([]);
  medicationIssueFindManyMock.mockResolvedValue([]);
}

describe('listCommunicationQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty overview when no data exists', async () => {
    emptyDbMocks();

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(result.summary.pending_count).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.timeline).toEqual([]);
    expect(result.emergency_drafts).toEqual([]);
  });

  it('includes self reports as queue items', async () => {
    emptyDbMocks();
    selfReportFindManyMock.mockResolvedValue([
      {
        id: 'sr-1',
        patient_id: 'p-1',
        subject: '体調不良',
        category: 'symptom',
        requested_callback: true,
        preferred_contact_time: '午前中',
        reported_by_name: '家族A',
        status: 'submitted',
        created_at: new Date('2026-04-01T08:00:00Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '田中太郎' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(result.summary.self_reports).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].queue_type).toBe('self_report');
    expect(result.items[0].priority).toBe('urgent'); // has callback
    expect(result.items[0].patient_name).toBe('田中太郎');
  });

  it('includes communication requests as queue items', async () => {
    emptyDbMocks();
    communicationRequestFindManyMock.mockResolvedValue([
      {
        id: 'cr-1',
        patient_id: 'p-1',
        request_type: 'physician_inquiry',
        subject: '処方確認',
        content: '用量について確認',
        template_key: null,
        status: 'sent',
        due_date: new Date('2026-04-02'),
        requested_at: new Date('2026-04-01'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '佐藤花子' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
    });

    expect(result.summary.open_requests).toBe(1);
    expect(result.items.some((i) => i.queue_type === 'request')).toBe(true);
  });

  it('scopes case-backed communication records when caseIds are provided', async () => {
    emptyDbMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '患者A',
      contacts: [],
    });

    await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
      caseIds: ['case-1'],
      limit: 3,
    });

    const caseScope = {
      OR: [{ case_id: null }, { case_id: { in: ['case-1'] } }],
    };
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          AND: [caseScope],
        }),
      }),
    );
    expect(contactLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          case_id: { in: ['case-1'] },
        }),
      }),
    );
    expect(deliveryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          report: expect.objectContaining({
            patient_id: 'p-1',
            AND: [caseScope],
          }),
        }),
      }),
    );
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          AND: [caseScope],
        }),
      }),
    );
    expect(tracingReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          AND: [caseScope],
        }),
      }),
    );
    expect(medicationIssueFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'p-1',
          OR: [{ case_id: null }, { case_id: { in: ['case-1'] } }],
        }),
      }),
    );
  });

  it('applies bulk patientIds and caseIds to dashboard communication queue sources', async () => {
    emptyDbMocks();

    await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientIds: ['p-1', 'p-2'],
      caseIds: ['case-1'],
      limit: 3,
    });

    const patientScope = { patient_id: { in: ['p-1', 'p-2'] } };
    const caseScope = {
      OR: [{ case_id: null }, { case_id: { in: ['case-1'] } }],
    };
    expect(selfReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining(patientScope),
      }),
    );
    expect(contactLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          case_id: { in: ['case-1'] },
        }),
      }),
    );
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          AND: [caseScope],
        }),
      }),
    );
    expect(deliveryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          report: expect.objectContaining({
            ...patientScope,
            AND: [caseScope],
          }),
        }),
      }),
    );
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          AND: [caseScope],
        }),
      }),
    );
    expect(tracingReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          AND: [caseScope],
        }),
      }),
    );
    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ...patientScope,
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { scope: { path: ['allowed_case_ids'], array_contains: ['case-1'] } },
              ]),
            }),
          ]),
        }),
        take: 3,
      }),
    );
  });

  it('builds emergency drafts when patientId is provided and patient has contacts', async () => {
    emptyDbMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '高橋一郎',
      contacts: [
        { name: '山田医師', relation: 'physician', is_emergency_contact: false },
        { name: '家族太郎', relation: 'spouse', is_emergency_contact: true },
      ],
    });
    medicationIssueFindManyMock.mockResolvedValue([]);
    selfReportFindManyMock.mockResolvedValue([]);
    patientFindManyMock.mockResolvedValue([]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    expect(result.emergency_drafts.length).toBeGreaterThan(0);
    const templateKeys = result.emergency_drafts.map((d) => d.template_key);
    expect(templateKeys).toContain('emergency_physician');
    expect(templateKeys).toContain('emergency_family');
  });

  it('suggests missing emergency contact draft when no emergency contacts exist', async () => {
    emptyDbMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'p-1',
      name: '独居太郎',
      contacts: [],
    });
    medicationIssueFindManyMock.mockResolvedValue([]);
    selfReportFindManyMock.mockResolvedValue([]);
    patientFindManyMock.mockResolvedValue([]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    const gapDraft = result.emergency_drafts.find(
      (d) => d.template_key === 'missing_emergency_contact',
    );
    expect(gapDraft).toBeDefined();
    expect(gapDraft!.title).toContain('緊急連絡先');
  });

  it('limits items to requested limit', async () => {
    emptyDbMocks();
    selfReportFindManyMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `sr-${i}`,
        patient_id: `p-${i}`,
        subject: `件名${i}`,
        category: 'symptom',
        requested_callback: false,
        preferred_contact_time: null,
        reported_by_name: '報告者',
        status: 'submitted',
        created_at: new Date(),
      })),
    );
    patientFindManyMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `p-${i}`,
        name: `患者${i}`,
      })),
    );

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      limit: 2,
    });

    expect(result.items.length).toBeLessThanOrEqual(2);
  });

  it('filters external share visibility before applying the final queue item limit', async () => {
    emptyDbMocks();
    externalAccessGrantFindManyMock.mockResolvedValue([
      {
        id: 'visible-1',
        patient_id: 'p-1',
        granted_to_name: '担当内',
        expires_at: new Date('2026-04-02T00:00:00Z'),
        scope: { care_reports: true, allowed_case_ids: ['case-1'] },
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '田中太郎' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientIds: ['p-hidden', 'p-1'],
      caseIds: ['case-1'],
      limit: 1,
    });

    expect(externalAccessGrantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { scope: { path: ['allowed_case_ids'], array_contains: ['case-1'] } },
              ]),
            }),
          ]),
        }),
      }),
    );
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    expect(result.summary.expiring_external_shares).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'external_share:visible-1',
        patient_id: 'p-1',
      }),
    ]);
  });

  it('queries DB-visible external shares without offset paging hidden grants', async () => {
    emptyDbMocks();
    externalAccessGrantFindManyMock.mockResolvedValue([
      {
        id: 'visible-db-filtered',
        patient_id: 'p-1',
        granted_to_name: '担当内',
        expires_at: new Date('2026-04-02T00:00:00Z'),
        scope: { care_reports: true, allowed_case_ids: ['case-1'] },
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'p-1', name: '田中太郎' }]);

    const result = await listCommunicationQueue(makeDb(), {
      orgId: 'org-1',
      patientIds: ['p-hidden', 'p-1'],
      caseIds: ['case-1'],
      limit: 1,
    });

    expect(externalAccessGrantFindManyMock).toHaveBeenCalledTimes(1);
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        take: 1,
        orderBy: [{ expires_at: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(externalAccessGrantFindManyMock.mock.calls[0][0]).not.toHaveProperty('skip');
    expect(result.summary.expiring_external_shares).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'external_share:visible-db-filtered',
        patient_id: 'p-1',
      }),
    ]);
  });
});
