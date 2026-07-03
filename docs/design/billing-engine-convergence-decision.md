# 請求エンジン二重化の収束決定（billing-rules ↔ phos/domain/claim）

- 課題ID: **W1-13**（`Plans.md`）。**W2-B1 BillingRequirementCatalog の前提**。旧 C-3。
- 種別: 設計判断（アーキテクチャ収束）。**コード変更なし**（本ドキュメントの作成のみ）。
- 最終ラティファイ: メインループ（本ドキュメントは推奨案を1つ提示する）。
- 関連文書:
  - `docs/operations/billing-revision-runbook.md` §(4)「請求エンジンの二重化」
  - `docs/visit-report-collab-spec.md` §1.2（BillingRequirementCatalog）/ §C-1（課金検証ロジックの所有権）
  - `docs/phos-legacy-api-isolation.md`（PH-OS API 境界）
  - `Plans.md`（W1-13 / W2-B1 / W3-C2 の直列化制約）

---

## 0. 結論（先出し）

**推奨案 = Option C（段階ハイブリッド）**。ただし内実は明確に一方向:

1. **稼働中の算定エンジンは `src/server/services/billing-rules/` に一本化する**（現状追認 + 明示化）。点数・薬価・介護・医療の全改定は billing-rules の revision レジストリのみに載せる（runbook §(4) の既存方針を恒久ルール化）。
2. **`src/phos/domain/claim/` は「AWS ネイティブ v1.1 の目標コントラクト層」として凍結保全する**。破棄しない。ただし現時点で算定生成ロジックの実体をこちらへ二重実装しない。FeeRule 条件 DSL・evidence-requirement 評価・楽観排他の candidate lifecycle は「将来のシリアライズ先／表現形式」として設計資産に留める。
3. **W2-B1 BillingRequirementCatalog は billing-rules（および `billing-requirement-validator.ts`）を土台に構築する**。phos/domain/claim を土台にしない。spec §C-1 のキャップ計算継承要件をここで担保する。

理由の一言要約: **billing-rules だけが「本番配線・患者データからの候補生成・キャップ強制・改定レジストリ・ドメイン網羅」を全て備える唯一の実働エンジン**であり、phos/domain/claim は**未デプロイの足場（scaffold）**で候補生成パイプラインを持たない。今 DSL 側へ全面移送するのは、走らせる実行環境が無いまま巨大な回帰リスクを負う純損失である。一方 phos の DSL/コントラクトは長期的な「形」として優れており、破棄せず目標形として保持する。

---

## 1. 現状分析

### 1.1 二つのエンジンの実体

| 観点                                     | `src/server/services/billing-rules/`                                                                                           | `src/phos/domain/claim/`                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| アーキテクチャ世代                       | 現行アクティブ（Next.js Route Handler / Node runtime / RDS PostgreSQL + Prisma）                                               | 次世代 v1.1 目標（Aurora PostgreSQL + DynamoDB + Lambda + API Gateway）                                                                                                           |
| 実行状態                                 | **本番稼働**（in-process）                                                                                                     | **未デプロイ**。到達経路は `/api/phos/[...path]` プロキシのみで、上流 `PHOS_API_BASE_URL` 未設定時は `503 PHOS_UPSTREAM_NOT_CONFIGURED`。上流実体はテスト環境参照のみで存在しない |
| ルール格納                               | `BillingRule` DB 行（`revisions/` の型付きレジストリからシード）                                                               | Aurora `phos_fee_rule_master` / `phos_fee_rule_versions`（バージョン付き master + DSL condition + evidence_requirements + source_refs）                                           |
| 条件表現                                 | TS ハードコード述語（`chooseBaseRule` / `manualRuleCandidates` の直書き分岐）                                                  | 汎用合成可能 DSL（`EXISTS/EQ/IN/GTE/LTE/AND/OR/NOT`、フィールド allowlist 制）                                                                                                    |
| **候補生成（患者/訪問データ→算定候補）** | **あり**: `buildBillingCandidateSpecs(tx, ctx)` が ~40 フィールドの `BillingEvidenceContext` → `BillingCandidateSpec[]` を生成 | **なし**: `claim-candidates-lambda` は DynamoDB 上の既存候補の search / exclude のみ。ファクトから候補集合を組み立てる機構が存在しない（`grep` で生成ロジック 0 件）              |
| キャップ強制（月/週/特別患者）           | **あり**（`monthly_cap` / `weekly_pharmacist_cap` / `special_*_cap`）                                                          | なし                                                                                                                                                                              |
| base/加算選択・単一建物区分・緊急区分    | **あり**（building tier, online, emergency_category）                                                                          | なし                                                                                                                                                                              |
| 患者条件加算（~20 種）                   | **あり**（麻薬/CVN/経管/乳幼児/小児/かかりつけ/施設基準/地域加算/percent 派生点数 等）                                         | なし（DSL の fact allowlist は 11 フィールドのみ）                                                                                                                                |
| 改定レジストリ + runbook                 | **あり**（medical 2026=1088行 / medical 2024=802行 / care 2024=399行、施行日ベース解決）                                       | 部分的（`revision_code` フィールドはあるがレジストリ/改定運用なし）                                                                                                               |
| evidence 要件→未充足シグナル             | 部分的（`exclusionReason` 文字列）                                                                                             | **構造化**（`missing_evidence_keys[]` + `candidate_status`=EXCLUDED/MISSING_EVIDENCE/READY）                                                                                      |
| candidate lifecycle（排他）              | billing-lock 経由（別 finding N16 で再アサート課題あり）                                                                       | **楽観排他**（`server_version` + `STALE_VERSION`、DynamoDB TransactWrite 条件式）                                                                                                 |
| マルチテナント                           | PostgreSQL RLS（`org_id`）                                                                                                     | `tenant_scope` SYSTEM/TENANT + テナントパーティション                                                                                                                             |
| 実消費者                                 | **~25 箇所**（後述 1.2）                                                                                                       | プロキシのみ（実 UI/アプリ配線ゼロ）                                                                                                                                              |

### 1.2 実結合・利用箇所

**billing-rules（`billing-evidence` 経由で深く配線）** — `buildBillingCandidateSpecs` は `src/server/services/billing-evidence/core.ts:1643` で呼ばれ、`billing-evidence` は以下から利用される:

- API: `billing-candidates`（route / `[id]` / close）, `visit-records`（route / `[id]`）, `care-reports/[id]/send`, `patients/[id]`, `visit-preparations/[scheduleId]`, `visit-schedules/day-board`, `jobs`（route / `[jobType]`）, `visit-schedule-proposals`
- サービス/ジョブ: `server/jobs/daily/billing.ts` / `preparation.ts`, `conference-sync.ts`, `home-care-ops.ts`, `patient-detail-communications.ts`, `pca-rental-billing.ts`, `visit-brief.ts`, `visit-preparation-readiness.ts`
- UI: `billing/billing-check-content.tsx`, `visits/[id]/visit-record-detail.tsx`, `admin/analytics/analytics-content.tsx`

**phos/domain/claim（外部からの実結合は事実上なし）** — 参照元は同一 phos スタック内のみ:

- `src/phos/backend/aurora-fee-rules-repository.ts`（`assertFeeRuleConditionAllowedFields` で DSL 検証）
- `src/phos/backend/claim-candidates-lambda.ts`（`buildExcludedClaimCandidateResponse` で除外 lifecycle）
- これら Lambda は `src/phos/infra/api-gateway-routes.ts` のマニフェスト経由でのみ公開され、`/api/phos/[...path]/route.ts` がプロキシ。**上流実体が未デプロイのため実運用フローは成立していない**。

### 1.3 機能差の要約

- **billing-rules は「厚いドメインエンジン」**: 実際の日本の在宅薬局算定（2024 介護 / 2026 医療改定）の base 選択・キャップ・加算・地域加算・percent 派生を網羅し、患者/訪問/処方データから候補を機械生成する。反面、条件がハードコードで改定差分がコード拡散しやすい（W3-C2 のレジストリ外ハードコード点数問題が併存）。
- **phos/domain/claim は「薄い汎用プリミティブ + 目標コントラクト」**: FeeRule 条件 DSL は合成可能で改定をデータ差し替えで吸収できる優れた「形」。evidence-requirement 評価と楽観排他 lifecycle も本来 billing-rules に欲しい構造。だが**候補生成・キャップ・ドメイン網羅・改定レジストリ・実行環境が全て未完**で、単体では算定できない。

---

## 2. 選択肢

### Option A: billing-rules へ一本化（phos claim を撤去）

- 内容: `src/phos/domain/claim/` の請求関連（feeRuleDsl / claimCandidateLifecycle）を撤去し、billing-rules を唯一の SSOT にする。
- 利点: 二重メンテ完全解消。現行の実働エンジンに集中。
- 欠点: AWS ネイティブ v1.1 目標アーキ（Aurora/DSL/コントラクト）を放棄することになり、`phos/infra` の API 契約・Lambda 群と不整合。DSL/evidence-requirement/楽観排他という**将来 billing-rules に取り込みたい良い形を捨てる**。phos スタック（cards/handoffs/report-deliveries 等）は請求以外で生きており、claim だけ切除すると契約面の穴が空く。

### Option B: phos claim へ移行（Aurora/DSL 次世代へ全面移送）

- 内容: billing-rules のドメインロジック（base 選択・~20 加算・キャップ・改定レジストリ）を FeeRule DSL + Aurora master へ全面移送し、候補生成 Lambda を新規実装。~25 消費者を phos プロキシ経由へ張り替え。
- 利点: 長期的に望ましい表現形式（データ駆動 DSL・バージョン付き master・構造化 evidence）に到達。
- 欠点: **現時点で致命的**。(1) phos 上流が未デプロイ＝走らせる実行環境が無い。(2) 候補生成・キャップ・改定運用を DSL 上でゼロから再実装する必要があり、医療算定の**巨大な回帰リスク**（false-negative = 算定漏れ/取りこぼしは患者・薬局双方に実害）。(3) ~25 の同期 in-process 消費者を HTTP プロキシ越しの非同期呼び出しへ張り替えるのは W2-B1 の遥か手前で破綻する。(4) 11 フィールドの DSL allowlist は現行 ~40 コンテキストフィールドをまだ表現できない。

### Option C: 段階ハイブリッド（推奨）

- 内容:
  1. **billing-rules を現行の唯一実働エンジンとして明示確定**。全改定は billing-rules の `revisions/` のみへ（runbook §(4) を恒久ルール化）。
  2. **phos/domain/claim を「v1.1 目標コントラクト層」として凍結保全**（撤去も拡張もしない）。FeeRule DSL・evidence-requirement 評価・candidate lifecycle は将来の billing-rules 再表現の**目標形**として設計資産に保持。
  3. **W2-B1 BillingRequirementCatalog は billing-rules + `billing-requirement-validator.ts` を土台に構築**。spec §C-1 のキャップ計算（pending proposal 計数・評価対象行除外・Sun–Sat 週境界・累積 tx cap・`excludeScheduleId`）を Catalog/coverage-checker へ継承し回帰テストで担保。
  4. **将来の橋渡し（今回スコープ外・別 Wave）**: billing-rules の revision エントリを FeeRule DSL 形式へ**シリアライズ可能にする**アダプタを、phos 上流が実デプロイされる時点で検討。それまでは billing-rules が正、phos claim は契約の受け皿。
- 利点: 実働エンジンを壊さず W2-B1 を前進できる。良い「形」（DSL/コントラクト）を捨てずに保持。改定二重メンテを avoid（billing-rules 一択）。医療安全上の回帰リスク最小。
- 欠点: 名目上コードは二重に存在し続ける（ただし改定・生成は billing-rules 単独運用なので不整合リスクは運用ルールで封じる）。真の物理的一本化は将来 Wave へ先送り。

---

## 3. 推奨案と根拠（Option C）

**Option C を推奨する。** 判断根拠:

1. **実働性**: billing-rules は ~25 消費者に本番配線され、患者データから算定候補を生成する唯一のエンジン。phos claim は未デプロイ足場で候補生成すら持たない。「収束」を実働側へ寄せるのが唯一安全。
2. **医療安全（false-negative の非対称害）**: 算定判定の取りこぼしは薬局収益と患者負担計算に直結する実害。実証済みの billing-rules ロジック（2024 介護 / 2026 医療の改定網羅）を、走らない DSL へ今移送するのは重大な後退リスク。データ欠損・未確定数値を「算定可」に潰さない fail-close 方針（spec §1.3）も billing-rules 側の revision 隔離で既に運用されている。
3. **W2-B1 の前提整合**: runbook §(4) は「W1-13 決定まで改定は billing-rules へ、phos claim へは反映しない」と既に明記。spec §C-1 は W2-B1 Catalog が `billing-requirement-validator.ts` のキャップ計算を継承すべきと明記。両者とも billing-rules を土台に指している。Option C はこの既定路線を恒久ルール化するもの。
4. **資産保全**: phos の DSL・evidence-requirement 構造・楽観排他 lifecycle は billing-rules に欠けている良い抽象。撤去（Option A）ではなく凍結保全することで、AWS ネイティブ v1.1 が実デプロイされる将来に「目標形」として再利用できる。

---

## 4. W2-B1 BillingRequirementCatalog はどちらを土台にすべきか

**billing-rules を土台にする（+ `billing-requirement-validator.ts`）。phos/domain/claim を土台にしない。**

補足（役割の切り分け）:

- BillingRequirementCatalog は**算定「要件カバレッジ／エビデンスゲート／摘要欄生成」の層**であり、点数計算エンジンそのものではない。現状 4 箇所（`home-visit-2026-evidence.ts` / `billing-rules`(types/rule-engine) / `report-templates.ts` / `billing-requirement-validator.ts`）に分散した要件ロジックを、型付き + codegen（zod→TS）の単一 SSOT へ統合する（spec §1.2）。
- したがって Catalog は billing-rules の**上に乗る**: `requirement_id → capture_paths → report_sections → gate → claim_note_template → payer×revision`。FE（完了ゲート/算定区分提示）と BE（coverage-checker / validator / claim-record-projector）が同一生成物を import。
- **phos の FeeRule DSL は Catalog の「条件表現の参考形」にはなりうるが、土台にはしない**。理由: (a) phos は未デプロイで Catalog の CI property test / 実 zod スキーマ解決（capture_path が実 StructuredSoap/ManagementPlan/VisitInstruction に解決可能か）は in-process の billing-rules 側でしか成立しない、(b) キャップ計算継承（§C-1）の originが billing-requirement-validator にある。
- **§C-1 の必須事項を再掲**: A/P3 が `billing-requirement-validator.ts` に加えたキャップ修正（pending dedupe・`excludeScheduleId`・累積 tx cap・Sun–Sat 週）を、W2-B1 の Catalog 移行で**破棄してはならない**。B/P0 着手時にこれらを Catalog/coverage-checker へ継承し、回帰テストで担保する。

---

## 5. 移行リスクと緩和

| リスク                                                                    | 影響                                    | 緩和                                                                                                                      |
| ------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 名目上の二重存在が残り、将来また改定が phos claim へ誤って入る            | 二重メンテ不整合                        | runbook §(4) を恒久ルール化。改定は billing-rules `revisions/` のみ。phos claim は請求「生成」を持たない受け皿に固定      |
| phos claim を「使われていない」と誤解し撤去                               | v1.1 目標コントラクト喪失               | 本ドキュメントで「凍結保全（撤去禁止）」を明示。`phos/infra` の API 契約・Lambda 群との整合を保つ                         |
| W2-B1 Catalog が billing-requirement-validator のキャップ修正を取りこぼす | 算定取りこぼし（false-negative の実害） | §C-1 継承要件を回帰テスト（敵対ケース: 週境界 TZ / pending 計数 / 除外行）で機械保証                                      |
| 将来の真の一本化（DSL への物理移送）が無期限先送り                        | 技術的負債の固定化                      | 「phos 上流が実デプロイされる時点で billing-rules revision→FeeRule DSL アダプタを検討」を明示的な将来 Wave 条件として記録 |
| W3-C2 レジストリ外ハードコード点数（conference-sync 等）が改定追従しない  | 改定漏れ                                | W3-C2 でレジストリへ吸収するまで runbook §(5) の手動確認箇所を継続監視（本決定と独立）                                    |

---

## 6. 意思決定サマリ（メインループ承認用）

- **決定**: Option C（段階ハイブリッド）。billing-rules = 唯一の実働算定エンジン兼改定 SSOT。phos/domain/claim = v1.1 目標コントラクト層として凍結保全（撤去も拡張もしない）。
- **W2-B1 の土台**: billing-rules + `billing-requirement-validator.ts`（phos claim ではない）。§C-1 キャップ継承を回帰で担保。
- **恒久ルール化**: 全改定は billing-rules `revisions/` のみ（runbook §(4)）。
- **将来条件**: phos 上流が実デプロイされた時点で billing-rules→FeeRule DSL シリアライズアダプタを別 Wave で検討（本決定のスコープ外）。
- コード変更なし。最終ラティファイはメインループ。
