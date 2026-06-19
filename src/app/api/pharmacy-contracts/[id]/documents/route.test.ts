import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyContractFindFirstMock,
  templateFindFirstMock,
  fileAssetFindFirstMock,
  contractDocumentCreateMock,
  contractDocumentFindManyMock,
  contractDocumentFindFirstMock,
  createAuditLogEntryMock,
  renderContractDocumentPdfMock,
  storeGeneratedFileMock,
  deleteGeneratedFileMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyContractFindFirstMock: vi.fn(),
  templateFindFirstMock: vi.fn(),
  fileAssetFindFirstMock: vi.fn(),
  contractDocumentCreateMock: vi.fn(),
  contractDocumentFindManyMock: vi.fn(),
  contractDocumentFindFirstMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  renderContractDocumentPdfMock: vi.fn(),
  storeGeneratedFileMock: vi.fn(),
  deleteGeneratedFileMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/pdf-pharmacy-contract-document', () => ({
  renderPharmacyContractDocumentPdf: renderContractDocumentPdfMock,
}));

vi.mock('@/server/services/file-storage', () => {
  class FileStorageError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }

  return {
    deleteGeneratedFile: deleteGeneratedFileMock,
    FileStorageError,
    storeGeneratedFile: storeGeneratedFileMock,
  };
});

import { GET as rawGET, POST as rawPOST } from './route';

const routeContext = { params: Promise.resolve({ id: 'contract_1' }) };
const GET = (req: NextRequest) => rawGET(req, routeContext);
const POST = (req: NextRequest) => rawPOST(req, routeContext);

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-contracts/contract_1/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createGetRequest() {
  return new NextRequest('http://localhost/api/pharmacy-contracts/contract_1/documents');
}

function contractTemplateArticles(
  body = '{{base_pharmacy_name}} と {{partner_pharmacy_name}} の契約本文',
) {
  return Array.from({ length: 23 }, (_value, index) => ({
    article_no: index + 1,
    title: `基本条項 ${index + 1}`,
    body,
  }));
}

function buildContract(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contract_1',
    partnership_id: 'partnership_1',
    status: 'active',
    effective_from: new Date('2026-06-01T00:00:00.000Z'),
    effective_to: null,
    closing_day: 20,
    payment_due_rule: { month_offset: 1, day: 10 },
    partnership: {
      id: 'partnership_1',
      status: 'active',
      base_site: { id: 'site_base', name: '基幹薬局' },
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
    },
    versions: [
      {
        id: 'version_1',
        version_no: 1,
        status: 'active',
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: null,
        fee_rules: [
          {
            billing_model: 'fixed_per_visit',
            unit_price: 5500,
            addon_rules: null,
            expense_rules: null,
            tax_category: 'taxable',
            tax_rate_bp: 1000,
            rounding_rule: 'round',
          },
        ],
      },
    ],
    ...overrides,
  };
}

function buildTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template_1',
    name: '薬局間連携契約書',
    format: 'html',
    version: 3,
    content: {
      articles: contractTemplateArticles(),
    },
    ...overrides,
  };
}

describe('/api/pharmacy-contracts/[id]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacyContractFindFirstMock.mockResolvedValue(buildContract());
    templateFindFirstMock.mockResolvedValue(buildTemplate());
    fileAssetFindFirstMock.mockResolvedValue({ id: 'file_1' });
    contractDocumentFindFirstMock.mockResolvedValue(null);
    contractDocumentCreateMock.mockResolvedValue({
      id: 'contract_document_1',
      contract_id: 'contract_1',
      version_id: 'version_1',
      template_id: 'template_1',
      file_id: null,
      document_type: 'basic_contract',
      hash_value: 'hash_from_route',
      signed_at: null,
      created_by: 'user_1',
      created_at: new Date('2026-06-19T00:00:00.000Z'),
      updated_at: new Date('2026-06-19T00:00:00.000Z'),
    });
    contractDocumentFindManyMock.mockResolvedValue([
      {
        id: 'contract_document_1',
        contract_id: 'contract_1',
        version_id: 'version_1',
        template_id: 'template_1',
        file_id: null,
        document_type: 'basic_contract',
        hash_value: 'hash_1',
        signed_at: null,
        created_by: 'user_1',
        created_at: new Date('2026-06-19T00:00:00.000Z'),
        updated_at: new Date('2026-06-19T00:00:00.000Z'),
      },
    ]);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    renderContractDocumentPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'contract_1_contract_v1.pdf',
    });
    storeGeneratedFileMock.mockResolvedValue({
      version: 1,
      id: 'generated_file_1',
      orgId: 'org_1',
      purpose: 'contract-document',
      storageKey:
        'contract-documents/org_1/contract-document-contract_1/generated_file_1-contract.pdf',
      originalName: 'contract_1_contract_v1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 3,
      status: 'uploaded',
      patientId: null,
      visitRecordId: null,
      reportId: null,
      jobId: 'contract-document-contract_1',
      uploadedBy: 'user_1',
      etag: null,
      createdAt: '2026-06-19T00:00:00.000Z',
      updatedAt: '2026-06-19T00:00:00.000Z',
      completedAt: '2026-06-19T00:00:00.000Z',
      expiresAt: null,
      downloadDisposition: 'attachment',
    });
    deleteGeneratedFileMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyContract: { findFirst: pharmacyContractFindFirstMock },
        template: { findFirst: templateFindFirstMock },
        fileAsset: { findFirst: fileAssetFindFirstMock },
        contractDocument: {
          create: contractDocumentCreateMock,
          findFirst: contractDocumentFindFirstMock,
          findMany: contractDocumentFindManyMock,
        },
      }),
    );
  });

  it('previews a contract document from the default template without DB writes or audit', async () => {
    const response = await POST(
      createPostRequest({
        mode: 'preview',
        document_type: 'basic_contract',
      }),
    );

    expect(response.status).toBe(200);
    expect(templateFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        template_type: 'contract_document',
        OR: [{ target_role: 'partner_pharmacy' }, { target_role: null }],
      },
      orderBy: [{ is_default: 'desc' }, { version: 'desc' }, { updated_at: 'desc' }],
      select: expect.any(Object),
    });
    expect(contractDocumentCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();

    await expect(response.json()).resolves.toMatchObject({
      mode: 'preview',
      document_type: 'basic_contract',
      snapshot: {
        template: { id: 'template_1', version: 3 },
        version: { id: 'version_1', version_no: 1 },
        fee_schedule: {
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
          tax_category: 'taxable',
        },
      },
    });
  });

  it('does not render or store a PDF during preview even when generate_pdf is requested', async () => {
    const response = await POST(
      createPostRequest({
        mode: 'preview',
        document_type: 'basic_contract',
        generate_pdf: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(renderContractDocumentPdfMock).not.toHaveBeenCalled();
    expect(storeGeneratedFileMock).not.toHaveBeenCalled();
    expect(contractDocumentCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      mode: 'preview',
      document_type: 'basic_contract',
    });
  });

  it('saves a generated document and audits only metadata when a signed PDF is attached', async () => {
    contractDocumentCreateMock.mockResolvedValue({
      id: 'contract_document_1',
      contract_id: 'contract_1',
      version_id: 'version_1',
      template_id: 'template_1',
      file_id: 'file_1',
      document_type: 'signed_contract',
      hash_value: 'hash_from_route',
      signed_at: new Date('2026-06-20T00:00:00.000Z'),
      created_by: 'user_1',
      created_at: new Date('2026-06-20T00:00:00.000Z'),
      updated_at: new Date('2026-06-20T00:00:00.000Z'),
    });

    const response = await POST(
      createPostRequest({
        mode: 'save',
        version_id: 'version_1',
        template_id: 'template_1',
        document_type: 'signed_contract',
        signed_file_id: 'file_1',
        signed_at: '2026-06-20',
      }),
    );

    expect(response.status).toBe(201);
    expect(pharmacyContractFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'contract_1', org_id: 'org_1' },
      }),
    );
    expect(templateFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'template_1',
        org_id: 'org_1',
        template_type: 'contract_document',
      },
      select: expect.any(Object),
    });
    expect(fileAssetFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'file_1',
        org_id: 'org_1',
        status: 'uploaded',
        purpose: 'contract-document',
        mime_type: 'application/pdf',
        patient_id: null,
        visit_record_id: null,
        report_id: null,
        job_id: null,
      },
      select: { id: true },
    });
    expect(contractDocumentFindFirstMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', file_id: 'file_1' },
      select: { id: true },
    });
    expect(contractDocumentCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        contract_id: 'contract_1',
        version_id: 'version_1',
        template_id: 'template_1',
        file_id: 'file_1',
        document_type: 'signed_contract',
        signed_at: new Date('2026-06-20T00:00:00.000Z'),
        created_by: 'user_1',
      }),
      select: expect.any(Object),
    });
    expect(contractDocumentCreateMock.mock.calls[0]?.[0].data.hash_value).toMatch(/^[0-9a-f]{64}$/);
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_contract_document_created',
        targetType: 'ContractDocument',
        targetId: 'contract_document_1',
        changes: expect.objectContaining({
          contract_id: 'contract_1',
          version_id: 'version_1',
          template_id: 'template_1',
          document_type: 'signed_contract',
          signed_file_attached: true,
          generated_pdf_stored: false,
          has_signed_at: true,
          article_count: 23,
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('基幹薬局 と 協力薬局 の契約本文');
    await expect(response.json()).resolves.toMatchObject({
      id: 'contract_document_1',
      file_id: 'file_1',
      preview: {
        snapshot: {
          articles: expect.arrayContaining([
            expect.objectContaining({
              article_no: 1,
              body: '基幹薬局 と 協力薬局 の契約本文',
            }),
          ]),
        },
      },
    });
  });

  it('renders and stores a generated contract PDF when requested', async () => {
    contractDocumentCreateMock.mockResolvedValue({
      id: 'contract_document_2',
      contract_id: 'contract_1',
      version_id: 'version_1',
      template_id: 'template_1',
      file_id: 'generated_file_1',
      document_type: 'basic_contract',
      hash_value: 'hash_from_route',
      signed_at: null,
      created_by: 'user_1',
      created_at: new Date('2026-06-20T00:00:00.000Z'),
      updated_at: new Date('2026-06-20T00:00:00.000Z'),
    });

    const response = await POST(
      createPostRequest({
        mode: 'save',
        version_id: 'version_1',
        template_id: 'template_1',
        document_type: 'basic_contract',
        generate_pdf: true,
      }),
    );

    expect(response.status).toBe(201);
    expect(renderContractDocumentPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({
        document_type: 'basic_contract',
        snapshot: expect.objectContaining({
          contract: expect.objectContaining({ id: 'contract_1' }),
          template: expect.objectContaining({ id: 'template_1' }),
          version: expect.objectContaining({ id: 'version_1' }),
        }),
      }),
    );
    expect(storeGeneratedFileMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      purpose: 'contract-document',
      fileName: 'contract_1_contract_v1.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('pdf'),
      uploadedBy: 'user_1',
      jobId: 'contract-document-contract_1',
      downloadDisposition: 'attachment',
    });
    expect(contractDocumentCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        file_id: 'generated_file_1',
        document_type: 'basic_contract',
        signed_at: null,
      }),
      select: expect.any(Object),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        changes: expect.objectContaining({
          signed_file_attached: false,
          generated_pdf_stored: true,
          has_signed_at: false,
          article_count: 23,
        }),
      }),
    );
    expect(deleteGeneratedFileMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      id: 'contract_document_2',
      file_id: 'generated_file_1',
      preview: {
        snapshot: {
          contract: { id: 'contract_1' },
        },
      },
    });
  });

  it('cleans up a generated contract PDF when document metadata persistence fails', async () => {
    contractDocumentCreateMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      POST(
        createPostRequest({
          mode: 'save',
          version_id: 'version_1',
          template_id: 'template_1',
          document_type: 'basic_contract',
          generate_pdf: true,
        }),
      ),
    ).rejects.toThrow('db unavailable');

    expect(renderContractDocumentPdfMock).toHaveBeenCalledOnce();
    expect(storeGeneratedFileMock).toHaveBeenCalledOnce();
    expect(deleteGeneratedFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated_file_1',
        purpose: 'contract-document',
      }),
    );
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects simultaneous generated PDF storage and signed PDF attachment', async () => {
    const response = await POST(
      createPostRequest({
        mode: 'save',
        signed_file_id: 'file_1',
        generate_pdf: true,
      }),
    );

    expect(response.status).toBe(400);
    expect(renderContractDocumentPdfMock).not.toHaveBeenCalled();
    expect(storeGeneratedFileMock).not.toHaveBeenCalled();
    expect(contractDocumentCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        generate_pdf: ['PDF自動生成と署名済みPDF添付は同時に指定できません'],
      },
    });
  });

  it('rejects templates missing required articles before document create or audit', async () => {
    templateFindFirstMock.mockResolvedValue(
      buildTemplate({
        content: {
          articles: [{ article_no: 1, title: '第1条', body: 'only one article' }],
        },
      }),
    );

    const response = await POST(createPostRequest({ mode: 'save' }));

    expect(response.status).toBe(400);
    expect(contractDocumentCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        missing_article_numbers: expect.arrayContaining([2, 23]),
      },
    });
  });

  it('rejects missing signed files before document create or audit', async () => {
    fileAssetFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createPostRequest({
        signed_file_id: 'missing_file',
      }),
    );

    expect(response.status).toBe(400);
    expect(contractDocumentCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects signed files that are already linked to another contract document', async () => {
    contractDocumentFindFirstMock.mockResolvedValue({ id: 'contract_document_existing' });

    const response = await POST(
      createPostRequest({
        signed_file_id: 'file_1',
      }),
    );

    expect(response.status).toBe(400);
    expect(contractDocumentCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        signed_file_id: ['未使用の契約書PDFファイルを指定してください'],
      },
    });
  });

  it('lists generated contract documents under the contract org scope', async () => {
    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    expect(pharmacyContractFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'contract_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(contractDocumentFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', contract_id: 'contract_1' },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: expect.any(Object),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'contract_document_1', contract_id: 'contract_1' }],
    });
  });
});
