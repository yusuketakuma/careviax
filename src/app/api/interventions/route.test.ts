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

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

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

function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{bad json',
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
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(patientFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'patient_1',
          org_id: 'org_1',
        },
        select: { id: true },
      });
      expect(interventionFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ performed_at: 'desc' }, { id: 'desc' }],
          where: expect.objectContaining({
            patient_id: 'patient_1',
          }),
        }),
      );
      const body = await response.json();
      expect(body.data).toHaveLength(1);
    });

    it.each([
      ['patient_id=', 'patient_id', '患者IDを指定してください'],
      ['patient_id=%20patient_1', 'patient_id', '患者IDの形式が不正です'],
      [`patient_id=${'a'.repeat(101)}`, 'patient_id', '患者IDの形式が不正です'],
      ['issue_id=%20%20', 'issue_id', '服薬課題IDを指定してください'],
      ['issue_id=issue_1%20', 'issue_id', '服薬課題IDの形式が不正です'],
      [`issue_id=${'a'.repeat(101)}`, 'issue_id', '服薬課題IDの形式が不正です'],
    ])(
      'rejects blank or malformed intervention filter query "%s" before scope resolution',
      async (query, fieldName, message) => {
        const response = (await GET(createRequest(`http://localhost/api/interventions?${query}`)))!;

        expect(response.status).toBe(400);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
        expect(response.headers.get('Pragma')).toBe('no-cache');
        await expect(response.json()).resolves.toMatchObject({
          code: 'VALIDATION_ERROR',
          message: '検索条件が不正です',
          details: {
            [fieldName]: [message],
          },
        });
        expect(patientFindFirstMock).not.toHaveBeenCalled();
        expect(patientFindManyMock).not.toHaveBeenCalled();
        expect(interventionFindManyMock).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['patient_id=patient_1&patient_id=patient_2', 'patient_id'],
      ['issue_id=issue_1&issue_id=', 'issue_id'],
    ])(
      'rejects duplicate intervention filter query "%s" before scope resolution',
      async (query, fieldName) => {
        const response = (await GET(createRequest(`http://localhost/api/interventions?${query}`)))!;

        expect(response.status).toBe(400);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
        expect(response.headers.get('Pragma')).toBe('no-cache');
        await expect(response.json()).resolves.toMatchObject({
          code: 'VALIDATION_ERROR',
          message: '検索条件が不正です',
          details: {
            [fieldName]: [`${fieldName} は1つだけ指定してください`],
          },
        });
        expect(patientFindFirstMock).not.toHaveBeenCalled();
        expect(patientFindManyMock).not.toHaveBeenCalled();
        expect(interventionFindManyMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('POST', () => {
    it('rejects non-object create payloads before loading patient or issue scope', async () => {
      const response = (await POST(createRequest('http://localhost/api/interventions', [])))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(patientFindFirstMock).not.toHaveBeenCalled();
      expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON create payloads before loading patient or issue scope', async () => {
      const response = (await POST(
        createMalformedJsonRequest('http://localhost/api/interventions'),
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(patientFindFirstMock).not.toHaveBeenCalled();
      expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

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
