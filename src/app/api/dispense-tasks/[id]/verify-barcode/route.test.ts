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
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  dispenseTaskFindFirstMock: vi.fn(),
  prescriptionLineFindFirstMock: vi.fn(),
  drugMasterFindFirstMock: vi.fn(),
  parseGS1BarcodeMock: vi.fn(),
  isExpiredMock: vi.fn(),
  loggerErrorMock: vi.fn(),
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

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { POST } from './route';

function createVerifyBarcodeRequest(taskId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/dispense-tasks/${taskId}/verify-barcode`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest(taskId: string) {
  return new NextRequest(`http://localhost/api/dispense-tasks/${taskId}/verify-barcode`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{"barcode":',
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(dispenseTaskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'task_1',
        org_id: 'org_1',
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
      data: {
        match: true,
        warnings: [],
      },
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });

  it('rejects blank route params before body parsing, task lookup, or barcode parsing', async () => {
    const response = (await POST(createMalformedJsonRequest(''), {
      params: Promise.resolve({ id: ' \t ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤タスクIDが不正です',
    });
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(drugMasterFindFirstMock).not.toHaveBeenCalled();
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before task or line lookup', async () => {
    const response = (await POST(createVerifyBarcodeRequest('task_1', ['unexpected']), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(drugMasterFindFirstMock).not.toHaveBeenCalled();
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payloads before task, line, or barcode lookup', async () => {
    const response = (await POST(createMalformedJsonRequest('task_1'), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(drugMasterFindFirstMock).not.toHaveBeenCalled();
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
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

  it('returns a sanitized no-store 500 and PHI-safe log metadata on unexpected failures', async () => {
    const err = new Error('患者 山田太郎 verify barcode raw SQL stack GTIN');
    err.name = 'DispenseTaskVerifyBarcodeSecretError';
    dispenseTaskFindFirstMock.mockRejectedValueOnce(err);

    const response = (await POST(
      createVerifyBarcodeRequest('task_1', {
        barcode: '0101234567890123',
        line_id: 'line_1',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw SQL');
    expect(JSON.stringify(body)).not.toContain('GTIN');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dispense_task_verify_barcode_unhandled_error',
        route: '/api/dispense-tasks/[id]/verify-barcode',
        method: 'POST',
        status: 500,
      }),
      err,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(err);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('山田太郎');
    expect(logContextText).not.toContain('raw SQL');
    expect(logContextText).not.toContain('GTIN');
    expect(logContextText).not.toContain('DispenseTaskVerifyBarcodeSecretError');
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });
});
