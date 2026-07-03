# 業務ID（display_id）設計文書

- 状態: \***\*ラティファイ済（2026-07-03 fable、ユーザー承認パラメータ準拠）** — 改訂2版。opus critic 2巡（CHANGES_REQUESTED→C1/M1/M2/M3+m1-m4 全解消→APPROVE）。実装順: ID-1 先頭の feasibility spike の結果で E1(extension)/E2(明示採番) を fable が確定する\*\* — 方式・採番・範囲・フォーマットはユーザーラティファイ済（2026-07-03）。critic レビュー（CHANGES_REQUESTED）の裁定を反映: C1=Setting を対象から除外（対象 138 + 除外 1）/ M1=extension 自動付与は feasibility spike を必須ゲートとし、失敗時はリポジトリ層明示採番へ fallback（§4）/ M2=IdSequence は RLS 非対象の内部テーブル（§3.1）/ M3=外部露出ポリシー新設（§7）/ minor m1-m4。§11 の未決事項（表示幅・コピーUI・グローバル検索・超高頻度表の性能影響）は fable ラティファイ時に判断する。
- 対象: Prisma 139 モデル中 **138 モデル**（Setting は §2 の裁定で除外）。DB 主キー cuid は不変のまま、`display_id` カラムを追加して UI/検索/帳票で使用する
- 関連:
  - `docs/design/api-versioning-decision.md`（決定文書スタイルの範）
  - `docs/design/care-report-finalize-lock-design.md`（同）
  - `docs/design/core-naming-conventions.md`（識別子命名規約）
  - `prisma/schema/*.prisma`（139 モデル定義の正本）
  - `src/lib/db/advisory-lock.ts`（既存 advisory lock ヘルパ）
- 補足: 本文書は設計のみ。コード・schema・migration・API 契約は変更しない。DB migration / バックフィル / 監査ログ関連は human approval 前提で、本文書は確定方向と推奨案を整理する。

## 0. 用語

- **cuid**: 現行の DB 主キー（`String @id @default(cuid())`）。不変。FK・URL・内部参照はこれを使い続ける。
- **display_id（業務ID）**: 人間可読の連番 ID。薬局組織（org）ごとに 1 起点で採番し、**org 内部の** UI 表示・検索・帳票（CSV/PDF）で cuid の代わりに露出する（外部送付物には出さない、§7）。PK ではない。FK にも使わない。
- **prefix**: モデルを識別する英字小文字の接頭辞（`[a-z]{1,6}`、モデルごとに一意）。
- **採番スコープ**: 連番のカウンタを分ける単位。org スコープ（薬局組織ごと）と global スコープ（全社共通マスタ）の 2 種。

## 1. フォーマット定義

### 1.1 構造

`display_id` = `prefix` + `zero-padded-sequence`。

- `prefix`: `[a-z]{1,6}`（英字小文字 1〜6 文字、数字で始まらない・数字を含まない）。モデルごとに一意（§2 台帳）。
- `sequence`: 10 進の連番を**標準 10 桁**でゼロ埋めした文字列。1 起点（`0000000001` から）。
- 桁溢れ時（10 桁 = 上限 99 億件を超過）は 11 桁以降へ**自然拡張**する。**フォーマット上限は 15 桁**（= 999,999,999,999,999、約 10^15）とし、パーサはこの範囲を受理する。

標準幅を 10 に固定するのは、UI の桁揃え・ソート・目視比較のしやすさのため。15 桁は「1 テナントで 10 億件を超える AuditLog 等の超高volume表」を将来受け止めるためのフォーマット仕様上の許容であり、初期スキーマは 10 桁を前提に設計してよい（可変長カラムのため桁溢れでも migration は不要）。

**ソート容易性の限界（注記）**: 「同一桁数内では文字列の辞書順 = 数値順」が成り立つのはゼロ埋め幅が揃っている間だけであり、**11 桁越え（桁溢れ）後は辞書順が数値順と一致しなくなる**（例: `p10000000000`（11 桁）は辞書順では `p9999999999`（10 桁）より前に並ぶ）。10 桁を超える運用に入った表では、文字列ソートに頼らず数値部（§1.4 の `value`）でソートすること。

### 1.2 BNF

```
<display-id>   ::= <prefix> <sequence>
<prefix>       ::= <lower> | <lower> <lower> | ... （1〜6 個の <lower>）
<lower>        ::= "a" | "b" | ... | "z"
<sequence>     ::= <digit>{10,15}         ; 標準は 10 桁、上限 15 桁
<digit>        ::= "0" | "1" | ... | "9"
```

### 1.3 正規表現

- 保存・validator（正本、10〜15 桁許容）: `^[a-z]{1,6}[0-9]{10,15}$` に**統一**する。10 桁は生成時フォーマッタの**ゼロ埋め幅**であって validator の長さゲートではない（11〜15 桁も正当な値として保存・受理する。生成側は 99 億件到達まで常に 10 桁を出力する）。
- パース時（キャプチャ付き、同じ受理集合）: `^([a-z]{1,6})([0-9]{10,15})$`
  - キャプチャ 1 = prefix、キャプチャ 2 = ゼロ埋め連番。
  - **貪欲マッチの曖昧性回避**: prefix は「台帳に載っている既知の値」でのみ照合する。数字を含まないため `prefix` と `sequence` の境界は「最初の数字」で機械的に決まる（例 `drug0000000001` → prefix=`drug`, seq=`0000000001`）。台帳外の prefix を持つ文字列は不正 ID として弾く。

### 1.4 パーサ仕様（実装は ID-2 で別途）

```
parseDisplayId(s):
  m = /^([a-z]{1,6})([0-9]{10,15})$/.exec(s)
  if !m: return null
  prefix = m[1]; seq = BigInt(m[2])
  if !PREFIX_REGISTRY.has(prefix): return null     // 台帳外を拒否
  return { prefix, model: PREFIX_REGISTRY.get(prefix), value: seq }
```

- 連番は 15 桁 = 最大 10^15 で `Number.MAX_SAFE_INTEGER`（約 9×10^15）未満だが、演算・比較は `BigInt` を用いて安全側に倒す。DB カラムの `next_value` は `BigInt`（Prisma `BigInt` / Postgres `bigint`）で持つ。

## 2. プレフィックス台帳（対象 138 モデル + 除外 1）

モデル名アルファベット順に schema の全 139 モデルを載せる（**対象 138 + 除外 1 = Setting**）。**一意性は機械検証済み**（§2.1）。対象 138 の全 prefix が `^[a-z]{1,6}$` を満たし、重複ゼロ。

主要 20 モデルには 1 文字 prefix（`p r d v s c b m n e q f h o u t i x w l`）を割り当てた。残り 118 は語感優先の 2〜6 文字。スコープ列 `org` = 薬局組織ごと採番、`global` = 全社共通マスタ（`org_id='__global__'` sentinel、§3.3）、`org (親経由)` = 自モデルに `org_id` 列は無いが親から org を導出する、`除外` = display_id を付与しない。

<div style="overflow-x:auto">

| モデル                           | prefix  | スコープ     | 備考                                                                           |
| -------------------------------- | ------- | ------------ | ------------------------------------------------------------------------------ |
| AuditLog                         | `l`     | org          | 監査ログ（超高頻度・§11 性能未決）。例 l0000000001                             |
| BillingCandidate                 | `b`     | org          | 請求候補（主要20）。例 b0000000001                                             |
| BillingEvidence                  | `bev`   | org          | 請求根拠エビデンス                                                             |
| BillingRule                      | `brul`  | org          | 請求ルール（billing-rules registry）                                           |
| BreakGlassSession                | `bg`    | global       | 運営者break-glassセッション（global）                                          |
| BusinessHoliday                  | `bhol`  | org          | 休業日                                                                         |
| CareCase                         | `cc`    | org          | ケア（療養）ケース                                                             |
| CareReport                       | `c`     | org          | 訪問報告書（主要20）。例 c0000000001                                           |
| CareReportSendRequest            | `crsr`  | org          | 報告書送信リクエスト                                                           |
| CareTeamLink                     | `ctl`   | org          | 多職種ケアチーム連携                                                           |
| ClaimCooperationNote             | `ccn`   | org          | 請求連携メモ                                                                   |
| CommunicationEvent               | `cev`   | org          | 連携イベント                                                                   |
| CommunicationRequest             | `creq`  | org          | 連携リクエスト                                                                 |
| CommunicationResponse            | `cres`  | org          | 連携レスポンス                                                                 |
| CommunityActivity                | `cact`  | org          | 地域活動                                                                       |
| ConferenceNote                   | `cnf`   | org          | 担当者会議記録                                                                 |
| ConsentRecord                    | `cons`  | org          | 同意記録                                                                       |
| ContactParty                     | `cp`    | org          | 連絡先当事者                                                                   |
| ContractDocument                 | `cdoc`  | org          | 契約書類                                                                       |
| CycleHold                        | `chld`  | org          | 服薬サイクル保留                                                               |
| CycleTransitionLog               | `ctlog` | org          | サイクル遷移ログ                                                               |
| DeliveryRecord                   | `dlv`   | org          | 到達／送達記録                                                                 |
| DispenseAudit                    | `dpa`   | org          | 調剤監査（レセコン風4工程 audit）                                              |
| DispenseResult                   | `dpr`   | org          | 調剤結果                                                                       |
| DispenseTask                     | `d`     | org          | 調剤タスク（主要20）。例 d0000000001                                           |
| DispensingDecision               | `dpd`   | org          | 調剤判断                                                                       |
| DocumentDeliveryRule             | `ddr`   | org          | 文書配信ルール                                                                 |
| DrugAlertRule                    | `dar`   | org          | 薬剤アラートルール（hybrid org-scoped、FORCE RLS）                             |
| DrugInteraction                  | `dint`  | global       | 相互作用マスタ（global）                                                       |
| DrugMaster                       | `drug`  | global       | 医薬品マスタ（global、SSK/YJ）。例 drug0000000001                              |
| DrugMasterChangeEvent            | `dmce`  | global       | 医薬品マスタ変更イベント（global）                                             |
| DrugMasterImportLog              | `dmil`  | global       | マスタ取込ログ（global）                                                       |
| DrugPackage                      | `dpkg`  | global       | 薬剤包装（global）                                                             |
| DrugPackageInsert                | `dpki`  | global       | 添付文書（global）                                                             |
| EscalationRule                   | `esc`   | org          | エスカレーションルール                                                         |
| ExternalAccessGrant              | `e`     | org          | 外部共有グラント（主要20）。例 e0000000001                                     |
| ExternalProfessional             | `extp`  | org          | 外部専門職                                                                     |
| Facility                         | `fac`   | org          | 施設                                                                           |
| FacilityContact                  | `facc`  | org          | 施設連絡先                                                                     |
| FacilityStandardRegistration     | `fsr`   | org          | 施設標準登録                                                                   |
| FacilityUnit                     | `facu`  | org          | 施設ユニット（棟・階）                                                         |
| FacilityVisitBatch               | `fvb`   | org          | 施設訪問バッチ                                                                 |
| FileAsset                        | `f`     | org          | ファイル資産（主要20・唯一のUUID採番モデル）。例 f0000000001                   |
| FirstVisitDocument               | `fvd`   | org          | 初回訪問文書                                                                   |
| FormularyChangeRequest           | `fcr`   | org          | 採用薬変更申請                                                                 |
| FormularyTemplate                | `ftpl`  | org          | 採用薬テンプレート                                                             |
| GenericDrugMapping               | `gdm`   | global       | 後発品マッピング（global）                                                     |
| HandoffBoard                     | `hb`    | org          | 引き継ぎボード                                                                 |
| HandoffItem                      | `h`     | org (親経由) | 引き継ぎアイテム（主要20）。org_id列なし→board_id経由でorg導出。例 h0000000001 |
| IncidentReport                   | `x`     | org          | インシデント報告（主要20・x）。例 x0000000001                                  |
| InquiryRecord                    | `i`     | org          | 疑義照会（主要20・i）。例 i0000000001                                          |
| IntegrationJob                   | `ijob`  | org          | 連携ジョブ                                                                     |
| Intervention                     | `itv`   | org          | 薬学的介入                                                                     |
| JahisSupplementalRecord          | `jsr`   | org          | JAHIS補足レコード                                                              |
| LabelDictionary                  | `lbl`   | global       | ラベル辞書（global・keyがすでに@unique）                                       |
| ManagementPlan                   | `mgp`   | org          | 管理計画                                                                       |
| MedicationCycle                  | `mcyc`  | org          | 服薬サイクル                                                                   |
| MedicationIssue                  | `miss`  | org          | 服薬課題                                                                       |
| MedicationProfile                | `m`     | org          | 薬歴プロファイル（主要20）。例 m0000000001                                     |
| Membership                       | `mem`   | org          | 組織メンバーシップ                                                             |
| Notification                     | `n`     | org          | 通知（主要20・高頻度）。例 n0000000001                                         |
| NotificationRule                 | `nrul`  | org          | 通知ルール                                                                     |
| Organization                     | `o`     | global       | 薬局組織（global・採番の親スコープ本体）。例 o0000000001                       |
| PackagingGroup                   | `pkg`   | org          | 一包化グループ                                                                 |
| PackagingMethodMaster            | `pmm`   | org          | 一包化方法マスタ                                                               |
| PartnerPharmacy                  | `ppha`  | org          | 連携薬局                                                                       |
| PartnerVisitRecord               | `pvr`   | org          | 連携先訪問記録                                                                 |
| Patient                          | `p`     | org          | 患者（主要20・@@unique([id,org_id])既存）。例 p0000000001                      |
| PatientCondition                 | `pcnd`  | org          | 患者病態                                                                       |
| PatientFieldRevision             | `pfr`   | org          | 患者項目改訂履歴                                                               |
| PatientInsurance                 | `pins`  | org          | 患者保険                                                                       |
| PatientLabObservation            | `plab`  | org          | 患者検査値                                                                     |
| PatientLink                      | `plnk`  | org          | 患者リンク（薬局間共有）                                                       |
| PatientMcsLink                   | `pml`   | org          | MCS患者リンク                                                                  |
| PatientMcsMessage                | `pmmsg` | org          | MCSメッセージ                                                                  |
| PatientMcsSummary                | `pmsum` | org          | MCSサマリ                                                                      |
| PatientMedicalProcedure          | `pmp`   | org          | 患者医療処置                                                                   |
| PatientNarcoticUse               | `pnar`  | org          | 患者麻薬使用                                                                   |
| PatientPackagingProfile          | `ppp`   | org          | 患者一包化プロファイル                                                         |
| PatientSchedulePreference        | `psp`   | org          | 患者訪問希望                                                                   |
| PatientSelfReport                | `psr`   | org          | 患者自己申告                                                                   |
| PatientShareCase                 | `psc`   | org          | 患者共有ケース                                                                 |
| PatientShareConsent              | `pscon` | org          | 患者共有同意                                                                   |
| PatientShareCorrectionRequest    | `pscr`  | org          | 患者共有訂正依頼                                                               |
| PcaPump                          | `pca`   | org          | PCAポンプ（既存 asset_code は別レイヤ維持）                                    |
| PcaPumpMaintenanceEvent          | `pcam`  | org          | PCAポンプ保守イベント                                                          |
| PcaPumpRental                    | `pcar`  | org          | PCAポンプ貸出                                                                  |
| PcaPumpRentalAccessory           | `pcara` | org          | PCAポンプ貸出付属品                                                            |
| PharmacistCredential             | `phcr`  | org          | 薬剤師資格                                                                     |
| PharmacistShift                  | `phsh`  | org          | 薬剤師シフト                                                                   |
| PharmacistShiftTemplate          | `phst`  | org          | 薬剤師シフトテンプレート                                                       |
| PharmacyContract                 | `phct`  | org          | 薬局契約                                                                       |
| PharmacyContractFeeRule          | `phcf`  | org          | 薬局契約料金ルール                                                             |
| PharmacyContractVersion          | `phcv`  | org          | 薬局契約バージョン                                                             |
| PharmacyCooperationMessage       | `phcm`  | org          | 薬局間連携メッセージ                                                           |
| PharmacyCooperationMessageThread | `phcmt` | org          | 薬局間連携スレッド                                                             |
| PharmacyDrugStock                | `phds`  | org          | 薬局在庫                                                                       |
| PharmacyInvoice                  | `phin`  | org          | 薬局請求書（既存 invoice_no は別レイヤ維持）                                   |
| PharmacyInvoiceItem              | `phini` | org          | 薬局請求書明細                                                                 |
| PharmacyOperatingHours           | `phoh`  | org          | 薬局営業時間                                                                   |
| PharmacyPartnership              | `phpa`  | org          | 薬局パートナーシップ                                                           |
| PharmacySite                     | `phs`   | org          | 薬局拠点                                                                       |
| PharmacySiteInsuranceConfig      | `phsic` | org          | 薬局拠点保険設定                                                               |
| PharmacyVisitRequest             | `phvr`  | org          | 薬局訪問依頼                                                                   |
| PlatformOperator                 | `plop`  | global       | プラットフォーム運営者（global）                                               |
| PrescriberInstitution            | `prin`  | org          | 処方元医療機関                                                                 |
| PrescriptionIntake               | `r`     | org          | 処方受付（主要20・rx_number紙番号は別レイヤ維持）。例 r0000000001              |
| PrescriptionLine                 | `rxl`   | org          | 処方明細行                                                                     |
| PushSubscription                 | `push`  | org          | Push購読                                                                       |
| QrScanDraft                      | `q`     | org          | QRスキャン下書き（主要20）。例 q0000000001                                     |
| Residence                        | `res`   | org          | 居住地                                                                         |
| ResidualMedication               | `rmed`  | org          | 残薬                                                                           |
| SavedView                        | `sv`    | org          | 保存ビュー                                                                     |
| ServiceArea                      | `sarea` | org          | サービスエリア                                                                 |
| SetAudit                         | `seta`  | org          | セット監査（レセコン風 set-audit 工程）                                        |
| SetBatch                         | `s`     | org          | セットバッチ（主要20）。例 s0000000001                                         |
| SetBatchChangeLog                | `sbcl`  | org          | セットバッチ変更ログ                                                           |
| SetPlan                          | `setp`  | org          | セット計画                                                                     |
| Setting                          | —       | 除外         | **業務ID対象外**（C1 裁定）。除外根拠は表直下の段落参照                        |
| SourceOfTruthMatrix              | `sot`   | org          | SoTマトリクス                                                                  |
| Task                             | `t`     | org          | タスク（主要20）。例 t0000000001                                               |
| TaskComment                      | `tc`    | org          | タスクコメント                                                                 |
| Template                         | `tpl`   | org          | テンプレート                                                                   |
| TracingReport                    | `trc`   | org          | トレーシングレポート（服薬情報提供）                                           |
| UatFeedback                      | `uat`   | org          | UATフィードバック                                                              |
| User                             | `u`     | org          | 利用者（主要20）。例 u0000000001                                               |
| VisitBillingCandidate            | `vbc`   | org          | 訪問請求候補                                                                   |
| VisitHandoffExtraction           | `vhe`   | org          | 訪問引き継ぎ抽出                                                               |
| VisitPreparation                 | `vprep` | org          | 訪問準備                                                                       |
| VisitRecord                      | `v`     | org          | 訪問記録（主要20）。例 v0000000001                                             |
| VisitSchedule                    | `vsch`  | org          | 訪問スケジュール                                                               |
| VisitScheduleContactLog          | `vscl`  | org          | 訪問調整連絡ログ                                                               |
| VisitScheduleOverride            | `vso`   | org          | 訪問スケジュール上書き                                                         |
| VisitScheduleProposal            | `vsp`   | org          | 訪問スケジュール提案                                                           |
| VisitScheduleProposalBatch       | `vspb`  | org          | 訪問スケジュール提案バッチ                                                     |
| VisitVehicleResource             | `vvr`   | org          | 訪問車両リソース                                                               |
| WebhookDelivery                  | `whd`   | org          | Webhook配信                                                                    |
| WebhookRegistration              | `whr`   | org          | Webhook登録                                                                    |
| WorkflowException                | `w`     | org          | ワークフロー例外（主要20・w）。例 w0000000001                                  |

</div>

**除外: Setting（C1 裁定）**。`Setting` は `scope SettingScope` + `scope_id String?`（org_id / site_id / user_id のいずれかが入る polymorphic 参照）+ `key` + `value Json` の**内部設定行**であり、ユニーク軸は既に `@@unique([scope, scope_id, key])` で業務的に確立している。人間が電話口で読み上げる・帳票に印字する・検索窓に打ち込むといった業務ID のユースケースが存在せず、org_id 列も持たない（scope_id の解釈が scope 依存）ため org 連番のスコープ解決も polymorphic 分岐を要する。費用対効果ゼロのため display_id を付与しない。prefix `cfg` は将来の誤用防止のため**予約済み・未割当**として台帳管理する（他モデルへ転用しない）。

### 2.1 一意性の機械検証

台帳は本文書生成時に Python スクリプトで検証済み（改訂2版で Setting 除外後に再実行）。検証内容と結果:

- **モデル数**: schema 全体 139（`grep -rh '^model ' prisma/schema/*.prisma | wc -l` と一致）。うち registry 対象 **138**、除外 1（Setting）。
- **正規表現適合**: 対象 138 の全 prefix が `^[a-z]{1,6}$` にマッチ（違反 0 件）。
- **重複**: `Counter(prefix)` で n>1 の要素 0 件。distinct prefix = **138**（= 対象モデル数）。
- **スコープ内訳（実測）**: **org 126 / global 11 / org(親経由) 1（= HandoffItem）/ 除外 1（= Setting）**。global 11 = BreakGlassSession, DrugInteraction, DrugMaster, DrugMasterChangeEvent, DrugMasterImportLog, DrugPackage, DrugPackageInsert, GenericDrugMapping, LabelDictionary, Organization, PlatformOperator。

**実装時の再検証（CI ゲート）**: prefix レジストリ（§4.5）を単一の TypeScript 定数として持ち、以下を単体テストで恒常検証する。(1) 全値が `/^[a-z]{1,6}$/`、(2) `new Set(values).size === entries.length`（重複ゼロ）、(3) レジストリのキー集合 + 明示除外リスト（Setting、予約 prefix `cfg` 含む）の和集合が `prisma/schema` の全モデル名集合と一致（モデル追加時に prefix 未登録を検出、除外は明示宣言を強制）。これによりモデル追加で prefix を付け忘れる／衝突させる退行を landing 前に捕捉する。

### 2.2 命名の原則（将来モデル追加時のガイド）

- prefix は `[a-z]{1,6}`、数字禁止。既存 138 + 予約 `cfg` と衝突しないこと（§2.1 のテストが強制）。
- モデル名の語幹を素直に縮約する（例 `PatientInsurance`→`pins`）。同一語幹で分岐する場合は 2 語目以降を足す（例 `PharmacyContract`→`phct`、`PharmacyContractVersion`→`phcv`）。
- 1 文字 prefix は既存の主要 20 で使い切っているため、新規モデルは 2 文字以上を用いる。
- prefix は**変更しない**（既発行の display_id を壊すため）。統廃合が必要なら旧 prefix を deprecated として台帳に残す。

## 3. 採番機構

### 3.1 IdSequence テーブル

org × prefix ごとにカウンタ行を持つ専用テーブルを新設する。

```prisma
model IdSequence {
  org_id     String   // org スコープは Organization.id、global は '__global__'
  prefix     String   // 台帳の prefix（[a-z]{1,6}）
  next_value BigInt   @default(1)  // 次に払い出す連番（1 起点）
  updated_at DateTime @updatedAt

  @@id([org_id, prefix])
  @@map("id_sequence")
}
```

- 主キー `@@id([org_id, prefix])` で「テナント × モデル」ごとに 1 行。行が無ければ最初の採番時に作る。
- **RLS: 非対象（意図的除外、M2 裁定）**。`org_id` 列は持つが **POLICY を張らない**。理由: グローバルマスタ import（DrugMaster 系の取込ジョブ等）は `withOrgContext` 外・非 tx で走るため、`app.current_org_id` セッション変数の存在を前提とする RLS を張ると fail-close で採番が崩壊する。行の中身は連番カウンタのみで PHI を含まず、テナント越境で漏れる情報も「他 org のカウンタ値」に限られる。
  - 台帳管理: W1-7 の**意図的 RLS 除外リスト**（`prisma/rls-policies.sql` の IntegrationJob 除外コメント `-- IntegrationJob — skip RLS for safety` と同じ流儀）に `id_sequence` を追加し、rls-policies.sql に除外理由コメントを明記する（migration 提案時、human approval）。
  - 代償措置（app 層 scoping）: `IdSequence` へのアクセスは**専用 `allocate` ヘルパー（§3.2 / §4）経由に限定**し、サービス/route からの直接クエリ（`prisma.idSequence.*` / 生 SQL）は規約で禁止する。レビュー/lint（`prisma.idSequence` の grep ゲート）で強制し、ヘルパーは呼び出し元の org スコープ（または `'__global__'`）以外の行に触れないシグネチャにする。

### 3.2 第一案: 単文原子 upsert（ON CONFLICT DO UPDATE ... RETURNING）

採番は 1 SQL 文で原子的に「行を作る or +1 して返す」を行う。**advisory lock 不要**。

```sql
INSERT INTO id_sequence (org_id, prefix, next_value)
VALUES ($org, $prefix, 2)          -- 初回: 1 を払い出し、次は 2
ON CONFLICT (org_id, prefix)
DO UPDATE SET next_value = id_sequence.next_value + 1
RETURNING next_value - 1 AS allocated;   -- 払い出した番号
```

- `INSERT` が成功（初回）した場合は 1 番を払い出す（`VALUES` の `next_value=2` にして `RETURNING next_value-1 = 1`）。
- 競合（2 回目以降）した場合は `DO UPDATE` で `next_value` を +1 し、`RETURNING next_value-1` で払い出す。
- 単一文なので Postgres が行ロックを取り原子実行する。同一 (org, prefix) への concurrent INSERT は直列化され、**採番の飛びや重複は発生しない**。
- N 件一括採番（createMany）は `next_value = next_value + N` にして `[old, old+N)` の範囲を割り当てる（§4.6）。

### 3.3 グローバル表の sentinel 行

`org_id` を持たないモデル（global 11 種、§2.1）は、採番カウンタも全社共通で 1 本にする必要がある。`IdSequence` に `org_id = '__global__'` の sentinel 行を用いる。

- `'__global__'` は Organization.id（cuid）と衝突しない予約文字列。cuid は `[a-z0-9]` の固定形式で `_` を含まないため安全。
- global 採番の実行コンテキスト: `IdSequence` は RLS 非対象（§3.1）のため、グローバルマスタ import のように **`withOrgContext` 外・非 tx のコンテキストからでも、`'__global__'` 行への単文 upsert（§3.2）がそのまま動く**。org セッション変数は不要。アクセスは §3.1 の専用ヘルパー経由に限定する。
- **HandoffItem（org 親経由）**: 自モデルに `org_id` 列は無いが、親 `HandoffBoard.org_id` から org を導出できる。sentinel ではなく親の org でカウンタを引く（§4.7）。導出元が確定できないコンテキストで作成される可能性がある場合のみ global fallback を検討するが、現状 HandoffItem は必ず board 配下で作られるため親 org で採番する。

### 3.4 欠番の許容

`IdSequence.next_value` の +1 は採番時点で確定するため、**採番後に tx がロールバックすると番号が欠番になる**。

- upsert（§3.2）は autonomous な単文だが、呼び出し側の interactive tx がロールバックした場合、行 INSERT 自体は同一 tx 内なら巻き戻る（= 欠番も起きない）／別 tx 相当なら欠番が残る。本設計は**採番を親エンティティ作成と同一 tx 内で行う**（§4.8）ため、親作成が失敗して tx がロールバックすれば採番も巻き戻り、この場合は欠番は残らない。
- ただし createMany の範囲割当や、部分的コミットを伴うバッチでは欠番が生じうる。**業務上、display_id の連番は「一意な業務識別子」であって「件数の連続保証」ではない**。欠番があっても患者番号・処方番号としての用途（検索・照合・帳票表示）に支障はない。連続性を要件とする会計連番（請求書の invoice_no 等）とは役割が異なる（§9 非ゴール）。この方針を明記し、欠番を許容する。

## 4. 自動付与機構（条件分岐設計）

付与機構は 2 案の条件分岐とする（M1 裁定）。**案 E1**（Prisma Client Extension 自動付与）は技術的成立性が未実証のため、**ID-1 の先頭に feasibility spike を必須ゲート**として置き、spike の判定基準を満たした場合のみ E1 を採用する。不成立なら**正式 fallback = 案 E2**（リポジトリ層明示採番）へ切り替える。§3 の採番機構・§5 の schema・§6 のバックフィルは両案で共通。

### 4.1 必須ゲート: feasibility spike（ID-1 の先頭タスク）

- **目的**: Prisma 7.8 の client extension `query.$allModels.create` フックの内側から、当該 create と**同一の interactive tx 接続**で `id_sequence` への upsert（`$executeRaw`）を発行できることを最小構成で実証する。query extension フックは `{ model, operation, args, query }` を受け取るが、**tx にバインドされた client への公式な参照を提供しない**。ここが本設計最大の技術リスクであり、実証なしに E1 を前提としてはならない。
- **spike 内容（最小構成）**: 使い捨てモデル or 既存 1 モデル + `id_sequence` 相当の一時テーブルで、(a) `prisma.$transaction(async (tx) => tx.<model>.create(...))`、(b) 非 tx の `prisma.<model>.create`、(c) `createMany`、(d) `withOrgContext` 配下、の 4 経路を通す。
- **判定基準（全て満たせば E1 採用。1 つでも不成立なら E2 へ fallback）**:
  1. interactive tx 内の create でフックが発火し、フック内から**同一 tx 接続**で upsert を発行できる。tx を意図的にロールバックさせたとき **upsert も巻き戻る**（= 別接続に漏れていない）ことをテストで実証する。
  2. 非 tx の create でも採番→create が動作する（この経路の欠番は §3.4 で許容済み）。
  3. `createMany` フックで `args.data[]` の各行へ display_id を注入できる。
  4. `withOrgContext` の RLS セッション変数（`SET LOCAL app.current_org_id`）と干渉しない（採番 upsert が RLS 非対象テーブル相手でも、同一 tx 上の後続クエリの RLS が壊れない）。
- **成果物**: spike 結果（成立/不成立と証跡）を本文書に追記し、E1/E2 の確定は fable ラティファイで行う。

### 4.2 案 E1: Prisma Client Extension 自動付与（spike 成功時）

`display_id` の付与を Prisma Client Extension（`$extends`）の `query.$allModels.create` / `createMany` フックで行う。registry 登録モデルの create 経路には広く自動適用されるが、**§4.1 の全基準成立が採用の前提**であり、入れ子 create（relation 経由）・生 SQL・`createManyAndReturn` 等のフック外経路は別途確認を要する。

```ts
prisma.$extends({
  query: {
    $allModels: {
      async create({ model, args, query }) {
        const prefix = PREFIX_REGISTRY.byModel(model);
        if (!prefix) return query(args); // registry 外はスキップ
        if (args.data.display_id) return query(args); // 明示指定は尊重（移行・seed 用）
        const orgId = resolveOrgScope(model, args); // org or '__global__'（§4.7）
        const seq = await allocate(txClient(), orgId, prefix, 1); // §3.2 ※txClient() の成立が spike の主題
        args.data.display_id = format(prefix, seq); // prefix + zero-pad(10)
        return query(args);
      },
      async createMany({ model, args, query }) {
        /* §4.6 */
      },
    },
  },
});
```

### 4.3 案 E2: リポジトリ層明示採番（spike 失敗時の正式 fallback）

`withOrgContext` 系ヘルパー **`allocateDisplayId(tx, model, orgId)`**（`src/lib/db/` 配下、§3.1 の専用 allocate を包む）を、create の**呼び出し側で明示利用**する。

```ts
await withOrgContext(orgId, async (tx) => {
  const display_id = await allocateDisplayId(tx, 'Patient', orgId);
  const patient = await tx.patient.create({ data: { ...input, display_id } });
});
```

- 同一 tx 内採番なのでロールバック時の欠番なし（§3.4）は E1 と同等に成立する。
- global スコープは `allocateGlobalDisplayId(client, model)`（非 tx 可、`'__global__'` 行、§3.3）。
- 一括投入は `allocateDisplayIdRange(tx, model, orgId, n)` で範囲確保し、呼び出し側が各行へ割り当てる（§4.6）。
- **適用は主要 create 経路から段階導入する**（Patient / PrescriptionIntake / DispenseTask / VisitRecord / CareReport 等、§5.3 の波に対応）。全 create 箇所の一括改修は行わず、未適用経路で作られた行は display_id NULL のまま → 定期バックフィル（§6 の流儀）で補完し、NULL 残存率を監視する。

### 4.4 E1 / E2 の比較（適用範囲・呼び出し側負担）

| 観点                            | E1: extension 自動付与                                                           | E2: リポジトリ層明示採番                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 技術的成立性                    | **未実証**（フック内で同一 tx 接続を取得する公式 API が無い。§4.1 spike が必須） | 既存 `withOrgContext` パターン内で完結。リスク低                                                |
| 適用範囲                        | registry 登録モデルの create/createMany 経路へ一括適用（フック外経路を除く）     | 改修した create 呼び出し箇所のみ。段階導入で徐々に拡大                                          |
| 呼び出し側負担                  | 原則変更なし（明示指定 `display_id` は尊重される）                               | 各 create 箇所に allocate 呼び出し + data への 1 フィールド追加（1〜2 行/箇所 × create 箇所数） |
| 付与漏れ                        | 起きにくい（自動）。フック外経路のみ注意                                         | 未改修経路は NULL → バックフィル + NULL 監視で補足                                              |
| tx 整合（欠番なしロールバック） | spike 基準 1 の成立が条件                                                        | 構造的に成立（呼び出し側が同一 tx を渡す）                                                      |
| createMany                      | フック内で範囲割当                                                               | `allocateDisplayIdRange` を呼び出し側で明示                                                     |
| デバッグ容易性                  | フックの暗黙動作で追いにくい                                                     | 採番が呼び出しコードに現れ追いやすい                                                            |

### 4.5 prefix レジストリ

台帳（§2）を単一の TypeScript 定数として持つ。モデル名 → { prefix, scope }。E1/E2 どちらでも共通に使う。

```ts
export const DISPLAY_ID_REGISTRY = {
  Patient: { prefix: 'p', scope: 'org' },
  PrescriptionIntake: { prefix: 'r', scope: 'org' },
  DrugMaster: { prefix: 'drug', scope: 'global' },
  HandoffItem: { prefix: 'h', scope: 'orgViaParent', parent: 'HandoffBoard' },
  // ... 138 件（Setting は除外、prefix 'cfg' は予約済み・未割当）
} as const;
```

- §2.1 の CI テストがこの定数の一意性・全網羅（除外の明示宣言込み）・regex を強制する。
- registry に載っていないモデルには display_id を付与しない（= 段階導入時に未対応モデルを安全にスキップ）。対象 138 を段階的に登録していく（§5 の波と対応）。

### 4.6 createMany の N 件採番

`createMany({ data: [...] })` は N 件を 1 回の SQL で入れるため、採番も N 件分をまとめて確保する。

- `allocate(tx, org, prefix, N)`: §3.2 の upsert を `next_value = next_value + N` にして `RETURNING next_value - N AS first` を返す。払い出し範囲は `[first, first + N)`。
- 各 data 行に `first + i` を昇順で割り当てる（配列の並び順に一致させる）。
- org スコープが行ごとに異なる createMany（複数 org 混在）は、org ごとに N を集計して別々に allocate する。実務上 createMany は単一 org の一括投入がほとんどだが、混在ケースを registry の scope で判定して分割する。
- **HandoffItem（orgViaParent）の createMany**: 行ごとに `board_id` が異なりうるため、**per-row で board_id → HandoffBoard.org_id の解決**が必要（distinct board_id を先にまとめて 1 クエリで引き、行→org を map してから org ごとに範囲確保する）。単一 org 前提の一括 allocate をそのまま適用してはならない。

### 4.7 org スコープの解決

`resolveOrgScope(model, args)`（E1 ではフック内、E2 では allocateDisplayId の引数検証として使用）:

- scope=`org`: `args.data.org_id` を使う（E2 では呼び出し側が orgId を明示渡し）。未指定なら現行の org セッションから補完。
- scope=`global`: `'__global__'` を使う。
- scope=`orgViaParent`（HandoffItem）: `args.data.board_id` から親 `HandoffBoard.org_id` を同一 tx で引く。親が同一 tx で作られる入れ子 create の場合は connect/create の解決順に注意（親の org を先に確定させる）。createMany は §4.6 の per-row 解決。

### 4.8 トランザクション境界の扱い

- **E1**: 採番 upsert は必ずフックに渡された query 実行と同じ tx 接続で行う（これが可能かどうか自体が §4.1 spike の判定基準 1）。別の `prisma` グローバルクライアントで採番すると tx 境界がずれ、ロールバック時に欠番が残る。
- **E2**: 呼び出し側が `withOrgContext` の `tx` を `allocateDisplayId` に渡すため、採番と親エンティティ作成が構造的に同一 tx へまとまる。ロールバック時は採番も巻き戻る（§3.4）。
- どちらの案でも、`withOrgContext` 配下の create は RLS セッション変数 `app.current_org_id` が同 tx で有効なまま採番される（`id_sequence` 自体は RLS 非対象、§3.1）。

### 4.9 既存 advisory lock との関係

`src/lib/db/advisory-lock.ts` の `acquireAdvisoryTxLock(tx, namespace, key)` は read→check→write の TOCTOU をアプリ層で塞ぐ既存ヘルパ。**§3.2 の単文 upsert 方式では採番に advisory lock は不要**（単一 SQL 文が原子的に直列化するため）。代替案（§10 の Option B）でのみ使用する。

## 5. スキーマ変更（段階導入）

### 5.1 各モデルへの列追加

```prisma
// org スコープモデル（例: Patient）
model Patient {
  // ... 既存フィールド
  display_id String?  // nullable 導入 → バックフィル → 将来 NOT NULL

  @@unique([org_id, display_id])   // テナント内一意
}

// global スコープモデル（例: DrugMaster）
model DrugMaster {
  // ... 既存フィールド
  display_id String? @unique       // 全社一意
}
```

- org スコープ: `@@unique([org_id, display_id])`。テナント内で一意。異なる org 間で同じ `p0000000001` が並存するのは意図通り（org ごと 1 起点連番）。
- global スコープ（11 種）: `@unique`。全社で一意。
- HandoffItem（org 親経由）: `org_id` 列が無いため `@@unique([org_id, display_id])` は張れない。選択肢は (a) `org_id` 列を非正規化追加してユニーク制約を張る、(b) `@unique`（display_id 単独、prefix=`h` で全社一意になるよう global カウンタ化する）。§3.3 の方針では親 org 採番のため (a) が整合的だが、`org_id` 列追加のコストと引き換え。→ **§11 未決**（HandoffItem のユニーク制約軸）。初期は nullable 導入のみで制約は保留可。

### 5.2 3 段階のライフサイクル

| 段階                       | 状態                 | 内容                                                                                                                                               |
| -------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. nullable 導入**       | `display_id String?` | 列 + ユニーク制約（partial: NULL 許容）を追加。registry へ登録し、採番機構（§4 の E1 または E2）が以後の新規行に付与。既存行は NULL。              |
| **2. バックフィル**        | 既存行を採番         | §6 のスクリプトで org ごと `created_at, id` 順に採番して埋める。`IdSequence.next_value` はバックフィル済みの最大値 +1 に設定。                     |
| **3. NOT NULL 化（将来）** | `display_id String`  | 全行埋まったことを検証後、`NOT NULL` 制約へ昇格。**human approval 前提**。段階 3 は全モデルの段階 2 完了後、性能・運用が安定してから別途判断する。 |

- ユニーク制約は段階 1 から張る（NULL は Postgres で重複可なので nullable でも成立）。ただし partial unique index（`WHERE display_id IS NOT NULL`）にするか通常 unique にするかは Postgres の NULL 扱い（NULL は unique 制約で複数許容）で自然に両立するため通常 unique で可。

### 5.3 migration の波分割（5〜7 波）

対象 138 モデルへの列追加を 1 migration で行うとロック時間・レビュー負荷が過大になる。ドメイン境界（schema ファイル）で 5〜7 波に分割する。

| 波  | 対象ドメイン（schema ファイル）                                                                | 目安モデル数 |
| --- | ---------------------------------------------------------------------------------------------- | ------------ |
| W1  | patient.prisma（Patient 系）                                                                   | ~24          |
| W2  | prescription.prisma（処方・調剤・セット）                                                      | ~22          |
| W3  | visit.prisma + communication.prisma（訪問・連携・報告書）                                      | ~30          |
| W4  | organization.prisma（組織・施設・薬剤師）                                                      | ~20          |
| W5  | pharmacy-partnership.prisma（薬局間連携・契約・請求書）                                        | ~24          |
| W6  | admin.prisma + drug.prisma + platform.prisma（管理・マスタ・運営、Setting は除外のため対象外） | ~29          |
| W7  | medication.prisma + pca-pump.prisma + core-task.prisma + saved-view.prisma（残余）             | ~11          |

- 各波: (1) 列 + ユニーク制約追加 migration、(2) registry へ当該モデルを登録（自動付与開始）、(3) バックフィルスクリプト実行、(4) 検証。波内でこの順を守れば、登録前に作られた行だけがバックフィル対象になる。
- 波の粒度・順序は実装時に調整可。患者・処方など UI 露出が最も多いドメインを先行させる（ID-3 の効果が早く出る）。

## 6. バックフィル設計

既存行に display_id を後付けする。migration-verify-template（`tools/scripts/migration-verify-template.ts`）の pre/post check 流儀に従う。

### 6.1 採番順序

- org スコープ: org ごとに `ORDER BY created_at ASC, id ASC` で全行を走査し、1 から連番を振る。`created_at` 同値の tie-break に `id`（cuid）を使い決定的にする。
- global スコープ: 全行を `created_at ASC, id ASC` で 1 から連番。
- HandoffItem: 親 HandoffBoard の org ごとに `created_at, id` 順で採番（§5.1 の制約方針が確定してから）。

### 6.2 スクリプト構造（pre / apply / post）

```
pre:
  - 対象モデルの総行数、display_id IS NULL 件数を記録
  - IdSequence に当該 (org, prefix) 行が無い（or next_value=1）ことを確認
apply（org ごと、tx 内）:
  - SELECT id FROM <table> WHERE org_id=$org ORDER BY created_at, id
  - i=1..N: UPDATE <table> SET display_id = format(prefix, i) WHERE id=$id
  - IdSequence upsert: next_value = N+1  （以後の自動採番が続きから振る）
post:
  - display_id IS NULL 件数 = 0 を確認
  - (org_id, display_id) の重複 0 を確認（GROUP BY ... HAVING count>1 が空）
  - 各 org の max(display_id 連番) + 1 == IdSequence.next_value を確認
  - サンプル行の display_id が validator regex ^prefix[0-9]{10,15}$ に一致（§1.3。バックフィル生成分は常に 10 桁）
```

- 大量行モデル（AuditLog 等）はバッチ UPDATE（例 org ごと・1 万行単位）で長時間ロックを避ける。バックフィル中の新規行は採番機構（§4）が続きの番号を振るため、`IdSequence.next_value` の設定タイミングをバックフィル完了直後にして番号衝突を防ぐ（バックフィル中は registry 未登録にしておき、完了後に登録 → 自動採番開始、の順が最も安全）。
- 冪等性: `WHERE display_id IS NULL` のみ対象にし、再実行で既採番行を上書きしない。

## 7. 外部露出ポリシー（M3 裁定）

**display_id は org 内部の UI・内部 CSV・内部帳票のみに表示する。外部送付物には出さない。**

- **内部（表示する）**: ログイン中の org メンバーが見るダッシュボード/一覧/詳細画面、org 内部向け CSV export（患者一覧・監査ログ等）、org 内部で完結する帳票・印刷物。
- **外部（出さない）**: パートナー薬局・医師・ケアマネ等の外部関係者へ送付する PDF（報告書送付版・請求書送付版等）、外部共有画面（external-access の患者/家族向けビュー、外部専門職ビュー）、partner 経由の response payload（薬局間連携 API・共有ケースの相手方に返すデータ）。これらは**従来どおり cuid ベース、または識別子表示なし**を維持する。
- **理由**: display_id は org ごとの 1 起点連番であり、外部に出すと**連番からの列挙可能性**が生じる。具体的には、外部関係者が受け取った `p0000012345` から当該薬局の患者総数・患者/処方の増加率（German tank problem）を推定でき、要配慮個人情報を扱う医療システムとして 3省2ガイドライン（安全管理・最小開示）/ APPI の観点で許容できない情報漏洩チャネルになる。cuid はランダムで件数情報を持たないため外部面では cuid を維持する。
- **運用規約**: 外部送付物を生成するコード（送付版 PDF レンダラ・external-access 系 route・partner response serializer）では display_id フィールドを serialize 対象に含めない。ID-3 のレビュー観点に「外部面へ display_id が漏れていないか」を必須項目として加える。

## 8. UI / 露出面の置換対象（ID-3 スコープ）

現在 cuid を UI/帳票に露出している箇所のうち、**§7 の内部面のみ**を display_id へ置換する。これは本設計（ID-1: 採番機構、ID-2: パーサ/フォーマッタ）の後段タスク **ID-3** として別途実施する。以下は 2026-07-03 実測の置換対象。

### 8.1 UI の cuid 疑似短縮（`id.slice(-8)` / `slice(0,8)`）— 内部面・置換対象

`grep -rEln 'slice\(-8\)|slice\(0, ?8\)' src` で検出。display 用途のもの（下記）を display_id 表示へ置換する。非 display 用途（`src/lib/aws/sigv4.ts` の署名計算、`src/lib/hooks/use-yjs-collaboration-room.ts` の room key 等）は対象外。

- `src/app/(dashboard)/admin/realtime/page.tsx`
- `src/app/(dashboard)/my-day/my-day-content.tsx`
- `src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.tsx`
- `src/app/(dashboard)/prescriptions/[id]/prescription-detail-content.tsx`
- `src/app/(dashboard)/prescriptions/new/prescription-intake-form.tsx`
- `src/app/(dashboard)/prescriptions/prescription-inline-detail.tsx`
- `src/app/(dashboard)/prescriptions/qr-drafts/[id]/page.tsx`
- `src/app/(dashboard)/schedules/day-view.shared.ts`
- `src/app/api/visit-preparations/[scheduleId]/route.ts`
- `src/components/features/visits/visit-medication-management-section.tsx`
- `src/components/visit-brief/visit-brief-card.tsx`
- `src/lib/navigation/recent-operations.ts`
- `src/server/services/partner-visit-report-drafts.ts`
- `src/server/services/pharmacy-invoices.ts`
- `src/server/services/visit-brief.ts`
- `src/server/services/workflow-dashboard-sections.ts`

（recon ドラフトの「7 ファイル」は display 用途に絞った初期集計。上記は `slice` 全ヒットから display 面を洗い出した拡張集合で、ID-3 実装時に各ヒットが display か内部処理かを個別確認する。`src/server/services/partner-visit-report-drafts.ts` 等 partner 面に接する箇所は、置換前に §7 の内部/外部判定を先に行うこと。）

### 8.2 CSV / PDF の生 cuid 露出（§7 に従い内部/外部で二分）

**内部面（display_id へ置換する）**:

- CSV: 患者 export、監査ログ export（`src/server/services/export-audit.ts` の `target_id`/`actor_id` 等が cuid のまま出力される箇所）。いずれも org 内部の運用者向け export であり、display_id 列を追加 or 置換する。
- PDF（org 内部で完結する版）: 内部確認用の報告書 PDF・請求書 PDF の画面プレビュー/控え。cuid ではなく display_id を識別子として印字する。請求書番号 `invoice_no` は別レイヤの外部番号として維持（§9）。

**外部面（置換非対象、§7 ポリシーにより display_id を出さない）**:

- 外部送付版 PDF: パートナー薬局・医師・ケアマネ等へ送付する報告書 PDF・請求書 PDF の送付版（`src/server/services/pdf-pharmacy-invoice.tsx` 等が外部送付経路で使われる場合の出力面）。従来どおり cuid ベース or 識別子なし + `invoice_no` 等の既存外部番号を使用。
- 外部共有画面: external-access（患者/家族向け）・外部専門職ビュー。
- partner 経由 response: 薬局間連携 API・共有ケースで相手薬局へ返す payload。

## 9. 非ゴール

- **PK 置換**: cuid 主キーは変更しない。display_id は PK にしない。
- **FK での display_id 使用**: 全ての外部キー参照は cuid のまま。display_id はリレーションに使わない。
- **既存外部番号の置換**: `PrescriptionIntake.rx_number`（紙処方箋の手入力番号）、`PharmacyInvoice.invoice_no`（会計連番）、`PcaPump.asset_code`、`Organization.corporate_number` は独立した業務番号レイヤとして display_id と**共存**する。display_id はこれらを置き換えない。
- **QR / 外部共有 payload の変更**: QR コード内容、external-access トークン、外部共有リンクの payload は cuid ベースのまま。display_id を埋め込まない（外部契約の安定性のため）。
- **URL ルーティングの変更**: `/patients/[id]` 等の URL segment は cuid のまま。display_id を URL に使うかは §11 未決（グローバル検索での解決とは別）。
- **会計的な連番連続性の保証**: display_id は欠番を許容する（§3.4）。連続性が法令要件となる番号は別途 invoice_no 等で担保する。

## 10. Option 比較（採番方式）と推奨

| 観点                   | A: ON CONFLICT 単文 upsert                               | B: advisory lock + read/insert                      | C: Postgres SEQUENCE ×（138×org）                                    |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| 原子性                 | 単一 SQL 文が原子。競合は行ロックで直列化                | tx advisory lock で直列化。lock→read→insert の 3 段 | SEQUENCE は原子。ただし org×prefix ごとに動的生成が必要              |
| org ごと連番           | `IdSequence` 行で自然に分離                              | 同左                                                | org ごとに SEQUENCE を動的 CREATE（138×N org = 数千〜数万 SEQUENCE） |
| 実装複雑度             | 低（1 文 + registry）                                    | 中（既存 advisory-lock 流用だが 3 段手続き）        | 高（SEQUENCE の動的管理・命名・DROP／テナント作成時の一括生成）      |
| ロールバック時の欠番   | 親作成と同一 tx なら巻き戻る（欠番なし）／別 tx なら欠番 | 同左                                                | SEQUENCE は tx 非依存で必ず欠番（nextval は巻き戻らない）            |
| 連番の稠密性           | 高（欠番は tx rollback 時のみ）                          | 高                                                  | 中（nextval キャッシュ・rollback で欠番増）                          |
| createMany の N 件確保 | `+N` で範囲割当（1 文）                                  | lock 内で `+N`                                      | `nextval` を N 回 or `setval` 併用                                   |
| テナント増加への追従   | 行を足すだけ（DDL 不要）                                 | 同左                                                | テナント作成時に 138 SEQUENCE を CREATE（運用重い）                  |
| 超高頻度表の競合       | 行ロック競合はホットスポット化しうる（§11 性能未決）     | lock 競合で同様のホットスポット                     | SEQUENCE は競合最小（キャッシュ）だが欠番増                          |

**推奨: A（ON CONFLICT 単文 upsert）。**

理由:

1. **DDL 不要でテナント増に追従**: org 追加時に SEQUENCE を大量生成する C の運用コストを負わない。`IdSequence` は行を足すだけ。
2. **原子性を単文で担保し advisory lock を不要化**: B の 3 段手続き（lock→read→insert）より実装が単純で、既存の `withOrgContext` tx にそのまま乗る。
3. **欠番を最小化しつつ許容**: 親作成と同一 tx 内採番（§4.8）でロールバック時は採番も巻き戻るため、C の「SEQUENCE は必ず欠番」より稠密。かつ §3.4 の通り欠番自体は業務上許容。
4. **B は代替**: 将来 `IdSequence` 行ロックが超高頻度表でホットスポット化した場合、採番を親 tx から切り離す（別接続で先行採番）際に advisory lock パターンへ寄せる余地を残す。§11 の性能検証結果次第で B を部分採用しうる。

## 11. 未決事項（fable ラティファイ時に判断）

1. **表示幅**: UI で常に 10 桁ゼロ埋め全表示（`p0000000001`）か、prefix + 有効桁のみ（`p1`）か、ハイブリッド（一覧は短縮・詳細は全桁）か。ソート・目視比較と可読性のトレードオフ。
2. **コピー UI**: display_id の横にコピーボタンを置くか、クリックでコピーか。医療現場での電話口読み上げ・転記を想定した UX（区切り・読み仮名）。
3. **グローバル検索での prefix 判別**: 検索窓に `p0000000001` を入れたら Patient 詳細へ、`r...` なら処方へ、と prefix からモデルを判定してルーティングするか。台帳（§4.5 registry）を逆引きすれば実装可能。cuid 直打ち・部分一致との併存方針。
4. **超高頻度表の性能影響**: AuditLog（`l`）等は 1 行 INSERT ごとに `IdSequence` 行を +1 更新するため、単一 (org,'l') 行がホットスポット化しうる。(a) 高頻度表は display_id 採番を非同期／バッチ後付けにする、(b) `IdSequence` を採番専用の軽量パスにする、(c) そもそも AuditLog に display_id を付けない（内部 ID のみ）等の選択。§10 の Option B（advisory lock で採番を親 tx から分離）採用可否もここで判断。
5. **HandoffItem のユニーク制約軸**（§5.1）: `org_id` 非正規化列を足して `@@unique([org_id, display_id])` にするか、prefix=`h` を global カウンタ化して `@unique` にするか。
6. **NOT NULL 化のタイミング**（§5.2 段階 3）: 全モデルのバックフィル完了後、いつ NOT NULL へ昇格するか。段階 2 のまま nullable 運用を続ける選択も含めて判断。

## 12. seed / e2e への影響（m4）

- **seed**（`prisma/seed.ts` / `prisma/seed-design-demo.ts`）: seed の create は採番機構（§4 の E1 extension または E2 ヘルパー）経由で display_id が自動採番される。決定性が必要な fixture（テストが特定 ID を期待する場合）は **display_id を明示指定してよい**（E1 は `args.data.display_id` の明示指定を尊重する設計、E2 は allocate を呼ばず直接値を渡す）。明示指定する場合は validator regex（§1.3）を満たし、当該 (org, prefix) の自動採番範囲と衝突しない大きめの番号帯 or seed 実行順で先に確保する。
- **seed リセット**: seed のリセット/再投入時は対象テーブルと併せて **`IdSequence` を `deleteMany`（該当 org 行 or 全行）でリセット**する。カウンタを残すと再投入後の採番が続き番号になり、fixture の期待とずれる。
- **e2e DB**（local 5433 postgres、deploy + seed 直叩き運用）: migration 適用後に**バックフィルスクリプト（§6）を e2e DB にも適用**し、本番と同じ「全行 display_id 埋まり + IdSequence 整合」状態を再現する。e2e アサーションは特定の display_id 値でなく §1.3 の形式（regex）や表示有無を検証する方針を推奨（seed 順序変更で壊れない）。

## 13. 実装タスク分解（参考）

- **ID-1（本設計の実装）**: 先頭に **feasibility spike（§4.1、必須ゲート）** → 判定に応じて E1（extension、§4.2）or E2（`allocateDisplayId` ヘルパー、§4.3）→ `IdSequence` schema + `allocate`（§3.2、RLS 除外リスト追記 §3.1）+ registry（§4.5）+ §2.1 CI テスト。
- **ID-2**: `format` / `parseDisplayId`（§1.4）ユーティリティ + 単体テスト。
- **ID-3**: 内部 UI/CSV/PDF の cuid 露出を display_id へ置換（§8）。外部面は §7 ポリシーにより非対象、レビューで漏出チェック。
- **各波の migration + バックフィル**（§5.3 / §6）: W1〜W7、各波 human approval。seed/e2e の追随は §12。

（本文書はコード・schema・migration を変更しない。上記は後続タスクの見取り図であり、実施は別途承認を得る。）
