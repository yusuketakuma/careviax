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

export interface RlsNullableOrgIdGap {
  readonly table: string;
  readonly reason: string;
  readonly plannedAction: string;
}

export type RlsTenantUniqueGapCategory =
  | 'case-child'
  | 'clinical-child'
  | 'identity-design-review'
  | 'notification-endpoint'
  | 'patient-one-to-one'
  | 'public-token'
  | 'site-scoped'
  | 'user-scope'
  | 'webhook-delivery';

export interface RlsTenantUniqueWithoutOrgGap {
  readonly table: string;
  readonly constraint: string;
  readonly fields: readonly string[];
  readonly category: RlsTenantUniqueGapCategory;
  readonly reason: string;
  readonly plannedAction: string;
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

/**
 * org_id が nullable な tenant model。
 * tenant table の fail-close contract では org_id NOT NULL が原則だが、既存の global/system 兼用設計は
 * migration 前に分離設計が必要。新規 nullable org_id はこの台帳無しでは fail させる。
 */
export const RLS_NULLABLE_ORG_ID_GAPS: readonly RlsNullableOrgIdGap[] = [
  {
    table: 'DrugAlertRule',
    reason:
      '薬剤アラートルールは global default と org override を同じ table で表す既存設計。org_id NULL 行は全組織共通設定を意味する。',
    plannedAction:
      'global master と org override の table 分離、または nullable 行を明示する scope column を追加して tenant RLS/unique の契約を再定義する。',
  },
  {
    table: 'IntegrationJob',
    reason:
      'system job と org-scoped job を同じ table で保持する既存設計。org_id NULL 行は system-wide job に使われる。',
    plannedAction:
      'runner の withOrgContext 対応後、system job contract を明示し、org-scoped job の org_id NOT NULL 化または table 分離を行う。',
  },
];

/**
 * tenant table 上の unique 制約が org_id を含まない既知ギャップ。
 * app 層で org_id filter していても、DB の unique/search contract が org 境界を表さないため、
 * 新規制約は fail させ、既存制約は理由付きで burn-down する。
 */
export const RLS_TENANT_UNIQUE_WITHOUT_ORG_GAPS: readonly RlsTenantUniqueWithoutOrgGap[] = [
  {
    table: 'DispensingDecision',
    constraint: '@@unique([task_id,line_id])',
    fields: ['task_id', 'line_id'],
    category: 'clinical-child',
    reason:
      '調剤判断は task/line 子レコードで実質 tenant scoped だが、unique 制約自体に org_id が無い。',
    plannedAction:
      'org_id を含む compound unique へ移行するか、task/line の composite FK に org_id を含める。',
  },
  {
    table: 'ExternalAccessGrant',
    constraint: '@unique(token_hash)',
    fields: ['token_hash'],
    category: 'public-token',
    reason:
      '外部共有 token hash は global lookup 用に一意。public token 境界のため org_id を含まない。',
    plannedAction:
      'token lookup 後の org/case/scope 再認可を snapshot test で固定し、必要なら org_id 付き索引を併設する。',
  },
  {
    table: 'FileAsset',
    constraint: '@unique(storage_key)',
    fields: ['storage_key'],
    category: 'clinical-child',
    reason: 'S3 object key は内部保存キーとして global 一意。public DTO には出さない前提。',
    plannedAction:
      'storage_key を public API から遮断する snapshot を維持し、org_id + storage_key の契約へ移行できるか設計する。',
  },
  {
    table: 'ManagementPlan',
    constraint: '@@unique([case_id,version])',
    fields: ['case_id', 'version'],
    category: 'case-child',
    reason: '計画書 version は case 配下で一意だが、unique 制約自体には org_id が無い。',
    plannedAction:
      'org_id を含む compound unique、または case_id + org_id composite relation に移行する。',
  },
  {
    table: 'PatientMcsLink',
    constraint: '@unique(patient_id)',
    fields: ['patient_id'],
    category: 'patient-one-to-one',
    reason: '患者ごとの MCS link は patient_id 一意で表現され、org_id が制約に含まれない。',
    plannedAction: 'org_id + patient_id の compound unique に移行する。',
  },
  {
    table: 'PatientMcsMessage',
    constraint: '@@unique([link_id,source_message_id])',
    fields: ['link_id', 'source_message_id'],
    category: 'patient-one-to-one',
    reason: '外部 MCS message は link 配下の source id で一意だが、org_id が制約に含まれない。',
    plannedAction:
      'org_id を含む compound unique に移行し、source id lookup も org scoped にする。',
  },
  {
    table: 'PatientMcsSummary',
    constraint: '@unique(link_id)',
    fields: ['link_id'],
    category: 'patient-one-to-one',
    reason: 'MCS summary は link 1件に対する一意行だが、org_id が制約に含まれない。',
    plannedAction: 'org_id + link_id の compound unique に移行する。',
  },
  {
    table: 'PatientMcsSummary',
    constraint: '@unique(patient_id)',
    fields: ['patient_id'],
    category: 'patient-one-to-one',
    reason: '患者ごとの MCS summary は patient_id 一意で表現され、org_id が制約に含まれない。',
    plannedAction: 'org_id + patient_id の compound unique に移行する。',
  },
  {
    table: 'PatientPackagingProfile',
    constraint: '@unique(patient_id)',
    fields: ['patient_id'],
    category: 'patient-one-to-one',
    reason: '患者包装設定は patient_id で一意だが、org_id が制約に含まれない。',
    plannedAction: 'org_id + patient_id の compound unique に移行する。',
  },
  {
    table: 'PatientSchedulePreference',
    constraint: '@unique(patient_id)',
    fields: ['patient_id'],
    category: 'patient-one-to-one',
    reason: '患者スケジュール希望は patient_id で一意だが、org_id が制約に含まれない。',
    plannedAction: 'org_id + patient_id の compound unique に移行する。',
  },
  {
    table: 'PharmacistShift',
    constraint: '@@unique([user_id,date])',
    fields: ['user_id', 'date'],
    category: 'user-scope',
    reason: '勤務シフトは user/date 一意。複数 org 所属 user で org 境界が DB 制約に表れない。',
    plannedAction: 'org_id または site_id を含む compound unique に移行する。',
  },
  {
    table: 'PharmacistShiftTemplate',
    constraint: '@@unique([user_id,weekday])',
    fields: ['user_id', 'weekday'],
    category: 'user-scope',
    reason:
      '勤務テンプレートは user/weekday 一意。複数 org 所属 user で org 境界が DB 制約に表れない。',
    plannedAction: 'org_id または site_id を含む compound unique に移行する。',
  },
  {
    table: 'PharmacyDrugStock',
    constraint: '@@unique([site_id,drug_master_id])',
    fields: ['site_id', 'drug_master_id'],
    category: 'site-scoped',
    reason: '薬局在庫は site 配下で一意だが、unique 制約自体に org_id が無い。',
    plannedAction: 'org_id + site_id + drug_master_id の compound unique に移行する。',
  },
  {
    table: 'PharmacyOperatingHours',
    constraint: '@@unique([site_id,weekday])',
    fields: ['site_id', 'weekday'],
    category: 'site-scoped',
    reason: '営業時間は site/weekday 一意だが、unique 制約自体に org_id が無い。',
    plannedAction: 'org_id + site_id + weekday の compound unique に移行する。',
  },
  {
    table: 'PushSubscription',
    constraint: '@unique(endpoint)',
    fields: ['endpoint'],
    category: 'notification-endpoint',
    reason:
      'Web Push endpoint は browser subscription として global 一意。通知 payload は別途 redaction する前提。',
    plannedAction:
      'endpoint hash と org/user scoped dedupe を設計し、raw endpoint の保存・表示境界を snapshot で固定する。',
  },
  {
    table: 'User',
    constraint: '@unique(cognito_sub)',
    fields: ['cognito_sub'],
    category: 'identity-design-review',
    reason:
      'Cognito sub は global identity。User は tenant membership と分離すべき design-review 対象。',
    plannedAction:
      'User を global identity として扱い、Membership/CrossTenantAccessGrant 側で tenant 境界を表す設計へ整理する。',
  },
  {
    table: 'User',
    constraint: '@unique(cognito_username)',
    fields: ['cognito_username'],
    category: 'identity-design-review',
    reason:
      'Cognito username は global identity。User は tenant membership と分離すべき design-review 対象。',
    plannedAction:
      'User を global identity として扱い、Membership/CrossTenantAccessGrant 側で tenant 境界を表す設計へ整理する。',
  },
  {
    table: 'User',
    constraint: '@unique(email)',
    fields: ['email'],
    category: 'identity-design-review',
    reason: 'email は global sign-in identity。複数 org 所属 user を membership で表す前提。',
    plannedAction:
      'User global identity + Membership tenant scope の contract を確定し、User.org_id の扱いを見直す。',
  },
  {
    table: 'VisitHandoffExtraction',
    constraint: '@unique(schedule_id)',
    fields: ['schedule_id'],
    category: 'clinical-child',
    reason: '訪問引継ぎ抽出は schedule に対する一意子レコードだが、org_id が制約に含まれない。',
    plannedAction: 'org_id + schedule_id の compound unique に移行する。',
  },
  {
    table: 'VisitHandoffExtraction',
    constraint: '@unique(visit_record_id)',
    fields: ['visit_record_id'],
    category: 'clinical-child',
    reason: '訪問引継ぎ抽出は visit record に対する一意子レコードだが、org_id が制約に含まれない。',
    plannedAction: 'org_id + visit_record_id の compound unique に移行する。',
  },
  {
    table: 'VisitPreparation',
    constraint: '@unique(schedule_id)',
    fields: ['schedule_id'],
    category: 'clinical-child',
    reason: '訪問準備は schedule に対する一意子レコードだが、org_id が制約に含まれない。',
    plannedAction: 'org_id + schedule_id の compound unique に移行する。',
  },
  {
    table: 'VisitRecord',
    constraint: '@unique(schedule_id)',
    fields: ['schedule_id'],
    category: 'clinical-child',
    reason: '訪問記録は schedule に対する一意子レコードだが、org_id が制約に含まれない。',
    plannedAction: 'org_id + schedule_id の compound unique に移行する。',
  },
  {
    table: 'VisitScheduleOverride',
    constraint: '@unique(replacement_schedule_id)',
    fields: ['replacement_schedule_id'],
    category: 'clinical-child',
    reason: '訪問予定差替は replacement schedule に対する一意関係だが、org_id が制約に含まれない。',
    plannedAction: 'org_id + replacement_schedule_id の compound unique に移行する。',
  },
  {
    table: 'VisitScheduleOverride',
    constraint: '@unique(source_schedule_id)',
    fields: ['source_schedule_id'],
    category: 'clinical-child',
    reason: '訪問予定差替は source schedule に対する一意関係だが、org_id が制約に含まれない。',
    plannedAction: 'org_id + source_schedule_id の compound unique に移行する。',
  },
  {
    table: 'WebhookDelivery',
    constraint: '@@unique([delivery_id,webhook_registration_id])',
    fields: ['delivery_id', 'webhook_registration_id'],
    category: 'webhook-delivery',
    reason:
      'Webhook delivery は registration 配下で一意だが、保存 payload/dispatch の tenant 境界を DB 制約が直接表さない。',
    plannedAction:
      'org_id を含む compound unique へ移行し、delivery payload 最小化/outbox 化と同じレーンで burn-down する。',
  },
];

export const KNOWN_MISSING_TABLES: ReadonlySet<string> = new Set(
  RLS_MISSING_GAPS.map((g) => g.table),
);
export const KNOWN_SSOT_DRIFT_TABLES: ReadonlySet<string> = new Set(
  RLS_SSOT_DRIFT_GAPS.map((g) => g.table),
);
export const KNOWN_NULLABLE_ORG_ID_TABLES: ReadonlySet<string> = new Set(
  RLS_NULLABLE_ORG_ID_GAPS.map((g) => g.table),
);
export const KNOWN_TENANT_UNIQUE_WITHOUT_ORG_CONSTRAINTS: ReadonlySet<string> = new Set(
  RLS_TENANT_UNIQUE_WITHOUT_ORG_GAPS.map((g) => `${g.table}:${g.constraint}`),
);
