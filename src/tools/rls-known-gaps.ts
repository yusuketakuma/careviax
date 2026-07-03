/**
 * RLS 既知ギャップ台帳（構造化 SSOT）
 *
 * scanRlsContract() が機械導出する「テナントスコープであるべき(org_id 列)のに RLS 実体が
 * 無い/不完全なテーブル」のうち、W1-6 時点で既知かつ W1-7（RLS 有効化 migration・別承認レーン）
 * で対応予定のものを明示列挙する。ここに列挙されたテーブルは contract テストを **fail させない**
 * が、以下の ratchet を成立させる:
 *
 *  - 新規テーブルが org_id を持ちつつ RLS 無しで、かつこの台帳に無ければ contract テストが赤くなる
 *    （＝ RLS を付けるか、意図的ギャップとして理由付きで台帳へ追記するまでマージできない）。
 *  - 台帳のテーブルが実際には RLS 被覆済みになった（W1-7 で解消）場合も赤くなる
 *    （＝陳腐化したギャップ行の削除を強制する）。
 *  - 台帳のテーブルが schema から消えた/org_id を失った場合も赤くなる。
 *
 * この台帳は docs/security/rls-gap-ledger.md（人間可読、W1-7 承認の入力資料）の生成元でもある。
 * category / reason / plannedAction を編集したら `UPDATE_RLS_LEDGER=1 pnpm exec vitest run
 * src/tools/rls-policy-contract.test.ts` でドキュメントを再生成すること。
 *
 * 注意: partial（ENABLE はあるが FORCE/POLICY 欠落）には allowlist を設けない。policy が
 * サイレントに機能しない状態はどのテーブルでも即 fail 扱い（医療安全 fail-close）。
 */

/** ギャップの性質分類。severity 順（PHI が最重大）。 */
export type RlsGapCategory =
  /** 患者/処方 PHI を含むテーブル。DB 層 backstop 欠如の害が最大。 */
  | 'phi'
  /** 訪問スコープの運用データ（患者連絡先・スケジュール等）。 */
  | 'tenant-operational'
  /** org 業務設定・マスタ。全 consumer が app 層で org_id filter 済で latent backstop 欠如。 */
  | 'tenant-config'
  /** global master / auth identity の可能性があり、RLS 適用可否に design 判定を要する。 */
  | 'design-review';

export interface RlsMissingGap {
  readonly table: string;
  /** ops/refactor/ULTRACODE_EXPANSION_MASTER_TARGETS.md の finding ID（machine 導出のみは 'machine-derived'）。 */
  readonly findingId: string;
  readonly category: RlsGapCategory;
  /** true = 患者/処方 PHI を保持。台帳で最優先強調。 */
  readonly phi: boolean;
  readonly reason: string;
  /** W1-7（別承認レーン）での対応方針。 */
  readonly plannedAction: string;
}

export interface RlsSsotDriftGap {
  readonly table: string;
  readonly findingId: string;
  readonly phi: boolean;
  readonly reason: string;
}

/**
 * RLS が一切無い（ENABLE ROW LEVEL SECURITY がどこにも無い）テナントテーブル。
 * = 本番 DB でも org 分離の DB 層 backstop が欠如。W1-7 で ENABLE+FORCE+POLICY を追加予定。
 */
export const RLS_MISSING_GAPS: readonly RlsMissingGap[] = [
  // NOTE: 2026-07-03 W1-7 承認レーンで 11 表に ENABLE+FORCE+tenant_isolation policy を追加
  // （migration 20260703090000_add_rls_missing_tenant_tables + prisma/rls-policies.sql 同期）。
  // 解消済みのため一覧から削除:
  //   PatientPackagingProfile(N01,PHI) / VisitScheduleContactLog(N07,PHI) /
  //   VisitScheduleOverride(N06) / BillingRule(N14) / BusinessHoliday(N29) /
  //   FacilityUnit(N12) / FormularyChangeRequest(F79) / FormularyTemplate(F79/N11) /
  //   NotificationRule(N33) / PackagingMethodMaster(N28) / PharmacySiteInsuranceConfig(N17)。
  // 残置は design 判定 2 表 + runner 改修待ち 1 表（IntegrationJob）。
  {
    table: 'IntegrationJob',
    findingId: 'machine-derived',
    category: 'tenant-operational',
    phi: true,
    reason:
      'ジョブ実行台帳。org_id は nullable。runner.ts が withOrgContext の外で base prisma を使い create/update する。' +
      '/api/jobs 管理者経路（refreshMedicalInstitutionMaster/refreshCareServiceOfficeMaster が ' +
      'targetOrgIds:[ctx.orgId] → runJob(..., orgId)）は非 NULL org_id を書き込むため、fail-close の ' +
      'FORCE RLS を張ると当該 INSERT が RLS context missing で throw → master-refresh が 500。' +
      'input/output(Json?) は job_type 次第で PHI を保持しうるため DB backstop は望ましいが、' +
      'runner が RLS 対応するまで fail-close RLS は unsafe。',
    plannedAction:
      'runner.ts の runJobOnce で orgId が非 NULL のとき create/update を withOrgContext(orgId, tx=>…) に包む' +
      '（NULL の system 行は base prisma のまま）改修を先行。その後に ENABLE+FORCE+tenant_isolation を追加。',
  },
  {
    table: 'PrescriberInstitution',
    findingId: 'CXR2-RLS01',
    category: 'design-review',
    phi: false,
    reason:
      '処方元医療機関。org-scoped（拠点別ディレクトリ）か global master かで RLS 適用要否が変わる。要 design 判定。',
    plannedAction:
      'W1-7 前に design 判定。org-scoped なら tenant_isolation、global master なら org_id 列自体の撤去/意図明示。',
  },
  {
    table: 'User',
    findingId: 'CXR2-RLS02',
    category: 'design-review',
    phi: false,
    reason:
      '認証/identity テーブル。org_id 列有だが RLS 適用は auth 境界に触れるため慎重。cross-org ユーザー参照の要件を含め design review が必要。',
    plannedAction:
      'auth 境界レーンで human 承認のもと design review。RLS 適用可否・cross-org 参照要件を確定してから migration。',
  },
];

/**
 * ENABLE+FORCE+POLICY は migration で適用済み（本番 DB は保護されている）が、
 * SSOT ファイル prisma/rls-policies.sql に該当行が無いテーブル。
 * = 再provision / 監査 / contract-of-record のドリフト。W1-7 で SSOT ファイルへ追記予定。
 */
export const RLS_SSOT_DRIFT_GAPS: readonly RlsSsotDriftGap[] = [
  // 2026-07-03 W1-7: 9 表（JahisSupplementalRecord / PatientCondition / Facility /
  // FacilityContact / ExternalProfessional / PharmacyCooperationMessage /
  // PharmacyCooperationMessageThread / SavedView / UatFeedback）を prisma/rls-policies.sql へ
  // 同期し drift 解消。各表は migration の最終適用 policy（last-migration-wins）を忠実に反映
  // （Facility/FacilityContact/ExternalProfessional は rls_context_failsafe 後の
  // app_enforced_org_id() 形。Jahis/UatFeedback は当時の current_setting 形）。
];

export const KNOWN_MISSING_TABLES: ReadonlySet<string> = new Set(
  RLS_MISSING_GAPS.map((g) => g.table),
);
export const KNOWN_SSOT_DRIFT_TABLES: ReadonlySet<string> = new Set(
  RLS_SSOT_DRIFT_GAPS.map((g) => g.table),
);
