import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  expectPhiExportSnapshotRedacted,
  expectSensitiveNoStore,
} from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  communicationRequestFindManyMock,
  patientFindManyMock,
  careCaseFindManyMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
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
      findMany: patientFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/communication-requests/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    communicationRequestFindManyMock.mockResolvedValue([
      {
        id: 'request_1',
        patient_id: 'patient_1',
        request_type: 'inquiry',
        recipient_name: '在宅主治医',
        recipient_role: '医師/FAX',
        related_entity_type: 'medication_cycle',
        related_entity_id: 'cycle_1',
        status: 'responded',
        subject: '疑義照会',
        content:
          '服用方法の確認。電話 03-1234-5678 へ折り返し希望。アムロジピン調整、保険者番号12345678、provider raw error token=secret',
        due_date: new Date('2026-03-30T00:00:00.000Z'),
        requested_at: new Date('2026-03-28T09:30:00.000Z'),
        context_snapshot: {
          line_count: 2,
          phone: '03-1234-5678',
          address: '東京都千代田区1-1-1',
          note: '家族へ事前共有',
          storageKey: 'exports/org_1/request_1/raw.csv',
          signed_url: 'https://signed.example/raw?token=secret',
          recommended_channels: ['fax', 'phone'],
        },
        responses: [
          {
            responder_name: '在宅主治医',
            responded_at: new Date('2026-03-28T11:00:00.000Z'),
          },
        ],
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '山田 太郎' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationRequest: {
          findMany: communicationRequestFindManyMock,
        },
        patient: {
          findMany: patientFindManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('returns collaborator handoff csv with patient and response fields', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=internal&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expectSensitiveNoStore(response);
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const body = await response.text();
    expect(body).toContain('patient_name');
    expect(body).toContain('"山田 太郎"');
    expect(body).toContain('"医師/FAX"');
    expect(body).toContain('"yes"');
    expect(body).toContain('"handoff-prep"');
    expect(body).toContain('03-1234-5678');
    expect(body).toContain('東京都千代田区1-1-1');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
    });
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ requested_at: 'desc' }, { id: 'desc' }],
        take: 1001,
        select: expect.objectContaining({
          responses: expect.objectContaining({
            orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
          }),
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'export',
        target_type: 'communication_request',
        target_id: 'bulk',
        changes: expect.objectContaining({
          format: 'csv',
          record_count: 1,
          filters: expect.objectContaining({
            status: 'responded',
            request_type: null,
            profile: 'internal',
            redaction_profile: 'internal',
            care_report_rows_excluded: false,
          }),
          metadata: expect.objectContaining({
            exported_request_id_hashes: [expect.stringMatching(/^[a-f0-9]{16}$/)],
            exported_request_count: 1,
            exported_request_id_hashes_truncated: false,
            exported_patient_count: 1,
            exported_patient_id_hashes: [expect.stringMatching(/^[a-f0-9]{16}$/)],
            exported_patient_id_hashes_truncated: false,
            export_snapshot_id: expect.stringMatching(/^[a-f0-9]{16}$/),
          }),
        }),
      }),
    });
  });

  it('trims export status and request type filters before query and audit', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=internal&status=%20responded%20&request_type=%20inquiry%20',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('Content-Disposition')).toContain(
      'communication_requests_responded_type-inquiry.csv',
    );
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: 'responded',
          request_type: 'inquiry',
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          filters: expect.objectContaining({
            status: 'responded',
            request_type: 'inquiry',
            profile: 'internal',
          }),
        }),
      }),
    });
  });

  it('allows internal exports narrowed only by request type and uses a safe filename token', async () => {
    const response = await GET(
      createRequest(
        `http://localhost/api/communication-requests/export?profile=internal&request_type=${encodeURIComponent('処方医フォロー')}`,
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="communication_requests_type-[a-f0-9]{16}\.csv"$/,
    );
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          request_type: '処方医フォロー',
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          filters: expect.objectContaining({
            status: null,
            request_type: '処方医フォロー',
            profile: 'internal',
          }),
        }),
      }),
    });
  });

  it('returns a sanitized no-store 500 when auth lookup fails unexpectedly', async () => {
    authMock.mockRejectedValueOnce(new Error('患者 山田花子 090-1234-5678 raw export auth detail'));

    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=internal&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw export auth detail');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('neutralizes formula-leading CSV cells in internal exports', async () => {
    communicationRequestFindManyMock.mockResolvedValueOnce([
      {
        id: 'request_1',
        patient_id: 'patient_1',
        request_type: 'inquiry',
        recipient_name: '@在宅主治医',
        recipient_role: '医師/FAX',
        related_entity_type: 'medication_cycle',
        related_entity_id: 'cycle_1',
        status: 'responded',
        subject: '+疑義照会',
        content: '=HYPERLINK("https://example.invalid","服用方法")',
        due_date: new Date('2026-03-30T00:00:00.000Z'),
        requested_at: new Date('2026-03-28T09:30:00.000Z'),
        context_snapshot: {
          note: '\t家族へ事前共有',
        },
        responses: [
          {
            responder_name: '在宅主治医',
            responded_at: new Date('2026-03-28T11:00:00.000Z'),
          },
        ],
      },
    ]);
    patientFindManyMock.mockResolvedValueOnce([{ id: 'patient_1', name: '-山田 太郎' }]);

    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=internal&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('"\'-山田 太郎"');
    expect(body).toContain('"\'@在宅主治医"');
    expect(body).toContain('"\' +疑義照会"'.replace(' ', ''));
    expect(body).toContain('"\'=HYPERLINK(""https://example.invalid"",""服用方法"")"');
    expect(body).not.toContain('"=HYPERLINK');
    expect(body).not.toContain('"+疑義照会"');
  });

  it('rejects internal exports when the caller cannot output care-report communications', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'clerk' });

    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=internal&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '内部向け連携依頼エクスポートの権限がありません',
    });
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('defaults to an external redacted csv profile when profile is omitted', async () => {
    const response = await GET(
      createRequest('http://localhost/api/communication-requests/export?status=responded'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('Content-Disposition')).toContain(
      'communication_requests_responded_external.csv',
    );
    const body = await response.text();
    expect(body).toContain('redaction_profile');
    expect(body).toContain('"external"');
    expect(body).not.toContain('patient_name');
    expect(body).not.toContain('山田 太郎');
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          filters: expect.objectContaining({
            profile: 'external',
            redaction_profile: 'external',
          }),
        }),
      }),
    });
  });

  it('returns an external redacted csv without patient names, snapshots, or free text', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?status=responded&profile=external',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('Content-Disposition')).toContain(
      'communication_requests_responded_external.csv',
    );
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const body = await response.text();
    const [header] = body.split('\n');
    expect(header).toBe(
      [
        'external_row_id',
        'request_type',
        'status',
        'recipient_role',
        'related_entity_type',
        'requested_at',
        'due_date',
        'latest_responded_at',
        'fax_ready',
        'nsips_csv_profile',
        'redaction_profile',
      ].join(','),
    );
    expect(body).toMatch(/\n"[a-f0-9]{16}","inquiry","responded"/);
    expect(body).toContain('"handoff-external-redacted"');
    expect(body).toContain('"external"');
    expect(body).not.toContain('request_1');
    expect(body).not.toContain('patient_name');
    expect(body).not.toContain('patient_1');
    expect(body).not.toContain('山田 太郎');
    expectPhiExportSnapshotRedacted(body, [
      '服用方法の確認',
      'exports/org_1',
      'signed_url',
      'raw.csv',
    ]);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    const select = communicationRequestFindManyMock.mock.calls[0]?.[0]?.select;
    expect(select).toMatchObject({
      id: true,
      request_type: true,
      recipient_role: true,
      related_entity_type: true,
      status: true,
      due_date: true,
      requested_at: true,
      context_snapshot: true,
      responses: {
        select: {
          responded_at: true,
        },
      },
    });
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1001,
      }),
    );
    expect(select).not.toHaveProperty('patient_id');
    expect(select).not.toHaveProperty('recipient_name');
    expect(select).not.toHaveProperty('related_entity_id');
    expect(select).not.toHaveProperty('subject');
    expect(select).not.toHaveProperty('content');
    expect(select.responses.select).not.toHaveProperty('responder_name');
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          record_count: 1,
          filters: expect.objectContaining({
            status: 'responded',
            request_type: null,
            profile: 'external',
            redaction_profile: 'external',
          }),
          metadata: expect.objectContaining({
            exported_request_id_hashes: [expect.stringMatching(/^[a-f0-9]{16}$/)],
            exported_request_count: 1,
            exported_patient_count: 0,
            exported_patient_id_hashes: [],
            export_snapshot_id: expect.stringMatching(/^[a-f0-9]{16}$/),
          }),
        }),
      }),
    });
  });

  it('fails closed when export audit persistence fails', async () => {
    auditLogCreateMock.mockRejectedValueOnce(new Error('audit unavailable'));

    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=internal&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('Content-Type') ?? '').not.toContain('text/csv');
    await expect(response.json()).resolves.toMatchObject({
      code: 'COMMUNICATION_REQUEST_EXPORT_AUDIT_FAILED',
      message: '連携依頼のエクスポート監査を記録できませんでした',
    });
  });

  it('returns an export failure code when the request read fails before audit persistence', async () => {
    communicationRequestFindManyMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=internal&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'COMMUNICATION_REQUEST_EXPORT_FAILED',
      message: '連携依頼のエクスポートに失敗しました',
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid status before resolving assignment scope', async () => {
    const response = await GET(
      createRequest('http://localhost/api/communication-requests/export?status=archived'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        status: ['対応していないステータスです'],
      },
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
  });

  it.each([
    ['status', '?status=', { status: ['ステータスを指定してください'] }],
    ['blank status', '?status=%20%20', { status: ['ステータスを指定してください'] }],
    ['request_type', '?request_type=', { request_type: ['依頼種別を指定してください'] }],
    [
      'blank request_type',
      '?request_type=%20%20',
      { request_type: ['依頼種別を指定してください'] },
    ],
  ])(
    'rejects explicitly empty %s filters before resolving assignment scope',
    async (_label, query, details) => {
      const response = await GET(
        createRequest(`http://localhost/api/communication-requests/export${query}`),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details,
      });
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects internal exports without a narrowing status or request type filter', async () => {
    const response = await GET(
      createRequest('http://localhost/api/communication-requests/export?profile=internal'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '内部向けエクスポートには status または request_type の指定が必要です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects exports above the synchronous row cap before returning a csv', async () => {
    communicationRequestFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 1001 }, (_, index) => ({
        id: `request_${index}`,
        request_type: 'inquiry',
        recipient_role: '医師',
        related_entity_type: 'medication_cycle',
        status: 'responded',
        due_date: null,
        requested_at: new Date('2026-03-28T09:30:00.000Z'),
        context_snapshot: {},
        responses: [],
      })),
    );

    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=external&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { max_rows: 1000 },
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('allows external exports at the synchronous row cap', async () => {
    communicationRequestFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 1000 }, (_, index) => ({
        id: `request_${index}`,
        request_type: 'inquiry',
        recipient_role: '医師',
        related_entity_type: 'medication_cycle',
        status: 'responded',
        due_date: null,
        requested_at: new Date('2026-03-28T09:30:00.000Z'),
        context_snapshot: {},
        responses: [],
      })),
    );

    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=external&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).not.toContain('"request_999"');
    expect(body).toMatch(/\n"[a-f0-9]{16}","inquiry","responded"/);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          record_count: 1000,
          filters: expect.objectContaining({ redaction_profile: 'external' }),
        }),
      }),
    });
  });

  it('rejects internal exports above the synchronous row cap before reading patient names', async () => {
    communicationRequestFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 1001 }, (_, index) => ({
        id: `request_${index}`,
        patient_id: `patient_${index}`,
        request_type: 'inquiry',
        recipient_name: '在宅主治医',
        recipient_role: '医師',
        related_entity_type: 'medication_cycle',
        related_entity_id: 'cycle_1',
        status: 'responded',
        subject: '疑義照会',
        content: '服用方法の確認',
        due_date: null,
        requested_at: new Date('2026-03-28T09:30:00.000Z'),
        context_snapshot: {},
        responses: [],
      })),
    );

    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=internal&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { max_rows: 1000 },
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('allows internal exports at the synchronous row cap', async () => {
    communicationRequestFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 1000 }, (_, index) => ({
        id: `request_${index}`,
        patient_id: `patient_${index}`,
        request_type: 'inquiry',
        recipient_name: '在宅主治医',
        recipient_role: '医師',
        related_entity_type: 'medication_cycle',
        related_entity_id: 'cycle_1',
        status: 'responded',
        subject: '疑義照会',
        content: '服用方法の確認',
        due_date: null,
        requested_at: new Date('2026-03-28T09:30:00.000Z'),
        context_snapshot: {},
        responses: [],
      })),
    );
    patientFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 1000 }, (_, index) => ({
        id: `patient_${index}`,
        name: `患者 ${index}`,
      })),
    );

    const response = await GET(
      createRequest(
        'http://localhost/api/communication-requests/export?profile=internal&status=responded',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('"request_999"');
    expect(body).toContain('"患者 999"');
    expect(patientFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: expect.arrayContaining(['patient_999']) },
      },
      select: { id: true, name: true },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          record_count: 1000,
          filters: expect.objectContaining({ redaction_profile: 'internal' }),
        }),
      }),
    });
  });

  it('rejects an invalid export profile before resolving assignment scope', async () => {
    const response = await GET(
      createRequest('http://localhost/api/communication-requests/export?profile=partner'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        profile: ['internal または external を指定してください'],
      },
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
  });
});
