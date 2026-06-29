import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitRecordFindFirstMock,
  txVisitRecordFindFirstMock,
  visitRecordUpdateManyMock,
  visitRecordFindManyMock,
  medicationCycleFindManyMock,
  residualMedicationDeleteManyMock,
  residualMedicationCreateMock,
  patientLabObservationDeleteManyMock,
  patientLabObservationCreateManyMock,
  auditLogFindFirstMock,
  userFindManyMock,
  careCaseFindFirstMock,
  patientSchedulePreferenceFindFirstMock,
  withOrgContextMock,
  getStoredFileRecordMock,
  toVisitRecordAttachmentMock,
  listBillingEvidenceBlockersMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  txVisitRecordFindFirstMock: vi.fn(),
  visitRecordUpdateManyMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  residualMedicationDeleteManyMock: vi.fn(),
  residualMedicationCreateMock: vi.fn(),
  patientLabObservationDeleteManyMock: vi.fn(),
  patientLabObservationCreateManyMock: vi.fn(),
  auditLogFindFirstMock: vi.fn(),
  userFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientSchedulePreferenceFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  getStoredFileRecordMock: vi.fn(),
  toVisitRecordAttachmentMock: vi.fn(),
  listBillingEvidenceBlockersMock: vi.fn(),
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

vi.mock('@/server/services/billing-evidence', () => ({
  listBillingEvidenceBlockers: listBillingEvidenceBlockersMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown) {
  if (body === undefined) {
    return new NextRequest('http://localhost/api/visit-records/visit_1', {
      headers: { 'x-org-id': 'org_1' },
    });
  }
  return new NextRequest('http://localhost/api/visit-records/visit_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/visit-records/visit_1', {
    method: 'PATCH',
    body: '{"version":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/visit-records/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txVisitRecordFindFirstMock.mockReset();
    visitRecordUpdateManyMock.mockReset();
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
    visitRecordFindManyMock.mockResolvedValue([{ id: 'visit_1' }]);
    medicationCycleFindManyMock.mockResolvedValue([{ id: 'cycle_1' }]);
    residualMedicationDeleteManyMock.mockResolvedValue({ count: 1 });
    residualMedicationCreateMock.mockResolvedValue({ id: 'residual_1' });
    patientLabObservationDeleteManyMock.mockResolvedValue({ count: 1 });
    patientLabObservationCreateManyMock.mockResolvedValue({ count: 1 });
    listBillingEvidenceBlockersMock.mockResolvedValue([]);
    txVisitRecordFindFirstMock
      .mockResolvedValueOnce({
        id: 'visit_1',
        version: 1,
        patient_id: 'patient_1',
        visit_date: new Date('2026-03-28T00:00:00.000Z'),
        outcome_status: 'delivery_only',
        structured_soap: null,
        schedule: {
          case_id: 'case_1',
          pharmacist_id: 'user_1',
          visit_type: 'regular',
          case_: {
            primary_pharmacist_id: 'user_primary',
            backup_pharmacist_id: null,
            required_visit_support: null,
          },
        },
      })
      .mockResolvedValue({
        id: 'visit_1',
        version: 2,
        patient_id: 'patient_1',
        structured_soap: {},
      });
    visitRecordUpdateManyMock.mockResolvedValue({ count: 1 });
    toVisitRecordAttachmentMock.mockImplementation((record) => ({
      file_id: record.id,
      file_name: record.originalName,
      mime_type: record.mimeType,
      size_bytes: record.sizeBytes,
      uploaded_at: record.completedAt ?? null,
      kind: record.mimeType.startsWith('image/') ? 'photo' : 'attachment',
      legacy_debug: undefined,
    }));
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([]),
        visitRecord: {
          findFirst: txVisitRecordFindFirstMock,
          findMany: visitRecordFindManyMock,
          updateMany: visitRecordUpdateManyMock,
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
        medicationCycle: {
          findMany: medicationCycleFindManyMock,
        },
        residualMedication: {
          count: vi.fn().mockResolvedValue(0),
          deleteMany: residualMedicationDeleteManyMock,
          create: residualMedicationCreateMock,
        },
        patientLabObservation: {
          deleteMany: patientLabObservationDeleteManyMock,
          createMany: patientLabObservationCreateManyMock,
        },
      }),
    );
  });

  it('returns visit record attachments as a normalized list', async () => {
    txVisitRecordFindFirstMock.mockReset();
    txVisitRecordFindFirstMock.mockResolvedValue({
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
        null,
        'legacy-bad-value',
        {
          file_id: '11111111-1111-4111-8111-111111111111',
          file_name: 'visit-photo.png',
          mime_type: 'image/png',
          size_bytes: 1024,
          uploaded_at: '2026-03-28T00:00:00.000Z',
          kind: 'photo',
        },
      ],
      patient_state_snapshot: { previous_visit: 'sensitive snapshot' },
      visit_geo_log: { started_at: { lat: 35.6812, lng: 139.7671 } },
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
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
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
    expect(body).not.toHaveProperty('patient_state_snapshot');
    expect(body).not.toHaveProperty('visit_geo_log');
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
        }),
      }),
    );
  });

  it('rejects blank visit record ids before loading visit details', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問記録IDが不正です',
    });
    expect(txVisitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns not found with no-store when the visit record is missing', async () => {
    txVisitRecordFindFirstMock.mockReset();
    txVisitRecordFindFirstMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'missing' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '訪問記録が見つかりません',
    });
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns forbidden with no-store when the schedule assignment is inaccessible', async () => {
    txVisitRecordFindFirstMock.mockReset();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'driver',
      },
    });
    txVisitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      org_id: 'org_1',
      schedule_id: 'schedule_1',
      patient_id: 'patient_1',
      pharmacist_id: 'user_other',
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
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: 'この訪問記録を閲覧する権限がありません',
    });
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store internal error when visit record loading fails', async () => {
    txVisitRecordFindFirstMock.mockReset();
    txVisitRecordFindFirstMock.mockRejectedValue(new Error('database leaked stack'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'visit_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceFindFirstMock).not.toHaveBeenCalled();
  });

  it('allows an org-wide pharmacist to read a visit record on another schedule assignment', async () => {
    txVisitRecordFindFirstMock.mockReset();
    txVisitRecordFindFirstMock.mockResolvedValue({
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
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ id: 'visit_1' });
    expect(auditLogFindFirstMock).toHaveBeenCalled();
  });

  it('allows an org-wide pharmacist to patch a visit record on another schedule assignment', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitRecord: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: 'visit_1',
              version: 1,
              patient_id: 'patient_1',
              visit_date: new Date('2026-03-28T00:00:00.000Z'),
              outcome_status: 'delivery_only',
              structured_soap: null,
              schedule: {
                case_id: 'case_1',
                pharmacist_id: 'user_other',
                visit_type: 'regular',
                case_: {
                  primary_pharmacist_id: 'user_primary',
                  backup_pharmacist_id: null,
                  required_visit_support: null,
                },
              },
            })
            .mockResolvedValue({ id: 'visit_1', version: 2 }),
          updateMany: visitRecordUpdateManyMock,
        },
        residualMedication: {
          count: vi.fn().mockResolvedValue(0),
        },
      }),
    );
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
    expect(getStoredFileRecordMock).toHaveBeenCalled();
    expect(visitRecordUpdateManyMock).toHaveBeenCalled();
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
    expect(visitRecordUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visit_1', org_id: 'org_1', version: 1 },
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
    const savedAttachments = visitRecordUpdateManyMock.mock.calls[0][0].data.attachments as Array<
      Record<string, unknown>
    >;
    expect(savedAttachments[0].legacy_debug).toBeUndefined();
  });

  it('clears next visit suggestion and receipt timestamp when empty strings are patched', async () => {
    const response = await PATCH(
      createRequest({
        version: 1,
        next_visit_suggestion_date: '',
        receipt_at: '',
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitRecordUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visit_1', org_id: 'org_1', version: 1 },
        data: expect.objectContaining({
          next_visit_suggestion_date: null,
          receipt_at: null,
        }),
      }),
    );
  });

  it('rejects calendar-overflow receipt timestamps before loading the visit record', async () => {
    const response = await PATCH(
      createRequest({
        version: 1,
        receipt_at: '2026-02-30T10:00',
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the visit record update loses the optimistic lock race', async () => {
    visitRecordUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest({
        version: 1,
        soap_subjective: '別タブ更新と競合',
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(residualMedicationDeleteManyMock).not.toHaveBeenCalled();
    expect(patientLabObservationDeleteManyMock).not.toHaveBeenCalled();
  });

  it('rejects stale previous-visit reuse metadata before patching structured soap', async () => {
    txVisitRecordFindFirstMock.mockReset();
    txVisitRecordFindFirstMock
      .mockResolvedValueOnce({
        id: 'visit_1',
        version: 1,
        patient_id: 'patient_1',
        visit_date: new Date('2026-03-28T00:00:00.000Z'),
        outcome_status: 'delivery_only',
        structured_soap: null,
        schedule: {
          case_id: 'case_1',
          pharmacist_id: 'user_1',
          visit_type: 'regular',
          case_: {
            primary_pharmacist_id: 'user_primary',
            backup_pharmacist_id: null,
            required_visit_support: null,
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'previous_visit_1',
        patient_id: 'patient_1',
        version: 5,
        updated_at: new Date('2026-04-02T03:00:00.000Z'),
        schedule: { case_id: 'case_1' },
      });

    const response = await PATCH(
      createRequest({
        version: 1,
        structured_soap: {
          subjective: { symptom_checks: [] },
          objective: {
            medication_status: 'full_compliance',
            adherence_score: 4,
            side_effect_checks: [],
          },
          assessment: { problem_checks: [] },
          plan: { intervention_checks: [] },
          previous_visit_reuse: {
            source_visit_record_id: 'previous_visit_1',
            source_visit_record_version: 4,
            source_visit_record_updated_at: '2026-04-01T03:00:00.000Z',
            carry_forward_items: ['眠気の継続確認'],
          },
        },
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'source_version_conflict',
      },
    });
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(patientLabObservationDeleteManyMock).not.toHaveBeenCalled();
  });

  it('rejects previous-visit reuse without source revision metadata before patching structured soap', async () => {
    txVisitRecordFindFirstMock.mockReset();
    txVisitRecordFindFirstMock
      .mockResolvedValueOnce({
        id: 'visit_1',
        version: 1,
        patient_id: 'patient_1',
        visit_date: new Date('2026-03-28T00:00:00.000Z'),
        outcome_status: 'delivery_only',
        structured_soap: null,
        schedule: {
          case_id: 'case_1',
          pharmacist_id: 'user_1',
          visit_type: 'regular',
          case_: {
            primary_pharmacist_id: 'user_primary',
            backup_pharmacist_id: null,
            required_visit_support: null,
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'previous_visit_1',
        patient_id: 'patient_1',
        version: 5,
        updated_at: new Date('2026-04-02T03:00:00.000Z'),
        schedule: { case_id: 'case_1' },
      });

    const response = await PATCH(
      createRequest({
        version: 1,
        structured_soap: {
          subjective: { symptom_checks: [] },
          objective: {
            medication_status: 'full_compliance',
            adherence_score: 4,
            side_effect_checks: [],
          },
          assessment: { problem_checks: [] },
          plan: { intervention_checks: [] },
          previous_visit_reuse: {
            source_visit_record_id: 'previous_visit_1',
            carry_forward_items: ['眠気の継続確認'],
          },
        },
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'source_revision_missing',
      },
    });
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(patientLabObservationDeleteManyMock).not.toHaveBeenCalled();
  });

  it('resyncs derived labs and residual medications when structured visit data is patched', async () => {
    const response = await PATCH(
      createRequest({
        version: 1,
        structured_soap: {
          objective: {
            lab_values: {
              egfr: 42,
              scr: 1.2,
              ignored_text: 'high',
            },
          },
        },
        residual_medications: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_code: 'drug_amlodipine',
            prescribed_quantity: 28,
            prescribed_daily_dose: 1,
            remaining_quantity: 10,
            is_prohibited_reduction: false,
          },
        ],
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(residualMedicationDeleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', visit_record_id: 'visit_1' },
    });
    expect(residualMedicationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          visit_record_id: 'visit_1',
          drug_name: 'アムロジピン錠5mg',
          excess_days: 10,
          is_reduction_target: true,
        }),
      }),
    );
    expect(patientLabObservationDeleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', source_visit_record_id: 'visit_1' },
    });
    expect(patientLabObservationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          analyte_code: 'egfr',
          value_numeric: 42,
          source_type: 'visit_record',
          source_visit_record_id: 'visit_1',
        }),
        expect.objectContaining({
          analyte_code: 'scr',
          value_numeric: 1.2,
        }),
      ]),
    });
    expect(patientLabObservationCreateManyMock.mock.calls[0][0].data).toHaveLength(2);
  });

  it('preserves server-owned handoff metadata when ordinary structured SOAP is patched', async () => {
    const existingHandoff = {
      next_check_items: ['既存の確認事項'],
      ongoing_monitoring: ['既存の観察事項'],
      decision_rationale: '確認済みの判断根拠',
      ai_extracted: true,
      ai_confidence: 0.82,
      confirmed_by: 'pharmacist_1',
      confirmed_at: '2026-04-01T00:00:00.000Z',
      extracted_at: '2026-03-31T23:00:00.000Z',
    };
    txVisitRecordFindFirstMock.mockReset();
    txVisitRecordFindFirstMock
      .mockResolvedValueOnce({
        id: 'visit_1',
        version: 1,
        patient_id: 'patient_1',
        visit_date: new Date('2026-03-28T00:00:00.000Z'),
        outcome_status: 'delivery_only',
        structured_soap: {
          subjective: { symptom_checks: [] },
          objective: {
            medication_status: 'full_compliance',
            adherence_score: 4,
            side_effect_checks: [],
          },
          assessment: { problem_checks: [] },
          plan: { intervention_checks: [] },
          handoff: existingHandoff,
        },
        schedule: {
          case_id: 'case_1',
          pharmacist_id: 'user_1',
          visit_type: 'regular',
          case_: {
            primary_pharmacist_id: 'user_primary',
            backup_pharmacist_id: null,
            required_visit_support: null,
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'visit_1',
        version: 2,
        patient_id: 'patient_1',
        structured_soap: {},
      });

    const response = await PATCH(
      createRequest({
        version: 1,
        structured_soap: {
          subjective: { symptom_checks: [] },
          objective: {
            medication_status: 'partial_compliance',
            adherence_score: 3,
            side_effect_checks: [],
          },
          assessment: { problem_checks: [] },
          plan: { intervention_checks: [] },
          handoff: {
            next_check_items: ['不正な上書き'],
            ongoing_monitoring: [],
            decision_rationale: '不正な根拠',
            ai_extracted: true,
            ai_confidence: 1,
            confirmed_by: 'attacker',
            confirmed_at: '2026-04-02T00:00:00.000Z',
            extracted_at: '2026-04-02T00:00:00.000Z',
          },
        },
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitRecordUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          structured_soap: expect.objectContaining({
            handoff: existingHandoff,
          }),
        }),
      }),
    );
    const persistedSoap = visitRecordUpdateManyMock.mock.calls[0][0].data.structured_soap as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(persistedSoap)).not.toContain('attacker');
    expect(JSON.stringify(persistedSoap)).not.toContain('不正な上書き');
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
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects create-only carry-item acknowledgement on PATCH before updating', async () => {
    const response = await PATCH(
      createRequest({
        version: 1,
        carry_item_warning_acknowledged: true,
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '持参物警告確認は訪問記録作成時のみ指定できます',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the visit record', async () => {
    const response = await PATCH(createRequest(['visit_1']), {
      params: Promise.resolve({ id: 'visit_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getStoredFileRecordMock).not.toHaveBeenCalled();
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank visit record ids before loading or updating the visit record', async () => {
    const response = await PATCH(
      createRequest({
        version: 1,
        attachments: [{ file_id: '11111111-1111-4111-8111-111111111111' }],
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問記録IDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getStoredFileRecordMock).not.toHaveBeenCalled();
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the visit record', async () => {
    const response = await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'visit_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getStoredFileRecordMock).not.toHaveBeenCalled();
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects completing a visit record update without medication-management readiness evidence', async () => {
    const response = await PATCH(
      createRequest({
        version: 1,
        outcome_status: 'completed',
        soap_subjective: '服薬状況は確認したが必須確認は未完了',
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問完了には訪問薬剤管理の必須確認が必要です',
      details: {
        home_visit_2026_readiness: expect.arrayContaining(['残薬確認']),
      },
    });
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
  });

  it('includes baseline_context with care_level, adl_level, dementia_level from intake data', async () => {
    txVisitRecordFindFirstMock.mockReset();
    txVisitRecordFindFirstMock.mockResolvedValue({
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
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
  });
});
