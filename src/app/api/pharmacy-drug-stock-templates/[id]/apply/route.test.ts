import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findMany: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn(), upsert: vi.fn() },
    formularyTemplate: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-drug-stock-templates/template_1/apply', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pharmacy-drug-stock-templates/template_1/apply', {
    method: 'POST',
    body: '{"target_site_id":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/pharmacy-drug-stock-templates/[id]/apply', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_2', name: '支店' });
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      items: [
        {
          drug_master_id: 'drug_new',
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: '標準採用',
        },
        {
          drug_master_id: 'drug_existing',
          reorder_point: 5,
          preferred_generic_id: null,
          adoption_note: null,
        },
      ],
    });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([{ drug_master_id: 'drug_existing' }]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_new',
        yj_code: '111111111111',
        drug_name: '新規薬',
        is_generic: false,
        generic_name: '新規薬',
      },
      {
        id: 'drug_existing',
        yj_code: '222222222222',
        drug_name: '既存薬',
        is_generic: false,
        generic_name: '既存薬',
      },
    ]);
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({ id: 'stock_1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('applies a formulary template to a same-org site and skips existing rows by default', async () => {
    const response = await POST(createRequest({ target_site_id: 'site_2' }), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      itemCount: 2,
      invalidItemCount: 0,
      appliedCount: 1,
      skippedCount: 1,
      overwrite: false,
      dryRun: false,
      preview: {
        summary: {
          item_count: 2,
          create_count: 1,
          skip_existing_count: 1,
          apply_count: 1,
        },
      },
    });
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledOnce();
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          site_id: 'site_2',
          drug_master_id: 'drug_new',
          adoption_source: 'template',
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'formulary_template_applied',
          target_id: 'site_2',
          changes: expect.objectContaining({
            template_id: 'template_1',
            invalid_item_count: 0,
            applied_count: 1,
            skipped_count: 1,
            preview_summary: expect.objectContaining({
              create_count: 1,
              skip_existing_count: 1,
            }),
          }),
        }),
      }),
    );
  });

  it('rejects non-object request bodies before loading template or site records', async () => {
    const response = await POST(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prismaMock.formularyTemplate.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before loading template or site records', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.formularyTemplate.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('previews template application without mutating stock rows or writing audit logs', async () => {
    const response = await POST(createRequest({ target_site_id: 'site_2', dry_run: true }), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      itemCount: 2,
      invalidItemCount: 0,
      appliedCount: 0,
      skippedCount: 1,
      overwrite: false,
      dryRun: true,
      preview: {
        summary: {
          item_count: 2,
          source_item_count: 2,
          invalid_item_count: 0,
          create_count: 1,
          update_count: 0,
          skip_existing_count: 1,
          apply_count: 1,
        },
        rows: [
          {
            action: 'create',
            drug_master_id: 'drug_new',
            drug_master: { yj_code: '111111111111', drug_name: '新規薬' },
          },
          {
            action: 'skip_existing',
            drug_master_id: 'drug_existing',
            drug_master: { yj_code: '222222222222', drug_name: '既存薬' },
          },
        ],
      },
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('reports malformed persisted template item rows during dry-run without mutating', async () => {
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      items: [
        null,
        ['unexpected'],
        'unexpected',
        { drug_master_id: '' },
        {
          drug_master_id: 'drug_valid',
          reorder_point: 8,
          preferred_generic_id: null,
          adoption_note: '有効行のみ',
        },
      ],
    });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_valid',
        yj_code: '333333333333',
        drug_name: '有効薬',
        is_generic: false,
        generic_name: '有効薬',
      },
    ]);

    const response = await POST(createRequest({ target_site_id: 'site_2', dry_run: true }), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      itemCount: 1,
      sourceItemCount: 5,
      invalidItemCount: 4,
      appliedCount: 0,
      skippedCount: 0,
      preview: {
        summary: {
          item_count: 1,
          source_item_count: 5,
          invalid_item_count: 4,
          create_count: 1,
          apply_count: 1,
        },
        rows: [
          {
            action: 'create',
            drug_master_id: 'drug_valid',
            reorder_point: 8,
            preferred_generic_id: null,
            drug_master: { drug_name: '有効薬' },
          },
        ],
      },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('reports missing template drug master references during dry-run without mutating', async () => {
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      items: [
        {
          drug_master_id: 'drug_missing',
          reorder_point: 4,
          preferred_generic_id: null,
          adoption_note: '参照切れ',
        },
        {
          drug_master_id: 'drug_valid',
          reorder_point: 8,
          preferred_generic_id: null,
          adoption_note: '有効行のみ',
        },
      ],
    });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_valid',
        yj_code: '333333333333',
        drug_name: '有効薬',
        is_generic: false,
        generic_name: '有効薬',
      },
    ]);

    const response = await POST(createRequest({ target_site_id: 'site_2', dry_run: true }), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      itemCount: 1,
      sourceItemCount: 2,
      invalidItemCount: 1,
      missingDrugMasterIds: ['drug_missing'],
      preview: {
        summary: {
          item_count: 1,
          source_item_count: 2,
          invalid_item_count: 1,
        },
        rows: [
          {
            action: 'create',
            drug_master_id: 'drug_valid',
            drug_master: { drug_name: '有効薬' },
          },
        ],
      },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('reports missing preferred generic references during dry-run without mutating', async () => {
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      items: [
        {
          drug_master_id: 'drug_valid',
          reorder_point: 8,
          preferred_generic_id: 'generic_missing',
          adoption_note: '参照切れ後発品',
        },
      ],
    });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_valid',
        yj_code: '333333333333',
        drug_name: '有効薬',
        is_generic: false,
        generic_name: '有効薬',
      },
    ]);

    const response = await POST(createRequest({ target_site_id: 'site_2', dry_run: true }), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      itemCount: 0,
      sourceItemCount: 1,
      invalidItemCount: 1,
      invalidPreferredGenericIds: ['generic_missing'],
      preview: {
        summary: {
          item_count: 0,
          source_item_count: 1,
          invalid_item_count: 1,
          apply_count: 0,
        },
        rows: [],
      },
    });
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('blocks applying malformed persisted template item rows before stock mutation', async () => {
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      items: [
        null,
        ['unexpected'],
        { drug_master_id: '' },
        {
          drug_master_id: 'drug_valid',
          reorder_point: 8,
          preferred_generic_id: null,
          adoption_note: '有効行のみ',
        },
      ],
    });

    const response = await POST(createRequest({ target_site_id: 'site_2' }), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '採用品テンプレートに破損した項目が含まれているため適用できません',
      details: {
        template_id: 'template_1',
        invalid_item_count: 3,
      },
    });
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('blocks applying missing template drug master references before stock mutation', async () => {
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      items: [
        {
          drug_master_id: 'drug_missing',
          reorder_point: 4,
          preferred_generic_id: null,
          adoption_note: '参照切れ',
        },
      ],
    });
    prismaMock.drugMaster.findMany.mockResolvedValue([]);

    const response = await POST(createRequest({ target_site_id: 'site_2' }), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '採用品テンプレートに破損した項目が含まれているため適用できません',
      details: {
        template_id: 'template_1',
        invalid_item_count: 1,
        missing_drug_master_ids: ['drug_missing'],
      },
    });
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('blocks applying missing preferred generic references before stock mutation', async () => {
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      items: [
        {
          drug_master_id: 'drug_valid',
          reorder_point: 8,
          preferred_generic_id: 'generic_missing',
          adoption_note: '参照切れ後発品',
        },
      ],
    });
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_valid',
        yj_code: '333333333333',
        drug_name: '有効薬',
        is_generic: false,
        generic_name: '有効薬',
      },
    ]);

    const response = await POST(createRequest({ target_site_id: 'site_2' }), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '採用品テンプレートに破損した項目が含まれているため適用できません',
      details: {
        template_id: 'template_1',
        invalid_item_count: 1,
        invalid_preferred_generic_ids: ['generic_missing'],
      },
    });
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
