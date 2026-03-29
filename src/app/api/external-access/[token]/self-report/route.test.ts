import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  validateExternalAccessGrantMock,
  transactionMock,
  patientSelfReportCreateMock,
  communicationEventCreateMock,
} = vi.hoisted(() => ({
  validateExternalAccessGrantMock: vi.fn(),
  transactionMock: vi.fn(),
  patientSelfReportCreateMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

vi.mock('@/server/services/external-access', () => ({
  validateExternalAccessGrant: validateExternalAccessGrantMock,
}));

import { POST } from './route';

describe('/api/external-access/[token]/self-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: true,
      grant: {
        id: 'grant_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
    });
    patientSelfReportCreateMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      status: 'triaged',
      created_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    transactionMock.mockImplementation(async (callback) =>
      callback({
        patientSelfReport: {
          create: patientSelfReportCreateMock,
        },
        communicationEvent: {
          create: communicationEventCreateMock,
        },
      }),
    );
  });

  it('creates a self report and communication event for valid external access', async () => {
    const response = await POST({
      nextUrl: new URL('http://localhost/api/external-access/token_1/self-report?otp=1234'),
      json: async () => ({
        reported_by_name: '家族A',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '夕食後を飲み忘れ',
      }),
    } as NextRequest, {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(response.status).toBe(201);
    expect(validateExternalAccessGrantMock).toHaveBeenCalledWith('token_1', '1234');
    expect(patientSelfReportCreateMock).toHaveBeenCalled();
    expect(communicationEventCreateMock).toHaveBeenCalled();
  });
});
