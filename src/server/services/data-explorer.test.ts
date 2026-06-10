import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

type QueryHandler = (query: string, ...params: unknown[]) => Promise<unknown>;
type MockTx = {
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
};

function mockOrgContext(handler: QueryHandler) {
  const tx = {
    $queryRawUnsafe: vi.fn((query: string, ...params: unknown[]) => handler(query, ...params)),
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
        url: 'https://hooks.example.test/ph-os',
        secret: 'whsec_plaintext',
      },
      deniedFields: ['secret'],
      visibleField: 'url',
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
      updateDataExplorerRow('org_1', tableName, 'row_1', {
        action: 'tampered',
        status: 'completed',
        note: 'tampered',
      }),
    ).rejects.toThrow('No editable fields were provided');
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
      reject_reason: '却下理由は監査ログ本体に保管されています',
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
      updateDataExplorerRow('org_1', 'Membership', 'membership_1', {
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

  it('keeps relation id fields read-only across editable models', async () => {
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
          },
        },
      ];
    });

    const result = await listDataExplorerRows('org_1', 'BillingCandidate');
    const editableByField = new Map(result.columns.map((field) => [field.name, field.isEditable]));

    expect(editableByField.get('id')).toBe(false);
    expect(editableByField.get('org_id')).toBe(false);
    expect(editableByField.get('patient_id')).toBe(false);
    expect(editableByField.get('billing_month')).toBe(true);
    expect(editableByField.get('status')).toBe(true);

    vi.clearAllMocks();
    await expect(
      updateDataExplorerRow('org_1', 'BillingCandidate', 'candidate_1', {
        patient_id: 'patient_2',
      }),
    ).rejects.toThrow('No editable fields were provided');
    expect(withOrgContextMock).not.toHaveBeenCalled();

    const updateTx = mockOrgContext(async () => [
      {
        row: {
          id: 'candidate_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
          status: 'ready',
        },
      },
    ]);

    await updateDataExplorerRow('org_1', 'BillingCandidate', 'candidate_1', {
      patient_id: 'patient_2',
      status: 'ready',
    });
    const updateCall = updateTx.$queryRawUnsafe.mock.calls[0];
    const sql = String(updateCall?.[0] ?? '');
    expect(sql).toContain('UPDATE "BillingCandidate" AS t');
    expect(sql).toContain('SET ("status")');
    expect(sql).not.toContain('SET ("patient_id"');
    expect(sql).not.toContain('SET ("patient_id",');
    expect(sql).not.toContain('"patient_id", "status"');
    expect(sql).not.toContain('"status", "patient_id"');
    expect(updateCall?.slice(1)).toEqual([
      JSON.stringify({ status: 'ready' }),
      'candidate_1',
      'org_1',
    ]);
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

    const updated = await updateDataExplorerRow('org_1', 'User', 'user_1', {
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
      updateDataExplorerRow('org_1', 'WebhookRegistration', 'webhook_1', {
        secret: 'new-secret',
      }),
    ).rejects.toThrow('No editable fields were provided');

    await expect(
      updateDataExplorerRow('org_1', 'User', 'user_1', {
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
          secret: 'should-not-return',
        },
      },
    ]);

    const updated = await updateDataExplorerRow('org_1', 'WebhookRegistration', 'webhook_1', {
      secret: 'new-secret',
      url: 'https://hooks.example.test/new',
    });

    const call = tx.$queryRawUnsafe.mock.calls[0];
    const sql = String(call?.[0] ?? '');
    expect(sql).toContain('UPDATE "WebhookRegistration" AS t');
    expect(sql).toContain('WHERE t."id" = $2 AND t."org_id" = $3');
    expect(sql).not.toContain('"secret"');
    expect(sql).not.toContain("'secret'");
    expect(call?.slice(1)).toEqual([
      JSON.stringify({ url: 'https://hooks.example.test/new' }),
      'webhook_1',
      'org_1',
    ]);
    expect(updated).toMatchObject({
      id: 'webhook_1',
      org_id: 'org_1',
      url: 'https://hooks.example.test/new',
    });
    expect(Object.keys(updated)).not.toContain('secret');
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

    const updated = await updateDataExplorerRow('org_1', 'Organization', 'org_1', {
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
});
