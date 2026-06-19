import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyContractFindFirstMock,
  templateFindFirstMock,
  fileAssetFindFirstMock,
  contractDocumentCreateMock,
  contractDocumentFindManyMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyContractFindFirstMock: vi.fn(),
  templateFindFirstMock: vi.fn(),
  fileAssetFindFirstMock: vi.fn(),
  contractDocumentCreateMock: vi.fn(),
  contractDocumentFindManyMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
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
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyContract: { findFirst: pharmacyContractFindFirstMock },
        template: { findFirst: templateFindFirstMock },
        fileAsset: { findFirst: fileAssetFindFirstMock },
        contractDocument: {
          create: contractDocumentCreateMock,
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
      where: { id: 'file_1', org_id: 'org_1', status: 'completed' },
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
          article_count: 23,
          billing_model: 'fixed_per_visit',
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
