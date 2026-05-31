import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const { authMock, membershipFindFirstMock, patientFindFirstMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    careCase: { findFirst: vi.fn().mockResolvedValue(null) },
    visitRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    medicationIssue: { findFirst: vi.fn().mockResolvedValue(null) },
    medicationCycle: { findFirst: vi.fn().mockResolvedValue(null) },
    setPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    dispenseTask: { findFirst: vi.fn().mockResolvedValue(null) },
    pharmacySite: { findFirst: vi.fn().mockResolvedValue(null) },
    visitSchedule: { findFirst: vi.fn().mockResolvedValue(null) },
    prescriptionLine: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { withValidatedBody } from '../route-builder';

function createRequest(
  body: unknown,
  headers?: Record<string, string>
) {
  return new NextRequest('http://localhost/api/test-route-builder', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('withValidatedBody', () => {
  const handler = withValidatedBody(
    {
      permission: 'canVisit',
      message: '権限がありません',
      bodySchema: z.object({
        patient_id: z.string().min(1),
        note: z.string().min(1),
      }),
      references: {
        patient_id: (body) => body.patient_id,
      },
    },
    async (_req, { body, references }) =>
      NextResponse.json({
        patientId: body.patient_id,
        note: body.note,
        resolvedPatientId: references.patient?.id ?? null,
      })
  );

  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await handler(
      createRequest({ patient_id: 'patient_1', note: 'x' }, { 'x-org-id': 'org_1' })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
  });

  it('returns 403 when role lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'driver' });

    const response = await handler(
      createRequest({ patient_id: 'patient_1', note: 'x' }, { 'x-org-id': 'org_1' })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
  });

  it('returns 400 when body validation fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await handler(
      createRequest({ patient_id: '', note: '' }, { 'x-org-id': 'org_1' })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });

  it('returns 400 when org reference validation fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    patientFindFirstMock.mockResolvedValue(null);

    const response = await handler(
      createRequest({ patient_id: 'patient_1', note: 'x' }, { 'x-org-id': 'org_1' })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });

  it('returns 200 and resolved references when validation passes', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await handler(
      createRequest({ patient_id: 'patient_1', note: 'x' }, { 'x-org-id': 'org_1' })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json() as Promise<Record<string, unknown>>).resolves.toEqual({
      patientId: 'patient_1',
      note: 'x',
      resolvedPatientId: 'patient_1',
    });
  });
});
