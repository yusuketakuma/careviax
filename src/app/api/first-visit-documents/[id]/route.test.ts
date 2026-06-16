import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  careCaseFindFirstMock,
  firstVisitDocumentFindFirstMock,
  firstVisitDocumentFindUniqueMock,
  firstVisitDocumentUpdateManyMock,
  auditLogCreateMock,
  getPatientDocumentsDataMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  firstVisitDocumentFindFirstMock: vi.fn(),
  firstVisitDocumentFindUniqueMock: vi.fn(),
  firstVisitDocumentUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  getPatientDocumentsDataMock: vi.fn(),
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
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    firstVisitDocument: {
      findFirst: firstVisitDocumentFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/patient-detail-documents', () => ({
  getPatientDocumentsData: getPatientDocumentsDataMock,
}));

import { PATCH as rawPATCH } from './route';

const PATCH = (req: NextRequest, id = 'doc_1') =>
  rawPATCH(req, { params: Promise.resolve({ id }) });

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/first-visit-documents/doc_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/first-visit-documents/[id]', () => {
  const updatedAt = new Date('2026-06-01T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    firstVisitDocumentFindFirstMock.mockResolvedValue({
      id: 'doc_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      document_url: '/api/visit-records/record_1/pdf',
      delivered_at: null,
      delivered_to: null,
      updated_at: updatedAt,
    });
    firstVisitDocumentUpdateManyMock.mockResolvedValue({ count: 1 });
    firstVisitDocumentFindUniqueMock.mockResolvedValue({
      id: 'doc_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      emergency_contacts: [],
      document_url: '/api/visit-records/record_1/pdf',
      delivered_at: new Date('2026-06-16T00:00:00.000Z'),
      delivered_to: '山田太郎',
      created_at: new Date('2026-06-01T00:00:00.000Z'),
      updated_at: new Date('2026-06-16T00:00:00.000Z'),
    });
    getPatientDocumentsDataMock.mockResolvedValue({
      print_readiness: {
        overall_status: 'ready',
        missing_required_count: 0,
        warning_count: 0,
        template_versions: [],
        checks: [
          {
            key: 'patient_profile',
            label: '患者基本情報',
            completed: true,
            severity: 'required',
            description: '氏名、フリガナ、生年月日を差し込みできます。',
            action_href: '/patients/patient_1/edit',
            action_label: '基本情報を編集',
          },
        ],
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        firstVisitDocument: {
          updateMany: firstVisitDocumentUpdateManyMock,
          findUnique: firstVisitDocumentFindUniqueMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('rejects invalid route IDs before touching storage', async () => {
    const response = (await PATCH(createPatchRequest({ delivered_to: '山田太郎' }), ''))!;

    expect(response.status).toBe(400);
    expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe document URLs', async () => {
    const response = (await PATCH(createPatchRequest({ document_url: 'javascript:alert(1)' })))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        document_url: expect.arrayContaining([
          '文書URLは相対パス、HTTPS、またはローカル開発用HTTPで指定してください',
        ]),
      },
    });
    expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
  });

  it('rejects non-local HTTP document URLs before loading the document', async () => {
    const response = (await PATCH(
      createPatchRequest({ document_url: 'http://files.example.test/contracts/doc_1.pdf' }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        document_url: expect.arrayContaining([
          '文書URLは相対パス、HTTPS、またはローカル開発用HTTPで指定してください',
        ]),
      },
    });
    expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
  });

  it('requires a reason before recording replacement or invalidation history', async () => {
    const response = (await PATCH(
      createPatchRequest({
        document_action: {
          action: 'replaced',
          document_type: 'contract',
          template_name: '居宅療養管理指導契約書 2026年版',
          template_version: 'v1.1',
          storage_location: 'store',
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        document_action: expect.arrayContaining(['差替え・無効化では理由を入力してください']),
      },
    });
    expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
  });

  it('requires a document URL before recording image-saved history', async () => {
    firstVisitDocumentFindFirstMock.mockResolvedValue({
      id: 'doc_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      document_url: null,
      delivered_at: null,
      delivered_to: null,
      updated_at: updatedAt,
    });

    const response = (await PATCH(
      createPatchRequest({
        document_action: {
          action: 'image_saved',
          document_type: 'contract',
          storage_location: 'store',
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        document_url: expect.arrayContaining([
          '画像保存・差替えでは署名済み書類のURLを入力してください',
        ]),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('requires delivery target before recording recovered history', async () => {
    const response = (await PATCH(
      createPatchRequest({
        delivered_at: '2026-06-16T00:00:00.000Z',
        delivered_to: '',
        document_action: {
          action: 'recovered',
          document_type: 'important_matters',
          storage_location: 'store',
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        delivered_to: expect.arrayContaining(['回収では同意者・交付先を入力してください']),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('allows localhost HTTP document URLs for local development previews', async () => {
    const response = (await PATCH(
      createPatchRequest({ document_url: 'http://localhost:3000/api/visit-records/record_1/pdf' }),
    ))!;

    expect(response.status).toBe(200);
    expect(firstVisitDocumentUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'doc_1',
        org_id: 'org_1',
        updated_at: updatedAt,
      },
      data: {
        document_url: 'http://localhost:3000/api/visit-records/record_1/pdf',
      },
    });
  });

  it('updates delivered status and document URL with assignment and optimistic checks', async () => {
    const response = (await PATCH(
      createPatchRequest({
        delivered_at: '2026-06-16T00:00:00.000Z',
        delivered_to: '山田太郎',
        document_url: '/api/visit-records/record_1/pdf',
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(firstVisitDocumentUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'doc_1',
        org_id: 'org_1',
        updated_at: updatedAt,
      },
      data: {
        delivered_at: new Date('2026-06-16T00:00:00.000Z'),
        delivered_to: '山田太郎',
        document_url: '/api/visit-records/record_1/pdf',
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'doc_1',
        document_url: '/api/visit-records/record_1/pdf',
        delivered_to: '山田太郎',
      },
    });
  });

  it('records document history actions in audit log', async () => {
    const response = (await PATCH(
      createPatchRequest({
        delivered_at: '2026-06-16T00:00:00.000Z',
        delivered_to: '山田太郎',
        document_url: '/api/visit-records/record_1/pdf',
        document_action: {
          action: 'replaced',
          document_type: 'contract',
          template_name: '居宅療養管理指導契約書 2026年版',
          template_version: 'v1.1',
          storage_location: 'store',
          reason: '署名者を長女へ訂正',
          note: '本人同席',
        },
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'first_visit_document.replaced',
        target_type: 'first_visit_document',
        target_id: 'doc_1',
        changes: expect.objectContaining({
          document_action: expect.objectContaining({
            action: 'replaced',
            document_type: 'contract',
            reason: '署名者を長女へ訂正',
          }),
          patient_id: 'patient_1',
          case_id: 'case_1',
          next: expect.objectContaining({
            document_url: '/api/visit-records/record_1/pdf',
            delivered_to: '山田太郎',
          }),
        }),
      }),
    });
  });

  it('records print history without rewriting document fields', async () => {
    const response = (await PATCH(
      createPatchRequest({
        document_action: {
          action: 'printed',
          document_type: 'first_visit_document',
          template_name: '契約・同意控え',
          template_version: 'print-preview',
          print_batch_id: 'print_20260616T013000Z_batch1',
          note: '印刷ハブから印刷',
        },
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(firstVisitDocumentUpdateManyMock).not.toHaveBeenCalled();
    expect(getPatientDocumentsDataMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'first_visit_document.printed',
        target_type: 'first_visit_document',
        target_id: 'doc_1',
        changes: expect.objectContaining({
          document_action: expect.objectContaining({
            action: 'printed',
            document_type: 'first_visit_document',
            print_batch_id: 'print_20260616T013000Z_batch1',
            note: '印刷ハブから印刷',
          }),
          patient_id: 'patient_1',
          case_id: 'case_1',
        }),
      }),
    });
  });

  it('records print history and saves the print copy URL when requested', async () => {
    firstVisitDocumentFindUniqueMock.mockResolvedValue({
      id: 'doc_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      emergency_contacts: [],
      document_url:
        '/reports/print?type=first_visit_documents&patient_id=patient_1&document_id=doc_1&copy=1',
      delivered_at: new Date('2026-06-16T00:00:00.000Z'),
      delivered_to: '山田太郎',
      created_at: new Date('2026-06-01T00:00:00.000Z'),
      updated_at: new Date('2026-06-16T00:00:00.000Z'),
    });

    const response = (await PATCH(
      createPatchRequest({
        document_url:
          '/reports/print?type=first_visit_documents&patient_id=patient_1&document_id=doc_1&copy=1',
        document_action: {
          action: 'printed',
          document_type: 'first_visit_document',
          template_name: '契約・同意控え',
          template_version: 'print-preview',
          note: '印刷ハブから印刷し、控えリンクを保存',
        },
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(getPatientDocumentsDataMock).toHaveBeenCalled();
    expect(firstVisitDocumentUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'doc_1',
        org_id: 'org_1',
        updated_at: updatedAt,
      },
      data: {
        document_url:
          '/reports/print?type=first_visit_documents&patient_id=patient_1&document_id=doc_1&copy=1',
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'first_visit_document.printed',
        changes: expect.objectContaining({
          next: expect.objectContaining({
            document_url:
              '/reports/print?type=first_visit_documents&patient_id=patient_1&document_id=doc_1&copy=1',
          }),
        }),
      }),
    });
  });

  it('blocks print history when required print-readiness checks are incomplete', async () => {
    getPatientDocumentsDataMock.mockResolvedValue({
      print_readiness: {
        overall_status: 'blocked',
        missing_required_count: 2,
        warning_count: 0,
        template_versions: [],
        checks: [
          {
            key: 'primary_residence',
            label: '住所・訪問先',
            completed: false,
            severity: 'required',
            description: '契約書へ転記する住所または施設情報を登録してください。',
            action_href: '/patients/patient_1/edit',
            action_label: '住所を編集',
          },
          {
            key: 'default_templates',
            label: '既定テンプレート',
            completed: false,
            severity: 'required',
            description: '既定テンプレート未設定: 重要事項説明書',
            action_href: '/admin/document-templates',
            action_label: 'テンプレートを確認',
          },
        ],
      },
    });

    const response = (await PATCH(
      createPatchRequest({
        document_url:
          '/reports/print?type=first_visit_documents&patient_id=patient_1&document_id=doc_1&copy=1',
        document_action: {
          action: 'printed',
          document_type: 'first_visit_document',
          template_name: '契約・同意控え',
          template_version: 'print-preview',
          note: '印刷ハブから印刷',
        },
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '初回文書の印刷前チェックで必須項目が未完了です。不足: 住所・訪問先、既定テンプレート',
    });
    expect(firstVisitDocumentUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the document is outside the current organization', async () => {
    firstVisitDocumentFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(createPatchRequest({ delivered_to: '山田太郎' })))!;

    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the row changed after it was read', async () => {
    firstVisitDocumentUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = (await PATCH(createPatchRequest({ delivered_to: '山田太郎' })))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '初回文書が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
  });
});
