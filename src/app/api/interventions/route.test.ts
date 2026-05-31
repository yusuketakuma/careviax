import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  patientFindFirstMock,
  patientFindManyMock,
  medicationIssueFindFirstMock,
  interventionFindManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  medicationIssueFindFirstMock: vi.fn(),
  interventionFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
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
      findMany: patientFindManyMock,
    },
    medicationIssue: {
      findFirst: medicationIssueFindFirstMock,
    },
    intervention: {
      findMany: interventionFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-org-id': 'org_1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('/api/interventions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1' }]);
    medicationIssueFindFirstMock.mockResolvedValue({ id: 'issue_1' });
    interventionFindManyMock.mockResolvedValue([
      {
        id: 'int_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        issue_id: null,
        type: 'dose_adjustment',
        description: '用量調整',
        outcome: null,
        performed_by: 'user_1',
        performed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        intervention: {
          create: vi.fn().mockResolvedValue({
            id: 'int_2',
            patient_id: 'patient_1',
            type: 'dose_adjustment',
            description: '用量調整',
            performed_by: 'user_1',
            performed_at: new Date(),
          }),
        },
      }),
    );
  });

  describe('GET', () => {
    it('returns 200 with interventions', async () => {
      const response = (await GET(
        createRequest('http://localhost/api/interventions?patient_id=patient_1'),
      ))!;

      expect(response.status).toBe(200);
      expect(patientFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'patient_1',
          org_id: 'org_1',
          AND: [
            {
              cases: {
                some: {
                  OR: [
                    { primary_pharmacist_id: 'user_1' },
                    { backup_pharmacist_id: 'user_1' },
                    { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                  ],
                },
              },
            },
          ],
        },
        select: { id: true },
      });
      expect(interventionFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patient_id: 'patient_1',
          }),
        }),
      );
      const body = await response.json();
      expect(body.data).toHaveLength(1);
    });
  });

  describe('POST', () => {
    it('returns 201 when creating an intervention', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/interventions', {
          patient_id: 'patient_1',
          type: 'dose_adjustment',
          description: '用量調整',
          performed_at: '2026-04-01T10:00:00.000Z',
        }),
      ))!;

      expect(response.status).toBe(201);
      expect(patientFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'patient_1',
            org_id: 'org_1',
          }),
        }),
      );
    });

    it('returns 404 without creating when the patient is outside assignment scope', async () => {
      patientFindFirstMock.mockResolvedValue(null);

      const response = (await POST(
        createRequest('http://localhost/api/interventions', {
          patient_id: 'patient_other',
          type: 'dose_adjustment',
          description: '用量調整',
          performed_at: '2026-04-01T10:00:00.000Z',
        }),
      ))!;

      expect(response.status).toBe(404);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns 404 without creating when the medication issue is outside patient scope', async () => {
      medicationIssueFindFirstMock.mockResolvedValue(null);

      const response = (await POST(
        createRequest('http://localhost/api/interventions', {
          patient_id: 'patient_1',
          issue_id: 'issue_other',
          type: 'dose_adjustment',
          description: '用量調整',
          performed_at: '2026-04-01T10:00:00.000Z',
        }),
      ))!;

      expect(response.status).toBe(404);
      expect(medicationIssueFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'issue_other',
          org_id: 'org_1',
          patient_id: 'patient_1',
        },
        select: { id: true },
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns 400 with invalid body', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/interventions', {
          patient_id: '',
        }),
      ))!;

      expect(response.status).toBe(400);
    });
  });
});
