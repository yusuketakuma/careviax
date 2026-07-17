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
  clearRequestAuthContextMock,
  runWithRequestAuthContextMock,
  unstableRethrowMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  dispenseTaskFindFirstMock: vi.fn(),
  prescriptionLineFindFirstMock: vi.fn(),
  drugMasterFindFirstMock: vi.fn(),
  parseGS1BarcodeMock: vi.fn(),
  isExpiredMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  clearRequestAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  unstableRethrowMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/request-context', () => ({
  clearRequestAuthContext: clearRequestAuthContextMock,
  runWithRequestAuthContext: runWithRequestAuthContextMock,
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
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
      }),
      expect.any(Function),
    );
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
    const request = createMalformedJsonRequest('task_1');

    const response = (await POST(request, {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      message: 'バーコード照合権限がありません',
    });
    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before params, body, or barcode work', async () => {
    authMock.mockResolvedValueOnce(null);
    const request = createMalformedJsonRequest('task_1');
    const paramsThenMock = vi.fn();

    const response = (await POST(request, {
      params: { then: paramsThenMock } as unknown as Promise<{ id: string }>,
    }))!;

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 when authentication dependencies throw', async () => {
    const err = new Error('患者 山田太郎 barcode auth secret GTIN');
    err.name = 'VerifyBarcodeAuthSecretError';
    authMock.mockRejectedValueOnce(err);
    const request = createMalformedJsonRequest('task_1');
    const paramsThenMock = vi.fn();

    const response = (await POST(request, {
      params: { then: paramsThenMock } as unknown as Promise<{ id: string }>,
    }))!;
    const requestId = response.headers.get('X-Request-Id');
    const correlationId = response.headers.get('X-Correlation-Id');

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(requestId).toBeTruthy();
    expect(correlationId).toBe(requestId);
    expect(request.bodyUsed).toBe(false);
    expect(paramsThenMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/dispense-tasks/task_1/verify-barcode',
        method: 'POST',
        requestId,
        correlationId,
      },
      err,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('山田太郎');
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain(
      'VerifyBarcodeAuthSecretError',
    );
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

  it('returns an authenticated-trace safe 500 and PHI-safe shared log metadata', async () => {
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
      {
        event: 'route_handler_unhandled_error',
        route: '/api/dispense-tasks/task_1/verify-barcode',
        method: 'POST',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
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

  it('rethrows authentication control flow without logging or request work', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });
    const request = createMalformedJsonRequest('task_1');
    const paramsThenMock = vi.fn();

    await expect(
      POST(request, {
        params: { then: paramsThenMock } as unknown as Promise<{ id: string }>,
      }),
    ).rejects.toBe(controlFlowError);

    expect(request.bodyUsed).toBe(false);
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
  });

  it('rethrows handler control flow without shared logging or barcode work', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    dispenseTaskFindFirstMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      POST(
        createVerifyBarcodeRequest('task_1', {
          barcode: '0101234567890123',
          line_id: 'line_1',
        }),
        { params: Promise.resolve({ id: 'task_1' }) },
      ),
    ).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(parseGS1BarcodeMock).not.toHaveBeenCalled();
  });
});
