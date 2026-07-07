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
  readonly hasEnable: boolean;
  readonly hasForce: boolean;
  readonly hasPolicy: boolean;
  /** SSOT ファイル(rls-policies.sql)に ENABLE 行があるか。 */
  readonly inSsot: boolean;
  readonly status: RlsCoverageStatus;
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
  for (const entry of readdirSync(migrationsDir)) {
    const sqlPath = join(migrationsDir, entry, 'migration.sql');
    try {
      if (statSync(sqlPath).isFile()) parts.push(readFileSync(sqlPath, 'utf8'));
    } catch {
      // migration ディレクトリ以外（migration_lock.toml 等）はスキップ。
    }
  }
  return parts.join('\n');
}

/** SQL から `ALTER TABLE "X" ... ROW LEVEL SECURITY` / `CREATE POLICY ... ON "X"` のテーブル集合を抽出。 */
function extractTables(sql: string, pattern: RegExp): Set<string> {
  const found = new Set<string>();
  const re = new RegExp(pattern.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) found.add(match[1]);
  return found;
}

function classify(cov: {
  hasEnable: boolean;
  hasForce: boolean;
  hasPolicy: boolean;
  inSsot: boolean;
}): RlsCoverageStatus {
  if (!cov.hasEnable) return 'missing';
  if (!cov.hasForce || !cov.hasPolicy) return 'partial';
  if (!cov.inSsot) return 'ssot-drift';
  return 'covered';
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
  const bothSql = `${migrationSql}\n${ssotSql}`;

  // ポリシー名は `tenant_isolation`（bare）も `"jahis_..._org_isolation"`（quoted）も許容。
  const enableBoth = extractTables(bothSql, /ALTER TABLE "(\w+)" ENABLE ROW LEVEL SECURITY/);
  const forceBoth = extractTables(bothSql, /ALTER TABLE "(\w+)" FORCE ROW LEVEL SECURITY/);
  const policyBoth = extractTables(bothSql, /CREATE POLICY "?\w+"? ON "(\w+)"/);
  const enableSsot = extractTables(ssotSql, /ALTER TABLE "(\w+)" ENABLE ROW LEVEL SECURITY/);

  const tenantModels = models
    .filter((m) => m.hasTenantColumn)
    .map((m) => m.name)
    .sort();

  const coverage: TenantTableCoverage[] = tenantModels.map((table) => {
    const hasEnable = enableBoth.has(table);
    const hasForce = forceBoth.has(table);
    const hasPolicy = policyBoth.has(table);
    const inSsot = enableSsot.has(table);
    return {
      table,
      hasEnable,
      hasForce,
      hasPolicy,
      inSsot,
      status: classify({ hasEnable, hasForce, hasPolicy, inSsot }),
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
