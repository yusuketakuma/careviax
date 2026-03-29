import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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

describe('/api/dispense-tasks/[id]/verify-barcode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    dispenseTaskFindFirstMock.mockResolvedValue({ id: 'task_1' });
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
    const response = (await POST({
      url: 'http://localhost/api/dispense-tasks/task_1/verify-barcode',
      method: 'POST',
      headers: {
        get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
      },
      nextUrl: new URL('http://localhost/api/dispense-tasks/task_1/verify-barcode'),
      json: async () => ({
        barcode: '0101234567890123',
        line_id: 'line_1',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      match: true,
      warnings: [],
    });
  });
});
