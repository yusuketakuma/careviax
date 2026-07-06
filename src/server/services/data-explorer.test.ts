import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DATA_EXPLORER_DELETE_FORBIDDEN_ERROR,
  DATA_EXPLORER_READ_ONLY_MODEL_ERROR,
  DATA_EXPLORER_SOFT_DELETE_AUDIT_ACTION,
  DATA_EXPLORER_UPDATE_AUDIT_ACTION,
  deleteDataExplorerRow,
  listDataExplorerModels,
  listDataExplorerRows,
  updateDataExplorerRow,
} from './data-explorer';

const { withOrgContextMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

const ACTOR = {
  orgId: 'org_1',
  userId: 'user_1',
  ipAddress: '192.0.2.10',
  userAgent: 'test-agent',
} as const;

type QueryHandler = (query: string, ...params: unknown[]) => Promise<unknown>;
type MockTx = {
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
  auditLog: { create: ReturnType<typeof vi.fn> };
};

function mockOrgContext(handler: QueryHandler) {
  const tx = {
    $queryRawUnsafe: vi.fn((query: string, ...params: unknown[]) => handler(query, ...params)),
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit_1' }) },
  };
  withOrgContextMock.mockImplementation(
    async (_orgId: string, callback: (tx: MockTx) => Promise<unknown>) => callback(tx),
  );
  return tx;
}

function joinedSql(tx: ReturnType<typeof mockOrgContext>) {
  return tx.$queryRawUnsafe.mock.calls.map(([query]) => String(query)).join('\n');
}

describe('data explorer service hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      tableName: 'Organization',
      row: {
        id: 'org_1',
        name: 'PH-OS Pharmacy',
        email: 'owner@example.test',
      },
      deniedFields: ['email'],
      visibleField: 'name',
    },
    {
      tableName: 'WebhookRegistration',
      row: {
        id: 'webhook_1',
        org_id: 'org_1',
        url: 'https://hooks.example.test/ph-os?token=super-secret#fragment',
        events: ['patient.created'],
        secret: 'whsec_plaintext',
      },
      deniedFields: ['url', 'secret'],
      visibleField: 'events',
    },
    {
      tableName: 'WebhookDelivery',
      row: {
        id: 'delivery_1',
        org_id: 'org_1',
        event: 'patient.created',
        status: 'failed',
        url: 'https://hooks.example.test/ph-os?token=super-secret',
        payload: { patient_name: '山田 太郎' },
      },
      deniedFields: ['url', 'payload'],
      visibleField: 'status',
    },
    {
      tableName: 'User',
      row: {
        id: 'user_1',
        org_id: 'org_1',
        cognito_sub: 'cognito-sub',
        cognito_username: 'cognito-user',
        email: 'admin@example.test',
        name: 'Admin User',
        account_status: 'active',
        session_version: 4,
      },
      deniedFields: [
        'cognito_sub',
        'cognito_username',
        'email',
        'account_status',
        'session_version',
      ],
      visibleField: 'name',
    },
    {
      tableName: 'FileAsset',
      row: {
        id: 'file_1',
        org_id: 'org_1',
        purpose: 'prescription',
        status: 'uploaded',
        original_name: '患者 山田太郎 090-1234-5678 アムロジピン.pdf',
        storage_key: 'prescriptions/org_1/patient_1/file_1-secret.pdf',
        etag: 'etag-secret',
        metadata: { provider_error: 'raw storageKey=prescriptions/org_1/patient_1/file_1' },
        size_bytes: 12345,
      },
      deniedFields: ['original_name', 'storage_key', 'etag', 'metadata'],
      visibleField: 'purpose',
    },
  ])(
    'omits denied $tableName fields from read columns, row payloads, and SQL projection',
    async ({ tableName, row, deniedFields, visibleField }) => {
      const tx = mockOrgContext(async (query) => {
        if (query.includes('COUNT(*)')) {
          return [{ row_count: 1 }];
        }
        return [{ row }];
      });

      const result = await listDataExplorerRows('org_1', tableName);
      const columnNames = result.columns.map((column) => column.name);
      const sql = joinedSql(tx);

      expect(columnNames).toContain(visibleField);
      expect(result.rows[0]).toHaveProperty(visibleField);
      for (const field of deniedFields) {
        expect(columnNames).not.toContain(field);
        expect(Object.keys(result.rows[0] ?? {})).not.toContain(field);
        expect(sql).not.toContain(`"${field}"`);
        expect(sql).not.toContain(`'${field}'`);
      }
    },
  );

  it('adds explicit org scope predicates to model counts and row queries', async () => {
    const modelTx = mockOrgContext(async () => []);

    await listDataExplorerModels('org_1');

    const modelCountSql = String(modelTx.$queryRawUnsafe.mock.calls[0]?.[0] ?? '');
    expect(modelCountSql).toContain('FROM "Patient" AS t WHERE t."org_id" = $1');
    expect(modelCountSql).toContain('FROM "Organization" AS t WHERE t."id" = $1');
    expect(modelCountSql).toContain('FROM "DrugMaster" AS t');
    expect(modelCountSql).not.toContain('FROM "DrugMaster" AS t WHERE');
    expect(modelCountSql).not.toContain('FROM "Setting" AS t');
    expect(modelTx.$queryRawUnsafe.mock.calls[0]?.slice(1)).toEqual(['org_1']);

    const rowsTx = mockOrgContext(async (query) => {
      if (query.includes('COUNT(*)')) {
        return [{ row_count: 1001 }];
      }
      return Array.from({ length: 11 }, (_, index) => ({
        row: {
          id: `patient_${index}`,
          org_id: 'org_1',
          name: `花子 ${index}`,
        },
      }));
    });

    const result = await listDataExplorerRows('org_1', 'Patient', {
      limit: 10,
      search: '花子',
    });

    const [countCall, rowsCall] = rowsTx.$queryRawUnsafe.mock.calls;
    expect(String(countCall?.[0])).toContain('FROM "Patient" AS t');
    expect(String(countCall?.[0])).toContain('WHERE t."org_id" = $1 AND');
    expect(String(countCall?.[0])).toContain('t."name" ILIKE $2');
    expect(String(countCall?.[0])).toContain('LIMIT $3');
    expect(String(countCall?.[0])).not.toContain('jsonb_build_object');
    expect(countCall?.slice(1)).toEqual(['org_1', '%花子%', 1001]);
    expect(String(rowsCall?.[0])).toContain('FROM "Patient" AS t');
    expect(String(rowsCall?.[0])).toContain('WHERE t."org_id" = $1 AND');
    expect(String(rowsCall?.[0])).toContain('t."name" ILIKE $2');
    expect(String(rowsCall?.[0])).not.toContain('::text ILIKE');
    expect(String(rowsCall?.[0])).toContain('LIMIT $3');
    expect(String(rowsCall?.[0])).toContain('OFFSET $4');
    expect(rowsCall?.slice(1)).toEqual(['org_1', '%花子%', 11, 0]);
    expect(result.rows).toHaveLength(10);
    expect(result.hasMore).toBe(true);
    expect(result.totalCount).toBe(1000);
    expect(result.totalCountIsExact).toBe(false);
  });

  it('caps direct row pagination inputs before issuing SQL offsets', async () => {
    const tx = mockOrgContext(async (query) => {
      if (query.includes('COUNT(*)')) {
        return [{ row_count: 2_000_000 }];
      }
      return [];
    });

    const result = await listDataExplorerRows('org_1', 'Patient', {
      limit: 10_000,
      offset: 999_999_999,
    });

    const [, rowsCall] = tx.$queryRawUnsafe.mock.calls;
    expect(rowsCall?.slice(1)).toEqual(['org_1', 100, 999_900]);
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(999_900);
    expect(result.hasMore).toBe(true);
  });

  it.each(['Setting', 'ExternalAccessGrant', 'PatientMcsMessage', 'PushSubscription'])(
    'rejects excluded Prisma model %s before issuing SQL',
    async (tableName) => {
      await expect(listDataExplorerRows('org_1', tableName)).rejects.toThrow(
        `Unknown table: ${tableName}`,
      );
      expect(withOrgContextMock).not.toHaveBeenCalled();
    },
  );

  it('exposes formulary operational models with the expected coverage categories', async () => {
    const tx = mockOrgContext(async (query) => {
      if (query.includes('COUNT(*)')) {
        return [
          { table_name: 'FormularyChangeRequest', row_count: 2 },
          { table_name: 'FormularyTemplate', row_count: 1 },
          { table_name: 'DrugMasterChangeEvent', row_count: 3 },
        ];
      }
      return [];
    });

    const result = await listDataExplorerModels('org_1');
    const byModel = new Map(result.map((model) => [model.modelName, model]));
    const sql = joinedSql(tx);

    expect(byModel.get('FormularyChangeRequest')).toMatchObject({
      coverageCategory: 'frontend_api',
      rowCount: 2,
      searchableFields: ['reason'],
    });
    expect(byModel.get('FormularyTemplate')).toMatchObject({
      coverageCategory: 'frontend_api',
      rowCount: 1,
      searchableFields: ['name'],
    });
    expect(byModel.get('DrugMasterChangeEvent')).toMatchObject({
      coverageCategory: 'api_only',
      editableFieldCount: 0,
      rowCount: 3,
      searchableFields: ['yj_code', 'change_type'],
    });
    expect(sql).toContain('FROM "FormularyChangeRequest" AS t WHERE t."org_id" = $1');
    expect(sql).toContain('FROM "FormularyTemplate" AS t WHERE t."org_id" = $1');
    expect(sql).toContain('FROM "DrugMasterChangeEvent" AS t');
    expect(sql).not.toContain('FROM "DrugMasterChangeEvent" AS t WHERE');
    expect(sql).toContain('FROM "DrugMaster" AS t');
    expect(sql).not.toContain('FROM "DrugMaster" AS t WHERE');
    expect(sql.match(/FROM "FormularyChangeRequest" AS t/g)).toHaveLength(1);
    expect(sql.match(/FROM "FormularyTemplate" AS t/g)).toHaveLength(1);
    expect(sql.match(/FROM "DrugMasterChangeEvent" AS t/g)).toHaveLength(1);
  });

  it.each([
    'AuditLog',
    'DrugMasterImportLog',
    'CycleTransitionLog',
    'SetBatchChangeLog',
    'VisitScheduleContactLog',
  ])('treats audit, history, job, and log model %s fields as read-only', async (tableName) => {
    mockOrgContext(async (query) => {
      if (query.includes('COUNT(*)')) {
        return [{ row_count: 0 }];
      }
      return [];
    });

    const result = await listDataExplorerRows('org_1', tableName);

    expect(result.columns.length).toBeGreaterThan(0);
    expect(result.columns.every((field) => field.isEditable === false)).toBe(true);

    vi.clearAllMocks();
    await expect(
      updateDataExplorerRow(ACTOR, tableName, 'row_1', {
        action: 'tampered',
        status: 'completed',
        note: 'tampered',
      }),
    ).rejects.toThrow(DATA_EXPLORER_READ_ONLY_MODEL_ERROR);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('redacts proposal reject free text from AuditLog data explorer rows', async () => {
    const storedChanges = {
      reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
      other: 'kept',
    };
    mockOrgContext(async (query) => {
      if (query.includes('COUNT(*)')) {
        return [{ row_count: 1 }];
      }
      return [
        {
          row: {
            id: 'audit_reject_1',
            org_id: 'org_1',
            actor_id: 'user_1',
            action: 'visit_schedule_proposal_rejected',
            target_type: 'visit_schedule_proposal',
            target_id: 'proposal_1',
            changes: storedChanges,
            ip_address: '192.0.2.10',
            user_agent: 'test-agent',
            created_at: new Date('2026-06-10T00:00:00.000Z'),
            updated_at: new Date('2026-06-10T00:00:00.000Z'),
          },
        },
      ];
    });

    const result = await listDataExplorerRows('org_1', 'AuditLog');
    const resultText = JSON.stringify(result.rows);

    expect(result.rows[0]?.changes).toMatchObject({
      reject_reason: '却下理由の自由記載は出力対象外です',
      reject_reason_redacted: true,
      other: 'kept',
    });
    expect(resultText).not.toContain('東京都港区2-2-2');
    expect(resultText).not.toContain('090-1234-5678');
    expect(resultText).not.toContain('アムロジピン');
    expect(resultText).not.toContain('処方詳細');
    expect(storedChanges.reject_reason).toBe('東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細');
  });

  it('keeps membership permission and status fields read-only', async () => {
    const tx = mockOrgContext(async (query) => {
      if (query.includes('COUNT(*)')) {
        return [{ row_count: 1 }];
      }
      return [
        {
          row: {
            id: 'membership_1',
            org_id: 'org_1',
            user_id: 'user_1',
            site_id: 'site_1',
            role: 'pharmacist',
            can_dispense: true,
            can_audit_dispense: false,
            can_set: true,
            can_audit_set: false,
            is_active: true,
          },
        },
      ];
    });

    const result = await listDataExplorerRows('org_1', 'Membership');
    const editableByField = new Map(result.columns.map((field) => [field.name, field.isEditable]));

    expect(editableByField.get('user_id')).toBe(false);
    expect(editableByField.get('site_id')).toBe(false);
    expect(editableByField.get('role')).toBe(false);
    expect(editableByField.get('can_dispense')).toBe(false);
    expect(editableByField.get('can_audit_dispense')).toBe(false);
    expect(editableByField.get('can_set')).toBe(false);
    expect(editableByField.get('can_audit_set')).toBe(false);
    expect(editableByField.get('is_active')).toBe(false);

    await expect(
      updateDataExplorerRow(ACTOR, 'Membership', 'membership_1', {
        user_id: 'user_2',
        site_id: 'site_2',
        role: 'owner',
        can_dispense: true,
        can_audit_dispense: true,
        can_set: true,
        can_audit_set: true,
        is_active: true,
      }),
    ).rejects.toThrow('No editable fields were provided');
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('keeps BillingCandidate business fields read-only so review and close APIs own workflow changes', async () => {
    mockOrgContext(async (query) => {
      if (query.includes('COUNT(*)')) {
        return [{ row_count: 1 }];
      }
      return [
        {
          row: {
            id: 'candidate_1',
            org_id: 'org_1',
            patient_id: 'patient_1',
            billing_month: new Date('2026-04-01T00:00:00.000Z'),
            status: 'candidate',
            source_snapshot: { billing_close: { review_state: 'pending' } },
            calculation_breakdown: { base_points: 650 },
            exclusion_reason: null,
          },
        },
      ];
    });

    const result = await listDataExplorerRows('org_1', 'BillingCandidate');
    const editableByField = new Map(result.columns.map((field) => [field.name, field.isEditable]));
    const readOnlyFields = [
      'id',
      'org_id',
      'patient_id',
      'billing_domain',
      'billing_target_type',
      'billing_target_id',
      'billing_target_name',
      'cycle_id',
      'evidence_id',
      'rule_id',
      'dedupe_key',
      'billing_month',
      'billing_code',
      'billing_name',
      'points',
      'quantity',
      'calculation_breakdown',
      'source_snapshot',
      'status',
      'exclusion_reason',
      'created_at',
      'updated_at',
    ];

    for (const field of readOnlyFields) {
      expect(editableByField.get(field)).toBe(false);
    }
    expect(result.columns.filter((field) => field.isEditable).map((field) => field.name)).toEqual(
      [],
    );

    vi.clearAllMocks();
    await expect(
      updateDataExplorerRow(ACTOR, 'BillingCandidate', 'candidate_1', {
        patient_id: 'patient_2',
      }),
    ).rejects.toThrow(DATA_EXPLORER_READ_ONLY_MODEL_ERROR);
    expect(withOrgContextMock).not.toHaveBeenCalled();

    await expect(
      updateDataExplorerRow(ACTOR, 'BillingCandidate', 'candidate_1', {
        billing_month: '2026-05-01',
        billing_code: 'tampered_code',
        billing_name: 'tampered name',
        points: 9999,
        quantity: 99,
        status: 'exported',
        source_snapshot: { billing_close: { closed_at: '2026-05-31T00:00:00.000Z' } },
        calculation_breakdown: { amount_yen: 999999 },
        exclusion_reason: 'tampered',
      }),
    ).rejects.toThrow(DATA_EXPLORER_READ_ONLY_MODEL_ERROR);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('reports BillingCandidate as read-only in model editability counts', async () => {
    mockOrgContext(async (query) => {
      if (query.includes('COUNT(*)')) {
        return [{ table_name: 'BillingCandidate', row_count: 3 }];
      }
      return [];
    });

    const models = await listDataExplorerModels('org_1');

    expect(models.find((model) => model.modelName === 'BillingCandidate')).toMatchObject({
      coverageCategory: 'partial',
      editableFieldCount: 0,
      rowCount: 3,
    });
  });

  it('strips user auth and lifecycle fields from mixed edit patches', async () => {
    const tx = mockOrgContext(async () => [
      {
        row: {
          id: 'user_1',
          org_id: 'org_1',
          name: 'Updated User',
          is_active: false,
          can_accept_emergency: false,
          deactivated_at: new Date('2026-04-28T00:00:00.000Z'),
          deactivation_reason: 'should-not-change',
        },
      },
    ]);

    const updated = await updateDataExplorerRow(ACTOR, 'User', 'user_1', {
      name: 'Updated User',
      is_active: false,
      can_accept_emergency: false,
      deactivated_at: '2026-04-28T00:00:00.000Z',
      deactivation_reason: 'tampered',
    });

    const call = tx.$queryRawUnsafe.mock.calls[0];
    const sql = String(call?.[0] ?? '');
    expect(sql).toContain('UPDATE "User" AS t');
    expect(sql).toContain('SET ("name")');
    expect(sql).toContain('WHERE t."id" = $2 AND t."org_id" = $3');
    expect(call?.slice(1)).toEqual([JSON.stringify({ name: 'Updated User' }), 'user_1', 'org_1']);
    expect(updated).toMatchObject({
      id: 'user_1',
      org_id: 'org_1',
      name: 'Updated User',
    });
  });

  it('rejects denied-only edit patches before issuing SQL', async () => {
    await expect(
      updateDataExplorerRow(ACTOR, 'WebhookRegistration', 'webhook_1', {
        secret: 'new-secret',
      }),
    ).rejects.toThrow('No editable fields were provided');

    await expect(
      updateDataExplorerRow(ACTOR, 'User', 'user_1', {
        cognito_sub: 'new-sub',
        email: 'new@example.test',
        account_status: 'active',
        session_version: 5,
      }),
    ).rejects.toThrow('No editable fields were provided');

    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('strips denied fields from mixed edit patches and scopes updates to the current org', async () => {
    const tx = mockOrgContext(async () => [
      {
        row: {
          id: 'webhook_1',
          org_id: 'org_1',
          url: 'https://hooks.example.test/new',
          events: ['care_report.sent'],
          secret: 'should-not-return',
        },
      },
    ]);

    const updated = await updateDataExplorerRow(ACTOR, 'WebhookRegistration', 'webhook_1', {
      secret: 'new-secret',
      url: 'https://hooks.example.test/new',
      events: ['care_report.sent'],
    });

    const call = tx.$queryRawUnsafe.mock.calls[0];
    const sql = String(call?.[0] ?? '');
    expect(sql).toContain('UPDATE "WebhookRegistration" AS t');
    expect(sql).toContain('WHERE t."id" = $2 AND t."org_id" = $3');
    expect(sql).not.toContain('"secret"');
    expect(sql).not.toContain("'secret'");
    expect(sql).not.toContain('"url"');
    expect(sql).not.toContain("'url'");
    expect(call?.slice(1)).toEqual([
      JSON.stringify({ events: ['care_report.sent'] }),
      'webhook_1',
      'org_1',
    ]);
    expect(updated).toMatchObject({
      id: 'webhook_1',
      org_id: 'org_1',
      events: ['care_report.sent'],
    });
    expect(Object.keys(updated)).not.toContain('secret');
    expect(Object.keys(updated)).not.toContain('url');
  });

  it('scopes Organization edits by organization id and denies Organization email edits', async () => {
    const tx = mockOrgContext(async () => [
      {
        row: {
          id: 'org_1',
          name: 'PH-OS Pharmacy',
          email: 'should-not-return@example.test',
        },
      },
    ]);

    const updated = await updateDataExplorerRow(ACTOR, 'Organization', 'org_1', {
      email: 'owner@example.test',
      name: 'PH-OS Pharmacy',
    });

    const call = tx.$queryRawUnsafe.mock.calls[0];
    const sql = String(call?.[0] ?? '');
    expect(sql).toContain('UPDATE "Organization" AS t');
    expect(sql).toContain('WHERE t."id" = $2 AND t."id" = $3');
    expect(sql).not.toContain('"email"');
    expect(sql).not.toContain("'email'");
    expect(call?.slice(1)).toEqual([JSON.stringify({ name: 'PH-OS Pharmacy' }), 'org_1', 'org_1']);
    expect(updated).toMatchObject({
      id: 'org_1',
      name: 'PH-OS Pharmacy',
    });
    expect(Object.keys(updated)).not.toContain('email');
  });

  it('writes an audit log entry recording only the changed field names on a successful update', async () => {
    const tx = mockOrgContext(async () => [
      {
        row: {
          id: 'webhook_1',
          org_id: 'org_1',
          events: ['care_report.sent'],
        },
      },
    ]);

    await updateDataExplorerRow(ACTOR, 'WebhookRegistration', 'webhook_1', {
      events: ['care_report.sent'],
    });

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArg = tx.auditLog.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(auditArg.data).toMatchObject({
      org_id: 'org_1',
      actor_id: 'user_1',
      action: DATA_EXPLORER_UPDATE_AUDIT_ACTION,
      target_type: 'WebhookRegistration',
      target_id: 'webhook_1',
      ip_address: '192.0.2.10',
      user_agent: 'test-agent',
    });
    // PHI 防止: changes には変更値ではなく変更列名のみを記録する。
    expect(auditArg.data.changes).toEqual({
      table: 'WebhookRegistration',
      updated_fields: ['events'],
    });
    expect(JSON.stringify(auditArg.data.changes)).not.toContain('care_report.sent');
  });

  it('does not write an audit log when no editable fields were provided', async () => {
    await expect(
      updateDataExplorerRow(ACTOR, 'WebhookRegistration', 'webhook_1', {
        secret: 'new-secret',
      }),
    ).rejects.toThrow('No editable fields were provided');
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects PATCH to read-only models with a read-only error before any SQL runs', async () => {
    await expect(
      updateDataExplorerRow(ACTOR, 'DispenseResult', 'dispense_1', {
        status: 'tampered',
      }),
    ).rejects.toThrow(DATA_EXPLORER_READ_ONLY_MODEL_ERROR);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('refuses DELETE on read-only models without issuing any SQL (no hard delete)', async () => {
    const tx = mockOrgContext(async () => []);

    await expect(deleteDataExplorerRow(ACTOR, 'DispenseResult', 'dispense_1')).rejects.toThrow(
      DATA_EXPLORER_READ_ONLY_MODEL_ERROR,
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('refuses DELETE on editable models without a soft-delete column (no hard delete)', async () => {
    const tx = mockOrgContext(async () => []);

    await expect(deleteDataExplorerRow(ACTOR, 'WebhookRegistration', 'webhook_1')).rejects.toThrow(
      DATA_EXPLORER_DELETE_FORBIDDEN_ERROR,
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects DELETE on unknown tables before touching the database', async () => {
    await expect(deleteDataExplorerRow(ACTOR, 'NotAModel', 'row_1')).rejects.toThrow(
      'Unknown table: NotAModel',
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('never issues a raw DELETE/TRUNCATE statement from the soft-delete path', async () => {
    // soft-delete が有効なモデルが将来追加されても hard delete SQL は発行しない契約を固定する。
    const tx = mockOrgContext(async (query) => {
      if (query.includes('RETURNING')) {
        return [{ row: { id: 'row_1', org_id: 'org_1' } }];
      }
      return [];
    });

    // 現状 soft-delete 対象モデルは存在しないため 403 になるが、
    // どの経路でも DELETE/TRUNCATE を含む SQL が組み立てられないことを保証する。
    await expect(deleteDataExplorerRow(ACTOR, 'WebhookRegistration', 'webhook_1')).rejects.toThrow(
      DATA_EXPLORER_DELETE_FORBIDDEN_ERROR,
    );
    const sql = tx.$queryRawUnsafe.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(DATA_EXPLORER_SOFT_DELETE_AUDIT_ACTION).toBe('data_explorer.record_soft_deleted');
  });
});
