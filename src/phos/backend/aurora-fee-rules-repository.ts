import { Pool, type QueryResultRow } from 'pg';
import {
  SOURCE_REF_KINDS,
  type EvidenceRequirementView,
  type FeeRuleConditionDsl,
  type FeeRuleSearchResponse,
  type FeeRuleView,
  type SourceRef,
} from '@/phos/contracts/phos_contracts';
import { assertFeeRuleConditionAllowedFields } from '@/phos/domain/claim/feeRuleDsl';
import type { FeeRuleSearchQuery, PhosFeeRulesRepository } from './fee-rules-repository';
import { validationError } from './input-validation';
import type { TenantContext } from './tenant-context';

export type AuroraFeeRulesClient = {
  connect(): Promise<AuroraFeeRulesConnection>;
};

export type AuroraFeeRulesConnection = {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: QueryResultRow[] }>;
  release(): void;
};

type FeeRuleRow = QueryResultRow & {
  rule_id: string;
  rule_version_id: string;
  fee_code: string;
  fee_label: string;
  tenant_scope: 'SYSTEM' | 'TENANT';
  revision_code: string;
  active_from: Date | string;
  active_to: Date | string | null;
  condition: unknown;
  evidence_requirements: unknown;
  source_refs: unknown;
};

type FeeRuleCursor = {
  fee_code: string;
  revision_code: string;
  rule_version_id: string;
};

const FEE_RULE_SELECT = `
SELECT
  fr.rule_id,
  rv.rule_version_id,
  fr.fee_code,
  fr.fee_label,
  fr.tenant_scope,
  rv.revision_code,
  rv.active_from,
  rv.active_to,
  rv.condition,
  COALESCE(er.evidence_requirements, '[]'::jsonb) AS evidence_requirements,
  COALESCE(sr.source_refs, '[]'::jsonb) AS source_refs
FROM phos_fee_rule_master fr
JOIN phos_fee_rule_versions rv
  ON rv.tenant_id = fr.tenant_id
 AND rv.rule_id = fr.rule_id
 AND rv.active = TRUE
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'evidence_key', req.evidence_key,
      'label', req.label,
      'required', req.required,
      'source_kind', req.source_kind
    )
    ORDER BY req.display_order ASC, req.evidence_key ASC
  ) AS evidence_requirements
  FROM phos_fee_rule_evidence_requirements req
  WHERE req.tenant_id = rv.tenant_id
    AND req.rule_version_id = rv.rule_version_id
) er ON TRUE
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'kind', src.kind,
      'ref_id', src.ref_id,
      'label', src.label,
      'uri', src.uri,
      'captured_at', src.captured_at
    )
    ORDER BY src.display_order ASC, src.ref_id ASC
  ) AS source_refs
  FROM phos_fee_rule_source_refs src
  WHERE src.tenant_id = rv.tenant_id
    AND src.rule_version_id = rv.rule_version_id
) sr ON TRUE
WHERE (fr.tenant_id = $1 OR (fr.tenant_scope = 'SYSTEM' AND fr.tenant_id = 'SYSTEM'))
`;

const SOURCE_REF_KIND_SET = new Set<SourceRef['kind']>(SOURCE_REF_KINDS);

function assertSafeTenantId(tenant_id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(tenant_id)) {
    throw new Error('PH-OS Aurora tenant_id contains unsafe characters');
  }
}

function encodeCursor(row: FeeRuleRow): string {
  return Buffer.from(
    JSON.stringify({
      fee_code: row.fee_code,
      revision_code: row.revision_code,
      rule_version_id: row.rule_version_id,
    } satisfies FeeRuleCursor),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(cursor: string | undefined): FeeRuleCursor | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('cursor must decode to an object');
    }
    const fee_code = (parsed as { fee_code?: unknown }).fee_code;
    const revision_code = (parsed as { revision_code?: unknown }).revision_code;
    const rule_version_id = (parsed as { rule_version_id?: unknown }).rule_version_id;
    if (
      typeof fee_code !== 'string' ||
      fee_code.trim().length === 0 ||
      typeof revision_code !== 'string' ||
      revision_code.trim().length === 0 ||
      typeof rule_version_id !== 'string' ||
      rule_version_id.trim().length === 0
    ) {
      throw new Error('cursor must include fee_code, revision_code, and rule_version_id');
    }
    return { fee_code, revision_code, rule_version_id };
  } catch {
    throw validationError({ field: 'cursor' });
  }
}

function asDateString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid FeeRule ${field}`);
  }
  return value;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return readString(value, field);
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid FeeRule ${field}`);
  return value;
}

function asCondition(value: unknown): FeeRuleConditionDsl {
  if (!isObject(value)) throw new Error('Invalid FeeRule condition');
  const op = readString(value.op, 'condition.op');
  switch (op) {
    case 'EXISTS':
      return { op, field: readString(value.field, 'condition.field') };
    case 'EQ':
      if (
        typeof value.value !== 'string' &&
        typeof value.value !== 'number' &&
        typeof value.value !== 'boolean'
      ) {
        throw new Error('Invalid FeeRule condition.value');
      }
      return { op, field: readString(value.field, 'condition.field'), value: value.value };
    case 'IN':
      if (
        !Array.isArray(value.values) ||
        value.values.some(
          (entry) =>
            typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean',
        )
      ) {
        throw new Error('Invalid FeeRule condition.values');
      }
      return {
        op,
        field: readString(value.field, 'condition.field'),
        values: value.values,
      };
    case 'GTE':
    case 'LTE':
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
        throw new Error('Invalid FeeRule condition.value');
      }
      return { op, field: readString(value.field, 'condition.field'), value: value.value };
    case 'AND':
    case 'OR':
      if (!Array.isArray(value.conditions)) {
        throw new Error('Invalid FeeRule condition.conditions');
      }
      return { op, conditions: value.conditions.map(asCondition) };
    case 'NOT':
      return { op, condition: asCondition(value.condition) };
    default:
      throw new Error(`Invalid FeeRule condition operator: ${op}`);
  }
}

function asEvidenceRequirements(value: unknown): EvidenceRequirementView[] {
  if (!Array.isArray(value)) throw new Error('Invalid FeeRule evidence requirements');
  return value.map((entry) => {
    if (!isObject(entry)) throw new Error('Invalid FeeRule evidence requirement');
    const source_kind = readString(entry.source_kind, 'evidence_requirement.source_kind');
    if (!SOURCE_REF_KIND_SET.has(source_kind as SourceRef['kind'])) {
      throw new Error('Invalid FeeRule evidence requirement source_kind');
    }
    return {
      evidence_key: readString(entry.evidence_key, 'evidence_requirement.evidence_key'),
      label: readString(entry.label, 'evidence_requirement.label'),
      required: readBoolean(entry.required, 'evidence_requirement.required'),
      source_kind: source_kind as SourceRef['kind'],
    };
  });
}

function asSourceRefs(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) throw new Error('Invalid FeeRule source refs');
  return value.map((entry) => {
    if (!isObject(entry)) throw new Error('Invalid FeeRule source ref');
    const kind = readString(entry.kind, 'source_ref.kind');
    if (!SOURCE_REF_KIND_SET.has(kind as SourceRef['kind'])) {
      throw new Error('Invalid FeeRule source_ref.kind');
    }
    const uri = readOptionalString(entry.uri, 'source_ref.uri');
    const captured_at = readOptionalString(entry.captured_at, 'source_ref.captured_at');
    return {
      kind: kind as SourceRef['kind'],
      ref_id: readString(entry.ref_id, 'source_ref.ref_id'),
      label: readString(entry.label, 'source_ref.label'),
      ...(uri ? { uri } : {}),
      ...(captured_at ? { captured_at } : {}),
    };
  });
}

function mapFeeRule(row: FeeRuleRow): FeeRuleView {
  const condition = asCondition(row.condition);
  assertFeeRuleConditionAllowedFields(condition);
  return {
    rule_id: row.rule_id,
    rule_version_id: row.rule_version_id,
    fee_code: row.fee_code,
    fee_label: row.fee_label,
    tenant_scope: row.tenant_scope,
    revision_code: row.revision_code,
    active_from: asDateString(row.active_from),
    ...(row.active_to ? { active_to: asDateString(row.active_to) } : {}),
    condition,
    evidence_requirements: asEvidenceRequirements(row.evidence_requirements),
    source_refs: asSourceRefs(row.source_refs),
  };
}

export class AuroraFeeRulesRepository implements PhosFeeRulesRepository {
  constructor(
    private readonly client: AuroraFeeRulesClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async searchFeeRules(
    ctx: TenantContext,
    query: FeeRuleSearchQuery,
  ): Promise<FeeRuleSearchResponse> {
    assertSafeTenantId(ctx.tenant_id);
    const cursor = decodeCursor(query.cursor);
    if (query.fee_code && cursor && cursor.fee_code !== query.fee_code) {
      throw validationError({ field: 'cursor' });
    }
    const connection = await this.client.connect();
    const params: unknown[] = [ctx.tenant_id];
    let sql = FEE_RULE_SELECT;

    if (query.fee_code) {
      params.push(query.fee_code);
      sql += ` AND fr.fee_code = $${params.length}`;
    }

    if (cursor) {
      params.push(cursor.fee_code, cursor.revision_code, cursor.rule_version_id);
      sql += ` AND (
  fr.fee_code > $${params.length - 2}
  OR (fr.fee_code = $${params.length - 2} AND rv.revision_code < $${params.length - 1})
  OR (
    fr.fee_code = $${params.length - 2}
    AND rv.revision_code = $${params.length - 1}
    AND rv.rule_version_id > $${params.length}
  )
)`;
    }

    params.push(query.limit + 1);
    sql += `
ORDER BY fr.fee_code ASC, rv.revision_code DESC, rv.rule_version_id ASC
LIMIT $${params.length}
`;

    try {
      await connection.query('BEGIN');
      await connection.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenant_id]);
      const result = await connection.query(sql, params);
      const visibleRows = result.rows.slice(0, query.limit) as FeeRuleRow[];
      const rows = visibleRows.map((row) => mapFeeRule(row));
      await connection.query('COMMIT');

      return {
        items: rows,
        ...(result.rows.length > query.limit
          ? { next_cursor: encodeCursor(visibleRows[visibleRows.length - 1]) }
          : {}),
        server_time: this.now().toISOString(),
      };
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

export function createAuroraFeeRulesRepository(input: {
  databaseUrl?: string;
  pool?: AuroraFeeRulesClient;
  now?: () => Date;
}): PhosFeeRulesRepository {
  if (!input.pool && !input.databaseUrl) {
    throw new Error('PH-OS FeeRule Aurora database URL is not configured');
  }
  const pool =
    input.pool ??
    new Pool({
      connectionString: input.databaseUrl,
      max: 2,
    });
  return new AuroraFeeRulesRepository(pool, input.now);
}
