import { Prisma } from '@prisma/client';
import {
  getCoverageCategory,
  getCoverageLabel,
  type CoverageCategory,
} from '@/lib/admin/data-explorer-catalog';
import { withOrgContext } from '@/lib/db/rls';

const READ_ONLY_FIELDS = new Set(['id', 'org_id', 'created_at', 'updated_at']);
const SEARCH_CANDIDATE_FIELDS = [
  'name',
  'title',
  'subject',
  'drug_name',
  'key',
  'code',
  'email',
  'recipient_name',
  'template_key',
  'certification_number',
  'yj_code',
] as const;

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
};

export type DataExplorerTableRows = {
  modelName: string;
  tableName: string;
  coverageCategory: CoverageCategory;
  coverageLabel: string;
  columns: DataExplorerField[];
  totalCount: number;
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
  hasUpdatedAt: boolean;
};

const tableMetaByName = new Map<string, TableMeta>(
  Prisma.dmmf.datamodel.models.map((model) => {
    const fields = model.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => ({
        name: field.dbName ?? field.name,
        type: String(field.type),
        kind: field.kind,
        isList: field.isList,
        isRequired: field.isRequired,
        isEditable: field.kind === 'scalar' && !READ_ONLY_FIELDS.has(field.dbName ?? field.name),
      }));

    const fieldNameSet = new Set(fields.map((field) => field.name));
    const searchableField =
      SEARCH_CANDIDATE_FIELDS.find((field) => fieldNameSet.has(field)) ?? null;

    return [
      model.name,
      {
        modelName: model.name,
        tableName: model.dbName ?? model.name,
        fields,
        editableFieldNames: new Set(
          fields.filter((field) => field.isEditable).map((field) => field.name)
        ),
        searchableField,
        hasUpdatedAt: fieldNameSet.has('updated_at'),
      } satisfies TableMeta,
    ] as const;
  })
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
  return Math.max(Math.trunc(offset), 0);
}

type CountRow = { table_name: string; row_count: bigint | number | string };
type JsonRow = { row: Record<string, unknown> | null };

export async function listDataExplorerModels(orgId: string): Promise<DataExplorerModelSummary[]> {
  const tables = Array.from(tableMetaByName.values());
  const unionQuery = tables
    .map(
      (meta) =>
        `SELECT ${escapeLiteral(meta.tableName)} AS table_name, COUNT(*)::bigint AS row_count FROM ${quoteIdentifier(meta.tableName)}`
    )
    .join(' UNION ALL ');

  const counts = await withOrgContext(orgId, (tx) =>
    tx.$queryRawUnsafe<CountRow[]>(unionQuery)
  );

  const countMap = new Map(
    counts.map((row) => [row.table_name, Number(row.row_count)])
  );

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
  }
): Promise<DataExplorerTableRows> {
  const meta = getTableMeta(tableName);
  const limit = normalizeLimit(options?.limit ?? 25);
  const offset = normalizeOffset(options?.offset ?? 0);
  const search = options?.search?.trim() ?? '';
  const orderClause = resolveOrderClause(meta);
  const whereClause = search ? 'WHERE to_jsonb(t)::text ILIKE $1' : '';

  const countQuery = `
    SELECT COUNT(*)::bigint AS row_count
    FROM ${quoteIdentifier(meta.tableName)} AS t
    ${whereClause}
  `;

  const rowsQuery = `
    SELECT to_jsonb(t) AS row
    FROM ${quoteIdentifier(meta.tableName)} AS t
    ${whereClause}
    ORDER BY ${orderClause}
    LIMIT $${search ? 2 : 1}
    OFFSET $${search ? 3 : 2}
  `;

  const params = search ? [`%${search}%`, limit, offset] : [limit, offset];

  const [countRows, rows] = await withOrgContext(orgId, async (tx) => {
    const [countResult, rowResult] = await Promise.all([
      tx.$queryRawUnsafe<Array<{ row_count: bigint | number | string }>>(countQuery, ...(search ? [`%${search}%`] : [])),
      tx.$queryRawUnsafe<JsonRow[]>(rowsQuery, ...params),
    ]);
    return [countResult, rowResult] as const;
  });

  return {
    modelName: meta.modelName,
    tableName: meta.tableName,
    coverageCategory: getCoverageCategory(meta.modelName),
    coverageLabel: getCoverageLabel(meta.modelName),
    columns: meta.fields,
    totalCount: Number(countRows[0]?.row_count ?? 0),
    limit,
    offset,
    rows: rows.flatMap((entry) => (entry.row ? [entry.row] : [])),
  };
}

export async function updateDataExplorerRow(
  orgId: string,
  tableName: string,
  rowId: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const meta = getTableMeta(tableName);
  const editableKeys = Object.keys(patch).filter((key) => meta.editableFieldNames.has(key));

  if (editableKeys.length === 0) {
    throw new Error('No editable fields were provided');
  }

  const quotedColumns = editableKeys.map((column) => quoteIdentifier(column)).join(', ');
  const updateQuery = `
    UPDATE ${quoteIdentifier(meta.tableName)} AS t
    SET (${quotedColumns}) = (
      SELECT ${quotedColumns}
      FROM jsonb_populate_record(
        NULL::${quoteIdentifier(meta.tableName)},
        to_jsonb(t) || $1::jsonb
      )
    )
    ${meta.hasUpdatedAt ? ', "updated_at" = NOW()' : ''}
    WHERE "id" = $2
    RETURNING to_jsonb(t) AS row
  `;

  const rows = await withOrgContext(orgId, (tx) =>
    tx.$queryRawUnsafe<JsonRow[]>(updateQuery, JSON.stringify(patch), rowId)
  );

  const row = rows[0]?.row;
  if (!row) {
    throw new Error('Row not found');
  }

  return row;
}
