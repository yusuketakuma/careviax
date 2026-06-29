import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  withOrgContextMock,
  createAuditLogEntryMock,
  deleteManyMock,
  createManyMock,
  findManyMock,
  contactFindManyMock,
  externalProfessionalFindManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
  findManyMock: vi.fn(),
  contactFindManyMock: vi.fn(),
  externalProfessionalFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
    contactParty: {
      findMany: contactFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { GET, PUT } from './route';

function createRequest(url: string, body?: unknown, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedJsonPutRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/care-team', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'corg1234567890123456789012',
    },
    body: '{"case_id":',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients/[id]/care-team', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_active',
        status: 'active',
        created_at: new Date('2026-03-01'),
        care_team_links: [
          {
            id: 'link_1',
            external_professional_id: 'external_1',
            role: 'physician',
            name: '佐藤医師',
          },
        ],
      },
      {
        id: 'case_old',
        status: 'on_hold',
        created_at: new Date('2026-02-01'),
        care_team_links: [],
      },
    ]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_active' });
    findManyMock.mockResolvedValue([{ id: 'link_1', role: 'physician', name: '佐藤医師' }]);
    contactFindManyMock.mockResolvedValue([
      {
        is_primary: true,
        is_emergency_contact: true,
        phone: '090-1111-2222',
        email: null,
        fax: null,
      },
    ]);
    externalProfessionalFindManyMock.mockResolvedValue([{ id: 'external_1' }]);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        externalProfessional: {
          findMany: externalProfessionalFindManyMock,
        },
        careTeamLink: {
          deleteMany: deleteManyMock,
          createMany: createManyMock,
          findMany: findManyMock,
        },
        auditLog: {
          create: vi.fn(),
        },
      }),
    );
  });

  it('returns the active case by default for care-team editing', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/care-team', undefined, {
        'x-org-id': 'corg1234567890123456789012',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      case_id: 'case_active',
      cases: [
        { id: 'case_active', status: 'active' },
        { id: 'case_old', status: 'on_hold' },
      ],
      data: [{ id: 'link_1', role: 'physician', name: '佐藤医師' }],
    });
  });

  it('rejects blank patient ids before loading care-team cases', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/%20%20/care-team', undefined, {
        'x-org-id': 'corg1234567890123456789012',
      }),
      { params: Promise.resolve({ id: '   ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when care-team reads fail', async () => {
    const rawError = '患者A 03-1111-1111 care-team read failure';
    careCaseFindManyMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/care-team', undefined, {
        'x-org-id': 'corg1234567890123456789012',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('03-1111-1111');
  });

  it('rejects blank patient ids before parsing care-team payloads or replacing links', async () => {
    const response = await PUT(createMalformedJsonPutRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(externalProfessionalFindManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object care-team payloads before loading the case', async () => {
    const response = await PUT(
      createRequest('http://localhost/api/patients/patient_1/care-team', [], {
        'x-org-id': 'corg1234567890123456789012',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(externalProfessionalFindManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON care-team payloads before loading the case', async () => {
    const response = await PUT(createMalformedJsonPutRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(externalProfessionalFindManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed care-team phone and fax before loading the case', async () => {
    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [
            {
              role: 'nurse',
              name: '山田看護師',
              phone: '03-ABCD-3333',
              fax: 'FAX-4444',
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(externalProfessionalFindManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('replaces care-team links for the selected case', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'link_physician',
        role: 'physician',
        name: '佐藤医師',
        phone: '03-1111-1111',
        email: null,
        fax: '03-1111-1112',
        is_primary: true,
      },
      {
        id: 'link_nurse',
        role: 'nurse',
        name: '山田看護師',
        phone: '03-2222-3333',
        email: 'nurse@example.com',
        fax: '03-3333-4444',
        is_primary: true,
      },
      {
        id: 'link_cm',
        role: 'care_manager',
        name: '鈴木CM',
        phone: '03-5555-6666',
        email: null,
        fax: '03-5555-6667',
        is_primary: true,
      },
    ]);
    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [
            {
              external_professional_id: 'external_1',
              role: 'nurse',
              name: '山田看護師',
              organization_name: '訪問看護ステーションA',
              department: '在宅部',
              phone: ' 03-2222-3333 ',
              email: 'nurse@example.com',
              fax: ' 03-3333-4444 ',
              address: '東京都千代田区7-8-9',
              is_primary: true,
              notes: '月水金に訪問',
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'corg1234567890123456789012',
      expect.any(Function),
      {
        requestContext: expect.objectContaining({
          orgId: 'corg1234567890123456789012',
          userId: 'user_1',
          role: 'pharmacist',
        }),
      },
    );
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'corg1234567890123456789012', case_id: 'case_active' },
    });
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'corg1234567890123456789012',
          case_id: 'case_active',
          external_professional_id: 'external_1',
          role: 'nurse',
          name: '山田看護師',
          organization_name: '訪問看護ステーションA',
          department: '在宅部',
          phone: '03-2222-3333',
          email: 'nurse@example.com',
          fax: '03-3333-4444',
          address: '東京都千代田区7-8-9',
          is_primary: true,
          notes: '月水金に訪問',
        },
      ],
    });
    expect(externalProfessionalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'corg1234567890123456789012',
        id: { in: ['external_1'] },
      },
      select: { id: true },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
      }),
      expect.objectContaining({
        action: 'patient_care_team_replaced',
        targetType: 'CareCase',
        targetId: 'case_active',
        patientId: 'patient_1',
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      case_id: 'case_active',
      data: [
        expect.objectContaining({ id: 'link_physician' }),
        expect.objectContaining({ id: 'link_nurse' }),
        expect.objectContaining({ id: 'link_cm' }),
      ],
      warnings: [],
      metadata: {
        care_team_reliability: {
          needs_confirmation: false,
          alert_count: 0,
          detail: '緊急連絡先と主要連携先の連絡手段があります。',
        },
      },
    });
  });

  it('records a redacted care-team replacement audit log', async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: 'old_physician_link',
          external_professional_id: 'external_old',
          role: 'physician',
          name: '旧主治医',
          organization_name: '旧クリニック',
          department: null,
          phone: '03-1111-1111',
          email: 'old-doctor@example.com',
          fax: null,
          address: '東京都旧住所',
          notes: '旧メモ',
          is_primary: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'new_nurse_link',
          external_professional_id: 'external_1',
          role: 'nurse',
          name: '山田看護師',
          organization_name: '訪問看護ステーションA',
          department: '在宅部',
          phone: '03-2222-3333',
          email: 'nurse@example.com',
          fax: '03-3333-4444',
          address: '東京都千代田区7-8-9',
          notes: '月水金に訪問',
          is_primary: true,
        },
      ]);

    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [
            {
              external_professional_id: 'external_1',
              role: 'nurse',
              name: '山田看護師',
              organization_name: '訪問看護ステーションA',
              department: '在宅部',
              phone: '03-2222-3333',
              email: 'nurse@example.com',
              fax: '03-3333-4444',
              address: '東京都千代田区7-8-9',
              is_primary: true,
              notes: '月水金に訪問',
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
      }),
      {
        action: 'patient_care_team_replaced',
        targetType: 'CareCase',
        targetId: 'case_active',
        patientId: 'patient_1',
        changes: {
          case_id: 'case_active',
          before_count: 1,
          after_count: 1,
          role_counts_before: { physician: 1 },
          role_counts_after: { nurse: 1 },
          external_professional_ids_before: ['external_old'],
          external_professional_ids_after: ['external_1'],
          before: [
            {
              id: 'old_physician_link',
              external_professional_id: 'external_old',
              role: 'physician',
              is_primary: true,
              has_organization: true,
              has_department: false,
              has_phone: true,
              has_email: true,
              has_fax: false,
              has_address: true,
              has_notes: true,
            },
          ],
          after: [
            {
              id: 'new_nurse_link',
              external_professional_id: 'external_1',
              role: 'nurse',
              is_primary: true,
              has_organization: true,
              has_department: true,
              has_phone: true,
              has_email: true,
              has_fax: true,
              has_address: true,
              has_notes: true,
            },
          ],
        },
      },
    );

    const auditPayload = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditPayload).not.toContain('03-1111-1111');
    expect(auditPayload).not.toContain('old-doctor@example.com');
    expect(auditPayload).not.toContain('旧主治医');
    expect(auditPayload).not.toContain('03-2222-3333');
    expect(auditPayload).not.toContain('nurse@example.com');
    expect(auditPayload).not.toContain('山田看護師');
  });

  it('returns care-team reliability warnings without raw recipient values when required channels are missing', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'link_physician',
        role: 'physician',
        name: '佐藤医師',
        phone: '03-1111-1111',
        email: 'doctor@example.com',
        fax: null,
        is_primary: true,
      },
    ]);

    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [
            {
              role: 'physician',
              name: '佐藤医師',
              phone: '03-1111-1111',
              email: 'doctor@example.com',
              is_primary: true,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      case_id: 'case_active',
      data: [expect.objectContaining({ id: 'link_physician' })],
      warnings: [
        {
          code: 'CARE_TEAM_RELIABILITY_UNREADY',
          severity: 'warning',
          message: '緊急連絡先あり / 不足: 訪看、ケアマネ / 報告FAX未登録: 医師',
        },
      ],
      metadata: {
        care_team_reliability: {
          needs_confirmation: true,
          alert_count: 1,
          detail: '緊急連絡先あり / 不足: 訪看、ケアマネ / 報告FAX未登録: 医師',
          missing_role_labels: ['訪看', 'ケアマネ'],
          phone_missing_role_labels: [],
          fax_missing_role_labels: ['医師'],
        },
      },
    });
    expect(JSON.stringify(json.warnings)).not.toMatch(/03-1111-1111|doctor@example.com|佐藤医師/);
    expect(JSON.stringify(json.metadata)).not.toMatch(/03-1111-1111|doctor@example.com|佐藤医師/);
  });

  it('normalizes care-team primary flags by role before replacing links', async () => {
    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [
            {
              role: 'physician',
              name: '主治医A',
              phone: '03-1111-1111',
              fax: '03-1111-1112',
              is_primary: true,
            },
            {
              role: 'physician',
              name: '主治医B',
              phone: '03-2222-2222',
              fax: '03-2222-2223',
              is_primary: true,
            },
            {
              role: 'nurse',
              name: '訪看A',
              phone: '03-3333-3333',
              fax: '03-3333-3334',
              is_primary: false,
            },
            {
              role: 'nurse',
              name: '訪看B',
              phone: '03-4444-4444',
              fax: '03-4444-4445',
              is_primary: false,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ role: 'physician', name: '主治医A', is_primary: true }),
        expect.objectContaining({ role: 'physician', name: '主治医B', is_primary: false }),
        expect.objectContaining({ role: 'nurse', name: '訪看A', is_primary: true }),
        expect.objectContaining({ role: 'nurse', name: '訪看B', is_primary: false }),
      ],
    });
  });

  it('returns 409 when primary care-team uniqueness is hit by a concurrent update', async () => {
    createManyMock.mockRejectedValueOnce({ code: 'P2002' });

    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [
            {
              role: 'physician',
              name: '主治医A',
              phone: '03-1111-1111',
              fax: '03-1111-1112',
              is_primary: true,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'ケアチームが同時に更新されました。再読み込みしてください',
    });
  });

  it('returns 409 for an archived patient before replacing care-team links', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [{ role: 'physician', name: '佐藤医師', is_primary: true }],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'アーカイブ中の患者は復元するまで更新できません',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('rejects external professionals outside the current org', async () => {
    externalProfessionalFindManyMock.mockResolvedValue([]);

    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [
            {
              external_professional_id: 'external_other_org',
              role: 'physician',
              name: '他院医師',
              is_primary: true,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(createManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      message: '他組織の他職種はケアチームに登録できません',
    });
  });

  it('GET returns 404 when patient is not assigned to the requesting user', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/patients/patient_unknown/care-team', undefined, {
        'x-org-id': 'corg1234567890123456789012',
      }),
      { params: Promise.resolve({ id: 'patient_unknown' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
  });

  it('PUT returns 404 when the requested case_id does not belong to an assigned case', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_unassigned',
          links: [],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });
});
