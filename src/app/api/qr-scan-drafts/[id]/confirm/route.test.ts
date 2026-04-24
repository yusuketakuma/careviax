import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  createPrescriptionIntakeMock,
  jahisSupplementalRecordUpdateManyMock,
  broadcastStatusUpdateMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest & { orgId: string; userId: string },
        ctx: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
        handler(
          {
            ...req,
            orgId: 'org_1',
            userId: 'user_1',
          } as NextRequest & { orgId: string; userId: string },
          ctx,
        );
    },
  ),
  withOrgContextMock: vi.fn(),
  createPrescriptionIntakeMock: vi.fn(),
  jahisSupplementalRecordUpdateManyMock: vi.fn(),
  broadcastStatusUpdateMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/prescription-intake-service', () => ({
  createPrescriptionIntake: createPrescriptionIntakeMock,
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/qr-scan-drafts/[id]/confirm POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPrescriptionIntakeMock.mockResolvedValue({
      ok: true,
      intake: { id: 'intake_1' },
      cycle: { id: 'cycle_1', patient_id: 'patient_1', case_id: 'case_1' },
      medicationChanges: [],
      profileSyncResult: null,
    });

    let callCount = 0;
    withOrgContextMock.mockImplementation(async (_orgId, callback) => {
      callCount += 1;

      if (callCount === 1) {
        return callback({
          qrScanDraft: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'draft_1',
              status: 'pending',
              org_id: 'org_1',
              patient_id: 'patient_1',
              scanned_by: 'user_scan',
              parsed_data: {
                supplementalRecords: [
                  {
                    recordType: '421',
                    recordLabel: '残薬確認',
                    lineNumber: 8,
                    fields: ['アムロジピンが10錠残薬。', '1'],
                    details: [{ label: '残薬内容', value: 'アムロジピンが10錠残薬。' }],
                    summary: 'アムロジピンが10錠残薬。',
                    rawLine: '421,アムロジピンが10錠残薬。,1',
                  },
                ],
              },
            }),
          },
        });
      }

      if (callCount === 2) {
        jahisSupplementalRecordUpdateManyMock.mockResolvedValue({ count: 1 });
        return callback({
          qrScanDraft: {
            update: vi.fn().mockResolvedValue({ id: 'draft_1', status: 'confirmed' }),
          },
          jahisSupplementalRecord: {
            updateMany: jahisSupplementalRecordUpdateManyMock,
          },
        });
      }

      return callback({
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      });
    });
  });

  it('creates an intake using patient_id and case_id without pre-resolving an existing cycle', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: '2026-04-01',
        prescriber_name: '鈴木医師',
        prescriber_institution_id: 'institution_1',
        prescriber_institution: 'テスト医院',
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
            packaging_instructions: '一包化',
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(createPrescriptionIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: 'case_1',
        patient_id: 'patient_1',
        source_type: 'qr_scan',
        prescriber_institution_id: 'institution_1',
        lines: [
          expect.objectContaining({
            drug_name: 'アムロジピン錠5mg',
            packaging_instructions: '一包化',
          }),
        ],
      }),
      'org_1',
      'user_1',
      { skipStructuringCheck: true },
    );
    expect(jahisSupplementalRecordUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        qr_draft_id: 'draft_1',
        prescription_intake_id: null,
      },
      data: {
        patient_id: 'patient_1',
        prescription_intake_id: 'intake_1',
      },
    });
    expect(broadcastStatusUpdateMock).toHaveBeenCalled();
  });

  it('rejects confirmation when the draft patient does not match the target patient', async () => {
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_1',
            status: 'pending',
            org_id: 'org_1',
            patient_id: 'patient_2',
            scanned_by: 'user_scan',
            parsed_data: { supplementalRecords: [] },
          }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: '2026-04-01',
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(createPrescriptionIntakeMock).not.toHaveBeenCalled();
  });
});
