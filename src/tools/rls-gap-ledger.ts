/**
 * RLS ギャップ台帳（docs/security/rls-gap-ledger.md）のレンダラ。
 *
 * scanRlsContract()（現行 schema/migration/SSOT の事実）と rls-known-gaps.ts（許容理由・
 * 対応予定）を突き合わせ、W1-7（RLS 有効化 migration 承認）の入力資料となる Markdown を
 * 決定論的に生成する。タイムスタンプ等の非決定値は含めない（contract テストで同期検証するため）。
 */
import { RLS_MISSING_GAPS, RLS_SSOT_DRIFT_GAPS, type RlsGapCategory } from './rls-known-gaps';
import { scanRlsContract, type RlsContractScan } from './rls-contract-scan';

export const LEDGER_PATH = 'docs/security/rls-gap-ledger.md';

const CATEGORY_LABEL: Record<RlsGapCategory, string> = {
  phi: 'PHI（最重大）',
  'tenant-operational': '運用データ',
  'tenant-config': 'org 設定/マスタ',
  'design-review': 'design 判定要',
};

/** PHI → operational → config → design-review の順で安定ソート。 */
const CATEGORY_ORDER: RlsGapCategory[] = [
  'phi',
  'tenant-operational',
  'tenant-config',
  'design-review',
];

function md(cell: string): string {
  // Markdown テーブルのセル内でパイプが表を壊さないようエスケープ。
  return cell.replace(/\|/g, '\\|');
}

export function renderRlsGapLedger(scan: RlsContractScan = scanRlsContract()): string {
  const lines: string[] = [];

  lines.push('<!-- 自動生成: src/tools/rls-gap-ledger.ts。直接編集しないこと。 -->');
  lines.push(
    '<!-- 更新: `UPDATE_RLS_LEDGER=1 pnpm exec vitest run src/tools/rls-policy-contract.test.ts` -->',
  );
  lines.push('');
  lines.push('# RLS ギャップ台帳（W1-7 承認入力資料）');
  lines.push('');
  lines.push(
    'prisma/schema の全モデルから `org_id` 列を持つ = テナントスコープであるべきテーブルを機械導出し、',
  );
  lines.push(
    'prisma/migrations と prisma/rls-policies.sql の RLS 有効化実態（ENABLE / FORCE ROW LEVEL SECURITY / POLICY）と',
  );
  lines.push('突き合わせた結果。「実体が無い」テーブルを構造化して可視化する。');
  lines.push('');
  lines.push(
    '**この台帳は 3省2ガイドライン準拠のテナント分離監査資料であり、RLS 有効化 migration（W1-7、別承認レーン）の入力。**',
  );
  lines.push('');

  // ── サマリ ──
  lines.push('## サマリ');
  lines.push('');
  lines.push('| 指標 | 件数 |');
  lines.push('| --- | ---: |');
  lines.push(`| テナントテーブル（org_id 列を持つモデル） | ${scan.tenantTables.length} |`);
  lines.push(`| RLS 完全被覆（ENABLE+FORCE+POLICY） | ${scan.covered.length} |`);
  lines.push(`| RLS 完全欠落（ギャップ 1a） | ${scan.missing.length} |`);
  lines.push(`| ENABLE のみ/policy 不完全（即修正対象） | ${scan.partial.length} |`);
  lines.push(
    `| SSOT ドリフト（migration 済・rls-policies.sql 欠、ギャップ 1b） | ${scan.ssotDrift.length} |`,
  );
  lines.push('');

  // ── 1a: 完全欠落 ──
  lines.push('## 1a. RLS 完全欠落（DB 層 backstop 皆無）');
  lines.push('');
  lines.push(
    'org_id 列を持つが ENABLE ROW LEVEL SECURITY がどこにも無いテーブル。本番 DB でも org 分離の DB 層 backstop が欠如しており、',
  );
  lines.push('W1-7 で ENABLE+FORCE+tenant_isolation policy を追加する。');
  lines.push('');
  lines.push('| テーブル | finding | 分類 | PHI | 理由 | 対応予定（W1-7） |');
  lines.push('| --- | --- | --- | :---: | --- | --- |');
  const sortedMissing = [...RLS_MISSING_GAPS].sort((a, b) => {
    const c = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    return c !== 0 ? c : a.table.localeCompare(b.table);
  });
  for (const g of sortedMissing) {
    lines.push(
      `| \`${g.table}\` | ${md(g.findingId)} | ${CATEGORY_LABEL[g.category]} | ${
        g.phi ? '⚠️ 有' : '—'
      } | ${md(g.reason)} | ${md(g.plannedAction)} |`,
    );
  }
  lines.push('');

  // ── 1b: SSOT ドリフト ──
  lines.push('## 1b. SSOT ドリフト（migration 済・rls-policies.sql 未反映）');
  lines.push('');
  lines.push(
    'migration で ENABLE+FORCE+POLICY 済のため本番 DB は保護されているが、SSOT ファイル prisma/rls-policies.sql に該当行が無いテーブル。',
  );
  lines.push(
    '再provision / 監査 / contract-of-record のドリフト源。W1-7 で SSOT ファイルへ追記する。',
  );
  lines.push('');
  lines.push('| テーブル | finding | PHI | 理由 |');
  lines.push('| --- | --- | :---: | --- |');
  const sortedDrift = [...RLS_SSOT_DRIFT_GAPS].sort((a, b) => {
    if (a.phi !== b.phi) return a.phi ? -1 : 1;
    return a.table.localeCompare(b.table);
  });
  for (const g of sortedDrift) {
    lines.push(
      `| \`${g.table}\` | ${md(g.findingId)} | ${g.phi ? '⚠️ 有' : '—'} | ${md(g.reason)} |`,
    );
  }
  lines.push('');

  // ── 完全被覆一覧（参照） ──
  lines.push('## 参考: RLS 完全被覆テーブル一覧');
  lines.push('');
  lines.push(
    `以下 ${scan.covered.length} テーブルは ENABLE+FORCE+POLICY が揃い、SSOT にも反映済み（contract テストで機械検証）。`,
  );
  lines.push('');
  lines.push('<details><summary>展開</summary>');
  lines.push('');
  for (const t of scan.covered) lines.push(`- \`${t}\``);
  lines.push('');
  lines.push('</details>');
  lines.push('');

  return lines.join('\n');
}
