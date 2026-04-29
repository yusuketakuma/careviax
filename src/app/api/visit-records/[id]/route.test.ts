import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitRecordFindFirstMock,
  visitRecordUpdateMock,
  auditLogFindFirstMock,
  userFindManyMock,
  careCaseFindFirstMock,
  patientSchedulePreferenceFindFirstMock,
  withOrgContextMock,
  getStoredFileRecordMock,
  toVisitRecordAttachmentMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  visitRecordUpdateMock: vi.fn(),
  auditLogFindFirstMock: vi.fn(),
  userFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientSchedulePreferenceFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  getStoredFileRecordMock: vi.fn(),
  toVisitRecordAttachmentMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
    auditLog: {
      findFirst: auditLogFindFirstMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    patientSchedulePreference: {
      findFirst: patientSchedulePreferenceFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/file-storage', () => ({
  getStoredFileRecord: getStoredFileRecordMock,
  toVisitRecordAttachment: toVisitRecordAttachmentMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown) {
  return {
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/visit-records/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    auditLogFindFirstMock.mockResolvedValue({ actor_id: 'user_1' });
    userFindManyMock.mockResolvedValue([{ id: 'user_1', name: '薬剤師A' }]);
    careCaseFindFirstMock.mockResolvedValue(null);
    patientSchedulePreferenceFindFirstMock.mockResolvedValue(null);
    toVisitRecordAttachmentMock.mockImplementation((record) => ({
      file_id: record.id,
      file_name: record.originalName,
      mime_type: record.mimeType,
      size_bytes: record.sizeBytes,
      uploaded_at: record.completedAt ?? null,
      kind: record.mimeType.startsWith('image/') ? 'photo' : 'attachment',
    }));
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitRecord: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'visit_1',
            version: 1,
            schedule: {
              pharmacist_id: 'user_1',
              case_: {
                primary_pharmacist_id: 'user_primary',
                backup_pharmacist_id: null,
              },
            },
          }),
          update: visitRecordUpdateMock,
        },
      }),
    );
  });

  it('returns visit record attachments as a normalized list', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      org_id: 'org_1',
      schedule_id: 'schedule_1',
      patient_id: 'patient_1',
      pharmacist_id: 'user_1',
      visit_date: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      outcome_status: 'completed',
      soap_subjective: null,
      soap_objective: null,
      soap_assessment: null,
      soap_plan: null,
      receipt_person_name: null,
      receipt_person_relation: null,
      receipt_at: null,
      next_visit_suggestion_date: null,
      cancellation_reason: null,
      postpone_reason: null,
      revisit_reason: null,
      version: 1,
      created_at: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      updated_at: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      attachments: [
        {
          file_id: '11111111-1111-4111-8111-111111111111',
          file_name: 'visit-photo.png',
          mime_type: 'image/png',
          size_bytes: 1024,
          uploaded_at: '2026-03-28T00:00:00.000Z',
          kind: 'photo',
        },
      ],
      schedule: {
        id: 'schedule_1',
        case_id: 'case_1',
        site_id: null,
        pharmacist_id: 'user_1',
        visit_type: 'home_visit',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        recurrence_rule: null,
        time_window_start: null,
        time_window_end: null,
        case_: {
          primary_pharmacist_id: 'user_primary',
          backup_pharmacist_id: null,
        },
      },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'visit_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'visit_1',
      attachments: [
        {
          file_id: '11111111-1111-4111-8111-111111111111',
          file_name: 'visit-photo.png',
          mime_type: 'image/png',
          size_bytes: 1024,
          kind: 'photo',
        },
      ],
    });
  });

  it('returns 403 when a pharmacist reads another schedule assignment visit record', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      org_id: 'org_1',
      schedule_id: 'schedule_1',
      patient_id: 'patient_1',
      pharmacist_id: 'user_other',
      visit_date: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      outcome_status: 'completed',
      soap_subjective: null,
      soap_objective: null,
      soap_assessment: null,
      soap_plan: null,
      receipt_person_name: null,
      receipt_person_relation: null,
      receipt_at: null,
      next_visit_suggestion_date: null,
      cancellation_reason: null,
      postpone_reason: null,
      revisit_reason: null,
      version: 1,
      created_at: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      updated_at: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      attachments: [],
      schedule: {
        id: 'schedule_1',
        case_id: 'case_1',
        site_id: null,
        pharmacist_id: 'user_other',
        visit_type: 'home_visit',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        recurrence_rule: null,
        time_window_start: null,
        time_window_end: null,
        case_: {
          primary_pharmacist_id: 'user_primary',
          backup_pharmacist_id: null,
        },
      },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'visit_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns 403 before attachment validation when a pharmacist patches another schedule assignment visit record', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitRecord: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'visit_1',
            version: 1,
            schedule: {
              pharmacist_id: 'user_other',
              case_: {
                primary_pharmacist_id: 'user_primary',
                backup_pharmacist_id: null,
              },
            },
          }),
          update: visitRecordUpdateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        version: 1,
        attachments: [{ file_id: '11111111-1111-4111-8111-111111111111' }],
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(getStoredFileRecordMock).not.toHaveBeenCalled();
    expect(visitRecordUpdateMock).not.toHaveBeenCalled();
  });

  it('stores validated attachment metadata on PATCH', async () => {
    getStoredFileRecordMock.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      orgId: 'org_1',
      purpose: 'visit-photo',
      storageKey: 'visit-photos/org_1/visit_1/file-1-photo.png',
      originalName: 'visit-photo.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      status: 'uploaded',
      visitRecordId: 'visit_1',
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
      completedAt: '2026-03-28T00:00:00.000Z',
      downloadDisposition: 'inline',
    });
    visitRecordUpdateMock.mockResolvedValue({
      id: 'visit_1',
      version: 2,
      attachments: [],
    });

    const response = await PATCH(
      createRequest({
        version: 1,
        attachments: [{ file_id: '11111111-1111-4111-8111-111111111111' }],
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitRecordUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visit_1' },
        data: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              file_id: '11111111-1111-4111-8111-111111111111',
              file_name: 'visit-photo.png',
              mime_type: 'image/png',
            }),
          ],
          version: { increment: 1 },
        }),
      }),
    );
  });

  it('rejects schedule and patient reassignment on PATCH before updating', async () => {
    const response = await PATCH(
      createRequest({
        version: 1,
        schedule_id: 'schedule_other',
        patient_id: 'patient_other',
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitRecordUpdateMock).not.toHaveBeenCalled();
  });

  it('includes baseline_context with care_level, adl_level, dementia_level from intake data', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      org_id: 'org_1',
      schedule_id: 'schedule_1',
      patient_id: 'patient_1',
      pharmacist_id: 'user_1',
      visit_date: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      outcome_status: 'completed',
      soap_subjective: null,
      soap_objective: null,
      soap_assessment: null,
      soap_plan: null,
      receipt_person_name: null,
      receipt_person_relation: null,
      receipt_at: null,
      next_visit_suggestion_date: null,
      cancellation_reason: null,
      postpone_reason: null,
      revisit_reason: null,
      version: 1,
      created_at: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      updated_at: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      attachments: [],
      schedule: {
        id: 'schedule_1',
        case_id: 'case_1',
        site_id: null,
        pharmacist_id: 'user_1',
        visit_type: 'home_visit',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        recurrence_rule: null,
        time_window_start: null,
        time_window_end: null,
      },
    });
    careCaseFindFirstMock.mockResolvedValue({
      required_visit_support: {
        home_visit_intake: {
          care_level: 'care_3',
          adl_level: 'b',
          dementia_level: 'ii',
          medication_support_methods: ['unit_dose', 'calendar'],
          special_medical_procedures: ['narcotics', 'home_oxygen'],
          family_key_person: '山田 長男',
          money_management: 'family',
          narcotics_base: true,
          narcotics_rescue: false,
          infection_isolation: 'droplet',
        },
      },
    });
    patientSchedulePreferenceFindFirstMock.mockResolvedValue({
      visit_before_contact_required: true,
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'visit_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'visit_1',
      baseline_context: {
        care_level: 'care_3',
        adl_level: 'b',
        dementia_level: 'ii',
        medication_support_methods: ['unit_dose', 'calendar'],
        special_medical_procedures: ['narcotics', 'home_oxygen'],
        family_key_person: '山田 長男',
        money_management: 'family',
        visit_before_contact_required: true,
        narcotics_base: true,
        narcotics_rescue: false,
        infection_isolation: 'droplet',
      },
    });
  });

  it('rejects attachments uploaded for another visit record', async () => {
    getStoredFileRecordMock.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      orgId: 'org_1',
      purpose: 'visit-photo',
      storageKey: 'visit-photos/org_1/visit_other/file-1-photo.png',
      originalName: 'visit-photo.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      status: 'uploaded',
      visitRecordId: 'visit_other',
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
      completedAt: '2026-03-28T00:00:00.000Z',
      downloadDisposition: 'inline',
    });

    const response = await PATCH(
      createRequest({
        version: 1,
        attachments: [{ file_id: '11111111-1111-4111-8111-111111111111' }],
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '添付ファイルの訪問記録IDが一致しません',
    });
    expect(visitRecordUpdateMock).not.toHaveBeenCalled();
  });
});
