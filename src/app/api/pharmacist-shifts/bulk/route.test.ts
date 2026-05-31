import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const {
  validateOrgReferencesMock,
  withOrgContextMock,
  pharmacistShiftUpsertMock,
} = vi.hoisted(() => ({
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  pharmacistShiftUpsertMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => handler,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown): AuthenticatedTestRequest {
  return Object.assign(
    new NextRequest('http://localhost/api/pharmacist-shifts/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
  );
}

describe('/api/pharmacist-shifts/bulk POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    pharmacistShiftUpsertMock.mockResolvedValue({ id: 'shift_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacistShift: {
          upsert: pharmacistShiftUpsertMock,
        },
      }),
    );
  });

  it('bulk upserts shift rows and returns the applied count', async () => {
    const response = (await POST(
      createRequest({
        rows: [
          {
            site_id: 'site_1',
            user_id: 'user_1',
            date: '2026-04-20',
            available: true,
            available_from: '09:00:00',
            available_to: '18:00:00',
          },
          {
            site_id: 'site_2',
            user_id: 'user_2',
            date: '2026-04-21',
            available: false,
            note: '休暇',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledTimes(2);
    expect(pharmacistShiftUpsertMock).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        applied_count: 2,
      },
    });
  });
});
