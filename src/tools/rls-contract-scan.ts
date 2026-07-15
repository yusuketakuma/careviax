/**
 * RLS contract scanner — 静的突合（DB 不要）
 *
 * 目的: prisma/schema の全モデルから「org_id 列を持つ = テナントスコープであるべき」
 * テーブルを機械導出し、prisma/migrations と prisma/rls-policies.sql の RLS 有効化実態
 * （ENABLE / FORCE ROW LEVEL SECURITY / CREATE POLICY）と突き合わせて被覆状況を返す。
 *
 * ハードコード allowlist（旧 rls-policy-contract.test.ts）と異なり、テーブル一覧は
 * schema から導出するため「RLS 実体が無いテーブル」の検出漏れが構造的に発生しない。
 * 新規テーブル追加時に RLS が欠けていれば contract テストが赤くなる ratchet の基盤。
 *
 * SSOT: このスキャナが返す事実（schema + migration + rls-policies.sql）が正。
 * 既知ギャップの「許容理由 / 対応予定」は src/tools/rls-known-gaps.ts（別ファイル）。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SCHEMA_DIR = 'prisma/schema';
const MIGRATIONS_DIR = 'prisma/migrations';
const RLS_SSOT_FILE = 'prisma/rls-policies.sql';

/** テナントスコープ判定に使う列名（snake_case、DB 実列名）。 */
const TENANT_COLUMN = 'org_id';

export type RlsCoverageStatus =
  /** ENABLE + FORCE + POLICY が揃っている（migration ∪ SSOT）。 */
  | 'covered'
  /** RLS が一切無い（ENABLE ROW LEVEL SECURITY がどこにも無い）。=本番でも DB 層 backstop 欠如。 */
  | 'missing'
  /** ENABLE はあるが FORCE か POLICY が欠けている。=policy がサイレントに機能しない危険。 */
  | 'partial'
  /** ENABLE+FORCE+POLICY は揃うが SSOT ファイル(rls-policies.sql)に 0 行。=再provision/監査ドリフト。 */
  | 'ssot-drift';

export interface TenantTableCoverage {
  readonly table: string;
  readonly migration: RlsSourceFinalState;
  readonly ssot: RlsSourceFinalState;
  readonly hasEnable: boolean;
  readonly hasForce: boolean;
  readonly hasPolicy: boolean;
  /** SSOT ファイル(rls-policies.sql)に ENABLE 行があるか。 */
  readonly inSsot: boolean;
  readonly status: RlsCoverageStatus;
}

export type RlsPolicyPredicate = 'app-enforced-org' | 'nullable-setting' | 'other';

export interface RlsSourceFinalState {
  readonly enabled: boolean;
  readonly forced: boolean;
  readonly hasPolicy: boolean;
  readonly hasApprovedPredicate: boolean;
  readonly policyPredicates: readonly RlsPolicyPredicate[];
}

export interface TenantUniqueWithoutOrg {
  readonly table: string;
  readonly kind: 'field' | 'compound';
  readonly constraint: string;
  readonly fields: readonly string[];
}

export interface RlsContractScan {
  /** schema 由来: org_id 列を持つモデル名の昇順ソート済み一覧。 */
  readonly tenantTables: readonly string[];
  /** 全モデル名（org_id 有無を問わず）。known-gap の陳腐化検出に使う。 */
  readonly allModels: readonly string[];
  /** org_id が nullable なテナントモデル。fail-close RLS/backfill 前の設計ギャップ。 */
  readonly nullableTenantColumns: readonly string[];
  /** org_id を含まない unique 制約。tenant table で外部ID/子IDだけの検索を許す再発面。 */
  readonly tenantUniquesWithoutOrg: readonly TenantUniqueWithoutOrg[];
  /** テナントテーブルごとの被覆状況（tenantTables と同順）。 */
  readonly coverage: readonly TenantTableCoverage[];
  /** status 別のテーブル名一覧（昇順）。 */
  readonly missing: readonly string[];
  readonly partial: readonly string[];
  readonly ssotDrift: readonly string[];
  readonly covered: readonly string[];
}

interface ModelDef {
  readonly name: string;
  readonly hasTenantColumn: boolean;
  readonly tenantColumnNullable: boolean;
  readonly uniqueConstraints: readonly TenantUniqueWithoutOrg[];
}

/** prisma/schema/*.prisma から model ブロックを抽出し、org_id スカラー列の有無を判定。 */
function parseSchemaModels(schemaDir = SCHEMA_DIR): ModelDef[] {
  const files = readdirSync(schemaDir).filter((f) => f.endsWith('.prisma'));
  const models: ModelDef[] = [];
  // model ブロック: `model Name {` ... 行頭 `}` まで。
  const modelBlock = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  // スカラー列宣言 `  org_id String` を検出（@@index([org_id]) や
  // relation `organization Organization @relation(fields: [org_id])` は field 名が
  // 異なる/@@ 始まりのため一致しない）。
  const tenantColumnDecl = new RegExp(`^\\s+${TENANT_COLUMN}\\s+\\w`, 'm');
  const tenantColumnLine = new RegExp(`^\\s+${TENANT_COLUMN}\\s+(\\S+)`, 'm');
  for (const file of files) {
    const text = readFileSync(join(schemaDir, file), 'utf8');
    let match: RegExpExecArray | null;
    while ((match = modelBlock.exec(text)) !== null) {
      const [, name, body] = match;
      const tenantType = tenantColumnLine.exec(body)?.[1] ?? '';
      models.push({
        name,
        hasTenantColumn: tenantColumnDecl.test(body),
        tenantColumnNullable: tenantType.endsWith('?'),
        uniqueConstraints: parseTenantUniqueConstraints(name, body),
      });
    }
  }
  return models;
}

function parseTenantUniqueConstraints(table: string, body: string): TenantUniqueWithoutOrg[] {
  const issues: TenantUniqueWithoutOrg[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('///')) continue;

    if (trimmed.startsWith('@@unique')) {
      const fields = parseAttributeFieldList(trimmed);
      if (fields.length > 0 && !fields.includes(TENANT_COLUMN)) {
        issues.push({
          table,
          kind: 'compound',
          constraint: `@@unique([${fields.join(',')}])`,
          fields,
        });
      }
      continue;
    }

    if (trimmed.includes('@unique')) {
      const field = trimmed.match(/^(\w+)\s+/)?.[1];
      if (field && field !== 'id' && field !== TENANT_COLUMN) {
        issues.push({
          table,
          kind: 'field',
          constraint: `@unique(${field})`,
          fields: [field],
        });
      }
    }
  }
  return issues;
}

function parseAttributeFieldList(attributeLine: string): string[] {
  const rawFields = attributeLine.match(/\[\s*([^\]]+)\s*\]/)?.[1];
  if (!rawFields) return [];
  return rawFields
    .split(',')
    .map((field) => field.trim().replace(/[^\w]/g, ''))
    .filter(Boolean);
}

/** 各 migration ディレクトリの migration.sql を全連結。 */
function readAllMigrations(migrationsDir = MIGRATIONS_DIR): string {
  const parts: string[] = [];
  for (const entry of readdirSync(migrationsDir).sort()) {
    const sqlPath = join(migrationsDir, entry, 'migration.sql');
    try {
      if (statSync(sqlPath).isFile()) parts.push(readFileSync(sqlPath, 'utf8'));
    } catch {
      // migration ディレクトリ以外（migration_lock.toml 等）はスキップ。
    }
  }
  return parts.join('\n');
}

type MutableRlsState = {
  enabled: boolean;
  forced: boolean;
  policies: Map<string, RlsPolicyPredicate>;
};

type RlsEvent =
  | {
      index: number;
      kind: 'enable' | 'disable' | 'force' | 'no-force' | 'drop-table';
      table: string;
    }
  | {
      index: number;
      kind: 'create-policy' | 'alter-policy';
      table: string;
      policy: string;
      predicate: RlsPolicyPredicate;
    }
  | { index: number; kind: 'drop-policy'; table: string; policy: string };

function classifyPolicyPredicate(statement: string): RlsPolicyPredicate {
  const code = statement.replace(/--[^\n\r]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const hasUsing = /\bUSING\s*\(/i.test(code);
  const hasWithCheck = /\bWITH\s+CHECK\s*\(/i.test(code);
  if (!hasUsing || !hasWithCheck) return 'other';

  const enforcedCalls = code.match(/(?:public\.)?app_enforced_org_id\s*\(\s*\)/gi) ?? [];
  if (enforcedCalls.length >= 2) return 'app-enforced-org';

  const nullableSettings =
    code.match(/current_setting\s*\(\s*'app\.current_org_id'\s*,\s*true\s*\)/gi) ?? [];
  if (nullableSettings.length >= 2) return 'nullable-setting';

  return 'other';
}

function collectMatches(
  sql: string,
  pattern: RegExp,
  toEvent: (match: RegExpExecArray) => RlsEvent,
) {
  const events: RlsEvent[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('i') ? 'gi' : 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) events.push(toEvent(match));
  return events;
}

function maskSqlNonCode(sql: string): string {
  const chars = [...sql];
  const mask = (index: number) => {
    if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
  };

  for (let index = 0; index < chars.length; ) {
    if (chars[index] === '-' && chars[index + 1] === '-') {
      while (index < chars.length && chars[index] !== '\n') mask(index++);
      continue;
    }
    if (chars[index] === '/' && chars[index + 1] === '*') {
      mask(index++);
      mask(index++);
      while (index < chars.length && !(chars[index] === '*' && chars[index + 1] === '/')) {
        mask(index++);
      }
      if (index < chars.length) {
        mask(index++);
        mask(index++);
      }
      continue;
    }
    if (chars[index] === "'") {
      mask(index++);
      while (index < chars.length) {
        if (chars[index] === "'" && chars[index + 1] === "'") {
          mask(index++);
          mask(index++);
          continue;
        }
        const closing = chars[index] === "'";
        mask(index++);
        if (closing) break;
      }
      continue;
    }
    if (chars[index] === '$') {
      const suffix = chars.slice(index).join('');
      const tag = suffix.match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        for (let count = 0; count < tag.length; count += 1) mask(index++);
        while (index < chars.length && chars.slice(index, index + tag.length).join('') !== tag) {
          mask(index++);
        }
        for (let count = 0; count < tag.length && index < chars.length; count += 1) mask(index++);
        continue;
      }
    }
    index += 1;
  }

  return chars.join('');
}

function parseRlsEvents(sql: string): RlsEvent[] {
  const literalSql = maskSqlNonCode(sql);
  const events: RlsEvent[] = [
    ...collectMatches(
      literalSql,
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"public"\.)?"([^"]+)"\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY/gi,
      (match) => ({
        index: match.index,
        kind: match[2].toUpperCase() === 'ENABLE' ? 'enable' : 'disable',
        table: match[1],
      }),
    ),
    ...collectMatches(
      literalSql,
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"public"\.)?"([^"]+)"\s+(FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi,
      (match) => ({
        index: match.index,
        kind: /NO\s+FORCE/i.test(match[2]) ? 'no-force' : 'force',
        table: match[1],
      }),
    ),
    ...collectMatches(
      literalSql,
      /CREATE\s+POLICY\s+"?([\w-]+)"?\s+ON\s+(?:"public"\.)?"([^"]+)"[\s\S]*?;/gi,
      (match) => ({
        index: match.index,
        kind: 'create-policy',
        policy: match[1],
        table: match[2],
        predicate: classifyPolicyPredicate(sql.slice(match.index, match.index + match[0].length)),
      }),
    ),
    ...collectMatches(
      literalSql,
      /ALTER\s+POLICY\s+"?([\w-]+)"?\s+ON\s+(?:"public"\.)?"([^"]+)"[\s\S]*?;/gi,
      (match) => ({
        index: match.index,
        kind: 'alter-policy',
        policy: match[1],
        table: match[2],
        predicate: classifyPolicyPredicate(sql.slice(match.index, match.index + match[0].length)),
      }),
    ),
    ...collectMatches(
      literalSql,
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"public"\.|public\.)?"([^"]+)"/gi,
      (match) => ({
        index: match.index,
        kind: 'drop-table',
        table: match[1],
      }),
    ),
    ...collectMatches(
      literalSql,
      /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([\w-]+)"?\s+ON\s+(?:"public"\.)?"([^"]+)"/gi,
      (match) => ({
        index: match.index,
        kind: 'drop-policy',
        policy: match[1],
        table: match[2],
      }),
    ),
  ];

  const dynamicFailClosedLoop =
    /FOREACH\s+target_table\s+IN\s+ARRAY\s+ARRAY\s*\[([\s\S]*?)\][\s\S]*?CREATE\s+POLICY\s+tenant_isolation[\s\S]*?app_enforced_org_id\s*\(\s*\)[\s\S]*?END\s+LOOP/gi;
  let loopMatch: RegExpExecArray | null;
  while ((loopMatch = dynamicFailClosedLoop.exec(sql)) !== null) {
    const loopBody = loopMatch[0];
    const dynamicallyEnables = /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(loopBody);
    const dynamicallyForces = /FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(loopBody);
    const tableLiteral = /'([^']+)'/g;
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = tableLiteral.exec(loopMatch[1])) !== null) {
      if (dynamicallyEnables) {
        events.push({ index: loopMatch.index, kind: 'enable', table: tableMatch[1] });
      }
      if (dynamicallyForces) {
        events.push({ index: loopMatch.index, kind: 'force', table: tableMatch[1] });
      }
      events.push({
        index: loopMatch.index,
        kind: 'create-policy',
        policy: 'tenant_isolation',
        table: tableMatch[1],
        predicate: 'app-enforced-org',
      });
    }
  }

  return events.sort((a, b) => a.index - b.index);
}

function scanSqlFinalState(sql: string): Map<string, RlsSourceFinalState> {
  const states = new Map<string, MutableRlsState>();
  const stateFor = (table: string) => {
    const existing = states.get(table);
    if (existing) return existing;
    const created: MutableRlsState = { enabled: false, forced: false, policies: new Map() };
    states.set(table, created);
    return created;
  };

  for (const event of parseRlsEvents(sql)) {
    const state = stateFor(event.table);
    switch (event.kind) {
      case 'enable':
        state.enabled = true;
        break;
      case 'disable':
        state.enabled = false;
        break;
      case 'force':
        state.forced = true;
        break;
      case 'no-force':
        state.forced = false;
        break;
      case 'drop-table':
        state.enabled = false;
        state.forced = false;
        state.policies.clear();
        break;
      case 'create-policy':
      case 'alter-policy':
        state.policies.set(event.policy, event.predicate);
        break;
      case 'drop-policy':
        state.policies.delete(event.policy);
        break;
    }
  }

  return new Map(
    [...states].map(([table, state]) => {
      const policyPredicates = [...state.policies.values()].sort();
      return [
        table,
        {
          enabled: state.enabled,
          forced: state.forced,
          hasPolicy: state.policies.size > 0,
          hasApprovedPredicate: policyPredicates.includes('app-enforced-org'),
          policyPredicates,
        },
      ];
    }),
  );
}

function classify(cov: {
  migration: RlsSourceFinalState;
  ssot: RlsSourceFinalState;
}): RlsCoverageStatus {
  const migrationComplete = isCompleteRlsState(cov.migration);
  const ssotComplete = isCompleteRlsState(cov.ssot);
  const hasAnyRlsSignal =
    cov.migration.enabled ||
    cov.migration.forced ||
    cov.migration.hasPolicy ||
    cov.ssot.enabled ||
    cov.ssot.forced ||
    cov.ssot.hasPolicy;

  if (!hasAnyRlsSignal) return 'missing';
  if (migrationComplete && !ssotComplete) return 'ssot-drift';
  if (!migrationComplete) return 'partial';
  return 'covered';
}

const EMPTY_RLS_STATE: RlsSourceFinalState = {
  enabled: false,
  forced: false,
  hasPolicy: false,
  hasApprovedPredicate: false,
  policyPredicates: [],
};

function isCompleteRlsState(state: RlsSourceFinalState) {
  return state.enabled && state.forced && state.hasPolicy && state.hasApprovedPredicate;
}

export interface ScanPaths {
  readonly schemaDir?: string;
  readonly migrationsDir?: string;
  readonly ssotFile?: string;
}

/** schema + migrations + SSOT を静的突合し、テナントテーブルの RLS 被覆を返す。 */
export function scanRlsContract(paths: ScanPaths = {}): RlsContractScan {
  const models = parseSchemaModels(paths.schemaDir);
  const migrationSql = readAllMigrations(paths.migrationsDir);
  const ssotSql = readFileSync(paths.ssotFile ?? RLS_SSOT_FILE, 'utf8');
  const migrationStates = scanSqlFinalState(migrationSql);
  const ssotStates = scanSqlFinalState(ssotSql);

  const tenantModels = models
    .filter((m) => m.hasTenantColumn)
    .map((m) => m.name)
    .sort();

  const coverage: TenantTableCoverage[] = tenantModels.map((table) => {
    const migration = migrationStates.get(table) ?? EMPTY_RLS_STATE;
    const ssot = ssotStates.get(table) ?? EMPTY_RLS_STATE;
    const hasEnable = migration.enabled && ssot.enabled;
    const hasForce = migration.forced && ssot.forced;
    const hasPolicy = migration.hasPolicy && ssot.hasPolicy;
    const inSsot = ssot.enabled;
    return {
      table,
      migration,
      ssot,
      hasEnable,
      hasForce,
      hasPolicy,
      inSsot,
      status: classify({ migration, ssot }),
    };
  });

  const byStatus = (s: RlsCoverageStatus) =>
    coverage
      .filter((c) => c.status === s)
      .map((c) => c.table)
      .sort();

  return {
    tenantTables: tenantModels,
    allModels: models.map((m) => m.name).sort(),
    nullableTenantColumns: models
      .filter((m) => m.hasTenantColumn && m.tenantColumnNullable)
      .map((m) => m.name)
      .sort(),
    tenantUniquesWithoutOrg: models
      .filter((m) => m.hasTenantColumn)
      .flatMap((m) => m.uniqueConstraints)
      .sort((a, b) => `${a.table}:${a.constraint}`.localeCompare(`${b.table}:${b.constraint}`)),
    coverage,
    missing: byStatus('missing'),
    partial: byStatus('partial'),
    ssotDrift: byStatus('ssot-drift'),
    covered: byStatus('covered'),
  };
}
