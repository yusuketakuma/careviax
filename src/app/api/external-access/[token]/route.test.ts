import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  validateExternalAccessGrantMock,
  markExternalAccessViewedMock,
  buildExternalAccessPayloadMock,
} = vi.hoisted(() => ({
  validateExternalAccessGrantMock: vi.fn(),
  markExternalAccessViewedMock: vi.fn(),
  buildExternalAccessPayloadMock: vi.fn(),
}));

vi.mock('@/server/services/external-access', () => ({
  validateExternalAccessGrant: validateExternalAccessGrantMock,
  markExternalAccessViewed: markExternalAccessViewedMock,
  buildExternalAccessPayload: buildExternalAccessPayloadMock,
}));

import { GET } from './route';

describe('/api/external-access/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: true,
      grant: { id: 'grant_1' },
    });
    buildExternalAccessPayloadMock.mockResolvedValue({
      patient: { id: 'patient_1' },
    });
  });

  it('returns the external access payload for a valid token and otp', async () => {
    const response = await GET({
      nextUrl: new URL('http://localhost/api/external-access/token_1?otp=1234'),
    } as NextRequest, {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(response.status).toBe(200);
    expect(validateExternalAccessGrantMock).toHaveBeenCalledWith('token_1', '1234');
    expect(markExternalAccessViewedMock).toHaveBeenCalledWith('grant_1');
  });
});
