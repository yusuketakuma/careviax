import { Prisma } from '@prisma/client';
import {
  COVERAGE_CATALOG,
  getCoverageCategory,
  getCoverageLabel,
  type CoverageCategory,
} from '@/lib/admin/data-explorer-catalog';
import { withOrgContext } from '@/lib/db/rls';

const READ_ONLY_FIELDS = new Set(['id', 'org_id', 'created_at', 'updated_at']);
const READ_ONLY_RELATION_ID_PATTERN = /(?:^|_)id$/;
const READ_ONLY_MODEL_PATTERNS = [/AuditLog$/, /History$/, /Job$/, /Log$/] as const;
const NON_EDITABLE_MODEL_FIELDS: Record<string, ReadonlySet<string>> = {
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

function isDeniedField(fieldName: string) {
  return DENIED_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

function isReadOnlyModel(modelName: string) {
  return READ_ONLY_MODEL_PATTERNS.some((pattern) => pattern.test(modelName));
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
    .filter((field) => !isDeniedField(field.dbName ?? field.name))
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
  const sanitizedRows = rows.flatMap((entry) => (entry.row ? [sanitizeRow(meta, entry.row)] : []));
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
  orgId: string,
  tableName: string,
  rowId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const meta = getTableMeta(tableName);
  const editableKeys = Object.keys(patch).filter((key) => meta.editableFieldNames.has(key));

  if (editableKeys.length === 0) {
    throw new Error('No editable fields were provided');
  }

  const sanitizedPatch = Object.fromEntries(editableKeys.map((key) => [key, patch[key]]));
  const quotedColumns = editableKeys.map((column) => quoteIdentifier(column)).join(', ');
  const conditions = [`t.${quoteIdentifier('id')} = $2`];
  const params: unknown[] = [JSON.stringify(sanitizedPatch), rowId];
  addScopeCondition(conditions, params, meta, orgId);
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

  const rows = await withOrgContext(orgId, (tx) =>
    tx.$queryRawUnsafe<JsonRow[]>(updateQuery, ...params),
  );

  const row = rows[0]?.row;
  if (!row) {
    throw new Error('Row not found');
  }

  return sanitizeRow(meta, row);
}
