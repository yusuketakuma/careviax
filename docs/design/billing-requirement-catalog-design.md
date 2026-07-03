# BillingRequirementCatalog 設計文書（W2-B1a）

- 課題ID: **W2-B1**（`Plans.md`）。前提 = **W1-13**（`docs/design/billing-engine-convergence-decision.md`、Option C 確定）。
- 種別: **設計のみ**（実装は W3-B2〜B6 の別バッチ）。本ドキュメントはコード変更を含まない。
- 最終ラティファイ: メインループ。
- 関連文書:
  - `docs/design/billing-engine-convergence-decision.md` — billing-rules 土台確定（§0/§4/§C-1 継承要件）
  - `docs/visit-report-collab-spec.md` §1.2（BillingRequirementCatalog）/ §1.3（fail-close 数値運用）/ §2.6（完了ゲート）/ §3.2（coverage-checker + claim-record）/ §8（property test）/ §C-1（キャップ継承）/ CLAIM-01（摘要欄）
  - `docs/operations/billing-revision-runbook.md` §(4)（改定は billing-rules `revisions/` のみ）
- スコープ外（明示）: FeeRule DSL（`src/phos/domain/claim/`）への物理移送、STT/PHI egress、実装コード。

---

## 0. 結論（先出し）

現状 **4 箇所に分散**する算定要件ロジック（`home-visit-2026-evidence.ts` / `billing-rules`(types.ts+rule-engine.ts) / `report-templates.ts` / `billing-requirement-validator.ts`）を、**DB テーブルを追加せず**、`src/lib/billing-catalog/` 配下の**型付き・codegen 済み共有モジュール**（zod スキーマ + そこから生成した TS）へ集約する。Catalog は「算定点数計算エンジン」ではなく、その**上に乗る『要件カバレッジ／エビデンスゲート／摘要欄生成』の SSOT 層**である。

- **点数・回数上限・間隔などの数値は引き続き `billing-rules/revisions/` が SSOT**（W1-13 恒久ルール）。Catalog は数値を持たず、`revision` キーで revisions を参照するのみ（§4）。
- **要件の構造（requirement_id → capture_paths → report_sections → gate → claim_note_template → payer × revision）は Catalog が SSOT**（§3）。
- **§C-1 キャップ計算は破棄せず継承**。`billing-requirement-validator.ts` の cadence 計数ロジック（pending dedupe / excludeScheduleId / 累積 tx cap / Sun–Sat 週境界）は Catalog に取り込まず、**別レイヤ（coverage-checker が呼ぶ cadence モジュール）として温存し、Catalog はその呼び出し要否を requirement metadata で宣言するだけ**にする（§5）。回帰テストは既存 37 ケースを移設せず現行ファイルに保持し、coverage-checker 統合後に上位テストを追加する。

---

## 1. 現状マップ（4 分散の実測）

| #   | ファイル                                               | 行数 | 現在の責務                                                                                                                                                                                                                                   | Catalog 統合後の役割                                                                                                                                                                                       |
| --- | ------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/lib/visits/home-visit-2026-evidence.ts`           | 397  | 訪問完了ゲート（`getMissingHomeVisit2026CompletionItems`）。`HomeVisit2026EvidenceItem[]` を手組みし、`StructuredSoap.home_visit_2026` から医師同時訪問/複数名/初期移行の充足を判定。`billingBlockers` を混ぜてゲート化。FE 完了判定の実源。 | **capture_paths → 充足判定**の実装を Catalog 由来メタに置換。item の `key/label/description/severity` は requirement エントリへ移送。`billingBlockers` 差込は coverage-checker 結果へ統一。                |
| 2a  | `src/server/services/billing-rules/types.ts`           | 289  | `BillingRuleConditions`（~90 条件フラグ）/ `BillingEvidenceRequirements`（11 文書要件）/ `BillingEvidenceContext`（~40 フィールド）/ `BillingCandidateSpec`。                                                                                | **要件の語彙の出所**。`BillingEvidenceRequirements` の各フラグが Catalog の requirement_id に 1:1 で対応（§3.4 のマッピング表）。型自体は billing-rules に残す（rule-engine が参照）。                     |
| 2b  | `src/server/services/billing-rules/rule-engine.ts`     | 339  | `buildBillingCandidateSpecs`。患者/訪問コンテキスト → 算定候補 + `exclusionReason`。base 選択・~20 加算判定・キャップ超過の `exclusionReason` を生成。                                                                                       | **点数・候補生成は現状維持**（Catalog は触らない）。ただし `exclusionReason` の文字列生成のうち「要件未充足」由来のものは、将来 coverage-checker 結果を入力にする（§7 段階移行）。                         |
| 3   | `src/server/services/report-templates.ts`              | 773  | `buildPhysicianReport` / `buildCareManagerReport` / `buildVisitingNurseReport` / `buildFacilityReport`。SOAP・intake → 各様式の `*ReportContent`。どのセクションがどの算定要件を満たすかは**暗黙**。                                         | **report_sections の解決先**。Catalog の `report_sections[].section` が実 `*ReportContent` のキーに解決可能であることを property test で保証（§3.3/§8）。生成ロジック自体は残す。                          |
| 4   | `src/server/services/billing-requirement-validator.ts` | 829  | `validateBillingRequirements`（6 アラート: 月キャップ/薬剤師週/緊急並算/計画書/同意/特別患者週）＋ `getBillingCadencePreview`。cadence 計数（pending dedupe / excludeScheduleId / 累積 / Sun–Sat 週）を内包。                                | **キャップ計算は Catalog に吸わせない**。cadence 計数を独立モジュール化し、Catalog は「この requirement は cadence gate を要する」と**宣言するだけ**（§5）。§C-1 の 4 修正は現行テストで固定したまま温存。 |

補足:

- `report_type` enum（`prisma/schema/communication.prisma:19`）= `physician_report | care_manager_report | facility_handoff | nurse_share | family_share | internal_record`。一方 `AudienceReportAudience`（`care-report-content.ts`）= `visiting_nurse | facility | family`。**enum 命名不一致**（`nurse_share ↔ visiting_nurse`, `facility_handoff ↔ facility`）を Catalog の `ReportType` で正規化する（§3.3、spec §284 の指摘）。
- `StructuredSoap`（`src/types/structured-soap.ts:163`）= `subjective / objective / assessment / plan / residual_medications / home_visit_2026 / handoff / previous_visit_reuse`。capture_paths の解決基盤（§3.2）。
- **VisitInstruction は未実装**（`order_ref` 自由文字列のみ、`prisma/schema/admin.prisma:104`）。KYO-002/ZTK-01 の指示有効期間ゲートは Catalog エントリだけ先に定義し、capture_path は「未実装フィールド参照」として `pending: true` フラグでマーク → CI property test は「pending は future revision に隔離され claimable 計算に関与しない」を検証（fail-close、§1.3/§3.5）。

---

## 2. モジュール配置と生成物

```
src/lib/billing-catalog/
├── schema.ts                  # zod スキーマ（BillingRequirement / CapturePath / ReportSectionRef / ClaimNoteTemplate / GateKind）
├── capture-paths.ts           # CP パスビルダ（enum + discriminated union、生 string 禁止）
├── requirements/
│   ├── medical-2026.ts        # 医療 2026 改定の requirement 群
│   ├── care-2024.ts           # 介護 2024 改定の requirement 群
│   └── index.ts               # 全 requirement 集約 + revision 別解決
├── generated/
│   └── catalog.generated.ts   # codegen 出力（zod.parse 済みの凍結データ + 型）。CI で再生成し diff ゼロを検証
├── resolve.ts                 # requirement 解決（payer × revision × asOfDate）
└── index.ts                   # 公開 API（FE/BE が import する唯一の入口）
```

- **codegen 方針**: 手書きは `requirements/*.ts`（zod オブジェクトリテラル）。`generated/catalog.generated.ts` は `tools/scripts/gen-billing-catalog.ts` が `requirements/` を zod.parse → 凍結 JSON + `as const` 型として書き出す。`pnpm gen:billing-catalog` を追加し、CI は「生成物が最新か（`--check`）」を検証（drift 検出）。生成物を import することで FE バンドルに zod ランタイムを載せず、型のみ共有できる。
- **FE/BE 共有**: `src/lib/` 配下（`@/lib/billing-catalog`）に置き、FE（完了ゲート/算定区分提示）と BE（coverage-checker/validator/claim-record-projector）が**同一生成物**を import（spec §206/§284）。副作用なし・prisma 非依存の純データ + 純関数に限定（FE 取り込み可能性を担保）。

---

## 3. 型設計（zod スキーマ）

### 3.1 BillingRequirement（コア型）

```ts
// schema.ts（設計。実装時に zod で表現）
type GateKind = 'hard' | 'warning';

interface BillingRequirement {
  requirement_id: RequirementId; // 'KYO-002' | 'ZTK-01' | 'CLAIM-01' | ... （spec の要件IDに一致）
  label: string; // 日本語表示名（home-visit-2026-evidence の item.label 由来）
  description: string; // 日本語説明（item.description 由来）
  payer: ('medical' | 'care')[]; // 対象保険
  revision: RevisionKey; // '2026-medical' | '2024-06-care' | '2027-care'（billing-rules revision と 1:1）
  capture_paths: CapturePath[]; // 型安全な discriminated union（§3.2）
  report_sections: ReportSectionRef[]; // 対応報告書セクション（§3.3）
  gate: GateKind; // hard=確定/送付ブロック, warning=助言
  severity: 'urgent' | 'high' | 'normal'; // FE 表示優先度（既存 HomeVisit2026EvidenceSeverity 踏襲）
  cadence?: CadenceGateRef; // キャップ系要件のみ。§5 の cadence モジュールへの委譲宣言
  claim_note_template?: ClaimNoteTemplate; // 摘要欄が要る要件のみ（§3.4、CLAIM-01）
  pending?: true; // capture_path/section が未実装スキーマを参照する暫定エントリ（fail-close, §3.5）
}
```

- `RequirementId` / `RevisionKey` / `ReportType` は string literal union で凍結（typo を型で検出）。
- `revision` は billing-rules の `BillingRevision.code`（`'2024'`/`'2026'` 等）と対応させるため、`{payer}-{code}` 形式の派生キーにし、`resolve.ts` で `resolveBillingRulesForDate` の結果 revision と突合する（§4）。

### 3.2 CapturePath（型安全な discriminated union）

生 string パス禁止。`root`（解決先スキーマ）+ `path`（そのスキーマ内フィールド）を enum で表現し、パスビルダ `CP.*` で構築。

```ts
type CaptureRoot =
  | 'structured_soap'
  | 'management_plan'
  | 'visit_instruction'
  | 'special_patient_status';

interface CapturePath {
  root: CaptureRoot;
  path: string; // 例: 'objective.medication_status'（root ごとに許容 path を型で制約）
  presence: PresenceRule; // 充足判定規則（下記）
}

type PresenceRule =
  | { kind: 'non_empty_text' } // hasText 相当
  | { kind: 'array_has_value' } // hasArrayValues 相当
  | { kind: 'boolean_true' } // Boolean() 相当
  | { kind: 'enum_not_in'; values: string[] } // medication_status !== 'free_text_only' 相当
  | { kind: 'number_gt'; value: number } // residualMedicationCount > 0 相当
  | { kind: 'within_period' }; // visit_date ∈ [valid_from, valid_to]（VisitInstruction）
```

- `CP.structuredSoap.objective.medicationStatus` のようなビルダが `{ root:'structured_soap', path:'objective.medication_status', ... }` を返す。パスは `StructuredSoap` の実キーから codegen した型で制約（存在しないパスはコンパイルエラー）。
- `presence` により、現在 `home-visit-2026-evidence.ts` に散在する `hasText/hasArrayValues/hasMedicationStatus/hasAdverseEventEvidence/hasPolypharmacyEvidence/hasInterventionEvidence` を**宣言的規則**へ移送。coverage-checker が単一の `evaluatePresence(rule, value)` で判定（分岐ロジックのコード拡散を解消）。

### 3.3 ReportSectionRef（報告書セクション参照）

```ts
type ReportType =
  | 'physician_report'
  | 'care_manager_report'
  | 'nurse_share'
  | 'facility_handoff'
  | 'family_share'
  | 'internal_record'; // prisma ReportType に一致

interface ReportSectionRef {
  report_type: ReportType;
  section: string; // 実 *ReportContent のトップレベルキー（例: 'prescriber', 'medication_management'）
}
```

- **正規化**: Catalog は `ReportType`（prisma enum）を正とし、`report-templates.ts` の `AudienceReportAudience`（`visiting_nurse`/`facility`）とのブリッジ表 `AUDIENCE_TO_REPORT_TYPE` を Catalog 内に持つ（`visiting_nurse → nurse_share`, `facility → facility_handoff`, `family → family_share`）。これで enum 不一致を単一箇所へ封じる。
- property test（§8-c）: 全 `report_sections[].section` が対応 `*ReportContent` 型のキーに存在すること（`PhysicianReportContent` = `patient/prescriber/medication_management/adverse_events/functional_assessment/residual_medications/assessment/plan/physician_communication/...`）を型レベルで検証。

### 3.4 ClaimNoteTemplate（摘要欄・CLAIM-01）

```ts
interface ClaimNoteTemplate {
  kind: ClaimNoteKind; // 'building_patient_count' | 'over_16km_reason' | 'emergency_tier_reason'
  //  | 'special_patient_reason' | 'instruction_out_of_period'
  required_inputs: ClaimNoteInputKey[]; // 摘要生成に必要な BillingEvidence フィールド
  // render は generated 側に純関数として持たせず、claim-record-projector が kind で分岐（PHI を Catalog データに焼かない）
}
```

- 設計判断: `render: (e) => string`（spec 例）を**生成データに埋めない**。摘要文字列は患者データ由来（PHI 混入リスク）なので、Catalog は「どの kind の摘要が必要か」「必要入力キー」だけを宣言し、実際の文字列生成は BE の `claim-record-projector`（W3-B4）が `kind` で分岐して行う。**摘要が必要な requirement で入力が欠落 = claimable false**（spec §3.2、摘要欠落ゲート）。
- 対象摘要（CLAIM-01）: 単一建物患者数 / 16km 超の理由 / 緊急訪問 tier 事由 / 特別患者該当事由 / 指示有効期間外の例外事由。

### 3.5 pending（未実装スキーマ参照の fail-close）

VisitInstruction / SpecialPatientStatus など未実装の capture root を参照する requirement は `pending: true`。property test は「`pending` エントリは `gate:'hard'` を持っても claimable 計算に**参加しない**（confirmed になるまで fail-close で算定保留）」を保証（spec §1.3）。これにより Catalog を**先に完成**させ、スキーマ実装（W3 各スライス）で `pending` を外す段階移行が可能。

### 3.4-map. BillingEvidenceRequirements → requirement_id 対応

既存 `BillingEvidenceRequirements`（types.ts）11 フラグの移送先:

| 既存フラグ                                                     | requirement_id（例）       | gate         | capture_root                                                       |
| -------------------------------------------------------------- | -------------------------- | ------------ | ------------------------------------------------------------------ |
| `requires_physician_instruction`                               | KYO-002 / ZTK-01           | hard         | visit_instruction（pending）                                       |
| `requires_management_plan`                                     | KYO-003 / ZTK-02           | hard         | management_plan                                                    |
| `requires_visit_documentation`                                 | RPT-001 / ZTK-09           | hard         | structured_soap                                                    |
| `requires_written_report`                                      | KYO-007 / ZTK-08 / RPT-004 | hard         | structured_soap.plan + report_sections + delivery_proof（pending） |
| `requires_care_manager_report`                                 | REQ-CARE-02                | hard(care)   | report_sections(care_manager_report)                               |
| `requires_medication_management_record`                        | KYO-006                    | hard         | structured_soap.objective                                          |
| `narcotic_management_record`                                   | KYO-014                    | warning→hard | structured_soap.home_visit_2026（narcotic、pending）               |
| `narcotic_injection_management_record`                         | KYO-015                    | warning      | structured_soap（pending）                                         |
| `central_venous_management_record`                             | KYO-016                    | warning      | structured_soap（pending）                                         |
| `narcotic_dealer_license` / `high_care_medical_device_license` | 施設基準系                 | warning      | facility_standards（billing-rules 側 config 参照）                 |

（正確な id/gate は spec §1.1 表 + 各改定 revision の確認事項に従い実装スライスで確定。数値未確定は fail-close。）

---

## 4. revisions レジストリとの関係（点数 = revisions が SSOT、要件構造 = Catalog が SSOT）

- **責務分界**:
  - `billing-rules/revisions/{medical,care}/*.ts` = 点数・回数上限・間隔・加算額・`confirmed` フラグ・source（告示番号）。**数値の SSOT**。
  - `billing-catalog/requirements/*.ts` = requirement の構造（capture/section/gate/claim_note/payer/revision）。**要件構造の SSOT**。数値は一切持たない。
- **結合方法**: Catalog の `revision: '2026-medical'` は `resolveBillingRulesForDate({payerBasis:'medical', asOfDate})` が返す `RevisionEntry.revision.code === '2026'` に対応。`resolve.ts` は asOfDate → 有効 revision code を billing-rules から取得し、その code の requirement 群だけを返す（改定切替に追従）。
- **数値参照が要る局面**（月キャップ超過メッセージ等）は Catalog が数値を保持せず、coverage-checker/validator が `getBillingCadencePolicy()`（`billing-runtime-context`）と `BillingRuleConditions.monthly_cap/special_*` を実行時に読む。Catalog は「cadence gate を要する」宣言のみ（§5）。
- **draft 改定の扱い**: `CARE_2027` は `status:'draft'`。Catalog も対応 requirement を `pending:true` 相当（draft revision 隔離）にし、`resolveRevisionEntryForDate` の `includeDraft` に従わせる。confirmed 昇格は runbook §(4) の人間承認フローに一致させる。

---

## 5. §C-1 キャップ計算の継承方法（最重要・破棄禁止）

A/P3 が `billing-requirement-validator.ts` に加えたキャップ修正を**破棄しない**。設計方針は「**Catalog に計数ロジックを吸わせず、cadence 計数を独立モジュールとして温存し、Catalog はその呼び出しを宣言するだけ**」。

### 5.1 温存する 4 修正（現行実装の位置）

| 修正                                    | 現行実装                                                                                                                                  | 継承先                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| pending proposal 計数 + batch dedupe    | `countProposalRows` / `isCountableProposalRow`（validator L190-244, L620-677）。`proposal_batch_id` 単位で `batch:{id}:{bucket}` dedupe。 | cadence モジュールへ**そのまま移設**（ロジック不変）。                                                                         |
| excludeScheduleId（評価対象行の除外）   | `countScheduleRows({excludeScheduleId})`（L177-188）＋ proposal 側 `reschedule_source_schedule_id !== excludeScheduleId`（L213-217）。    | 同上。呼び出し口の引数は現行 `ValidateBillingRequirementsArgs` を維持。                                                        |
| 累積 tx cap（schedule + proposal 合算） | `monthlyVisitCount = monthlyScheduleCount + monthlyProposalCount`（L678-681）。                                                           | 同上。合算式を cadence モジュールの単一関数に閉じる。                                                                          |
| Sun–Sat 週境界                          | `startOfBillingWeek`（`billing-cadence.ts:26` = `getUTCDay()` オフセットで日曜起点、JST 基準 `japanDateKey` 経由）。                      | `billing-cadence.ts` を SSOT に据え、Catalog/coverage-checker は必ずこれを経由（TZ トラップ回避、memory: JST Date-Boundary）。 |

### 5.2 継承アーキテクチャ

```
BillingRequirement.cadence = {
  kind: 'monthly_cap' | 'pharmacist_weekly' | 'special_patient_weekly' | 'emergency_regular_concurrent',
}
        ↓ 宣言のみ（数値・計数ロジックを持たない）
coverage-checker（W3-B3）
        ↓ cadence.kind を見て委譲
cadence-counter モジュール（= 現 billing-requirement-validator の計数部を抽出・不変移設）
        ↓ getBillingCadencePolicy() + billing-cadence.ts（Sun-Sat 週 SSOT）
BillingRequirementAlert[]（現行と同一の shape・severity）
```

- **移行原則**: `validateBillingRequirements` / `getBillingCadencePreview` の**シグネチャ・返り値 shape・severity を変えない**。内部の計数を `cadence-counter.ts` へ抽出するリファクタに留め、Catalog はゲート宣言を追加するだけ。呼び出し元（visit-schedule-proposals 等 §1.2 の消費者）は無改修。
- **fail-close 継続**: `error` severity（`monthly_cap_exceeded`）は既存 `validateProposalBillingExclusions` のブロック判定を維持。Catalog `gate:'hard'` と severity の対応表を固定（hard ⊇ error を保証）。

### 5.3 回帰テスト計画

- **既存 37 ケース（`billing-requirement-validator.test.ts`）を移設・改変しない**。特に §C-1 直結の 3 ケースを**アンカーテスト**として固定:
  - `counts special weekly caps on Sunday-to-Saturday billing weeks`（L254）
  - `excludes the schedule under evaluation from monthly caps`（L284）
  - `counts open proposal occupancy with batch dedupe before monthly cap validation`（L321）
- cadence 抽出リファクタ（W3-B3）では、抽出後も上記が**同一入力で同一アラート**を返すことを green で確認（振る舞い不変の証跡）。
- **敵対ケース追加**（新規、coverage-checker 統合時）:
  - 週境界: 非東京 TZ（`TZ=America/New_York` / `TZ=UTC`）で env-shift させ、内側で JST 週境界アサート（memory: JST TZ トラップの偽ガード回避）。
  - pending dedupe: 同一 batch 内複数 proposal が 1 件計数 / batch 跨ぎは別計数。
  - 除外行: `excludeScheduleId` 指定時に当該行が month/week 双方から抜けること。
  - 累積上限: schedule 3 + proposal 1 = 4（cap 4）で境界、+1 で `monthly_cap_exceeded`。
- **property test（§8）**: 全 `cadence` 付き requirement が cadence-counter の対応 kind を持つ（hard-gate ⇔ checker 存在の機械保証、spec §8-b）。

---

## 6. FE（完了ゲート）継承

- `getMissingHomeVisit2026CompletionItems`（home-visit-2026-evidence.ts:347）を **Catalog 起点に再実装**（spec §2.6）:
  - 現行の手組み `baseItems`（medication_review / residual / adverse_event / polypharmacy / intervention_plan / after_hours_contact）を、対応 requirement の `capture_paths + presence` から生成。
  - `HomeVisit2026EvidenceItem` の `key/label/description/severity` は requirement メタから射影。`done` は `evaluatePresence` 結果。`required` は `gate==='hard'`。
  - 保険区分別必須差（`payer` フィルタ）・単一建物区分・特別患者該当を requirement の `payer`/`revision`/条件で能動分岐提示。
- **手動 useMemo 新規追加禁止**（React Compiler、memory）。Catalog 解決は純関数、結果は props/derived で受ける。
- **fail-close**: Catalog 解決に失敗（生成物欠損等）した場合は空配列で「算定可」に潰さず、ErrorState/degraded 提示（規約）。完了ゲートは「未取得＝未充足」で保守側に倒す。

---

## 7. 段階移行手順（W3-B2〜B6 との接続）

原則: **Catalog を先に完成 → 各分散を順次『参照差し替え』**。各段階で objective gate（lint/typecheck/test/build）green を維持し、maker/checker 分離（実装と別 supervisor のレビュー）。

| 段階      | 内容                                                                                                                                                                                                                                                                      | 触るファイル                                                             | 依存     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| **W3-B2** | Catalog SSOT 新設（schema.ts / capture-paths.ts / requirements(medical-2026, care-2024) / resolve.ts / codegen + generated）。requirement 毎にサンプル 1 件。§8 property test を CI 追加。**既存 4 分散は無改修**（並存）。                                               | `src/lib/billing-catalog/**`、`tools/scripts/gen-billing-catalog.ts`、CI | W1-13    |
| **W3-B3** | cadence 計数抽出: `billing-requirement-validator.ts` の計数部を `cadence-counter.ts` へ不変移設。§5.3 アンカーテスト green 維持。Catalog の `cadence` 宣言と結線。**§C-1 継承の実体**。                                                                                   | validator（抽出）、`cadence-counter.ts`、既存テスト温存                  | W3-B2    |
| **W3-B4** | coverage-checker 新設 + claim-record-projector 新設。`report-generator.ts` を data-loader/content-projector/billing-coverage-checker/claim-record-projector/persister へ分割（ARCH-8）。「記載有無」→「capture/section カバレッジ」判定へ置換。摘要欠落=claimable false。 | `report-generator.ts`（分割）、coverage-checker、claim-record-projector  | W3-B2/B3 |
| **W3-B5** | FE 完了ゲート差し替え: `getMissingHomeVisit2026CompletionItems` を Catalog 起点へ（§6）。`home-visit-2026-evidence.ts` の presence 判定を Catalog へ委譲。                                                                                                                | home-visit-2026-evidence.ts、visit-record-form 系                        | W3-B2    |
| **W3-B6** | rule-engine の `exclusionReason`（要件未充足由来分）を coverage-checker 結果入力へ接続。pending requirement のスキーマ実装（VisitInstruction / SpecialPatientStatus）が揃い次第 `pending` 解除。                                                                          | rule-engine.ts、prisma schema（承認レーン: schema 変更は別途承認）       | W3-B4    |

- **後方互換**: 各段階で旧 API のシグネチャ/返り値を維持し、消費者（§1.2 の ~25 箇所）を無改修に保つ。差し替えは内部実装のみ。
- **prisma schema 変更（VisitInstruction 等）は承認レーン**。本設計では `pending` で先送りし、schema migration は別バッチ・別承認（規約: DB migration 禁止 without 承認）。

---

## 8. CI property test（機械保証、spec §8）

`src/lib/billing-catalog/__tests__/catalog.property.test.ts`（W3-B2 で追加）で全 requirement を走査:

- **(a) 完全性**: 全 requirement_id が `capture_paths`(≥1) + `report_sections`(≥1 または明示 `[]` 許可要件を allowlist) + `gate` + `payer`(≥1) + `revision` を持つ。
- **(b) hard-gate ⇔ checker 存在**: `gate:'hard'` の全 requirement に、coverage-checker/cadence-counter 側の対応判定が存在（`cadence` 付きは kind が counter に実在、非 cadence は capture presence が評価可能）。
- **(c) 摘要要件 ⇔ template**: 摘要が要る要件（CLAIM-01 系）が `claim_note_template` を持ち、`kind` が claim-record-projector の分岐に実在。
- **(d) capture_path 解決可能**: 全 `capture_paths` の `{root, path}` が実 `StructuredSoap`/`ManagementPlan`/`VisitInstruction` の zod スキーマに解決（未実装 root は `pending:true` 必須 → pending は claimable 非参加を別テストで保証）。
- **(e) codegen drift**: `generated/catalog.generated.ts` が `requirements/` から再生成した内容と一致（`pnpm gen:billing-catalog --check`）。
- **(f) fail-close**: `confirmed:false` 数値（revisions 側）に依存する requirement / `pending:true` requirement は claimable=true を生成しない（保留ステータス）。

---

## 9. リスクと緩和

| リスク                                                       | 影響                         | 緩和                                                                                                           |
| ------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| §C-1 キャップ修正の取りこぼし（false-negative=算定漏れ）     | 薬局収益・患者負担計算の実害 | §5: 計数を Catalog に吸わせず不変移設。§5.3 アンカーテスト固定 + 敵対ケース（TZ/dedupe/除外/累積）で機械保証。 |
| capture_path が stringly-typed に退行                        | 壊れたパスが実行時まで潜伏   | §3.2: enum + パスビルダ + codegen 型制約 + property test(d)。生 string 禁止。                                  |
| VisitInstruction 未実装で hard-gate が空振り or 誤 claimable | 指示期間外算定の素通り       | §3.5: `pending:true` で claimable 非参加（fail-close）。schema 実装は承認レーン別バッチ。                      |
| 数値の二重管理（Catalog に点数が混入）                       | revisions と不整合           | §4: Catalog は数値を持たず revision キー参照のみ。property test で数値フィールド不在を検査（実装時追加）。     |
| enum 命名不一致（nurse_share↔visiting_nurse 等）の漏れ       | 報告書セクション解決失敗     | §3.3: prisma `ReportType` を正、ブリッジ表を Catalog 内単一箇所に封じ property test(c)。                       |
| codegen 生成物の drift（手書きと乖離）                       | FE/BE 参照不整合             | §8-e: `--check` を CI ゲート化。                                                                               |
| 移行途中の並存で二重判定                                     | ゲート二重発火/不一致        | §7: 各段階で旧 API シグネチャ維持・内部差し替えのみ。段階ごとに maker/checker + objective gate。               |
| PHI が Catalog 生成データに焼き込まれる                      | 3省2GL/APPI 違反             | §3.4: 摘要 render を生成データに埋めず、projector が実行時に kind 分岐。Catalog は宣言のみ。                   |

---

## 10. 未確定事項（実装スライスで確定 / 安全側デフォルト）

- 各 requirement_id の正確な gate 種別（hard/warning）と点数・回数の `confirmed` 状態は spec §1.1 表 + 告示原文確認に従う。**未確定は fail-close（算定保留）をデフォルト**（spec §1.3）。
- VisitInstruction / SpecialPatientStatus の prisma schema 形状は承認レーン（本設計は `pending` で先送り）。
- delivery_proof_type（到達証跡）の hard-gate 化（KYO-007）は §3.4-map で `pending`。W3 の delivery 実装スライスで解除。
- codegen ランナーの実装形態（ts-node 直叩き / vitest 経由 emit）は W3-B2 実装時に確定。
