import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  createPrescriptionIntakeMock,
  broadcastStatusUpdateMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest & { orgId: string; userId: string },
        ctx: { params: Promise<{ id: string }> }
      ) => Promise<Response>
    ) => {
      return (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
        handler(
          {
            ...req,
            orgId: 'org_1',
            userId: 'user_1',
          } as NextRequest & { orgId: string; userId: string },
          ctx
        );
    }
  ),
  withOrgContextMock: vi.fn(),
  createPrescriptionIntakeMock: vi.fn(),
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
              scanned_by: 'user_scan',
            }),
          },
        });
      }

      if (callCount === 2) {
        return callback({
          qrScanDraft: {
            update: vi.fn().mockResolvedValue({ id: 'draft_1', status: 'confirmed' }),
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
    const response = await POST(createRequest({
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
    }), { params: Promise.resolve({ id: 'draft_1' }) });

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
      { skipStructuringCheck: true }
    );
    expect(broadcastStatusUpdateMock).toHaveBeenCalled();
  });
});
