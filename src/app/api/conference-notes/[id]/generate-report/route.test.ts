import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  conferenceNoteFindFirstMock,
  conferenceNoteUpdateMock,
  careCaseFindFirstMock,
  careReportFindManyMock,
  careReportCreateManyMock,
  deliveryRecordFindManyMock,
  deliveryRecordCreateManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  conferenceNoteFindFirstMock: vi.fn(),
  conferenceNoteUpdateMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  careReportCreateManyMock: vi.fn(),
  deliveryRecordFindManyMock: vi.fn(),
  deliveryRecordCreateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    conferenceNote: {
      findFirst: conferenceNoteFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body?: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/conference-notes/[id]/generate-report POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conferenceNoteFindFirstMock.mockResolvedValue({
      id: 'note_1',
      case_id: 'case_1',
      patient_id: 'patient_1',
      note_type: 'service_manager',
      title: '担当者会議',
      content: '本文サマリー',
      conference_date: new Date('2026-03-30T10:00:00.000Z'),
      participants: [
        {
          name: '佐藤CM',
          role: 'care_manager',
          attended: true,
          is_report_recipient: true,
          email: 'cm@example.com',
        },
      ],
      structured_content: {
        template: 'service_manager',
        sections: [{ key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' }],
      },
      metadata: null,
      generated_report_id: null,
      action_items: [],
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
    });
    careReportFindManyMock.mockImplementation(
      async (args?: { where?: { report_type?: { in?: string[] } } }) => {
        if (args?.where?.report_type?.in?.length) {
          return [{ id: 'report_cm_1', report_type: args.where.report_type.in[0] }];
        }
        return [];
      },
    );
    careReportCreateManyMock.mockResolvedValue({ count: 1 });
    deliveryRecordFindManyMock.mockResolvedValue([]);
    deliveryRecordCreateManyMock.mockResolvedValue({ count: 1 });
    conferenceNoteUpdateMock.mockResolvedValue({
      id: 'note_1',
      generated_report_id: 'report_cm_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        conferenceNote: {
          update: conferenceNoteUpdateMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        careReport: {
          findMany: careReportFindManyMock,
          createMany: careReportCreateManyMock,
        },
        deliveryRecord: {
          findMany: deliveryRecordFindManyMock,
          createMany: deliveryRecordCreateManyMock,
        },
      }),
    );
  });

  it('creates a care manager report draft and queues draft delivery records', async () => {
    const response = await POST(
      createRequest({
        report_type: 'care_manager_report',
        auto_send: true,
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(careReportCreateManyMock).toHaveBeenCalledTimes(1);
    expect(deliveryRecordCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            report_id: 'report_cm_1',
            channel: 'email',
            recipient_name: '佐藤CM',
            recipient_contact: 'cm@example.com',
            status: 'draft',
          }),
        ]),
      }),
    );
    expect(conferenceNoteUpdateMock).toHaveBeenCalledWith({
      where: { id: 'note_1' },
      data: {
        generated_report_id: 'report_cm_1',
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      data: {
        report_draft_ids: ['report_cm_1'],
        queued_recipients: [
          {
            report_id: 'report_cm_1',
            name: '佐藤CM',
            channel: 'email',
          },
        ],
      },
    });
  });

  it('does not create duplicate delivery drafts when the same recipient is already queued', async () => {
    deliveryRecordFindManyMock.mockResolvedValue([
      {
        report_id: 'report_cm_1',
        channel: 'email',
        recipient_contact: 'cm@example.com',
      },
    ]);

    const response = await POST(
      createRequest({
        report_type: 'care_manager_report',
        auto_send: true,
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(deliveryRecordCreateManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        queued_recipients: [],
      },
    });
  });

  it('can generate a report without structured content in the body', async () => {
    const response = await POST(
      createRequest({
        report_type: 'care_manager_report',
        include_structured_content: false,
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(careReportCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            content: expect.objectContaining({
              body: '',
              sections: [],
              disclosure_scope: expect.objectContaining({
                audience: 'care_manager_report',
                sanitized: true,
                included_section_keys: [],
              }),
            }),
          }),
        ]),
      }),
    );
  });

  it('generates a report for a patient-scoped conference note without a case', async () => {
    conferenceNoteFindFirstMock.mockResolvedValueOnce({
      id: 'note_patient_only',
      case_id: null,
      patient_id: 'patient_1',
      note_type: 'service_manager',
      title: '担当者会議',
      content: '本文サマリー',
      conference_date: new Date('2026-03-30T10:00:00.000Z'),
      participants: [],
      structured_content: {
        template: 'service_manager',
        sections: [{ key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' }],
      },
      metadata: null,
      generated_report_id: null,
      action_items: [],
    });

    const response = await POST(createRequest({ report_type: 'care_manager_report' }), {
      params: Promise.resolve({ id: 'note_patient_only' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            patient_id: 'patient_1',
            case_id: null,
            report_type: 'care_manager_report',
          }),
        ]),
      }),
    );
  });
});
