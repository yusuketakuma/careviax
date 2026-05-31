import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  dispenseTaskFindFirstMock,
  prescriptionLineFindFirstMock,
  drugMasterFindFirstMock,
  parseGS1BarcodeMock,
  isExpiredMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  dispenseTaskFindFirstMock: vi.fn(),
  prescriptionLineFindFirstMock: vi.fn(),
  drugMasterFindFirstMock: vi.fn(),
  parseGS1BarcodeMock: vi.fn(),
  isExpiredMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    dispenseTask: {
      findFirst: dispenseTaskFindFirstMock,
    },
    prescriptionLine: {
      findFirst: prescriptionLineFindFirstMock,
    },
    drugMaster: {
      findFirst: drugMasterFindFirstMock,
    },
  },
}));

vi.mock('@/lib/pharmacy/barcode', () => ({
  parseGS1Barcode: parseGS1BarcodeMock,
  isExpired: isExpiredMock,
}));

import { POST } from './route';

function createVerifyBarcodeRequest(
  taskId: string,
  body: { barcode: string; line_id: string },
) {
  return new NextRequest(`http://localhost/api/dispense-tasks/${taskId}/verify-barcode`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/dispense-tasks/[id]/verify-barcode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    dispenseTaskFindFirstMock.mockResolvedValue({ id: 'task_1', cycle_id: 'cycle_1' });
    prescriptionLineFindFirstMock.mockResolvedValue({
      id: 'line_1',
      drug_code: '1234567A',
      drug_name: 'Drug A',
    });
    parseGS1BarcodeMock.mockReturnValue({
      gtin: '01234567890123',
      expiryDate: new Date('2026-12-31T00:00:00.000Z'),
      lotNumber: 'LOT-1',
    });
    drugMasterFindFirstMock.mockResolvedValue({ yj_code: '1234567A' });
    isExpiredMock.mockReturnValue(false);
  });

  it('verifies a matching barcode without warnings', async () => {
    const response = (await POST(
      createVerifyBarcodeRequest('task_1', {
        barcode: '0101234567890123',
        line_id: 'line_1',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(dispenseTaskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'task_1',
        org_id: 'org_1',
        cycle: {
          case_: {
            OR: [
              { primary_pharmacist_id: 'user_1' },
              { backup_pharmacist_id: 'user_1' },
              { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
            ],
          },
        },
      },
      select: { id: true, cycle_id: true },
    });
    expect(prescriptionLineFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'line_1',
        org_id: 'org_1',
        intake: {
          cycle_id: 'cycle_1',
        },
      },
      select: {
        id: true,
        drug_code: true,
        drug_name: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      match: true,
      warnings: [],
    });
  });

  it('requires dispense permission before task lookup', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const response = (await POST(
      createVerifyBarcodeRequest('task_1', {
        barcode: '0101234567890123',
        line_id: 'line_1',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(403);
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });

  it('does not parse barcode or disclose expected drug data when the task is outside assignment scope', async () => {
    dispenseTaskFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createVerifyBarcodeRequest('task_unassigned', {
        barcode: '0101234567890123',
        line_id: 'line_1',
      }),
      {
        params: Promise.resolve({ id: 'task_unassigned' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });

  it('does not parse barcode or disclose expected drug data when the line is not in the task cycle', async () => {
    prescriptionLineFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createVerifyBarcodeRequest('task_1', {
        barcode: '0101234567890123',
        line_id: 'line_other_cycle',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(prescriptionLineFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'line_other_cycle',
          intake: {
            cycle_id: 'cycle_1',
          },
        }),
      }),
    );
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });
});
