import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  careCaseFindFirstMock,
  firstVisitDocumentFindManyMock,
  firstVisitDocumentUpdateManyMock,
  auditLogFindManyMock,
  auditLogCreateMock,
  getPatientDocumentsDataMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
  firstVisitDocumentUpdateManyMock: vi.fn(),
  auditLogFindManyMock: vi.fn(),
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
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/patient-detail-documents', () => ({
  getPatientDocumentsData: getPatientDocumentsDataMock,
}));

import { POST as rawPOST } from './route';

const POST = (req: NextRequest) => rawPOST(req, { params: Promise.resolve({}) });

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/first-visit-documents/print-batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
      'user-agent': 'vitest',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/first-visit-documents/print-batch', () => {
  const updatedAt = new Date('2026-06-16T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    firstVisitDocumentFindManyMock.mockResolvedValue([
      {
        id: 'doc_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        document_url: null,
        delivered_at: null,
        delivered_to: null,
        updated_at: updatedAt,
      },
      {
        id: 'doc_2',
        patient_id: 'patient_1',
        case_id: 'case_1',
        document_url: '/existing-copy',
        delivered_at: new Date('2026-06-15T00:00:00.000Z'),
        delivered_to: '長女 山田花子',
        updated_at: updatedAt,
      },
    ]);
    firstVisitDocumentUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogFindManyMock.mockResolvedValue([
      {
        target_id: 'doc_1',
        changes: {
          document_action: {
            action: 'generated',
            document_type: 'contract',
            template_name: '居宅療養管理指導契約書',
            template_version: 'v1.1',
            storage_location: 'store',
          },
        },
      },
      {
        target_id: 'doc_2',
        changes: {
          document_action: {
            action: 'generated',
            document_type: 'important_matters',
            template_name: '重要事項説明書',
            template_version: 'v2',
            storage_location: 'headquarters',
          },
        },
      },
    ]);
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    getPatientDocumentsDataMock.mockResolvedValue({
      print_readiness: {
        overall_status: 'ready',
        missing_required_count: 0,
        warning_count: 0,
        template_versions: [],
        checks: [],
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        firstVisitDocument: {
          findMany: firstVisitDocumentFindManyMock,
          updateMany: firstVisitDocumentUpdateManyMock,
        },
        auditLog: {
          findMany: auditLogFindManyMock,
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('records all selected first-visit documents with one server-generated print batch id', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_2'],
        save_copy: true,
      }),
    ))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      printed_document_ids: ['doc_1', 'doc_2'],
      document_count: 2,
    });
    expect(body.data.print_batch_id).toMatch(/^print_[0-9A-Za-z]+_[0-9a-f]{12}$/);

    expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['doc_1', 'doc_2'] },
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      orderBy: [{ created_at: 'asc' }],
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        document_url: true,
        delivered_at: true,
        delivered_to: true,
        updated_at: true,
      },
    });
    expect(firstVisitDocumentUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(auditLogCreateMock).toHaveBeenCalledTimes(2);
    const printBatchIds = auditLogCreateMock.mock.calls.map(
      ([args]) => args.data.changes.document_action.print_batch_id,
    );
    expect(printBatchIds).toEqual([body.data.print_batch_id, body.data.print_batch_id]);
    expect(new Set(printBatchIds).size).toBe(1);
    expect(auditLogCreateMock).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        action: 'first_visit_document.printed',
        target_id: 'doc_1',
        changes: expect.objectContaining({
          document_action: expect.objectContaining({
            action: 'printed',
            document_type: 'contract',
            template_name: '居宅療養管理指導契約書',
            template_version: 'v1.1',
            storage_location: 'store',
            print_batch_id: body.data.print_batch_id,
          }),
          next: expect.objectContaining({
            document_url:
              '/reports/print?type=first_visit_documents&patient_id=patient_1&document_id=doc_1&copy=1',
          }),
        }),
      }),
    });
  });

  it('does not write partial audit history when any selected document is missing', async () => {
    firstVisitDocumentFindManyMock.mockResolvedValueOnce([
      {
        id: 'doc_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        document_url: null,
        delivered_at: null,
        delivered_to: null,
        updated_at: updatedAt,
      },
    ]);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_missing'],
      }),
    ))!;

    expect(response.status).toBe(404);
    expect(firstVisitDocumentUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('blocks the whole batch when print readiness is incomplete', async () => {
    getPatientDocumentsDataMock.mockResolvedValueOnce({
      print_readiness: {
        overall_status: 'blocked',
        missing_required_count: 1,
        warning_count: 0,
        template_versions: [],
        checks: [
          {
            key: 'care_insurance',
            label: '介護保険情報',
            completed: false,
            severity: 'required',
            description: '介護保険番号を確認します。',
            action_href: '/patients/patient_1#care-insurance',
            action_label: '保険情報へ',
          },
        ],
      },
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_2'],
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '初回文書の印刷前チェックで必須項目が未完了です。不足: 介護保険情報',
    });
    expect(firstVisitDocumentUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('does not create audit history when a copy URL update conflicts', async () => {
    firstVisitDocumentUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_2'],
        save_copy: true,
      }),
    ))!;

    expect(response.status).toBe(409);
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an empty document list before entering the transaction', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: [],
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
