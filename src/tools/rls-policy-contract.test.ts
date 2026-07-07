import { readFileSync, writeFileSync, existsSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { scanRlsContract } from './rls-contract-scan';
import {
  KNOWN_NULLABLE_ORG_ID_TABLES,
  RLS_MISSING_GAPS,
  RLS_NULLABLE_ORG_ID_GAPS,
  RLS_SSOT_DRIFT_GAPS,
  RLS_TENANT_UNIQUE_WITHOUT_ORG_GAPS,
  KNOWN_MISSING_TABLES,
  KNOWN_SSOT_DRIFT_TABLES,
  KNOWN_TENANT_UNIQUE_WITHOUT_ORG_CONSTRAINTS,
} from './rls-known-gaps';
import { renderRlsGapLedger, LEDGER_PATH } from './rls-gap-ledger';

/**
 * RLS contract（機械導出 + ratchet）
 *
 * 旧テストはハードコード allowlist（PatientInsurance / PcaPump … の列挙）で、schema に新しい
 * テナントテーブルが増えても RLS 欠落を検出できず漏れの再発源だった。本テストは
 * prisma/schema の全モデルから org_id 列を持つテーブルを機械導出し、migrations と
 * rls-policies.sql の RLS 実態と突き合わせる。既知ギャップは rls-known-gaps.ts に明示列挙され、
 * それ以外の欠落は即 fail する（新規テーブルに RLS が無ければ赤くなる ratchet）。
 */
const rawScan = scanRlsContract();
const INTENTIONAL_RLS_EXCLUSION_TABLES = new Set(['IdSequence']);

function withoutIntentionalRlsExclusions(scan: typeof rawScan): typeof rawScan {
  const coverage = scan.coverage.filter((c) => !INTENTIONAL_RLS_EXCLUSION_TABLES.has(c.table));
  return {
    ...scan,
    tenantTables: scan.tenantTables.filter((t) => !INTENTIONAL_RLS_EXCLUSION_TABLES.has(t)),
    coverage,
    nullableTenantColumns: scan.nullableTenantColumns.filter(
      (t) => !INTENTIONAL_RLS_EXCLUSION_TABLES.has(t),
    ),
    tenantUniquesWithoutOrg: scan.tenantUniquesWithoutOrg.filter(
      (issue) => !INTENTIONAL_RLS_EXCLUSION_TABLES.has(issue.table),
    ),
    missing: scan.missing.filter((t) => !INTENTIONAL_RLS_EXCLUSION_TABLES.has(t)),
    partial: scan.partial.filter((t) => !INTENTIONAL_RLS_EXCLUSION_TABLES.has(t)),
    ssotDrift: scan.ssotDrift.filter((t) => !INTENTIONAL_RLS_EXCLUSION_TABLES.has(t)),
    covered: scan.covered.filter((t) => !INTENTIONAL_RLS_EXCLUSION_TABLES.has(t)),
  };
}

const scan = withoutIntentionalRlsExclusions(rawScan);
const uniqueIssueId = (issue: { readonly table: string; readonly constraint: string }) =>
  `${issue.table}:${issue.constraint}`;

describe('RLS contract — machine-derived tenant coverage', () => {
  it('derives a non-trivial tenant-table set from prisma/schema (guards a broken parser)', () => {
    // パーサが壊れて空集合を返すと ratchet が骨抜きになる（false-green）。下限で fail-close。
    expect(scan.tenantTables.length).toBeGreaterThan(50);
    // 代表的なテナントテーブルが必ず含まれること。
    for (const table of ['Patient', 'PatientInsurance', 'PcaPump', 'CareCase', 'Residence']) {
      expect(scan.tenantTables).toContain(table);
    }
  });

  it('has NO partial RLS: every enabled tenant table also has FORCE + a policy', () => {
    // ENABLE だけで FORCE / POLICY を欠く状態は policy がサイレントに機能しない危険。
    // これは allowlist を認めず即 fail（医療安全 fail-close）。
    expect(scan.partial).toEqual([]);
  });

  it('RATCHET: every RLS-missing tenant table is an acknowledged known gap (new tables must add RLS)', () => {
    // schema 由来の「RLS 皆無」集合が、rls-known-gaps.ts の許容リストと完全一致すること。
    // 新規テーブルを RLS 無しで追加すると missing に現れて known リストに無いため fail する。
    const unexpected = scan.missing.filter((t) => !KNOWN_MISSING_TABLES.has(t));
    expect(
      unexpected,
      `新規のテナントテーブルに RLS がありません。migration で ENABLE+FORCE+tenant_isolation policy を追加するか、` +
        `意図的な既知ギャップとして理由・対応予定つきで src/tools/rls-known-gaps.ts に追記してください: ${unexpected.join(', ')}`,
    ).toEqual([]);
  });

  it('RATCHET: no stale known-missing entry (a gap resolved by W1-7 must be removed from the ledger)', () => {
    // 台帳に載っているが実際には RLS 被覆済みになったテーブル → 陳腐化。削除を強制。
    const stale = [...KNOWN_MISSING_TABLES].filter((t) => !scan.missing.includes(t)).sort();
    expect(
      stale,
      `以下は RLS 被覆済みになりました。src/tools/rls-known-gaps.ts の RLS_MISSING_GAPS から削除してください: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('RATCHET: every SSOT-drift tenant table is an acknowledged known gap', () => {
    const unexpected = scan.ssotDrift.filter((t) => !KNOWN_SSOT_DRIFT_TABLES.has(t));
    expect(
      unexpected,
      `migration で RLS 済だが rls-policies.sql に無いテーブルが増えました。SSOT ファイルへ追記するか ` +
        `src/tools/rls-known-gaps.ts の RLS_SSOT_DRIFT_GAPS に追記してください: ${unexpected.join(', ')}`,
    ).toEqual([]);
  });

  it('RATCHET: no stale SSOT-drift entry (a table added to rls-policies.sql must leave the drift list)', () => {
    const stale = [...KNOWN_SSOT_DRIFT_TABLES].filter((t) => !scan.ssotDrift.includes(t)).sort();
    expect(
      stale,
      `以下は SSOT へ反映済み or 状態が変わりました。RLS_SSOT_DRIFT_GAPS から削除してください: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('every known-gap table is still a tenant model with an org_id column (guards renames/removals)', () => {
    const tenant = new Set(scan.tenantTables);
    for (const g of [...RLS_MISSING_GAPS, ...RLS_SSOT_DRIFT_GAPS]) {
      expect(
        tenant.has(g.table),
        `known-gap の ${g.table} が org_id 列を持つテナントモデルとして存在しません（rename/削除? 台帳を更新してください）`,
      ).toBe(true);
    }
  });

  it('RATCHET: every nullable org_id tenant table is an acknowledged known gap', () => {
    const unexpected = scan.nullableTenantColumns.filter(
      (t) => !KNOWN_NULLABLE_ORG_ID_TABLES.has(t),
    );
    expect(
      unexpected,
      `org_id nullable のテナントテーブルが増えました。org_id NOT NULL/RLS 設計へ直すか、理由・対応予定つきで ` +
        `RLS_NULLABLE_ORG_ID_GAPS に追記してください: ${unexpected.join(', ')}`,
    ).toEqual([]);
  });

  it('RATCHET: no stale nullable org_id known-gap entry', () => {
    const stale = [...KNOWN_NULLABLE_ORG_ID_TABLES]
      .filter((table) => !scan.nullableTenantColumns.includes(table))
      .sort();
    expect(
      stale,
      `以下は org_id nullable ではなくなりました。RLS_NULLABLE_ORG_ID_GAPS から削除してください: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('RATCHET: every tenant unique without org_id is an acknowledged known gap', () => {
    const unexpected = scan.tenantUniquesWithoutOrg
      .filter((issue) => !KNOWN_TENANT_UNIQUE_WITHOUT_ORG_CONSTRAINTS.has(uniqueIssueId(issue)))
      .map(uniqueIssueId);
    expect(
      unexpected,
      `org_id を含まない tenant unique 制約が増えました。org_id を含む DB 制約へ直すか、理由・対応予定つきで ` +
        `RLS_TENANT_UNIQUE_WITHOUT_ORG_GAPS に追記してください: ${unexpected.join(', ')}`,
    ).toEqual([]);
  });

  it('RATCHET: no stale tenant unique without org_id known-gap entry', () => {
    const current = new Set(scan.tenantUniquesWithoutOrg.map(uniqueIssueId));
    const stale = [...KNOWN_TENANT_UNIQUE_WITHOUT_ORG_CONSTRAINTS]
      .filter((issueId) => !current.has(issueId))
      .sort();
    expect(
      stale,
      `以下の tenant unique 制約ギャップは解消/変更されました。` +
        `RLS_TENANT_UNIQUE_WITHOUT_ORG_GAPS から削除または更新してください: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('every nullable/unique known gap is still attached to a tenant model', () => {
    const tenant = new Set(scan.tenantTables);
    for (const g of [...RLS_NULLABLE_ORG_ID_GAPS, ...RLS_TENANT_UNIQUE_WITHOUT_ORG_GAPS]) {
      expect(
        tenant.has(g.table),
        `known-gap の ${g.table} が org_id 列を持つテナントモデルとして存在しません（rename/削除? 台帳を更新してください）`,
      ).toBe(true);
    }
  });
});

describe('RLS contract — intentional internal exclusions', () => {
  it('keeps IdSequence as an explicitly documented non-RLS internal counter', () => {
    expect(rawScan.allModels).toContain('IdSequence');
    expect(rawScan.tenantTables).toContain('IdSequence');
    expect(rawScan.missing).toContain('IdSequence');
    expect(scan.missing).not.toContain('IdSequence');

    const ssot = readFileSync('prisma/rls-policies.sql', 'utf8');
    expect(ssot).toContain('id_sequence / IdSequence');
    expect(ssot).toContain('intentional RLS exclusion');
    expect(ssot).toContain('allocateDisplayId');
  });
});

describe('RLS contract — hardened failsafe (app_enforced_org_id) for critical domains', () => {
  const both = (() => {
    const ssot = readFileSync('prisma/rls-policies.sql', 'utf8');
    // 重要ドメイン（billing / PCA rental / 患者構造化ケア）は fail-close な
    // public.app_enforced_org_id()（org 未設定時に throw）を policy が使うことを維持する。
    return ssot;
  })();

  it.each([
    'PatientInsurance',
    'PcaPump',
    'PcaPumpRental',
    'PcaPumpMaintenanceEvent',
    'PatientFieldRevision',
    'PatientMedicalProcedure',
    'PatientNarcoticUse',
    'VisitScheduleProposalBatch',
    'VisitHandoffExtraction',
  ])('SSOT keeps ENABLE+FORCE+policy for hardened table %s', (table) => {
    // これらは以前 hardening migration で app_enforced_org_id 化されたテーブル。
    // scan の被覆判定と別に、SSOT ファイル本体での完全被覆を明示的に固定する。
    const cov = scan.coverage.find((c) => c.table === table);
    expect(cov, `${table} が tenant テーブルとして導出されていません`).toBeDefined();
    expect(cov?.hasEnable).toBe(true);
    expect(cov?.hasForce).toBe(true);
    expect(cov?.hasPolicy).toBe(true);
    expect(both).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    expect(both).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
  });

  it('SSOT wires the fail-close app_enforced_org_id() helper into policies', () => {
    // helper 自体が SSOT に存在し、少なくとも重要テーブルの policy で使われていること。
    expect(both).toContain('app_enforced_org_id');
    expect(both).toMatch(/CREATE POLICY[\s\S]*?app_enforced_org_id\(\)/);
  });
});

describe('RLS gap ledger doc stays in sync', () => {
  it('docs/security/rls-gap-ledger.md matches the generated content', () => {
    const rendered = renderRlsGapLedger(scan);
    if (process.env.UPDATE_RLS_LEDGER === '1') {
      writeFileSync(LEDGER_PATH, rendered);
    }
    expect(existsSync(LEDGER_PATH), `${LEDGER_PATH} が存在しません`).toBe(true);
    const actual = readFileSync(LEDGER_PATH, 'utf8');
    expect(
      actual,
      `${LEDGER_PATH} が生成内容と一致しません。` +
        `\`UPDATE_RLS_LEDGER=1 pnpm exec vitest run src/tools/rls-policy-contract.test.ts\` で再生成してください。`,
    ).toBe(rendered);
  });
});
