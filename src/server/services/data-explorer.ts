import { Prisma } from '@prisma/client';
import {
  COVERAGE_CATALOG,
  getCoverageCategory,
  getCoverageLabel,
  type CoverageCategory,
} from '@/lib/admin/data-explorer-catalog';
import { redactAuditLogChangesForResponse } from '@/lib/audit-logs/redaction';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import type { RequestAuthContext } from '@/lib/auth/request-context';

/**
 * data-explorer mutation を行うアクターのコンテキスト。監査ログ (createAuditLogEntry)
 * に必要な最小フィールドのみを受け取る。PHI は含めない。
 */
export type DataExplorerActorContext = Pick<
  RequestAuthContext,
  'orgId' | 'userId' | 'actorPharmacyId' | 'actorSiteId' | 'ipAddress' | 'userAgent'
>;

/** read-only モデルへの PATCH/DELETE を弾いたときに throw するエラーメッセージ (route で 403 にマップ)。 */
export const DATA_EXPLORER_READ_ONLY_MODEL_ERROR = 'Data explorer model is read-only';
/** hard delete を弾いたときに throw するエラーメッセージ (route で 403 にマップ)。 */
export const DATA_EXPLORER_DELETE_FORBIDDEN_ERROR = 'Data explorer model cannot be deleted';
/** 更新・soft-delete 時に記録する監査アクション。 */
export const DATA_EXPLORER_UPDATE_AUDIT_ACTION = 'data_explorer.record_updated';
export const DATA_EXPLORER_SOFT_DELETE_AUDIT_ACTION = 'data_explorer.record_soft_deleted';

const READ_ONLY_FIELDS = new Set(['id', 'org_id', 'created_at', 'updated_at']);
const READ_ONLY_RELATION_ID_PATTERN = /(?:^|_)id$/;
const READ_ONLY_MODEL_PATTERNS = [/AuditLog$/, /History$/, /Job$/, /Log$/] as const;

/**
 * モデル単位で編集・削除を全面禁止する read-only モデル。
 *
 * 根拠 (Compliance by Design / Audit by Default):
 * 医療記録・調剤/監査証跡・患者臨床データ・同意/交付の法的記録・請求根拠は、
 * それぞれ専用ワークフロー (+ 個別の監査ログ) を通じてのみ変更されるべきであり、
 * 汎用のデータ探索 UI から直接改変することは 3省2ガイドライン準拠に反する。
 * したがって data-explorer からは field レベルではなくモデルレベルで read-only 化する
 * (PATCH/DELETE は 403)。マスタ/設定系のみ編集可のまま残す。
 * 個別モデルの編集解除が必要になった場合はここから外し、専用の検証を伴って判断する。
 */
const READ_ONLY_MODELS: ReadonlySet<string> = new Set([
  // 処方・調剤記録 (法定記録・監査証跡)
  'PrescriptionIntake',
  'PrescriptionLine',
  'DispenseTask',
  'DispenseResult',
  'DispenseAudit',
  'DispensingDecision',
  'SetPlan',
  'SetBatch',
  'SetAudit',
  'MedicationCycle',
  'CycleTransitionLog',
  'CycleHold',
  'MedicationProfile',
  'ResidualMedication',
  'MedicationIssue',
  'InquiryRecord',
  'Intervention',
  'WorkflowException',
  // 訪問・薬学管理記録
  'VisitRecord',
  'VisitPreparation',
  'ManagementPlan',
  // 報告書・多職種連携記録 (対外提出物・送達証跡)
  'CareReport',
  'CareReportSendRequest',
  'ConferenceNote',
  'TracingReport',
  'PatientSelfReport',
  'CommunicationEvent',
  'CommunicationRequest',
  'CommunicationResponse',
  // 患者臨床データ (要配慮個人情報)
  'Patient',
  'PatientCondition',
  'PatientLabObservation',
  'PatientMedicalProcedure',
  'PatientNarcoticUse',
  'PatientFieldRevision',
  // 医療安全・インシデント記録
  'IncidentReport',
  // 同意・情報連携の法的証跡
  'ConsentRecord',
  'PatientShareCase',
  'PatientShareConsent',
  'PatientShareCorrectionRequest',
  'ClaimCooperationNote',
  // 交付・ファイル証跡 (S3 Object Lock 対象を含む)
  'DeliveryRecord',
  'FileAsset',
  'JahisSupplementalRecord',
  'VisitHandoffExtraction',
  // 請求根拠・請求候補・契約 (会計監査対象)
  'BillingEvidence',
  'BillingCandidate',
  'VisitBillingCandidate',
  'PharmacyInvoice',
  'PharmacyInvoiceItem',
  'PharmacyContract',
  'PharmacyContractVersion',
  'PharmacyContractFeeRule',
  'ContractDocument',
]);

/**
 * soft-delete 用の列名候補。編集可能モデルがこれらの列を持つ場合のみ soft-delete を許可する。
 * 現状、編集可能モデルでこの列を持つものは存在しない (Patient は archived_at を持つが read-only)。
 * そのため DELETE は全モデルで 403 になる。将来、編集可能かつ soft-delete 列を持つモデルを
 * 追加した場合はここで自動的に soft-delete + 監査ログ経路に載る。hard delete は一切行わない。
 */
const SOFT_DELETE_COLUMN_CANDIDATES = ['archived_at', 'deleted_at', 'voided_at'] as const;
const NON_EDITABLE_MODEL_FIELDS: Record<string, ReadonlySet<string>> = {
  BillingCandidate: new Set([
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
  ]),
  Membership: new Set([
    'user_id',
    'site_id',
    'role',
    'can_dispense',
    'can_audit_dispense',
    'can_set',
    'can_audit_set',
    'is_active',
  ]),
  User: new Set([
    'cognito_sub',
    'cognito_username',
    'email',
    'can_accept_emergency',
    'is_active',
    'account_status',
    'invited_at',
    'invited_by',
    'last_invited_at',
    'activated_at',
    'deactivated_at',
    'deactivation_reason',
    'session_version',
  ]),
};
const DENIED_MODEL_FIELDS: Record<string, ReadonlySet<string>> = {
  WebhookRegistration: new Set(['url']),
  WebhookDelivery: new Set(['payload', 'url']),
};
const DENIED_FIELD_PATTERNS = [
  /(^|_)secret($|_)/i,
  /(^|_)token($|_)/i,
  /(^|_)hash($|_)/i,
  /^cognito_/i,
  /^session_version$/i,
  /^account_status$/i,
  /^email$/i,
  /^endpoint$/i,
  /^p256dh$/i,
  /^auth$/i,
] as const;
const SEARCH_CANDIDATE_FIELDS = [
  'name',
  'name_kana',
  'title',
  'subject',
  'drug_name',
  'drug_name_kana',
  'generic_name',
  'actual_drug_name',
  'key',
  'code',
  'drug_code',
  'actual_drug_code',
  'billing_name',
  'billing_code',
  'receipt_code',
  'hot_code',
  'jan_code',
  'gtin',
  'recipient_name',
  'counterpart_name',
  'responder_name',
  'granted_to_name',
  'reported_by_name',
  'partner_name',
  'author_name',
  'contact_name',
  'receipt_person_name',
  'organization_name',
  'institution_code',
  'template_key',
  'certification_number',
  'yj_code',
  'reason',
  'change_type',
] as const;
const SEARCH_COUNT_EXACT_LIMIT = 1000;
export const DATA_EXPLORER_MAX_OFFSET = 999_900;

const DATA_EXPLORER_MODEL_EXCLUSIONS: ReadonlySet<string> = new Set([
  'Setting',
  'IntegrationJob',
  'LabelDictionary',
  'ExternalAccessGrant',
  'PatientMcsLink',
  'PatientMcsSummary',
  'PatientMcsMessage',
  'HandoffItem',
  'PushSubscription',
] as const);
const GLOBAL_DATA_EXPLORER_MODELS: ReadonlySet<string> = new Set([
  'DrugAlertRule',
  'DrugInteraction',
  'DrugMaster',
  'DrugMasterChangeEvent',
  'DrugMasterImportLog',
  'DrugPackage',
  'DrugPackageInsert',
  'GenericDrugMapping',
] as const);

function buildDataExplorerModelAllowlist() {
  const modelNames = new Set<string>();
  for (const models of Object.values(COVERAGE_CATALOG)) {
    for (const modelName of models) {
      if (!DATA_EXPLORER_MODEL_EXCLUSIONS.has(modelName)) {
        modelNames.add(modelName);
      }
    }
  }
  return Array.from(modelNames);
}

const DATA_EXPLORER_MODEL_ALLOWLIST = buildDataExplorerModelAllowlist();
const prismaModelByName = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model] as const),
);

export type DataExplorerField = {
  name: string;
  type: string;
  kind: string;
  isList: boolean;
  isRequired: boolean;
  isEditable: boolean;
};

export type DataExplorerModelSummary = {
  modelName: string;
  tableName: string;
  coverageCategory: CoverageCategory;
  coverageLabel: string;
  rowCount: number;
  scalarFieldCount: number;
  editableFieldCount: number;
  searchableField: string | null;
  searchableFields: string[];
};

export type DataExplorerTableRows = {
  modelName: string;
  tableName: string;
  coverageCategory: CoverageCategory;
  coverageLabel: string;
  columns: DataExplorerField[];
  totalCount: number;
  totalCountIsExact: boolean;
  hasMore: boolean;
  limit: number;
  offset: number;
  rows: Array<Record<string, unknown>>;
};

type TableMeta = {
  modelName: string;
  tableName: string;
  fields: DataExplorerField[];
  editableFieldNames: Set<string>;
  searchableField: string | null;
  searchableFields: string[];
  hasUpdatedAt: boolean;
  scope: 'org_id' | 'organization' | 'global';
};

function isDeniedField(modelName: string, fieldName: string) {
  if (DENIED_MODEL_FIELDS[modelName]?.has(fieldName)) return true;
  return DENIED_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

function isReadOnlyModel(modelName: string) {
  if (READ_ONLY_MODELS.has(modelName)) return true;
  return READ_ONLY_MODEL_PATTERNS.some((pattern) => pattern.test(modelName));
}

/**
 * モデル単位で mutation を許可してよいか。read-only モデル・global (参照マスタ) スコープは
 * PATCH/DELETE を一切許可しない。呼び出し側で 403 にマップする。
 */
function assertModelIsMutable(meta: TableMeta) {
  if (meta.scope === 'global' || isReadOnlyModel(meta.modelName)) {
    throw new Error(DATA_EXPLORER_READ_ONLY_MODEL_ERROR);
  }
}

/**
 * 編集可能モデルが持つ soft-delete 列を返す。持たなければ null。
 * hard delete を避けるための soft-delete 対象列の解決に使う。
 */
function resolveSoftDeleteColumn(meta: TableMeta): string | null {
  const fieldNames = new Set(meta.fields.map((field) => field.name));
  return SOFT_DELETE_COLUMN_CANDIDATES.find((column) => fieldNames.has(column)) ?? null;
}

function isNonEditableModelField(modelName: string, fieldName: string) {
  if (READ_ONLY_RELATION_ID_PATTERN.test(fieldName)) {
    return true;
  }
  if (modelName === 'Membership' && fieldName.startsWith('can_')) {
    return true;
  }
  return NON_EDITABLE_MODEL_FIELDS[modelName]?.has(fieldName) ?? false;
}

function resolveTableScope(modelName: string, fieldNameSet: Set<string>): TableMeta['scope'] {
  if (modelName === 'Organization') return 'organization';
  if (fieldNameSet.has('org_id')) return 'org_id';
  if (GLOBAL_DATA_EXPLORER_MODELS.has(modelName)) return 'global';
  throw new Error(
    `Data explorer model ${modelName} has no org_id and is not explicitly marked global`,
  );
}

function buildTableMeta(modelName: string): TableMeta {
  const model = prismaModelByName.get(modelName);
  if (!model) {
    throw new Error(`Data explorer allowlist references unknown Prisma model: ${modelName}`);
  }

  const scalarFields = model.fields.filter((field) => field.kind !== 'object');
  const allFieldNameSet = new Set(scalarFields.map((field) => field.dbName ?? field.name));
  const scope = resolveTableScope(model.name, allFieldNameSet);
  const fields = scalarFields
    .filter((field) => !isDeniedField(model.name, field.dbName ?? field.name))
    .map((field) => ({
      name: field.dbName ?? field.name,
      type: String(field.type),
      kind: field.kind,
      isList: field.isList,
      isRequired: field.isRequired,
      isEditable:
        !isReadOnlyModel(model.name) &&
        scope !== 'global' &&
        field.kind === 'scalar' &&
        !READ_ONLY_FIELDS.has(field.dbName ?? field.name) &&
        !isNonEditableModelField(model.name, field.dbName ?? field.name),
    }));

  const fieldNameSet = new Set(fields.map((field) => field.name));
  const fieldByName = new Map(fields.map((field) => [field.name, field]));
  const searchableFields = SEARCH_CANDIDATE_FIELDS.filter((fieldName) => {
    const field = fieldByName.get(fieldName);
    return field?.kind === 'scalar' && field.type === 'String' && !field.isList;
  });

  return {
    modelName: model.name,
    tableName: model.dbName ?? model.name,
    fields,
    editableFieldNames: new Set(
      fields.filter((field) => field.isEditable).map((field) => field.name),
    ),
    searchableField: searchableFields[0] ?? null,
    searchableFields,
    hasUpdatedAt: fieldNameSet.has('updated_at'),
    scope,
  };
}

const tableMetaByName = new Map<string, TableMeta>(
  DATA_EXPLORER_MODEL_ALLOWLIST.map((modelName) => {
    const meta = buildTableMeta(modelName);
    return [meta.tableName, meta] as const;
  }),
);

function getTableMeta(tableName: string): TableMeta {
  const meta = tableMetaByName.get(tableName);
  if (!meta) {
    throw new Error(`Unknown table: ${tableName}`);
  }
  return meta;
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildRowJsonExpression(meta: TableMeta, alias = 't') {
  const pairs = meta.fields.flatMap((field) => [
    escapeLiteral(field.name),
    `${alias}.${quoteIdentifier(field.name)}`,
  ]);
  return `jsonb_build_object(${pairs.join(', ')})`;
}

function buildScopeCondition(meta: TableMeta, placeholder: string, alias = 't') {
  if (meta.scope === 'org_id') {
    return `${alias}.${quoteIdentifier('org_id')} = ${placeholder}`;
  }
  if (meta.scope === 'organization') {
    return `${alias}.${quoteIdentifier('id')} = ${placeholder}`;
  }
  return null;
}

function buildSearchCondition(meta: TableMeta, placeholder: string, alias = 't') {
  if (meta.searchableFields.length === 0) return null;
  return `(${meta.searchableFields
    .map((fieldName) => `${alias}.${quoteIdentifier(fieldName)} ILIKE ${placeholder}`)
    .join(' OR ')})`;
}

function addScopeCondition(
  conditions: string[],
  params: unknown[],
  meta: TableMeta,
  orgId: string,
) {
  params.push(orgId);
  const condition = buildScopeCondition(meta, `$${params.length}`);
  if (!condition) {
    params.pop();
    return;
  }
  conditions.push(condition);
}

function sanitizeRow(meta: TableMeta, row: Record<string, unknown>) {
  const safeRow: Record<string, unknown> = {};
  for (const field of meta.fields) {
    if (Object.hasOwn(row, field.name)) {
      safeRow[field.name] = row[field.name];
    }
  }
  return safeRow;
}

function redactRowForResponse(meta: TableMeta, row: Record<string, unknown>) {
  if (meta.modelName !== 'AuditLog' || typeof row.action !== 'string') {
    return row;
  }

  return redactAuditLogChangesForResponse(
    row as Record<string, unknown> & { action: string; changes: unknown },
  );
}

function resolveOrderClause(meta: TableMeta) {
  const fieldNames = new Set(meta.fields.map((field) => field.name));
  if (fieldNames.has('updated_at')) return `${quoteIdentifier('updated_at')} DESC`;
  if (fieldNames.has('created_at')) return `${quoteIdentifier('created_at')} DESC`;
  return `${quoteIdentifier('id')} ASC`;
}

function normalizeLimit(limit: number) {
  if (!Number.isFinite(limit)) return 25;
  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function normalizeOffset(offset: number) {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(Math.trunc(offset), 0), DATA_EXPLORER_MAX_OFFSET);
}

type CountRow = { table_name: string; row_count: bigint | number | string };
type JsonRow = { row: Record<string, unknown> | null };
type RowCount = { row_count: bigint | number | string };

export async function listDataExplorerModels(orgId: string): Promise<DataExplorerModelSummary[]> {
  const tables = Array.from(tableMetaByName.values());
  const unionQuery = tables
    .map((meta) => {
      const scopeCondition = buildScopeCondition(meta, '$1');
      return `SELECT ${escapeLiteral(meta.tableName)} AS table_name, COUNT(*)::bigint AS row_count FROM ${quoteIdentifier(meta.tableName)} AS t${
        scopeCondition ? ` WHERE ${scopeCondition}` : ''
      }`;
    })
    .join(' UNION ALL ');
  const usesOrgParam = tables.some((meta) => meta.scope !== 'global');

  const counts = await withOrgContext(orgId, (tx) =>
    tx.$queryRawUnsafe<CountRow[]>(unionQuery, ...(usesOrgParam ? [orgId] : [])),
  );

  const countMap = new Map(counts.map((row) => [row.table_name, Number(row.row_count)]));

  return tables
    .map((meta) => ({
      modelName: meta.modelName,
      tableName: meta.tableName,
      coverageCategory: getCoverageCategory(meta.modelName),
      coverageLabel: getCoverageLabel(meta.modelName),
      rowCount: countMap.get(meta.tableName) ?? 0,
      scalarFieldCount: meta.fields.length,
      editableFieldCount: meta.fields.filter((field) => field.isEditable).length,
      searchableField: meta.searchableField,
      searchableFields: meta.searchableFields,
    }))
    .sort((left, right) => {
      if (left.rowCount !== right.rowCount) return right.rowCount - left.rowCount;
      return left.tableName.localeCompare(right.tableName);
    });
}

export async function listDataExplorerRows(
  orgId: string,
  tableName: string,
  options?: {
    limit?: number;
    offset?: number;
    search?: string;
  },
): Promise<DataExplorerTableRows> {
  const meta = getTableMeta(tableName);
  const limit = normalizeLimit(options?.limit ?? 25);
  const offset = normalizeOffset(options?.offset ?? 0);
  const search = options?.search?.trim() ?? '';
  const orderClause = resolveOrderClause(meta);
  const rowJsonExpression = buildRowJsonExpression(meta);

  if (search && meta.searchableFields.length === 0) {
    return {
      modelName: meta.modelName,
      tableName: meta.tableName,
      coverageCategory: getCoverageCategory(meta.modelName),
      coverageLabel: getCoverageLabel(meta.modelName),
      columns: meta.fields,
      totalCount: 0,
      totalCountIsExact: true,
      hasMore: false,
      limit,
      offset,
      rows: [],
    };
  }

  const conditions: string[] = [];
  const baseParams: unknown[] = [];
  addScopeCondition(conditions, baseParams, meta, orgId);
  if (search) {
    baseParams.push(`%${search}%`);
    const searchCondition = buildSearchCondition(meta, `$${baseParams.length}`);
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitParam = baseParams.length + 1;
  const offsetParam = baseParams.length + 2;

  const countQuery = search
    ? `
      SELECT COUNT(*)::bigint AS row_count
      FROM (
        SELECT 1
        FROM ${quoteIdentifier(meta.tableName)} AS t
        ${whereClause}
        LIMIT $${baseParams.length + 1}
      ) AS bounded_count
    `
    : `
      SELECT COUNT(*)::bigint AS row_count
      FROM ${quoteIdentifier(meta.tableName)} AS t
      ${whereClause}
    `;

  const rowsQuery = `
    SELECT ${rowJsonExpression} AS row
    FROM ${quoteIdentifier(meta.tableName)} AS t
    ${whereClause}
    ORDER BY ${orderClause}
    LIMIT $${limitParam}
    OFFSET $${offsetParam}
  `;

  const rowLimit = search ? limit + 1 : limit;
  const countParams = search ? [...baseParams, SEARCH_COUNT_EXACT_LIMIT + 1] : baseParams;
  const rowParams = [...baseParams, rowLimit, offset];

  const [countRows, rows] = await withOrgContext(orgId, async (tx) => {
    const [countResult, rowResult] = await Promise.all([
      tx.$queryRawUnsafe<RowCount[]>(countQuery, ...countParams),
      tx.$queryRawUnsafe<JsonRow[]>(rowsQuery, ...rowParams),
    ]);
    return [countResult, rowResult] as const;
  });
  const rawTotalCount = Number(countRows[0]?.row_count ?? 0);
  const totalCountIsExact = !search || rawTotalCount <= SEARCH_COUNT_EXACT_LIMIT;
  const totalCount = search && !totalCountIsExact ? SEARCH_COUNT_EXACT_LIMIT : rawTotalCount;
  const sanitizedRows = rows.flatMap((entry) =>
    entry.row ? [redactRowForResponse(meta, sanitizeRow(meta, entry.row))] : [],
  );
  const hasMore = search
    ? sanitizedRows.length > limit
    : offset + sanitizedRows.length < totalCount;

  return {
    modelName: meta.modelName,
    tableName: meta.tableName,
    coverageCategory: getCoverageCategory(meta.modelName),
    coverageLabel: getCoverageLabel(meta.modelName),
    columns: meta.fields,
    totalCount,
    totalCountIsExact,
    hasMore,
    limit,
    offset,
    rows: sanitizedRows.slice(0, limit),
  };
}

export async function updateDataExplorerRow(
  actor: DataExplorerActorContext,
  tableName: string,
  rowId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const meta = getTableMeta(tableName);
  assertModelIsMutable(meta);
  const editableKeys = Object.keys(patch).filter((key) => meta.editableFieldNames.has(key));

  if (editableKeys.length === 0) {
    throw new Error('No editable fields were provided');
  }

  const sanitizedPatch = Object.fromEntries(editableKeys.map((key) => [key, patch[key]]));
  const quotedColumns = editableKeys.map((column) => quoteIdentifier(column)).join(', ');
  const conditions = [`t.${quoteIdentifier('id')} = $2`];
  const params: unknown[] = [JSON.stringify(sanitizedPatch), rowId];
  addScopeCondition(conditions, params, meta, actor.orgId);
  const updateQuery = `
    UPDATE ${quoteIdentifier(meta.tableName)} AS t
    SET (${quotedColumns}) = (
      SELECT ${quotedColumns}
      FROM jsonb_populate_record(
        NULL::${quoteIdentifier(meta.tableName)},
        $1::jsonb
      )
    )
    ${meta.hasUpdatedAt ? ', "updated_at" = NOW()' : ''}
    WHERE ${conditions.join(' AND ')}
    RETURNING ${buildRowJsonExpression(meta)} AS row
  `;

  const row = await withOrgContext(actor.orgId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<JsonRow[]>(updateQuery, ...params);
    const updated = rows[0]?.row;
    if (!updated) {
      return null;
    }
    // 監査ログ: 誰が・いつ・どのモデル/行の・どの列を変更したかのみ記録する。
    // 変更値そのものは PHI を含み得るため logged value には残さない (updated_fields のみ)。
    await createAuditLogEntry(tx, actor, {
      action: DATA_EXPLORER_UPDATE_AUDIT_ACTION,
      targetType: meta.modelName,
      targetId: rowId,
      changes: { table: meta.tableName, updated_fields: editableKeys },
    });
    return updated;
  });

  if (!row) {
    throw new Error('Row not found');
  }

  return sanitizeRow(meta, row);
}

/**
 * data-explorer からの削除。hard delete は一切行わない (Audit by Default / 破壊的操作の防止)。
 * - read-only モデル・global スコープ: 403 (DATA_EXPLORER_READ_ONLY_MODEL_ERROR)
 * - soft-delete 列を持たない編集可能モデル: 403 (DATA_EXPLORER_DELETE_FORBIDDEN_ERROR)
 * - soft-delete 列を持つ編集可能モデル: 当該列に NOW() をセットする soft-delete + 監査ログ
 */
export async function deleteDataExplorerRow(
  actor: DataExplorerActorContext,
  tableName: string,
  rowId: string,
): Promise<Record<string, unknown>> {
  const meta = getTableMeta(tableName);
  assertModelIsMutable(meta);

  const softDeleteColumn = resolveSoftDeleteColumn(meta);
  if (!softDeleteColumn) {
    throw new Error(DATA_EXPLORER_DELETE_FORBIDDEN_ERROR);
  }

  const conditions = [`t.${quoteIdentifier('id')} = $1`];
  const params: unknown[] = [rowId];
  addScopeCondition(conditions, params, meta, actor.orgId);
  const softDeleteQuery = `
    UPDATE ${quoteIdentifier(meta.tableName)} AS t
    SET ${quoteIdentifier(softDeleteColumn)} = NOW()
    ${meta.hasUpdatedAt ? ', "updated_at" = NOW()' : ''}
    WHERE ${conditions.join(' AND ')} AND t.${quoteIdentifier(softDeleteColumn)} IS NULL
    RETURNING ${buildRowJsonExpression(meta)} AS row
  `;

  const row = await withOrgContext(actor.orgId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<JsonRow[]>(softDeleteQuery, ...params);
    const softDeleted = rows[0]?.row;
    if (!softDeleted) {
      return null;
    }
    await createAuditLogEntry(tx, actor, {
      action: DATA_EXPLORER_SOFT_DELETE_AUDIT_ACTION,
      targetType: meta.modelName,
      targetId: rowId,
      changes: { table: meta.tableName, soft_delete_column: softDeleteColumn },
    });
    return softDeleted;
  });

  if (!row) {
    throw new Error('Row not found');
  }

  return sanitizeRow(meta, row);
}
