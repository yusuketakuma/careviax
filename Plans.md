# PH-OS Pharmacy — Implementation Plan

> 仕様書: [ワークフロー/多職種連携](docs/visit-report-collab-spec.md) | [設計判断](docs/decisions.md)
> アーキテクチャ / デザイン方針: CLAUDE.md 参照
> ※ Phase 3 は Phase 2 完了時に詳細化する

### 明示的な非ゴール（既存レセコン/薬局システムの責務）

- フル在庫管理（発注・仕入・棚卸し・在庫評価）→ PH-OSは在庫医薬品マスタ（採用薬フラグ+引当フラグ）の薄い層のみ
- 麻薬管理帳簿・毒薬劇薬受払い簿 → レセコンが法定帳票を担う
- 領収書・調剤報酬明細書の発行 → レセコンの中核機能（二重入力回避）
- 会計・一部負担金の収納管理 → レセコン/会計システム
- POS・仕入・発注 → 在庫管理専用システム

### 実装優先原則（今回レビュー反映）

- MVPは「訪問日次運用 + 報告送付 + 最低限の処方差分/持参判定」を最優先にし、重いマスタ/処方安全チェック/請求自動化は後段に寄せる
- `MedicationCycle` は「処方起点の1運用サイクル」を維持する。MVPでも訪問予定は処方差分・持参可否・未解決課題と切り離さない
- PH-OS / レセコン / 電子薬歴 / 在宅支援システムの責任分界を先に固定し、二重入力を避ける
- 公開情報ベースの市場比較では、既存製品は「訪問記録・計画書/報告書作成・FAX/メール送付・現場共有」に強い。初期価値は最適化機能より、現場記録/連携/持参漏れ防止に置く

### 2026-07-08 Active Plan Board v8 — 実装済み / 未実装分類 `cc:ACTIVE`

> この v8 が `Plans.md` の唯一の実装入口。後段の v7/v6/v4/v3、詳細証跡、長大なプロンプト型仕様は `cc:REFERENCE` / `cc:WIP` として読む。
> 実装済みタスクは active backlog から削除し、再実装しない。未実装または一部実装済みの残スコープだけを、下の queue から次PRへ切る。
> 照合根拠: 2026-07-08 時点の現行 route/service/type/test、`ops/refactor/STATE.md`、`docs/compliance/access-control-policy.md`、`docs/ui-ux-design-guidelines.md`、`package.json` scripts。
> 追加照合: `STOCK-001-VISIT-API` は commit `af38c8e42` で push 済み。API/service/idempotency/route catalog/rate limit/display-id/境界checkは実装済みとして frozen に移す。runtime利用には `MedicationStockObservationContext` migration適用の human gate が残る。
> 追加照合: `STOCK-001-VISIT-FORECAST` の次回訪問/JST不足判定は commit `ddd3c5bf5` で push 済み。active queue から削除し、未実装の次回処方/補充horizonは `STOCK-001-PRESCRIPTION-HORIZON` に集約する。
> 追加照合: 2026-07-08 の live code scan で `movement-timeline` route、dashboard summary rail / urgent source links、formal inbound schema/API、MedicationStock visit observation route、read SLO / query-shape guardrail が存在することを確認した。後段 `cc:REFERENCE` の古い「未実装」表記より、この v8 board を優先する。

**現在の分類サマリー**:

| Bucket                   | Count | 入口                                                                                                    |
| ------------------------ | ----: | ------------------------------------------------------------------------------------------------------- |
| Done / frozen            |    25 | 下の Done 表。active backlog ではなく、回帰防止・docs参照・watchlist対象として扱う。                    |
| Partial / residual track |     6 | 下の Partial 表。既存土台は再作成せず、残スコープだけ implementation queue へ切る。                     |
| Implementation queue     |    23 | `Implementation-ready queue`。次PRに切れる backend/platform/ops/API タスク。Human gate を含む。         |
| Frontend queue           |     9 | `Frontend implementation queue`。7画面UI改善は実在BFF/API/state matrixに基づく slice として扱う。       |
| Archive / reference      |     - | `Archived Plan Board v3` 以下。背景・受入条件・旧証跡。未チェックboxをそのまま backlog として数えない。 |

**次の実装優先順（2026-07-08時点）**:

1. `STOCK-001-VISIT-CONTEXT-APPLY`: migration適用は human gate。承認、rollback、staging evidence が揃うまで Codex単独で実行しない。
2. `STOCK-001-VISIT-UI`: 訪問記録フォームから push済み API へ接続する大きい入力UI。
3. `QUERY-SHAPE-WATCHLIST-003-FOLLOW`: DB read-speed follow-up を zero-debt watchlist で維持する。
4. `OPS-RECOVERY-LIVE-001`: AWS live restore evidence は credential/承認が揃うまで human gate。

**分類ルール**:

| Status        | 判定                                                                                     | 実装判断                                                                           |
| ------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Done / frozen | code path、test、commit/STATE evidence がある。                                          | active backlog から削除。再実装せず、回帰防止test・watchlist・docs参照だけ残す。   |
| Partial       | 正本DB/API/BFFまたは初期UIはあるが、review UI、downstream、role tests、運用証跡が残る。  | 既存土台を再作成せず、残スコープだけ小IDへ切る。                                   |
| Not started   | 永続 code path がなく、計画文だけがある。                                                | DoD、validation、stopping condition を補ってから着手する。                         |
| Human gate    | migration適用、live AWS、restore drill、PMDA/法務/UAT、production data mutation が必要。 | Codexだけで完了扱いにしない。runbook、evidence、rollback、承認条件を明示して待つ。 |

**Active Board execution rules**:

- 実装入口はこの `Active Plan Board v8` の `Implementation-ready queue` / `Frontend implementation queue` のみ。後段 archive/reference のチェックボックスは直接 sprint backlog にしない。
- 実装済み行は再作成しない。必要なら regression test、watchlist、payload budget、docs sync だけを足す。
- Partial 行は「土台を使う」。既存 schema / route / service / BFF を削除・置換せず、残 scope を小PRへ切る。
- Not started 行は、着手前に entrypoint、BFF/API、permission、state matrix、validation、stopping condition を1つ以上明文化する。
- Human gate 行は、Codex単独では完了扱いにしない。migration / live AWS / restore drill / production data mutation は、承認、rollback、staging evidence、redacted result が揃うまで実行しない。

**Done / frozen — active backlog から削除するもの**:

| Area                           | 実装済みとみなす範囲                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 今後の扱い                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard backend              | lightweight summary、segment-specific invalidation、Unified Urgent主要source、inbound / stock-risks / report-billing segments、ViewModel hook、Clock Island、segment payload budget。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | BFF/APIを再作成しない。残は quick actions、density/semantic tone、visual QA。                                                                                                       |
| Dashboard process links        | `ProcessNowSection` の9工程tileが相対URLリンクを持ち、0件でも各既存一覧へ遷移できる。工程名・件数・WIP目安は `aria-label` で固定し、external/protocol-relative href は helper test で拒否する。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 再実装しない。                                                                                                                                                                      |
| Dashboard urgent links         | Unified Urgent source links を `今すぐ対応` 下に表示し、audit/inbound/stock/report/billing/task の source別 drilldown を相対URLで固定した。`count_basis='source_total'`、`visible_count`、`hidden_count` の意味をDTO/UI/API testで固定。                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 再実装しない。                                                                                                                                                                      |
| Dashboard hidden links         | 右レールの持ち越し、他職種受信hidden、チーム会話hiddenを条件付き相対URLへ接続した。carryover は `/tasks?status=open&filter=carryover&context=dashboard_home`、受信は `needs_review`、会話は handoff comments filter に寄せる。                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 再実装しない。                                                                                                                                                                      |
| Dashboard summary rail         | `DashboardCockpit` に左Summary Railを追加し、今日のサマリー、主なタスク、チーム状況、最終更新を既存 summary/details/team/inbound/source links から合成する。狭幅では上部カードとして表示し、専用rail BFFは追加しない。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 再実装しない。残は quick actions、density/semantic tone、visual QA。                                                                                                                |
| Inbound core                   | `InboundCommunicationEvent` / `InboundCommunicationSignal` schema、RLS、phone/MCS登録、FAX/email/manual canonical intake、inbox、signal materialize、task bridge、risk bridge、MedicationStock accepted-signal apply。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 正本DB/APIは固定。downstream は VisitBrief/Schedule/Report/External Share summary まで完了。detail/raw external share は known unsupported の別slice。                              |
| Inbound raw detail API/UI      | `GET /api/communications/inbound/:id/detail` で raw_text / 送信者詳細を `purpose`、coded `read_reason`、`request_id`、再認可、read audit、no-store 経由に限定。`/communications/inbound` の選択中 review panel に明示ボタン「原文を監査付きで表示」を追加し、押下後だけ detail API を取得する。dashboard inbound / urgent / stock-risk DTO は raw_text、sender_contact、signal extracted_text を返さない。候補カードには作業ライフサイクル、source detail layout、MedicationStock 適用条件/台帳直書き不可、監査付き detail gate 後の actual apply target selector を表示し、`target_stock_item_id` と観測値の明示入力なしに `apply_to_medication_stock` を呼ばないことを UI test で固定した。             | 再実装しない。raw_text は引き続き監査付き detail API 限定で、external share summary には入れない。                                                                                  |
| Inbound source mapping API/UI  | `POST /api/communications/inbound/:id/source-mapping` と `/communications/inbound` の監査付き詳細後 source mapping panel を追加。route は strict snake_case body のみを受け付け、`source_system` は event の `source_channel` から導出し、event可視性、target patient/case実在・担当範囲、event既存patient/case整合、active時の exact/manual confidence と server-derived source key、active/needs_review duplicate conflict を検証する。response は `mapping_id`、`inbound_event_id`、patient/case、source_system、mapping_status、confidence、created/reviewed timestamp の最小DTOだけ。UI は raw detail gate 後だけ表示し、raw_text、sender_contact、source_url、旧alias/camelCaseを送らない。         | 再実装しない。残は患者未確定sourceのRisk surface。                                                                                                                                  |
| Inbound VisitBrief downstream  | VisitBrief が formal `InboundCommunicationSignal` を same-case scoped かつ bounded/safelist select で読み、未処理/要確認の safety/stock/adherence/schedule/urgent signal を controlled visit check と `inbound_communication_signal` unresolved item へ変換する。raw_text、normalized_summary、extracted_text、薬剤名、数量、送信者、連絡先、source URL、添付情報は select/brief/AI input に入れない。                                                                                                                                                                                                                                                                                                    | 再実装しない。                                                                                                                                                                      |
| Schedule inbound requests      | Schedule day-board BFF が formal `InboundCommunicationSignal(signal_domain=schedule)` の未リンク・要確認/自動確認/確認済み signal だけを bounded visible-window で読み、`inbound_schedule_requests` と `inbound_schedule_request_counts` を返す。UI は受信訪問調整カードと日次要点に件数だけを表示し、正本 `/communications/inbound` へ戻す。raw_text、normalized_summary、extracted_text、structured_payload、送信者/連絡先、external URL、添付、薬剤/数量fieldは DTO/UI に出さず、schedule/proposal/task mutation や `linked_to_schedule` も行わない。                                                                                                                                                  | 再実装しない。accepted signal から具体的な schedule/proposal へ変換する write flow は、薬剤師選択の別sliceで扱う。                                                                  |
| Report inbound candidates      | Report workspace BFF が formal `InboundCommunicationSignal(signal_domain=report)` だけを候補化し、nonempty `InboundCommunicationEvent.normalized_summary`、未リンクaction、review allowlist、event scope整合を満たすものを `inbound_report_candidates` として返す。UI は normalized_summary と患者/受信元ラベルだけを表示し、「報告書に含める / 申し送りのみ / 内部記録のみ」を既存 signal PATCH へ送る。`include_in_report` は `accepted + not_linked` のまま、handoff/internal は `record_only + ignored` と controlled reason にする。raw_text、extracted_text、送信者連絡先、external URL、添付、薬剤/数量fieldは DTO/UI/response に出さず、CareReport content/PDF/send/share body へ自動挿入しない。 | 再実装しない。具体的な CareReport target への挿入/リンクは、report editor 側の pharmacist-selected signal insertion slice で別途扱う。raw text 自動挿入は禁止。                     |
| Inbound external share summary | External Access scope registry に `inbound_communication_summary` / `inbound_communication_detail` / `inbound_communication_raw_text` を登録し、supported は summary のみに限定した。外部共有 payload は formal `InboundCommunicationEvent` / `InboundCommunicationSignal` の case-scoped、人間review済み、30日bounded records から counts/labels/recent controlled labels だけを返す。`normalized_summary`、`raw_text`、`extracted_text`、薬剤名/数量、送信者名/連絡先、external URL、display id、event/signal id、添付/file id は select/payload/UI に出さない。detail/raw scope は known unsupported として grant作成時拒否・public strip する。                                                       | 再実装しない。detail/raw external share は明示理由、request_id、audit、外部共有用redaction field が揃う高リスク別sliceまで unsupported を維持する。                                 |
| Medication Stock base          | schema、RLS/index、append-only event、snapshot、summary API、stockout/equivalence helper、accepted inbound signal apply、処方供給adapter v1。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 残は処方供給follow-up、訪問観測migration適用/DB integration/UI、usage/refill、equivalence review UI。                                                                               |
| Stock prescription horizon     | `PrescriptionIntake.refill_next_dispense_date` / `split_next_dispense_date` だけを補充horizonの正本sourceにし、`source_type=refill`、split未完了、strictly future、`PatientMedicationStockItem.source_type=prescription`、exact処方供給pathに限定して snapshot forecast へ接続した。`docs/architecture/medication-stock-prescription-horizon.md` に非採用sourceも固定済み。                                                                                                                                                                                                                                                                                                                               | 再実装しない。`MedicationCycle`単体、処方line日数、task/free-text、`refill_request` から予定日を作らない。visit/inbound callerへの横展開は別sliceで exact context resolver が必要。 |
| Stock visit context            | `MedicationStockObservationContext` sidecar model、migration candidate、RLS、append-only trigger、DB contract test、Oracle review。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | API実装前提として固定。migration適用は `STOCK-001-VISIT-CONTEXT-APPLY` human gate。                                                                                                 |
| Stock visit API                | `POST /api/visit-records/:id/medication-stock-observations`、`applyVisitMedicationStockObservations`、idempotency/replay/409 conflict、route auth/rate-limit/catalog/display-id/boundary tests。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 再実装しない。残は DB migration適用 gate、DB integration/e2e evidence、訪問UI。                                                                                                     |
| Stock visit forecast           | 訪問観測後の snapshot 再計算で Asia/Tokyo civil date と active future `VisitSchedule` 由来の次回訪問日を使い、次回訪問前不足を `shortage_expected` に分類する。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 再実装しない。処方/補充horizonの正本sourceは `Stock prescription horizon` で固定済み。visit caller横展開は別sliceで扱う。                                                           |
| Stock visit downstream         | 訪問観測後の `MedicationStockSnapshot` `urgent` / `shortage_expected` を OperationalTask fan-out、Case Risk Cockpit provider、VisitBrief、Schedule候補理由、Patient Movement occurrence marker へ接続した。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 再実装しない。残は migration/DB integration gate、write-enabled UI、equivalence review UI。                                                                                         |
| Patient Movement base          | `movement` tab、共通DTO、safe detail resolver、処方/訪問/文書 occurrence marker、MedicationStockSnapshot occurrence marker、timeline list payload budget、standalone `/api/patients/:id/movement-timeline`、map-less loaded-window date card shell、internal-only detail href guard、legacy/API deep-link guard、purpose/read_reason gated detail resolver、browser/mobile/a11y fixture validation。                                                                                                                                                                                                                                                                                                      | 再実装しない。旧 `/api/patients/:id/timeline` list alias と旧 page detail shell は戻さない。                                                                                        |
| Patient Movement source parity | movement presenter が visit/prescription/document の concrete source event_type を保持し、inbound/stock/task/safety と同じ movement DTO contract で `event_type` / `category` / `href` / `action_label` を固定する。summary/metadata suppression、relative href fallback、PHI raw omission は presenter test の parity matrix で固定済み。                                                                                                                                                                                                                                                                                                                                                                | 再実装しない。Task registry `actionBuilder` 採用など action href の追加深掘りは別sliceで扱う。                                                                                      |
| DB read-speed guardrails       | care-report bounded patient/keyword search、delivery summary page-basis、payload budgets、SELECT-only EXPLAIN tool、query-shape watchlist guard、patients board nested relation bounds、patient timeline / visit brief route-shell ratchet、read-path SLO registry。                                                                                                                                                                                                                                                                                                                                                                                                                                      | 残は patients board main cursor redesign、day-board/detail surfaces cleanup、index migration human gate、perf-smoke運用証跡。                                                       |
| Recovery / AWS base            | AWS Backup/RDS read-only monitor、S3 Object Lock read-only monitor、strict skipped-check degradation、template validator、redacted drill evidence、SELECT-only restored DB integrity audit。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | runtime restore APIは作らない。残は live AWS drill evidence の human gate。                                                                                                         |
| Permission SSOT base           | `docs/compliance/access-control-policy.md` と `src/lib/auth/permission-matrix.ts` の基本 capability matrix。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 新account種別やsupport mode導入時に docs/code/tests/RLS/audit を同時更新する。                                                                                                      |
| Plans active board guard       | `plans:active:check` と `tools/scripts/check-plans-active-board.mjs` で Active Plan Board v8 の分類件数、active queue、完了済み派生ID、archive/reference境界を検査する。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 再実装しない。active board 更新時はこの lint と fixture test を通す。                                                                                                               |
| Frontend contract base         | `docs/frontend-screen-contracts.md` と `frontend-contract:check` で7画面UI改善の entrypoint、BFF/API、server-authorized DTO、state matrix、PHI境界、mobile/validation、stop conditionを current code path に固定した。互換性は対象外で、old alias / classic shell / legacy response/action shape は新 contract に上書きし、削除済み経路は no-PHI/no-write で fail-closed にする。                                                                                                                                                                                                                                                                                                                         | 再実装しない。各FE sliceはこの contract と `docs/ui-ux-design-guidelines.md` に従い、実在しないAPI、旧surface、互換shim、client-hidden PHI payload、mock completionを前提にしない。 |

**Partial — 残スコープだけを実装するもの**:

| Track           | 実装済み土台                                                                                                                                                                                                                                      | 未実装の残スコープ                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DASH-OPS`      | DashboardCockpit segments、urgent DTO/source、role priority、payload budget、工程tile相対URLリンク、urgent source drilldown、carryover/hidden drilldown、左Summary Rail。                                                                         | quick actions、density/semantic tone、visual regression。                                                                                                                                                 |
| `RX-002/STOCK`  | MedicationStock ledger base、accepted inbound signal apply、prescription supply adapter v1、visit observation API、訪問観測後の次回訪問/JST stockout forecast、処方/補充horizon source guard、downstream task/risk/brief/schedule/movement 連動。 | prescription supply follow-up、visit context migration apply、visit observation UI、usage_delta/frequency/refill、equivalence review UI。完了済みforecast/downstream/horizon source guardを再作成しない。 |
| `PERF-DB-001`   | 主要summary/listのpayload/query-shape改善。                                                                                                                                                                                                       | patients board main cursor、visit-schedules day-board、contact profiles、visit-preparation detail、visit-brief、visit-record BFF。                                                                        |
| `MOD-*`         | module boundary ratchet、collaboration/risk provider contract、TaskTypeRegistry guardrail。                                                                                                                                                       | report/share/data crosswalk、DomainEventOutbox、module metadata、service_line/discipline/task.module migration plan。                                                                                     |
| `VS-AUTO`       | proposal-first土台、planner、availability helper、approve/contact/confirm flow。                                                                                                                                                                  | DeadlinePolicy、direct generate cordon、review fields migration、PRN/topical stock hard gate、overload apply、Google matrix provider。                                                                    |
| `FE-FOUNDATION` | AppShell、Sidebar、MobileNav、SegmentError、DataTable、WorkspaceActionRail。                                                                                                                                                                      | patient detail island split、visit form split、mobile contextual CTA、browser storage PHI audit、interaction budget。                                                                                     |

**Implementation-ready queue — 未実装 / Partial 残スコープのみ**:

| ID                                 | Status      | Priority | Lane              | Plan / DoD                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Validation / Stop                                                                                                                                      |
| ---------------------------------- | ----------- | -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STOCK-001-PRESCRIPTION-FOLLOWUP`  | Partial     | P1       | Pharmacy stock    | manual retry API、DrugPackage/GS1(GTIN/JAN) quantity conversion、review taskからのstock item作成/適用導線、prescription intake route integration testを追加する。完全一致しない供給を自動加算しない原則は維持。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | adapter/API/integration tests、DrugPackage quantity conversion tests、equivalence review tests。単位変換不能を自動加算するなら停止。                   |
| `STOCK-001-VISIT-CONTEXT-APPLY`    | Human gate  | P0/P1    | Pharmacy stock    | `MedicationStockObservationContext` migration candidate を適用するための承認、rollback plan、staging/prod evidenceを揃える。Codex単独では適用しない。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `prisma validate`、DB contract test、rollback plan、人間承認。DDL/DMLやlive migrationをCodex単独で実行するなら停止。                                   |
| `STOCK-001-VISIT-DB-INTEGRATION`   | Human gate  | P1       | Pharmacy stock    | migration適用後に visit observation API を実DBで検証する。observed_absolute、usage_delta、usage_frequency、not_observed、refill_request の event/context/snapshot/idempotency を staging DB で確認し、rollback evidenceを残す。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | DB integration test、migration status、rollback proof、tenant forbidden proof。migration未適用DBで runtime成功扱いにするなら停止。                     |
| `STOCK-001-VISIT-UI`               | Partial     | P1       | Visit UI          | 訪問記録フォームに外用/頓服/OTC/他院薬の残数確認UIを追加する。read-only参照panelは実装済み。残は migration gate / DB integration evidence 後に、今回残数、未確認理由、最終使用日、usage/refill、idempotent write、offline/conflict を有効化する。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | component/mobile tests、visit form regression。正本DB gate前に保存済み/反映済みを表示するなら停止。                                                    |
| `STOCK-002-EQUIVALENCE-REVIEW`     | Not started | P1       | Pharmacy stock    | YJ/HOT/薬価コード/GS1、一般名、成分、規格、剤形、メーカーを使う名寄せ review UI/API。低confidence候補は薬剤師確認必須。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | equivalence lifecycle tests、audit tests。規格違い・配合剤・剤形違いを自動統合するなら停止。                                                           |
| `PERF-DB-PATIENT-BOARD-CURSOR`     | Not started | P1       | DB read speed     | patients board の main query を cursor/bounded include へ寄せ、右previewとsummaryは別BFFまたは既存summaryから合成する。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | query-shape watchlist、payload budget、patients board tests。全患者×深いrelation includeへ戻るなら停止。                                               |
| `QUERY-SHAPE-WATCHLIST-003-FOLLOW` | Partial     | P1       | DB read speed     | query-shape watchlist に patients board、day-board、visit detail、visit brief、report workspace の代表read pathを追加し、zero-debt batchを維持する。患者訪問系 route shell は `003G`、report workspace の stable top-N / new-only draft target は `003H` で固定済み。残は patients board main cursor、day-board、report workspace aggregate fan-out/watchlist admission、visit-brief service本体。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `pnpm db:query-shape:check`。watchlistを増やすだけでfailを放置するなら停止。                                                                           |
| `PERF-DB-READ-SLO-001`             | Partial     | P1       | DB read speed     | 主要read pathの `p95`、payload bytes、max rows、allowed include depth、expected indexesを `tools/read-path-slo.json` と `db:read-slo:check` で固定済み。残は実環境/seeded環境の perf-smoke evidence と route metrics dashboardへの接続。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | route-level metrics smoke、payload snapshots、query-shape check。SLO未定義のまま新しい広域list APIを足すなら停止。                                     |
| `PERF-DB-006D-INDEX`               | Human gate  | P1/P2    | DB migration plan | care-report index候補は SELECT-only EXPLAIN と rollback plan 後に migration候補化する。blind index migration は禁止。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | SELECT-only EXPLAIN artifact、Oracle/DB review、人間承認。DDL/DMLやlive ANALYZEをCodex単独で実行するなら停止。                                         |
| `PERM-DOC-SYNC-001`                | Partial     | P0/P1    | Permission docs   | 新account種別、support mode、freelance assignment、external viewer scope導入時に capability表、RLS proof、forbidden tests、audit requirementを同時更新。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | permission matrix tests、forbidden tests。docs/code片側更新なら停止。                                                                                  |
| `OPS-RECOVERY-LIVE-001`            | Human gate  | P0/P1    | AWS recovery ops  | 本番相当roleで `--live-aws --strict`、admin health実AWS確認、restore drill evidenceを収集。runtime restore APIは作らない。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | live AWS result、RTO/RPO evidence。credentials/承認なしなら実行しない。                                                                                |
| `OPS-RECOVERY-DRILL-002`           | Human gate  | P0/P1    | AWS recovery ops  | AWS Backup/RDS PITR から隔離DBへ復元し、`backup:drill:integrity` の redacted evidence を残す。アプリ内restore APIは作らず、runbook/AWS権限/承認で復旧する。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `pnpm backup:drill:check --append`、`pnpm backup:drill:integrity`、restore ticket、approver、RTO/RPO evidence。production credentialなしで実行しない。 |
| `TENANT-SUPPORT-001`               | Not started | P0/P1    | Platform access   | Global User/Membership/Grant/Assignment、SupportSession、break-glass、RLS context extension、audit searchをadditive-firstで設計。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | threat model、migration rollback、forbidden tests。support_sessionなしのtenant横断read/writeなら停止。                                                 |
| `API-CONTRACT-001`                 | Partial     | P0       | API contract      | success/error envelopeを `ApiSuccess<T>` / `ApiError` へ段階統一し、public route allowlistを減らす。`API-CONTRACT-001A/B/C/D/E/F/G/H/I/J/K/L/M/N/O/P/Q/R/S/T/U/V/W/X/Y/Z/AA/AB/AC/AD/AE/AF/AG/AH/AI/AJ/AK/AL/AM/AN/AO/AP/AQ/AR/AS/AT/AU/AV/AW/AX/AY/AZ/BA/BB/BC/BD/BE/BF/BG` で guard 誤検出修正、business-holidays mutation、escalation-rules list/delete envelope、admin master delete envelope、facility-standards list envelope、packaging-methods list envelope、service-areas list/delete envelope、drug-master-import status envelope、shift-template delete envelope、saved-view delete envelope、operational-policy explicit envelope、document-template delete envelope、document-template list envelope、vehicle-resource list envelope、dispensing-stats envelope、dashboard-overdue envelope、notification-rules envelope、drug-alert-rules envelope、document-delivery-rules envelope、dashboard monthly-stats envelope、dashboard medication-deadlines envelope、admin organizations provision success envelope、pharmacist credential delete envelope、pharmacist credentials list envelope、password reset confirm success envelope、billing candidate close success envelope、billing candidates list/generation success envelope、billing rule detail success envelope、billing rules collection success envelope、care report print-audit success envelope、care report send success/replay response cleanup、care report generate-from-visit success envelope、case risk-cockpit success envelope、case risk task resolution success envelope、case risk task sync success envelope、case detail patch success envelope、case collection list/create success envelope、CDS check success envelope、comment delete success envelope、communication events list success envelope、communication requests list success envelope、community activities list success envelope、conference notes list success envelope、consent records list/create/detail/update/revoke success envelope、dashboard workflow cache/read success envelope、dispense audit replay/create success envelope、dispense result detail read/rework success envelope、dispense results create/replay success envelope、dispense task detail/update success envelope、dispense task barcode verification success envelope、dispense task workbench read/interrupt success envelope、dispense task collection list/create success envelope、drug master generic recommendations success envelope、drug master ingredient group success envelope、drug master package insert success envelope、drug master detail success/cache envelope、drug master batch success/cache envelope、facility visit batch delete/reorder success envelope、facility visit batch upsert success envelope移行を行い、allowlist debt は 240 → 129 へ削減済み。残は実route envelope移行、error/request_id統一、frontend reader。 | route snapshots、frontend reader、`api-response-shape:check` expectedCount減。既存route一括破壊なら停止。                                              |
| `API-CONTRACT-002`                 | Not started | P0/P1    | API observability | `request_id` / `correlation_id` を success meta、error、AuditLog、security event、job/outboxへ伝播。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | representative route tests、audit/security tests。provider raw errorやPHI混入なら停止。                                                                |
| `API-CONTRACT-003`                 | Not started | P0/P1    | API contract      | error code registryを作り、HTTP status、log level、retryability、user recovery actionを定義する。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | registry snapshot、unknown code reject。                                                                                                               |
| `API-LIST-001`                     | Not started | P0/P1    | API list          | cursor list responseを `data[] + meta{ generated_at, limit, next_cursor, has_more, total_count?, count_basis, facets?, truncated? }` へ統一。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | list API tests、frontend normalizer tests。                                                                                                            |
| `DB-EVENT-001`                     | Not started | P0/P1    | Durable events    | DomainEventOutbox。mutation transaction内では minimal event insertまで。payloadはaggregate refs、schema version、pii_class、minimal json。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | migration design、payload PHI snapshot。migration適用はhuman gate。                                                                                    |
| `FILE-LIFE-001`                    | Not started | P0/P1    | File/PHI          | FileAsset lifecycle、scan gate、safe display name、retention、legal hold。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | FileAsset DTO snapshot、external share/report gate。storage_key/signed URLをpublic DTOへ出すなら停止。                                                 |
| `DATA-RET-001A`                    | Not started | P1       | Retention         | entity別保持期間、削除/匿名化/Legal hold/archive guardのpolicy matrixとmigration plan。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | policy matrix、archive/write/export tests。保持期間の法務判断はhuman gate。                                                                            |
| `PERF-RTE-001A`                    | Not started | P0/P1    | Ops/perf          | current-process metrics依存を減らし、route/method/status/p95/p99/org_scope/deploy_shaを横断集計してCloudWatchへ接続。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | metrics tests、deploy readiness smoke。live AWS操作はhuman gate。                                                                                      |
| `FRONTEND-PHI-DISPLAY-001`         | Not started | P1       | Frontend/security | 認証済み業務画面では権限内の患者名、薬剤名、訪問内容、処方内容、MCS/電話本文、残数、報告/請求の具体情報を表示してよい、という方針を各画面contractに反映する。外部共有、OS通知、SSE、ログ、監査差分、CSV/PDF export は別境界として扱う。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | UI snapshot、permission tests、external/export/log omission tests。業務画面の表示制限を通知/外部共有境界へ誤って流用するなら停止。                     |
| `PLAN-ARCHIVE-001`                 | Not started | P2       | Plan hygiene      | 後段の長大なプロンプト型仕様を active backlog から分離し、reference spec として `docs/plans-archive.md` または専用docsへリンク化する。内容を失わず、active入口には status と残scopeだけを残す。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | markdown link check、active board diff review。仕様を削除して証跡を失うなら停止。                                                                      |

**未実装Plan拡充 — 次PRへ切るサブスライス**:

> この表は `Implementation-ready queue` の件数に含めない。上の queue 行を実装する前に、最初のPR境界・再実装禁止範囲・追加検証を確認するための分解補助である。

| Parent ID                      | 先に切るPR / artifact                                                                                                                                                                                                                                                                                                                                           | 再実装しないもの                                                         | 追加 acceptance / validation                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `STOCK-001-VISIT-UI`           | `VisitMedicationStockObservationPanel` を visit record form の section として追加。`GET /api/patients/:id/medication-stock` で前回値/リスクを表示し、write は migration gate / DB integration evidence が揃うまで disabled/review待ちにする。write有効化後は push済み `POST /api/visit-records/:id/medication-stock-observations` と `Idempotency-Key` を使う。 | visit observation API、idempotency、snapshot forecast、context sidecar。 | mobile 44px tap target、offline/conflict/idempotency key、未確認理由、前回値/今回値/差分、次回訪問前不足表示、保存失敗時の false success 防止。 |
| `PERF-DB-PATIENT-BOARD-CURSOR` | patients board main list を cursor + bounded select へ移し、右preview/summaryは別BFFまたは既存summaryから合成する。                                                                                                                                                                                                                                             | patients board nested relation bounds / stable order の既存改善。        | query-shape watchlist、max rows/include depth、payload budget、safe patients hidden/priority ordering、count_basis。                            |
| `PLAN-ARCHIVE-001`             | 後段の長大仕様を削除せず reference doc へ移管し、active入口は v8 board + queue だけにする。                                                                                                                                                                                                                                                                     | 完了済み詳細契約、旧v3/v2の履歴証跡。                                    | link check、同一ID重複 scan、archiveの未チェックboxを active 件数へ混ぜない smoke。                                                             |

**Frontend implementation queue — 未実装だけ**:

| ID                      | Status      | Screen            | Entrypoints / existing contract                                                                                                                               | Plan / DoD                                                                                                                                                          | Validation / Stop                                                                                                                                  |
| ----------------------- | ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-SHELL-001`          | Not started | Shell/Header/Rail | `src/components/layout/app-shell.tsx`, `sidebar.tsx`, `app-header.tsx`, `navigation-config.ts`, `WorkspaceActionRail`。                                       | AppShell / Sidebar / Top Header / Rail の役割と見た目を統一。データ取得や権限contractは変えない。nav active、通知、検索、mobile sheet を current path で改善する。  | layout tests、a11y landmarks、mobile nav smoke。新しい別shellや別design-systemを作るなら停止。                                                     |
| `FE-PATIENT-LIST-001`   | Not started | 患者一覧          | `src/app/(dashboard)/patients/page.tsx`, `patients-board.tsx`, patient board BFF/summary、`DataTable` / card display。                                        | 左summary、中央信頼できるlist/card、右selected patient preview。要対応、他職種受信、残数不足、報告未提出は権限内で表示し、right previewは詳細へ進む導線を持つ。     | patients board API contract、component tests、payload budget、mobile drawer screenshot。全患者deep includeや見た目だけの未接続badgeなら停止。      |
| `FE-PATIENT-DETAIL-001` | Partial     | 患者詳細          | `src/app/(dashboard)/patients/[id]/card-workspace.tsx`, `src/types/patient-movement-timeline.ts`, patient detail workspace services。                         | Command Center、Must Check、Safety、Next Action、薬剤/訪問、Movement tab、右レールを整理。movement土台は再作成せず、既存tab/sourceを使って島ごとに分割する。        | card-workspace tests、movement tests、a11y heading order、state matrix。history/movement混在を戻すなら停止。                                       |
| `FE-DISPENSE-001`       | Not started | 調剤              | `src/components/features/dispense-workbench/dispensing-workbench.tsx`, `right-pane.tsx`, `patient-list-panel.tsx`, `/dispense` `/audit` `/set` `/set-audit`。 | 左queue、中央作業台、工程stepper、処方table、右監査railを整理。既存phase/workflow/write handlers、確認dialog、F-key contractは壊さない。                            | dispense focused tests、route smoke、keyboard order、color-token tests。監査/確定操作のpreconditionやconfirmを弱めるなら停止。                     |
| `FE-SCHEDULE-001`       | Not started | スケジュール      | `src/app/(dashboard)/schedules/page.tsx`, `schedule-team-board.tsx`, proposals content/optimizer、schedule service BFF。                                      | 薬剤師別timeline、状態凡例、提案rail、患者連絡待ちを整理。proposal-first、confirmed schedule不変、移動/仮予定/緊急挿入の区別を守る。                                | schedule board/proposal tests、responsive screenshot、route/order tests。未確定提案を確定予定のように表示するなら停止。                            |
| `FE-VISIT-001`          | Not started | 訪問中            | `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`, `VisitMedicationManagementSection`, voice memo route、visit record conflict/offline helpers。 | 残数入力、観察、他職種受信確認、音声メモ、下部固定bar。正本APIがない操作は disabled/review待ち/詳細遷移にし、保存済み表示をしない。                                 | visit record tests、mobile/offline/conflict tests、idempotency UI。migration gate前に本番write UIを有効化するなら停止。                            |
| `FE-REPORT-001`         | Not started | 報告書            | `src/app/(dashboard)/reports/report-share-workspace.tsx`, report delivery dashboard、care report detail/share/print、report AI draft review。                 | 左報告書一覧、中央editor、右AI/送付rail。医療チャット/残数/訪問記録は候補として選択投入し、raw_textを自動本文化しない。送付先statusとmaskingを近接表示する。        | report workspace tests、delivery/masking、PDF/send route tests。外部送付本文へraw textや未確認signalを自動投入するなら停止。                       |
| `FE-INBOUND-001`        | Partial     | 他職種受信        | `src/app/(dashboard)/communications/inbound/page.tsx`, `inbound-content.tsx`, formal Event/Signal APIs、MedicationStock accepted-signal apply。               | 受信inbox、message detail、structured signal panel、action rail。raw detailは purpose/re-auth/read audit を通し、summary/list と detail の情報境界を分ける。        | inbound route/UI tests、raw omission snapshots、review lifecycle、forbidden tests。raw_textを一覧/通知/監査changesへ流すなら停止。                 |
| `FE-QA-001`             | Not started | 横断              | 7画面の existing tests、`docs/ui-ux-design-guidelines.md`、`docs/compliance/access-control-policy.md`、route payload budgets。                                | loading/empty/data/partial/error/forbidden/stale/offline/conflict fixture、mobile snapshot、keyboard navigation、PHI output boundary snapshotを画面ごとに追加する。 | Playwright/component screenshot、exact-path lint、typecheck。状態fixtureなしの大規模UI変更、または権限内表示と外部出力境界を混同する変更なら停止。 |

**Frontend quality rules — 各FE sliceの必須条件**:

| Rule                 | 内容                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract first       | 実装前に対象画面の entrypoint、既存BFF/API、permission、loading/empty/error/forbidden/stale/offline/conflict state を確認する。                          |
| No mock completion   | 正本APIや書き込みcontractが未実装の操作は、見た目だけで「保存/反映済み」にしない。disabled、proposal、review待ち、または詳細遷移として表現する。         |
| Right rail action    | 右レールまたは下部固定CTAには、次に何をするか、止まっている理由、詳細へ進む導線を必ず置く。                                                              |
| Permissioned display | 権限内の業務画面では必要な個人情報・医療情報を表示してよい。隠すのではなく、適切な権限・再認可・監査・外部出力境界で制御する。                           |
| Mobile parity        | 右レールは mobile で Sheet/drawer、主要CTAは下部固定、タップ領域は44px以上、tableはcard表示へ落とす。                                                    |
| PHI boundary tests   | OS通知、SSE、server log、audit diff、external share、CSV/PDF export、public/signed URL には一覧/業務画面の詳細情報を流用しないことをsnapshotで固定する。 |

**今回完了した派生タスク（再実装しない）**:

- `STOCK-VISIT-CONTEXT-SCHEMA-001`: `last_used_at`、`unobserved_reason_code`、controlled source context を `MedicationStockEvent` 1:1 sidecar の `MedicationStockObservationContext` に永続化する最小設計と migration candidate は追加済み。free-text reason は保存対象外。migration適用は human gate。
- `STOCK-VISIT-IDEMPOTENCY-001`: visit record id、stock item id、client observation id、payload fingerprint による idempotent replay / 409 conflict は API/service test で固定済み。raw `Idempotency-Key` は保存・返却しない。
- `STOCK-VISIT-ROUTE-CONTRACT-001`: `POST /api/visit-records/:id/medication-stock-observations`、route auth、rate limit、route catalog、display-id registry、module boundary、response shape allowlist整合は commit `af38c8e42` で完了済み。
- `STOCK-VISIT-FORECAST-CONTEXT-001`: 訪問観測後の snapshot 再計算に Asia/Tokyo civil date と active future `VisitSchedule` 由来の次回訪問日を渡す実装は commit `ddd3c5bf5` で完了済み。次回処方/補充予定horizonは `STOCK-001-PRESCRIPTION-HORIZON` に分離済み。
- `STOCK-PRESCRIPTION-HORIZON-001`: 補充horizonの正本sourceは `PrescriptionIntake.refill_next_dispense_date` / `split_next_dispense_date` の structured date に限定し、`source_type=refill`、split未完了、strictly future、`PatientMedicationStockItem.source_type=prescription`、exact処方供給pathだけで snapshot forecast へ渡す。`MedicationCycle`単体、処方line日数、task/free-text、`refill_request` は自動horizonにしない。
- `INBOUND-REVIEW-LIFECYCLE-001`: `/communications/inbound` の選択中候補カードに、受信→初期評価→レビュー→反映/クローズの作業ライフサイクルと MedicationStock 適用条件を追加済み。候補DTOに `target_stock_item_id` や観測値入力がない状態では台帳直書き不可を表示し、`apply_to_medication_stock` を呼ぶボタンを出さない。
- `INBOUND-APPLY-SELECTOR-001`: `/communications/inbound` の監査付き detail panel に source detail layout を追加し、accepted / not_linked の MedicationStock signal だけに actual apply target selector を表示する。`/api/patients/:id/medication-stock?item_limit=20&event_limit=0` は audited detail の `patient_id` が得られた後だけ取得し、PATCH payload は signal id、`target_stock_item_id`、明示入力した observation、idempotency key に限定する。raw_text、送信者、連絡先、source URL は selector payload に入れない。
- `INBOUND-003-SOURCE-MAPPING-UI`: `POST /api/communications/inbound/:id/source-mapping` と監査付き detail 後の source mapping panel を追加済み。strict snake_case の新契約だけを受け付け、event由来の source key、target patient/case access、active/needs_review conflict、active時の exact/manual confidence を検証し、raw_text、sender_contact、source_url、旧alias/camelCaseは payload/response に入れない。
- `VISIT-BRIEF-010`: VisitBrief が formal `InboundCommunicationSignal` を same-case scoped かつ bounded/safelist select で読み、未処理/要確認の safety/stock/adherence/schedule/urgent signal を controlled visit check と `inbound_communication_signal` unresolved item へ変換する。select/brief/AI input は raw_text、normalized_summary、extracted_text、薬剤名、数量、送信者、連絡先、source URL、添付情報を含めず、action は正式 `/communications/inbound?signal=<id>` へ向ける。
- `INBOUND-SCHEDULE-DOWNSTREAM-001`: Schedule day-board が formal `InboundCommunicationSignal(signal_domain=schedule)` の未リンク・要確認/自動確認/確認済み signal を bounded visible-window で読み、日次要点と受信訪問調整カードに controlled label と件数だけを表示する。raw_text、normalized_summary、extracted_text、structured_payload、送信者/連絡先、external URL、添付、薬剤/数量fieldは select/DTO/UI に含めず、schedule/proposal/task mutation と `linked_to_schedule` は行わない。
- `MOV-UI-DATE-CARD-001`: `PatientMovementTimeline` を new `/api/patients/:id/movement-timeline` の loaded-window DTOだけで map-less date card shell に整理済み。日付ごとの scoped count / category chips、読込済み count wording、44px filter/action target、internal-only detail href guardを component test で固定し、旧 `/api/patients/:id/timeline` list alias や raw detail drawer は追加しない。
- `DASH-PROCESS-TILE-LINKS-001`: `ProcessNowSection` の9工程tileを相対URLリンク化し、0件でも既存の該当一覧へ遷移できるようにした。`ProcessNowTile` は `href` / `ariaLabel` を持ち、helper test で外部URLと protocol-relative URLを拒否する。
- `DASH-URGENT-SOURCE-LINKS-001`: `DashboardUrgentSourceLink` に `count_basis='source_total'` を追加し、`今すぐ対応` 下に source別 drilldown を表示した。audit/inbound/stock/report/billing/task は既存UI routeのfilter付き相対URLへ進み、外部URLへ逃がさない。`visible_count` は top3表示件数ではなく details payload に materialize されたsource内件数として固定済み。
- `DASH-HIDDEN-CARRYOVER-LINKS-001`: 右レールの「昨日からの持ち越し」、他職種受信hidden、チーム会話hiddenを条件付き相対URLへ接続済み。hidden/carryoverは件数表示だけで終わらせず、既存の tasks / inbound / handoff 画面へ進める。
- `DASH-SUMMARY-RAIL-001`: `DashboardCockpit` に左Summary Railを追加済み。専用BFFは作らず、既存 summary/details/team/inbound/source links から今日のサマリー、主なタスク、チーム状況、最終更新を合成する。狭幅では上部カードとして表示し、dashboard component test で主要リンクと件数を固定した。
- `PLANS-ACTIVE-LINT-001`: `plans:active:check` と fixture test を追加済み。Active Plan Board v8 の分類件数、active queue、完了済み派生ID、Archived Plan Boardの非active境界を検査し、archive/referenceの未チェックboxをactive backlog扱いしない。
- `QUERY-SHAPE-WATCHLIST-003F`: patient movement timeline list API、patient timeline detail API、single visit preparation brief API を query-shape watchlist に追加済み。これらの route shell は直接DBを広く読まず、今後 direct `findMany` / broad `include` / aggregate fan-out が混入したら `pnpm db:query-shape:check` で止める。allowlist debt は 0 のまま維持。
- `QUERY-SHAPE-WATCHLIST-003G`: patient visit brief、patient visits tab、patient visit constraints の route shell を query-shape watchlist に追加済み。これらの route shell は患者/訪問の重要read入口として direct broad Prisma reads、broad include、aggregate fan-out を戻さない。heavy visit brief service 本体、visit record BFF、patients board main cursor、day-board、report workspace は別sliceで cleanup 後に追加する。
- `QUERY-SHAPE-WATCHLIST-003H`: report today-workspace BFF の bounded top-N read に id tie-breaker を追加し、delivery/request/resolved response/recent report/schedule/prescription intake の安定順序を route test で固定した。宛先未登録の完了済み訪問では旧互換の主治医向け fallback を出さず、現行care team link がない限り生成targetを空にする。report workspace は aggregate fan-out cleanup 後に watchlist 追加する。
- `API-CONTRACT-001A`: `api-response-shape:check` が新 envelope の `success({ data })` shorthand を legacy direct payload と誤検出しないように修正済み。stale allowlist expectedCount 17件を削除し、残 debt は 240 → 223。route behavior や旧互換 fallback は追加していない。
- `API-CONTRACT-001B`: `business-holidays` の POST/DELETE success body を新 `data` envelope に統一済み。POST は `data: holiday`、DELETE は `data: { id }` を返し、旧 `success(holiday)` / `success({ ok: true })` は残さない。allowlist debt は 223 → 221。
- `API-CONTRACT-001C`: `admin/escalation-rules` の GET を `data + meta` envelope へ移行し、DELETE は `data: { id }` へ統一済み。通知設定画面は escalation 側だけ `payload.meta` を読む。旧 top-level count fields / message body は残さない。allowlist debt は 221 → 219。
- `API-CONTRACT-001D`: admin master detail の `external-professionals` / `facilities` / `facility units` DELETE success body を `data: { id }` に統一済み。旧 `{ ok: true }` は残さない。allowlist debt は 219 → 216。
- `API-CONTRACT-001E`: `admin/facility-standards` の GET を `data + meta` envelope へ移行済み。画面 reader は `payload.meta` のみを読む。旧 top-level count fields は残さない。allowlist debt は 216 → 215。
- `API-CONTRACT-001F`: `packaging-methods` の GET を `data + meta` envelope へ移行済み。画面 reader は `payload.meta` のみを読む。旧 top-level count fields は残さない。allowlist debt は 215 → 214。
- `API-CONTRACT-001G`: `service-areas` の GET を `data + meta` envelope へ移行し、DELETE は `data: { id }` へ統一済み。画面 reader は `payload.meta` のみを読む。旧 top-level count fields / message body は残さない。allowlist debt は 214 → 212。
- `API-CONTRACT-001H`: `drug-master-imports/status` の GET を `data` envelope へ移行済み。画面 reader は `payload.data` のみを読む。旧 top-level status DTO は残さない。allowlist debt は 212 → 211。
- `API-CONTRACT-001I`: `pharmacist-shift-templates/:id` の DELETE を `data: { id }` envelope へ移行済み。旧 message body は残さない。allowlist debt は 211 → 210。
- `API-CONTRACT-001J`: `saved-views/:id` の DELETE を `data: { id }` envelope へ移行済み。旧 `{ ok: true }` body は残さない。allowlist debt は 210 → 209。
- `API-CONTRACT-001K`: `settings/operational-policy` の GET/PATCH を静的にも明示的な `data` envelope へ移行済み。旧 helper-wrapped success 呼び出しは残さない。allowlist debt は 209 → 207。
- `API-CONTRACT-001L`: `templates/:id` の DELETE を `data: { id }` envelope へ移行済み。旧 message body は残さない。allowlist debt は 207 → 206。
- `API-CONTRACT-001M`: `templates` の GET を `data + meta` envelope へ移行済み。文書テンプレート画面 reader は `payload.meta` のみを読む。旧 top-level count fields は残さない。allowlist debt は 206 → 205。
- `API-CONTRACT-001N`: `visit-vehicle-resources` の GET を `data + meta` envelope へ移行済み。車両マスター/スケジュール提案 reader は `payload.meta` のみを読む。旧 top-level count fields は残さない。allowlist debt は 205 → 204。
- `API-CONTRACT-001O`: `dashboard/dispensing-stats` の GET を `data` envelope へ移行済み。統計ハブ reader は `payload.data` のみを読む。旧 raw success fields は残さない。allowlist debt は 204 → 203。
- `API-CONTRACT-001P`: `dashboard/overdue` の GET を `data` envelope へ移行済み。旧 root `summary` は残さない。allowlist debt は 203 → 202。
- `API-CONTRACT-001Q`: `notification-rules` の GET/POST と `notification-rules/:id` の GET/PATCH/DELETE を `data` / `data + meta` envelope へ移行済み。通知設定画面 reader は `payload.meta` と mutation `payload.data` のみを読む。旧 top-level count fields / raw rule / delete message body は残さない。allowlist debt は 202 → 197。
- `API-CONTRACT-001R`: `drug-alert-rules` の GET と `drug-alert-rules/:id` の DELETE を `data` / `data + meta` envelope へ移行済み。管理画面と表示設定 panel の reader は `payload.meta` のみを読み、旧 top-level count fields / delete message body は残さない。allowlist debt は 197 → 195。
- `API-CONTRACT-001S`: `document-delivery-rules` の GET と `document-delivery-rules/:id` の DELETE を `data` / `data + meta` envelope へ移行済み。文書テンプレート管理の送達ルール reader は `payload.meta` のみを読み、旧 top-level count fields / delete message body は残さない。allowlist debt は 195 → 193。
- `API-CONTRACT-001T`: `dashboard/monthly-stats` の GET を `data` envelope へ移行済み。旧 root `month` / `summary` / `patient_stats` は残さない。allowlist debt は 193 → 192。
- `API-CONTRACT-001U`: `dashboard/medication-deadlines` の GET を `data` envelope へ移行済み。SearchContent reader と検索 perf item count は `payload.data` のみを読み、旧 root `total` / `critical` / `warning` は残さない。allowlist debt は 192 → 191。
- `API-CONTRACT-001V`: `admin/organizations` の POST provision success を `data` envelope へ移行済み。tenant/Cognito provisioning、owner gate、validation、rollback、error response は変えず、旧 root `organization` / `site` / `admin_user` / `membership` は残さない。allowlist debt は 191 → 190。
- `API-CONTRACT-001W`: `admin/pharmacist-credentials/:id` の DELETE success を `data: { id }` envelope へ移行済み。PATCH は既存 data envelope のまま維持し、資格情報 delete/audit/org scope/error response は変えず、旧 root `message` は残さない。allowlist debt は 190 → 189。
- `API-CONTRACT-001X`: `admin/pharmacist-credentials` の GET success を `data + meta` envelope へ移行済み。薬剤師認定情報画面 reader は `payload.meta` のみを読み、旧 root `total_count` / `visible_count` / `hidden_count` / `truncated` / `count_basis` / `filters_applied` / `limit` は残さない。POST は既存 data envelope のまま維持。allowlist debt は 189 → 188。
- `API-CONTRACT-001Y`: `auth/password/reset/confirm` の POST success を `data: { ok: true }` envelope へ移行済み。rate limit、payload validation、Cognito confirm/error classification、password reset page の success handling は変えず、旧 root `ok` は残さない。allowlist debt は 188 → 187。
- `API-CONTRACT-001Z`: `billing-candidates/close` の POST success を `data` envelope へ移行済み。月次締めservice、webhook、任意claims export/audit、conflict/error response は変えず、請求候補画面の close toast は `payload.data.message` のみを読む。旧 root `message` / `billing_domain` / `exported_count` / `summary` / `claims_export` は残さない。allowlist debt は 187 → 186。
- `API-CONTRACT-001AA`: `billing-candidates` の GET/POST success を `data + meta` / `data` envelope へ移行済み。GET は pagination と workbench summary を `payload.meta` のみに移し、POST 生成 toast は `payload.data.message` のみを読む。旧 root `hasMore` / `nextCursor` / `summary` / `message` / generation count fields は残さない。allowlist debt は 186 → 184。
- `API-CONTRACT-001AB`: `billing-rules/:id` の GET/PATCH/DELETE success を `data` envelope へ移行済み。管理画面の detail update/delete reader は `payload.data` のみを読み、旧 root rule fields / delete `message` は残さない。allowlist debt は 184 → 181。
- `API-CONTRACT-001AC`: `billing-rules` の GET/POST success を `data + meta` / `data` envelope へ移行済み。GET は SSOT source/summary を `payload.meta` のみに移し、SSOT同期と任意ルール作成の reader は `payload.data` のみを読む。旧 root `source` / `summary` / `message` / seed count / rule fields は残さない。allowlist debt は 181 → 179。
- `API-CONTRACT-001AD`: `care-reports/:id/print-audit` の POST success を static guard が追跡できる直接 `data` envelope へ整形済み。印刷監査記録、confirmed/access recheck、stale updated_at fail-closed、NoStore/error sanitization、print page / print hub reader は既存の `payload.data` 契約のまま維持し、旧 root `audited` / `report` は残さない。allowlist debt は 179 → 178。
- `API-CONTRACT-001AE`: `care-reports/:id/send` の POST success / idempotency replay response を `success(variable)` から保存済み body を正確に返す route-local JSON responder へ整理し、通常成功は `data` envelope のまま固定済み。送付処理、外部メール、DeliveryRecord、AuditLog、idempotency claim/completion、masked replay body、frontend reader は変更せず、旧 root `report` / `deliveries` は残さない。allowlist debt は 178 → 171。
- `API-CONTRACT-001AF`: `care-reports/generate-from-visit` の POST success を static guard が追跡できる直接 `data` envelope へ整形済み。訪問記録版チェック、下書き版チェック、report generator 呼び出し、NoStore/error sanitization、frontend client schema は変更せず、旧 root `reports` は残さない。allowlist debt は 171 → 170。
- `API-CONTRACT-001AG`: `cases/:id/risk-cockpit` の GET success を `data` envelope へ移行済み。患者 workspace reader は `payload.data` のみを読み、旧 root `overall` / `sections` / `next_actions` は残さない。allowlist debt は 170 → 169。
- `API-CONTRACT-001AH`: `cases/:id/risk-cockpit/tasks/:taskId/resolution` の POST success を `data` envelope へ移行済み。患者 workspace の免除 mutation reader は `payload.data` のみを読み、旧 root `task_id` / `case_id` / `updated_count` は残さない。allowlist debt は 169 → 168。
- `API-CONTRACT-001AI`: `cases/:id/risk-cockpit/tasks` の POST success を `data` envelope へ移行済み。患者 workspace の同期 mutation reader は `payload.data` のみを読み、旧 root `case_id` / `upserted_tasks` / `resolved_stale_tasks` は残さない。allowlist debt は 168 → 167。
- `API-CONTRACT-001AJ`: `cases/:id` の PATCH success を `data` envelope へ移行済み。旧 root `id` / `primary_pharmacist_id` / `required_visit_support` は残さない。allowlist debt は 167 → 166。
- `API-CONTRACT-001AK`: `cases` の GET/POST success を `data + meta` / `data` envelope へ移行済み。訪問候補・QR下書き reader は `payload.data` のみを読み、旧 root `hasMore` / `nextCursor` / case fields は残さない。allowlist debt は 166 → 165。
- `API-CONTRACT-001AL`: `cds/check` の POST success を `data.alerts` envelope へ移行済み。訪問記録・患者安全・アラートルール reader は `payload.data.alerts` のみを読み、旧 root `alerts` は残さない。allowlist debt は 165 → 164。
- `API-CONTRACT-001AM`: `comments/:id` の DELETE success を `data.deleted` envelope へ移行済み。コメントスレッドの削除 reader はレスポンス値に依存せず、テストfixtureのみ current envelope に更新し、旧 root `deleted` は残さない。allowlist debt は 164 → 163。
- `API-CONTRACT-001AN`: `communication-events` の GET success を `data + meta` envelope へ移行済み。旧 root `hasMore` / `nextCursor` は残さず、pagination は `meta.has_more` / `meta.next_cursor` のみで返す。allowlist debt は 163 → 162。
- `API-CONTRACT-001AO`: `communication-requests` の GET success を `data + meta` envelope へ移行済み。通信依頼一覧 reader は `meta.has_more` / `meta.next_cursor` 専用 helper へ切り替え、旧 root `hasMore` / `nextCursor` は残さない。allowlist debt は 162 → 161。
- `API-CONTRACT-001AP`: `community-activities` の GET success を `data + meta` envelope へ移行済み。カンファレンス画面 reader は `meta.has_more` / `meta.next_cursor` 専用 helper へ切り替え、外部ビューアーは `payload.data` のみを読み、旧 root `hasMore` / `nextCursor` は残さない。allowlist debt は 161 → 160。
- `API-CONTRACT-001AQ`: `conference-notes` の GET success を `data + meta` envelope へ移行済み。カンファレンス画面の一覧・カレンダー reader は `meta.has_more` / `meta.next_cursor` 専用 helper へ切り替え、旧 root `hasMore` / `nextCursor` は残さない。allowlist debt は 160 → 159。
- `API-CONTRACT-001AR`: `consent-records` の GET/POST、`consent-records/:id` の GET/PATCH、`consent-records/:id/revoke` の POST success を `data` / `data + meta` envelope へ移行済み。患者同意タブ reader は `payload.meta` 型のみを持ち、旧 root `hasMore` / `nextCursor` / `totalCount` や raw record root fields は残さない。allowlist debt は 159 → 155。
- `API-CONTRACT-001AS`: `dashboard/workflow` の GET success を cache hit/miss とも静的に明示した `data` envelope へ整理済み。public response は `{ data: workflowDashboard }` のまま、cache 内部は dashboard data 本体を保持し、旧 `success(variable)` path は残さない。allowlist debt は 155 → 153。
- `API-CONTRACT-001AT`: `dispense-audits` の POST idempotent replay/create success を `data` envelope へ移行済み。dispense workbench adapter は既に `payload.data` 契約で読み、旧 raw audit root fields は残さない。allowlist debt は 153 → 151。
- `API-CONTRACT-001AU`: `dispense-results/:id` の GET detail と PATCH rework success を `data` envelope へ移行済み。detail/rework の旧 raw result root fields は残さず、auth、assignment scope、OCC、差戻し後 rework side effects は変更しない。allowlist debt は 151 → 149。
- `API-CONTRACT-001AV`: `dispense-results` の POST create/idempotent replay success を `data` envelope へ移行済み。dispense workbench adapter 型も `payload.data` 契約へ更新し、旧 raw `task_id` root fields は残さない。allowlist debt は 149 → 148。
- `API-CONTRACT-001AW`: `dispense-tasks/:id` の GET detail と PATCH update success を `data` envelope へ移行済み。detail/update の旧 raw task root fields は残さず、auth、assignment scope、status transition、workflow notification は変更しない。allowlist debt は 148 → 146。
- `API-CONTRACT-001AX`: `dispense-tasks/:id/verify-barcode` の POST success を `data` envelope へ移行済み。barcode verification adapter 型も `payload.data` 契約へ更新し、旧 raw `match` / `warnings` root fields は残さない。allowlist debt は 146 → 145。
- `API-CONTRACT-001AY`: `dispense-tasks/:id/workbench` の GET workbench projection と POST interrupt success を `data` envelope へ移行済み。workbench reader fixture は `payload.data` 契約へ更新し、旧 raw projection/exception root fields は残さない。allowlist debt は 145 → 143。
- `API-CONTRACT-001AZ`: `dispense-tasks` の GET list と POST create success を `data + meta` / `data` envelope へ移行済み。旧 root `hasMore` / `nextCursor` や raw task root fields は残さず、notification/cycle transition は変更しない。allowlist debt は 143 → 141。
- `API-CONTRACT-001BA`: `drug-masters/:id/generic-recommendations` の GET success を `data` envelope へ移行済み。generic recommendations reader は `payload.data.recommendations` 契約へ更新し、旧 raw `recommendations` / `reason` root fields は残さない。allowlist debt は 141 → 139。
- `API-CONTRACT-001BB`: `drug-masters/:id/ingredient-group` の GET success を `data` envelope へ移行済み。ingredient group reader は `payload.data` 契約へ更新し、旧 raw `summary` / `members` / `reason` root fields は残さない。allowlist debt は 139 → 137。
- `API-CONTRACT-001BC`: `drug-masters/:id/package-insert` の GET success を `data` envelope へ移行済み。package insert route test helper は `payload.data` 契約へ更新し、旧 raw `drug` / `package_insert` / `interactions` root fields は残さない。allowlist debt は 137 → 136。
- `API-CONTRACT-001BD`: `drug-masters/:id` の GET detail success/cache hit を `data` envelope へ移行済み。admin detail reader は `payload.data` を返して既存 UI state を維持し、旧 raw drug detail root fields は残さない。allowlist debt は 136 → 134。
- `API-CONTRACT-001BE`: `drug-masters/batch` の POST success/cache hit を `data` envelope へ移行済み。prescription history reader は `payload.data` を返して既存 master map state を維持し、旧 raw YJ/drug-master-id map root fields は残さない。allowlist debt は 134 → 132。
- `API-CONTRACT-001BF`: `facility-visit-batches/:id` の DELETE unlink success と PATCH reorder success を `data` envelope へ移行済み。旧 raw `deleted` / `updated` / `order` root fields は残さず、権限・担当アクセス・OCC・audit/notify semantics は変更しない。allowlist debt は 132 → 130。
- `API-CONTRACT-001BG`: `facility-visit-batches` の POST upsert success を `data` envelope へ移行済み。旧 raw `batch_id` / `facility_label` / `schedules` root fields は残さず、権限・担当アクセス・OCC・carry-items・audit/notify semantics は変更しない。allowlist debt は 130 → 129。
- `API-CONTRACT-001BH`: `facility-visit-batches/visit-days` の POST success を `data` envelope へ移行済み。旧 raw `facility_label` / `patient_count` / `patient_names` root fields は残さず、権限・担当アクセス・facility validation・preference upsert・workflow notify semantics は変更しない。allowlist debt は 129 → 128。
- `API-CONTRACT-001BI`: `first-visit-documents` の GET list success を `data + meta` envelope へ移行済み。旧 root `hasMore` / `nextCursor` は残さず、POST mutation の既存 `data` envelope、権限・担当アクセス・患者書込guard・audit semantics は変更しない。allowlist debt は 128 → 127。
- `API-CONTRACT-001BJ`: `inquiry-records/:id` の PATCH success を `data` envelope へ移行済み。旧 raw inquiry `id` / `result` / `change_detail` root fields は残さず、臨床確定権限・担当アクセス・OCC・処方明細更新・cycle transition・audit/notify semantics は変更しない。allowlist debt は 127 → 126。
- `API-CONTRACT-001BK`: `interventions` の GET list success を `data + meta` envelope へ移行済み。旧 root `hasMore` / `nextCursor` は残さず、介入記録panel reader は `payload.data` のみを読む。POST create の既存 `data` envelope、権限・担当アクセス・patient/issue scope semantics は変更しない。allowlist debt は 126 → 125。
- `API-CONTRACT-001BL`: `jobs/:jobType` の POST success を `data` envelope へ移行済み。旧 root `jobType` / `processedCount` / `scannedCount` / `errorCount` は残さず、薬剤マスター画面の job reader は `payload.data` のみを読む。API key/admin auth、org scoping、job handler sanitization、error response は変更しない。allowlist debt は 125 → 121。
- `API-CONTRACT-001BM`: `me/logout-all` の POST success を `data` envelope へ移行済み。旧 root `ok` は残さず、session_version increment、audit、Cognito global sign-out、error response は変更しない。allowlist debt は 121 → 120。
- `API-CONTRACT-001BN`: `me/mfa/verify` の POST success を `data` envelope へ移行済み。旧 root `ok` / `recoveryCodes` は残さず、MFA setup 画面 reader は `payload.data.recoveryCodes` のみを読む。TOTP 検証、local user resolution、recovery code 発行、no-store/error response は変更しない。allowlist debt は 120 → 119。
- `API-CONTRACT-001BO`: `me/org` の GET success を `data` envelope へ移行済み。旧 root `name` は残さず、患者訪問記録/服薬印刷ページ reader は `payload.data.name` のみを読む。auth context と org scope は変更しない。allowlist debt は 119 → 118。
- `API-CONTRACT-001BP`: `medication-cycles/:id/history` の GET success を `data` envelope へ移行済み。旧 root 配列は残さず、workflow history fetcher は `payload.data` のみを読む。auth context、case assignment scope、no-store、PHI-safe logging は変更しない。allowlist debt は 118 → 117。
- `API-CONTRACT-001BQ`: `medication-cycles/:id/transition` の PATCH success を `data` envelope へ移行済み。旧 raw updated cycle root fields は残さず、権限判定、case assignment scope、OCC、transition log、best-effort notification、workflow refresh 通知は変更しない。allowlist debt は 117 → 116。
- `API-CONTRACT-001BR`: `medication-cycles` の GET/POST success を `data + meta` / `data` envelope へ移行済み。旧 root `hasMore` / `totalCount` / `nextCursor` と raw cycle root fields は残さず、safety-check の cycle lookup は `payload.data` 契約を維持する。auth context、case assignment scope、org reference validation、case access check、RLS create は変更しない。allowlist debt は 116 → 115。
- `API-CONTRACT-001BS`: `medication-profiles` の GET success を `data + meta` envelope へ移行済み。旧 root `hasMore` / `nextCursor` は残さず、inaccessible patient の空 list も同じ envelope で返す。POST create の既存 `data` envelope、auth context、patient access、DrugMaster validation、RLS create、PHI-safe logging は変更しない。allowlist debt は 115 → 114。
- `PERF-DB-READ-SLO-001A`: `tools/read-path-slo.json` と `db:read-slo:check` を追加済み。configured GET payload budget family は read SLO entry 必須とし、route/family/payload bytes の registry drift、p95/p99不整合、max rows/include depth/query count欠落、expected index guidance欠落をfixture testで拒否する。
- `MOV-001-API-FILTER-001`: `GET /api/patients/:id/movement-timeline` を standalone-only の movement list API とし、旧 `/api/patients/:id/timeline` list alias を削除済み。bounded latest-window source read、limit/cursor/category/date_from/date_to filter、movement-only DTO、meta.next_cursor、no-store/measured JSON、PHI read audit、payload budget、read-path SLO、query-shape watchlist、rate-limit bucket、patient detail UI fetch path、route testsで固定した。raw detail reauth は `MOV-001-RAW-DETAIL-REAUTH-001` で完了済み。
- `MOV-001-DEEPLINK-GUARD-001`: Movement presenter と UI が `/api`、`/api?`、`/api/...`、旧 `/patients/:id/timeline` list alias、旧 `/patients/:id/timeline/:eventId` detail shell を action href として出さない。presenter payload は安全な `/patients/:id#patient-movement` へ fallback し、UI は直渡しの unsafe href を disabled 表示にする。movement list route test は `timeline_events` / `self_reports` / `raw_text` / `event_detail_href` / SOAP/OCR/pdf名を返さない新契約だけを固定する。
- `MOV-001-RAW-DETAIL-REAUTH-001`: `GET /api/patients/:id/timeline/:eventId` は movement-safe detail resolver のまま、`purpose` と coded `read_reason` を必須にし、safe `request_id` を検証/生成して `X-Request-Id` と `data/meta` envelope を返す。成功時の PHI read audit は purpose、request_id、read_reason_code、event_id、category、raw_available だけを記録し、title/summary/actor/destination/raw本文は audit metadata に入れない。`raw_text_included=false` を固定し、SOAP/OCR/raw chat/処方本文/添付は返さない。
- `MOV-001-BROWSER-MOBILE-A11Y-001`: Patient Movement の current loaded-window date-card shell を component test と Playwright fixture で browser/mobile/a11y validation 済み。fixture route は `PLAYWRIGHT` / `PLAYWRIGHT_REUSE_SERVER` 実行時だけ 200 を返し、通常環境では `notFound()` に落とす。検索 input、filter/action、unsafe legacy href disabled、no `/api` action link、no旧 `/patients/:id/timeline` link、mobile overflow、44px target、critical/serious axe 0 を固定した。
- `FRONTEND-CONTRACT-001`: `docs/frontend-screen-contracts.md` で患者一覧、患者詳細、調剤、スケジュール、訪問中、報告書、他職種受信の entrypoint、BFF/API、shared component/type、existing validation、next implementation boundary、state matrix、PHI/output boundary、exact-path validation、stop conditionを current code path に固定した。互換性は対象外で、old alias / classic shell / legacy response/action shape は新 contract に上書きし、削除済み経路は no-PHI/no-write で fail-closed にする。`frontend-contract:check` で必須screen/token/state matrix/PHI boundaryを検査する。
- `FRONTEND-ENTRYPOINT-MAP-001`: `FRONTEND-CONTRACT-001` の最初の成果物として、7画面の route、primary component、BFF/API、shared component、existing tests、missing state を contract 表に統合済み。AppShell、Sidebar、WorkspaceActionRail、DataTable、Movement/Inbound/Stockの既存土台を再作成しない。
- `MOV-002-SOURCE-PARITY`: Patient Movement presenter が visit/prescription/document の concrete event_type を保持し、inbound/stock/task/safety と同じ source parity matrix で `event_type` / `category` / `href` / `action_label` を固定済み。処方・訪問・文書・stock snapshot の summary/metadata suppression、relative href fallback、raw_available false は継続する。
- `STOCK-VISIT-UI-READONLY-001`: `VisitMedicationStockObservationPanel` を訪問記録フォームの残薬セクションへ追加済み。`GET /api/patients/:id/medication-stock?item_limit=20&event_limit=0` の読取情報で前回実測、現在推定残数、推定使用量、推定切れ日、risk badge、hidden/partial/offline/error状態を表示する。migration gate前のため入力欄・未確認理由・反映ボタンは disabled とし、visit submit payload や `/medication-stock-observations` POST へ混入しないことを test で固定した。
- `STOCK-VISIT-DOWNSTREAM-TASK-001`: visit observation API の created non-replay 書き込み後、stock item ごとの最終 snapshot が `urgent` / `shortage_expected` の場合だけ `pharmacy.medication_stock_shortage_expected` OperationalTask を同一transaction内で upsert する。replayでは副作用を出さず、dedupe は stock item 単位、related entity は patient anchor、metadata は stock/item/event/context/visit/case/risk/observation kind の ids/status/code のみに限定し、患者名・薬剤名・raw reason・quantity・unit・idempotency hash を保存/返却しない。
- `STOCK-VISIT-DOWNSTREAM-RISK-001`: Case Risk Cockpit が `MedicationStockSnapshot` の `urgent` / `shortage_expected` を case/patient/org scoped かつ bounded/safelist select で読み、pharmacy provider 経由で controlled `medication_stock_urgent_shortage` RiskFinding へ変換する。RiskFinding title/detail/key/action は患者名・薬剤名・数量・単位・raw reason・idempotency/fingerprint を含めず、`shortage_expected` は warning severity、OperationalTask 生成は既存 risk-task bridge に任せる。
- `STOCK-VISIT-DOWNSTREAM-BRIEF-001`: VisitBrief が `MedicationStockSnapshot` の `urgent` / `shortage_expected` を same-case scoped かつ bounded/safelist select で読み、1件の generic `medication_stock` unresolved item と must-check へ集約する。同種 shortage task は二重表示せず、薬剤名・数量・単位・raw reason・idempotency/fingerprint は brief / AI input へ渡さない。
- `STOCK-VISIT-DOWNSTREAM-SCHEDULE-001`: VisitScheduleProposal 生成が same-case `MedicationStockSnapshot` の `urgent` / `shortage_expected` を bounded/safelist select で集約し、候補理由へ generic な薬剤師レビュー文脈を追加する。API/audit diagnostics は `medication_stock_shortage_risk` review candidate として count/risk level/最短日/丸めたdaysだけを通し、薬剤名・数量・単位・stock_item_id・raw reason・idempotency/fingerprint は渡さない。
- `STOCK-VISIT-DOWNSTREAM-MOVEMENT-001`: Patient Movement timeline registry が same-case `MedicationStockSnapshot` の `urgent` / `shortage_expected` を bounded/select-only で読み、`medication_stock_snapshot` occurrence marker へ接続する。select は `id` / `stock_risk_level` / `calculated_at` のみ、payload は status-only + generic summary + empty metadata とし、薬剤名・数量・単位・stock_item_id・raw reason・stockout date/days・idempotency/fingerprint は渡さない。

**今回昇格した派生タスク（未実装 / 残スコープ）**:

- `DASH-P1-005-SPLIT-001`: 旧 `DASH-P1-005-LINKS` を `PROCESS_TILE`、`URGENT_SOURCE`、`CARRYOVER` の3段階に分割する。先に工程tileをリンク化し、hidden/carryoverは count semantics を固定してから着手する。
- `TASK-ID-DEDUP-001`: 統合済みID（例: `TASK-010 -> TASK-011`, `RISK-020 -> RISK-021`）を registry に集約し、同じ意味の新IDを増やさない。
- `ROUTE-LINK-001`: dashboard / movement / inbound / stock の deep link builder を統一する。相対URLのみ許可し、external/signed/storage URLはaction hrefに入れない。
- `PAYLOAD-BUDGET-002`: patients board / reports / remaining detail surfaces の list/summary/detail payload budgetを表にし、summary/listでは raw text、storage key、signed URL、provider raw errorを出さないことをsnapshotで固定する。
- `ROUTE-PERF-MEASURE-001`: `withRoutePerformance` が `unmeasured` にならないよう、shared measured JSON success helperを `src/lib/api/response.ts` に集約する。
- `BFF-COUNT-META-001`: `returned_count` / `total_count` / `visible_count` / `hidden_count` / `count_basis` の意味をrouteごとに固定し、表示行数を総件数として扱わない。
- `RIGHT-RAIL-ACTION-002`: dashboard、患者一覧、患者詳細、調剤、スケジュール、訪問、報告、他職種の右レール/下部CTAに「次に何をするか」と「止まっている理由」を必ず持たせる。
- `RAW-DETAIL-REAUDIT-001`: raw chat text、電話原文、添付、連絡先詳細を表示する場合の `purpose`、再認可、read audit、request_id を共通helper/testへ寄せる。
- `ACCESS-MATRIX-COVERAGE-001`: `docs/compliance/access-control-policy.md` と `src/lib/auth/permission-matrix.ts` の capability差分を検査し、新機能PRがdocs/code/testsの片側更新で終わらないようにする。
- `PATIENT-SAFE-DISPLAY-001`: 認証済み業務画面では、権限内の患者名、薬剤名、残数、MCS/電話本文、連絡先、訪問内容、処方内容、報告/請求の具体情報を表示してよい。ただしOS通知、SSE payload、server log、監査差分、外部共有、CSV/PDF export、public URLは別境界として扱い、業務画面の表示内容をそのまま流用しない。
- `STOCK-VISIT-AUDIT-001`: 訪問由来 stock ledger write の監査方針を固定する。append-only event を clinical audit record とみなすか、別 `AuditLog` も書くかを決め、いずれも PHI-minimized metadata に限定する。
- `STOCK-VISIT-UI-CONTRACT-001`: visit record form へ接続する前に、入力状態、未確認理由、idempotency key生成、offline/conflict、disabled/retry state、mobile 44px tap target を画面契約として固定する。
- `PERF-DB-READ-SLO-001`: DB読出し改善を場当たりのindex追加ではなく、主要read pathごとのp95、payload bytes、max rows、include depth、expected indexesとして固定する。
- `OPS-RECOVERY-DRILL-002`: AWS Backup/RDS PITR の復旧可能性はアプリ機能ではなく、隔離DB restore drill、redacted integrity evidence、RTO/RPO記録で証明する。
- `FRONTEND-PHI-DISPLAY-001`: ダッシュボード/患者一覧/患者詳細など権限内業務画面では必要情報を隠さず表示し、外部出力境界だけ別途制御する方針をFE契約に落とす。
- `FRONTEND-IMAGEGEN-REFERENCE-001`: 視覚的に大きいFE sliceでは、非PHIの `gpt-image-2` 参照案を作るか、省略理由を `ops/refactor/STATE.md` に残す。軽微な文言/状態追加では省略可。
- `FRONTEND-ACTION-RAIL-COVERAGE-001`: 7画面それぞれで右レールまたは下部固定CTAに「次に何をするか」「止まっている理由」「詳細へ進む導線」があるかを検査し、欠ける画面をFE queueへ戻す。
- `FRONTEND-STATE-MATRIX-001`: loading / empty / data / partial / error / forbidden / stale / offline / conflict を画面ごとに fixture 化し、false empty と mock completion を防ぐ。
- `PLAN-DETAIL-SYNC-001`: active board と後段 `cc:REFERENCE` の詳細phase表が矛盾しないように、実装済みAPI/route/schema/testが見つかった場合は reference 側も「実装済み / Human gate / 残scope」に更新する。古い「未実装」表記だけを根拠に再実装しない。
- `STOCK-VISIT-DB-GATE-UI-001`: visit observation UI は `MedicationStockObservationContext` migration の適用状態と DB integration evidence を検知できるまで、write可能UIとread-only/review待ちUIを明確に分ける。保存不可時は必ず false success を防ぐ。
- `STOCK-LEGACY-RESIDUAL-MIGRATION-001`: 既存 `ResidualMedication` と新 `MedicationStockLedger` の dual-read / dual-write / backfill / cutoff 条件を別計画に切る。既存訪問記録の残薬表示を壊さず、正本移行後に legacy field を段階縮小する。

**次に着手する推奨順**:

1. `STOCK-001-VISIT-CONTEXT-APPLY`: migration適用の human gate を準備する。承認、rollback、staging evidenceがない限り実行しない。
2. `STOCK-001-VISIT-UI`: visit record form を push済み observation API へ接続する。
3. `QUERY-SHAPE-WATCHLIST-003-FOLLOW`: query-shape対象拡張とzero-debt維持。
4. `PERF-DB-006D-INDEX`: SELECT-only EXPLAIN artifact と rollback plan の実環境証跡が揃ってから human gate へ進める。

**Plans.md セクション分類**:

| Section                            | 扱い                        | 実装時の読み方                                                                                     |
| ---------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `Active Plan Board v8`             | Active                      | 実装済み / Partial / Not started / Human gate の正。ここを最初に確認する。                         |
| `Implementation-ready queue`       | Active                      | 次PRに切れる実装単位。後段の詳細仕様から昇格済みのものだけ。                                       |
| `Frontend implementation queue`    | Active                      | 7画面UI改善の未実装slice。見た目PRではなく Contract / Layout / Interaction / State-QA として扱う。 |
| `Archived Plan Board v3`           | Archive                     | 2026-07-08時点の旧分類証跡。active backlog として数えない。                                        |
| `Detailed Status Evidence Archive` | Archive                     | 実装済み証跡と旧分類の履歴。active backlog として数えない。                                        |
| `cc:PARTIAL`                       | Reference + residual detail | 実装済み土台は再作成せず、残タスクをactive boardの対応IDへ戻してから着手。                         |
| `cc:REFERENCE`                     | Reference only              | 背景、受入条件、停止条件、仕様詳細。直接sprint backlog化しない。                                   |
| `cc:WIP`                           | Program context             | 大きなプログラム背景。実装する場合はactive boardへ小IDで切り出す。                                 |
| `cc:blocked` / Human gate          | External gate               | Codexだけで完了扱いにしない。証跡、runbook、承認条件を残す。                                       |

### 2026-07-08 Archived Plan Board v3 — 旧分類証跡 `cc:REFERENCE`

> この v3 は 2026-07-08 時点の旧分類証跡。現在の実装入口は上の `Active Plan Board v8` のみ。
> v3 内の `Implementation-ready queue` / `Frontend implementation queue` は履歴として残すが、active backlog として数えない。
> 照合根拠: 2026-07-08 時点の `git log --oneline -30`、現行 route/service/type/test、`ops/refactor/STATE.md`、`docs/compliance/access-control-policy.md`、`docs/ui-ux-design-guidelines.md`。

**分類ルール**:

| Status        | 判定                                                                                     | 実装判断                                                                       |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Done / frozen | code path、test、commit/STATE evidence がある。                                          | active backlog から外す。回帰防止test・watchlist・docs参照だけ残す。           |
| Partial       | 正本DB/API/BFFまたは初期UIはあるが、review UI、downstream、role tests、運用証跡が残る。  | 既存土台を再作成せず、残スコープだけ小IDへ切る。                               |
| Not started   | 永続 code path がなく、計画文だけがある。                                                | DoD、validation、stopping condition を補ってから着手する。                     |
| Human gate    | migration適用、live AWS、restore drill、PMDA/法務/UAT、production data mutation が必要。 | Codexだけで完了扱いにしない。runbook、evidence、rollback、承認条件を管理する。 |

**実装済み / 再実装しない範囲**:

| Area                      | Done / frozen evidence                                                                                                                                                                                                                                                                                    | 今後の扱い                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Dashboard backend         | lightweight summary、segment-specific invalidation、Unified Urgent主要source、inbound / stock-risks / report-billing segments、ViewModel hook、Clock Island、dashboard segment payload budget。                                                                                                           | API/BFFを再作成しない。残は Summary Rail、drilldown、quick actions、visual QA。                                               |
| Inbound core              | `InboundCommunicationEvent` / `InboundCommunicationSignal` schema、RLS、phone/MCS登録、inbox、signal materialize、task bridge、risk bridge、MedicationStock accepted-signal apply。                                                                                                                       | 正本DB/APIは固定。残は review detail UX、raw再認可、FAX/email/manual、VisitBrief/Schedule/Report/Share downstream。           |
| Report inbound candidates | Formal report signals onlyを `inbound_report_candidates` に投影し、report workspace UI三択から `include_in_report` / `handoff_only` / `internal_record_only` を signal PATCH へ記録する。raw/detail/sender/external/attachment/medication extracted fields は DTO/UI/response/send/PDF/share に出さない。 | 再実装しない。具体的なreport editor挿入は別slice。                                                                            |
| Medication Stock base     | schema、RLS/index、append-only event、snapshot、summary API、stockout/equivalence helper、accepted inbound signal apply、処方供給adapter v1（完全一致の既存stock itemのみ自動反映、その他はreview task）。                                                                                                | 残は処方供給follow-up、訪問観測UI/API、usage/refill、equivalence review UI、downstream接続。                                  |
| Patient Movement base     | `movement` tab、共通DTO、safe detail resolver、処方/訪問/文書 occurrence marker、timeline list payload budget、standalone `/api/patients/:id/movement-timeline`。                                                                                                                                         | 残は map-less date card UX、formal inbound/stock/safety sources、deep link coverage。                                         |
| DB read-speed guardrails  | care-report bounded patient/keyword search、delivery summary page-basis、payload budgets、SELECT-only EXPLAIN tool、query-shape watchlist guard、patients board nested relation bounds/stable ordering。                                                                                                  | 残は patients board main cursor redesign、day-board/detail surfaces cleanup、index migration human gate、perf-smoke運用証跡。 |
| Recovery / AWS base       | AWS Backup/RDS read-only monitor、S3 Object Lock read-only monitor、strict skipped-check degradation、template validator、structured redacted drill evidence、SELECT-only restored DB integrity audit、root runbook least-privilege cleanup。                                                             | runtime restore APIは作らない。残は live AWS drill evidence の human gate。                                                   |
| Permission SSOT base      | `docs/compliance/access-control-policy.md` と `src/lib/auth/permission-matrix.ts` の基本 capability matrix。                                                                                                                                                                                              | 新account種別やsupport mode導入時に docs/code/tests/RLS/audit を同時更新する。                                                |

**一部実装済み / 残スコープ**:

| Track           | 実装済み土台                                                                                                 | 未実装の残スコープ                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DASH-OPS`      | DashboardCockpit segments、urgent DTO/source、role priority、payload budget。                                | `DASH-P1-010-RAIL`、`DASH-P1-005-LINKS`、quick actions、安全な density/semantic tone、visual regression。                              |
| `INB-001/002`   | Formal inbound schema/API/inbox/signals/task/risk/stock apply。                                              | 3カラム review shell、raw_text再認可detail、FAX/email/manual、source mapping UI、VisitBrief/Schedule/Report/Share。                    |
| `RX-002/STOCK`  | MedicationStock ledger base、accepted inbound signal apply、prescription supply adapter v1。                 | prescription supply follow-up、visit observation、usage_delta/frequency/refill、equivalence review UI、stock risk provider完全統合。   |
| `MOV-001`       | Movement tab/DTO/resolver/occurrence marker、standalone movement-timeline API、cursor/date/category filter。 | 日付カードUX、formal inbound/stock/safety sources、relative href builder、raw再認可detail。                                            |
| `PERF-DB-001`   | 主要summary/listのpayload/query-shape改善。                                                                  | patients board main cursor、visit-schedules day-board、contact profiles、visit-preparation detail、visit-brief、visit-record BFF。     |
| `MOD-*`         | module boundary ratchet、collaboration/risk provider contract、TaskTypeRegistry guardrail一部。              | report/share/data crosswalk、DomainEventOutbox、module metadata、service_line/discipline/task.module migration plan。                  |
| `VS-AUTO`       | proposal-first土台、planner、availability helper、approve/contact/confirm flow。                             | DeadlinePolicy、direct generate cordon、review fields migration、PRN/topical stock hard gate、overload apply、Google matrix provider。 |
| `FE-FOUNDATION` | AppShell、Sidebar、MobileNav、SegmentError、DataTable、WorkspaceActionRail。                                 | patient detail island split、visit form split、mobile contextual CTA、browser storage PHI audit、interaction budget。                  |

**Not started / Human gate の主バックログ**:

| ID                       | Status      | Priority | Lane              | Plan / DoD                                                                                                                                                                                                                                                                                                                                                                                                                                     | Validation / Stop                                                                                                                                                                                          |
| ------------------------ | ----------- | -------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DASH-P1-010-RAIL`       | Not started | P1       | Dashboard UI      | 既存 segments から左Summary Railを合成する。専用BFFは必要になるまで作らない。狭幅では上部横スクロールカードへ変形。                                                                                                                                                                                                                                                                                                                            | dashboard component tests、mobile snapshot。summary/details重複fetch復活なら停止。                                                                                                                         |
| `DASH-P1-005-LINKS`      | Not started | P1       | Dashboard routing | process tiles、hidden queue、carryoverを相対URLでdrilldown化する。0件でも空一覧へ遷移できる。                                                                                                                                                                                                                                                                                                                                                  | href allowlist、relative URL tests。signed/storage/external URLをaction hrefに入れるなら停止。                                                                                                             |
| `INBOUND-002-REVIEW`     | Partial     | P0/P1    | Inbound UI/API    | 3カラム review shell。左=原文/添付/送信者/日時、中央=signal候補、右=反映先/Task/Record-only/Reject/MedicationStock。raw_textはdetail再認可とread audit経由。                                                                                                                                                                                                                                                                                   | raw omission snapshots、review lifecycle、read-reason/audit tests。raw_textをlist/通知/監査changesへ流すなら停止。                                                                                         |
| `STOCK-001-PRESCRIPTION` | Partial     | P1       | Pharmacy stock    | v1実装済み: 処方作成後hookで完全一致の既存stock itemへ `prescription_supply` eventをidempotentに追加し、snapshotを再計算。YJ/HOT/receipt/DrugMaster完全一致だけ自動反映し、GS1(GTIN/JAN)・名前のみ・候補なし・曖昧・単位不一致は薬剤師review taskへ回す。残: manual retry API、DrugPackage/GS1数量換算、review taskからstock item作成/適用するUI/API、integration route test。                                                                 | adapter unit tests、idempotency、PHI-free task metadata testsは追加済み。残は API/integration tests、DrugPackage quantity conversion tests、equivalence review tests。単位変換不能を自動加算するなら停止。 |
| `STOCK-001-VISIT`        | Not started | P1       | Pharmacy stock/UI | 訪問観測API/UI。残数、使用頻度、最終使用日、未確認理由をappend-only eventとsnapshot再計算へ接続。`残り4枚` と `2枚使用` を区別。                                                                                                                                                                                                                                                                                                               | unit/API/UI/mobile tests、stockout forecast tests。reviewなしで他職種signalをledger直書きするなら停止。                                                                                                    |
| `MOV-001-API`            | Partial     | P1       | Patient detail    | standalone `/api/patients/:id/movement-timeline` と cursor/date/category filter は実装済み。旧 `/api/patients/:id/timeline` list alias は残さない。残は map-less date card UX、formal inbound/stock/safety sources。処方・訪問・文書は occurrence marker + deep linkのみ。                                                                                                                                                                     | movement API tests、payload budget、raw omission、mobile/a11y。SOAP/OCR/raw chat/薬剤明細全文を一覧に出すなら停止。                                                                                        |
| `VISIT-BRIEF-010`        | Not started | P1       | Visit brief       | 他職種受信、残数不足、服薬困難、副作用疑い、日程相談を訪問前確認項目へ変換。未処理/安全/残数を上位表示。                                                                                                                                                                                                                                                                                                                                       | visit brief tests、provider contract。raw_textをbrief本文へ自動挿入するなら停止。                                                                                                                          |
| `PERM-DOC-SYNC-001`      | Partial     | P0/P1    | Permission docs   | 新account種別、support mode、freelance assignment、external viewer scope導入時に capability表、RLS proof、forbidden tests、audit requirementを同時更新。                                                                                                                                                                                                                                                                                       | permission matrix tests、forbidden tests。docs/code片側更新なら停止。                                                                                                                                      |
| `OPS-RECOVERY-LIVE-001`  | Human gate  | P0/P1    | AWS recovery ops  | 本番相当roleで `--live-aws --strict`、admin health実AWS確認、restore drill evidenceを収集。runtime restore APIは作らない。                                                                                                                                                                                                                                                                                                                     | live AWS result、RTO/RPO evidence。credentials/approvalなしなら実行しない。                                                                                                                                |
| `TENANT-SUPPORT-001`     | Not started | P0/P1    | Platform access   | Global User/Membership/Grant/Assignment、SupportSession、break-glass、RLS context extension、audit searchをadditive-firstで設計。                                                                                                                                                                                                                                                                                                              | threat model、migration rollback、forbidden tests。support_sessionなしのtenant横断read/writeなら停止。                                                                                                     |
| `API-CONTRACT-001`       | Partial     | P0       | API contract      | success/error envelopeを `ApiSuccess<T>` / `ApiError` へ段階統一し、public route allowlistを減らす。`API-CONTRACT-001A/B/C/D/E/F` で guard 誤検出修正、business-holidays mutation、escalation-rules list/delete envelope、admin master delete envelope、facility-standards list envelope、packaging-methods list envelope移行を行い、allowlist debt は 240 → 214 へ削減済み。残は実route envelope移行、error/request_id統一、frontend reader。 | route snapshots、frontend reader、`api-response-shape:check` expectedCount減。既存route一括破壊なら停止。                                                                                                  |
| `API-CONTRACT-002`       | Not started | P0/P1    | API observability | `request_id` / `correlation_id` を success meta、error、AuditLog、security event、job/outboxへ伝播。                                                                                                                                                                                                                                                                                                                                           | representative route tests、audit/security tests。provider raw errorやPHI混入なら停止。                                                                                                                    |
| `API-CONTRACT-003`       | Not started | P0/P1    | API contract      | error code registryを作り、HTTP status、log level、retryability、user recovery actionを定義する。                                                                                                                                                                                                                                                                                                                                              | registry snapshot、unknown code reject。                                                                                                                                                                   |
| `API-LIST-001`           | Not started | P0/P1    | API list          | cursor list responseを `data[] + meta{ generated_at, limit, next_cursor, has_more, total_count?, count_basis, facets?, truncated? }` へ統一。                                                                                                                                                                                                                                                                                                  | list API tests、frontend normalizer tests。                                                                                                                                                                |
| `DB-EVENT-001`           | Not started | P0/P1    | Durable events    | DomainEventOutbox。mutation transaction内では minimal event insertまで。payloadはaggregate refs、schema version、pii_class、minimal json。                                                                                                                                                                                                                                                                                                     | migration design、payload PHI snapshot。migration適用はhuman gate。                                                                                                                                        |
| `FILE-LIFE-001`          | Not started | P0/P1    | File/PHI          | FileAsset lifecycle、scan gate、safe display name、retention、legal hold。                                                                                                                                                                                                                                                                                                                                                                     | FileAsset DTO snapshot、external share/report gate。storage_key/signed URLをpublic DTOへ出すなら停止。                                                                                                     |
| `DATA-RET-001A`          | Not started | P1       | Retention         | entity別保持期間、削除/匿名化/Legal hold/archive guardのpolicy matrixとmigration plan。                                                                                                                                                                                                                                                                                                                                                        | policy matrix、archive/write/export tests。保持期間の法務判断はhuman gate。                                                                                                                                |
| `PERF-RTE-001A`          | Not started | P0/P1    | Ops/perf          | current-process metrics依存を減らし、route/method/status/p95/p99/org_scope/deploy_shaを横断集計してCloudWatchへ接続。                                                                                                                                                                                                                                                                                                                          | metrics tests、deploy readiness smoke。live AWS操作はhuman gate。                                                                                                                                          |
| `FRONTEND-CONTRACT-001`  | Not started | P1       | Frontend          | 7画面の entrypoint、BFF/API、state matrix、PHI表示方針、mobile構成、validationを1ページ contract化。                                                                                                                                                                                                                                                                                                                                           | docs diff、state matrix。実在しないAPIを前提にしたUI実装なら停止。                                                                                                                                         |

**Frontend implementation queue（未実装だけ）**:

| ID                      | Status      | Screen            | Slice        | Plan / DoD                                                                                                                                        | Validation                                                               |
| ----------------------- | ----------- | ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `FE-SHELL-001`          | Not started | Shell/Header/Rail | Layout       | AppShell / Sidebar / Top Header / WorkspaceActionRail の見え方と役割を統一。各業務データcontractは変えない。                                      | layout tests、a11y landmarks、mobile nav smoke。                         |
| `FE-PATIENT-LIST-001`   | Not started | 患者一覧          | Layout       | 左summary / 中央list-card / 右selected patient preview。要対応、他職種受信、残数不足、報告未提出は権限内で表示。                                  | component tests、patients board API contract、mobile drawer screenshot。 |
| `FE-PATIENT-DETAIL-001` | Partial     | 患者詳細          | Layout/State | Command Center、Must Check、Safety、Next Action、薬剤/訪問、Movement tab、右レールを整理。movement土台は再作成しない。                            | card-workspace tests、movement tests、a11y heading order。               |
| `FE-DISPENSE-001`       | Not started | 調剤              | Layout       | 左queue、中央作業台、工程stepper、処方table、右監査rail。既存workflow contractは変えない。                                                        | dispense tests、route smoke、keyboard order。                            |
| `FE-SCHEDULE-001`       | Not started | スケジュール      | Layout       | 薬剤師別timeline、状態凡例、提案rail、患者連絡待ち。proposal-firstとconfirmed不変を守る。                                                         | schedule board/proposal tests、responsive screenshot。                   |
| `FE-VISIT-001`          | Not started | 訪問中            | Interaction  | 残数入力、観察、他職種受信確認、音声メモ、下部固定bar。正本実装がない操作をmock確定しない。                                                       | visit record tests、mobile/offline/conflict tests。                      |
| `FE-REPORT-001`         | Not started | 報告書            | Interaction  | 左報告書一覧、中央editor、右AI/送付rail。医療チャット/残数/訪問記録は候補として選択投入する。                                                     | report workspace、delivery/masking、PDF/send route tests。               |
| `FE-INBOUND-001`        | Partial     | 他職種受信        | Interaction  | 受信inbox、message detail、structured signal panel、action rail。formal Event/Signalを使い、raw detailは再認可とread audit。                      | inbound route/UI tests、raw omission snapshots、review lifecycle。       |
| `FE-QA-001`             | Not started | 横断              | State/QA     | 7画面の loading/empty/data/partial/error/forbidden/stale/offline/conflict fixtures、mobile snapshot、keyboard navigation、PHI omission snapshot。 | Playwright/component screenshot、exact-path lint、typecheck。            |

**今回昇格した派生タスク**:

- `PLAN-ARCHIVE-001`: 後段の長大なプロンプト型仕様を active backlog から分離し、reference spec として `docs/plans-archive.md` または専用docsへリンク化する。内容を失わず、active入口には status と残scopeだけを残す。
- `PLANS-ACTIVE-LINT-001`: `Plans.md` の active ID はこの `Active Plan Board` と implementation/frontend queue に存在するものだけとし、`cc:REFERENCE` / `cc:WIP` の未チェックboxを backlog 件数に数えない軽量lintまたは `rg` 手順を作る。
- `TASK-ID-DEDUP-001`: 統合済みID（例: `TASK-010 -> TASK-011`, `RISK-020 -> RISK-021`）を registry に集約し、同じ意味の新IDを増やさない。
- `ROUTE-LINK-001`: dashboard / movement / inbound / stock の deep link builder を統一する。相対URLのみ許可し、external/signed/storage URLはaction hrefに入れない。
- `PAYLOAD-BUDGET-002`: patients board / reports / remaining detail surfaces の list/summary/detail payload budgetを表にし、summary/listでは raw text、storage key、signed URL、provider raw errorを出さないことをsnapshotで固定する。
- `ROUTE-PERF-MEASURE-001`: `withRoutePerformance` が `unmeasured` にならないよう、shared measured JSON success helperを `src/lib/api/response.ts` に集約する。
- `BFF-COUNT-META-001`: `returned_count` / `total_count` / `visible_count` / `hidden_count` / `count_basis` の意味をrouteごとに固定し、表示行数を総件数として扱わない。
- `RIGHT-RAIL-ACTION-002`: dashboard、患者一覧、患者詳細、調剤、スケジュール、訪問、報告、他職種の右レール/下部CTAに「次に何をするか」と「止まっている理由」を必ず持たせる。
- `RAW-DETAIL-REAUDIT-001`: raw chat text、電話原文、添付、連絡先詳細を表示する場合の `purpose`、再認可、read audit、request_id を共通helper/testへ寄せる。
- `ACCESS-MATRIX-COVERAGE-001`: `docs/compliance/access-control-policy.md` と `src/lib/auth/permission-matrix.ts` の capability差分を検査し、新機能PRがdocs/code/testsの片側更新で終わらないようにする。
- `STOCK-001-PRESCRIPTION-FOLLOWUP`: 処方供給adapter v1の残作業。manual retry API、DrugPackage/GS1 quantity conversion、review taskからのstock item作成/適用導線、prescription intake route integration testを追加する。完全一致しない供給を自動加算しない原則は維持する。

**次に着手する推奨順**:

1. `OPS-RECOVERY-LIVE-001`: human gate として本番相当roleで `--live-aws --strict`、admin health実AWS確認、restore drill evidenceを収集する。credentials/承認なしでは実行しない。
2. `DASH-P1-010-RAIL` + `DASH-P1-005-LINKS`: Dashboard Summary Rail と drilldown。既存BFFを再作成しない。
3. `INBOUND-002-REVIEW`: 3カラムreview shell + raw再認可detail。
4. `STOCK-001-PRESCRIPTION` follow-up: manual retry API、DrugPackage/GS1数量換算、review taskからの適用導線。
5. `MOV-001-API`: standalone movement API と formal source。
6. `FRONTEND-CONTRACT-001`: 7画面UI改善のslice contract / state matrix。
7. `PLANS-ACTIVE-LINT-001` + `PLAN-ARCHIVE-001`: reference spec と active backlog の分離を継続。

**Plans.md セクション分類**:

| Section                                                  | 扱い                        | 実装時の読み方                                                             |
| -------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| `Archived Plan Board v3`                                 | Archive                     | 2026-07-08時点の旧分類証跡。現在の入口ではない。                           |
| Archived `Implementation-ready queue` / `Frontend queue` | Archive                     | v3当時の抽出結果。現在は v8 の queue だけを実装入口にする。                |
| `Detailed Status Evidence Archive`                       | Archive                     | 実装済み証跡と旧分類の履歴。active backlog として数えない。                |
| `cc:PARTIAL`                                             | Reference + residual detail | 実装済み土台は再作成せず、残タスクをactive boardの対応IDへ戻してから着手。 |
| `cc:REFERENCE`                                           | Reference only              | 背景、受入条件、停止条件、仕様詳細。直接sprint backlog化しない。           |
| `cc:WIP`                                                 | Program context             | 大きなプログラム背景。実装する場合はactive boardへ小IDで切り出す。         |
| `cc:blocked` / Human gate                                | External gate               | Codexだけで完了扱いにしない。証跡、runbook、承認条件を残す。               |

### 2026-07-08 Detailed Status Evidence Archive — 旧分類証跡 `cc:REFERENCE`

> ここから下の旧 status 表は、2026-07-08 の分類作業で使った詳細証跡であり、実装入口ではない。
> 「この registry を入口にする」等の旧文言は当時の履歴として残すが、現在の active 入口は上の `Active Plan Board v8` のみ。

> 目的: `Plans.md` 内の古い TODO と最新 main の実装状態を混ぜない。実装済み項目は再タスク化せず、未実装項目だけを次PRに落とせる粒度へ拡充する。
> 根拠は 2026-07-08 時点の `git log --oneline -80`、現行コード検索、既存テスト、`ops/refactor/STATE.md`、`docs/compliance/access-control-policy.md`。
> 旧運用ではこの registry を `Plans.md` の入口にしていた。現在の実装判断は `Active Plan Board v8` を優先する。
> 下位セクションに古い `cc:TODO` や完了済み task が残っていても、同じIDについてはこの registry の status / 残スコープが優先される。

**ステータス定義**:

| 区分       | 判定基準                                                                 | Plans.md での扱い                                                           |
| ---------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 実装済み   | code / route / schema / test / commit evidence がある。                  | 再実装しない。下位セクションの旧TODOは「実装済み前提」へ圧縮する。          |
| 一部実装済 | 正本または初期BFFはあるが、UI、downstream、権限test、運用runbookが残る。 | 完了部分と残部分を同じ行で明記し、残は具体的PRへ切る。                      |
| 未実装     | 永続コードパス、schema、API、UI、test のいずれも確認できない。           | Active backlog として依存、受入条件、validation、停止条件を持たせる。       |
| Human gate | migration適用、AWS本番、restore drill、PMDA/法務/UAT等の外部作業。       | 実装タスクと混ぜず、前提条件・runbook・evidence collection として管理する。 |

**整理ルール（2026-07-08 追補）**:

- 旧運用では、この `Plan Status Registry` と下の `Implementation-ready queue` を入口にしていた。現在の実装判断は `Active Plan Board v8` を入口にする。
- 後段の長大な `cc:TODO` セクションは、業務仕様・背景・受入条件の reference spec として扱う。同じIDがこの registry で実装済みまたは一部実装済みになっている場合、後段の旧 checklist をそのまま再実装しない。
- 後段の見出しに `cc:REFERENCE` が付く場合は、直接の未実装TODOではなく、上位 queue の acceptance / 背景 / 仕様詳細として読む。実装着手前に必ず上位 queue の status と重複を確認する。
- 旧運用では `Plans.md` 内の active 実装入口をこの registry、`Implementation-ready queue`、`Frontend implementation queue` に限定していた。現在は v8 の queue に限定する。`cc:REFERENCE` 節のチェックボックスは、そのまま sprint backlog として数えない。
- 新規 task を追加する場合は、`ID / 優先度 / status / owner lane / 依存 / DoD / validation / stopping condition` を最低限持たせる。
- `Done` は「コード、テスト、push済み commit、または明確な実装ファイル」がある場合だけ使う。計画文書だけのものは `未実装`。
- `Partial` は「正本DB/APIやBFFはあるが、review UI、downstream、role test、visual/state QA が残る」状態に限定する。
- `Human gate` は migration適用、live AWS、restore drill、本番設定、法務/UAT のように Codex だけで完了宣言できないものに限定する。
- DB/auth/PHI/billing/migration/deploy を含む未実装 task は、実装前に `Oracle / GPT-5.5 Pro` または同等の厳格レビューを挟む。Oracle に相談する場合は上流 GitHub / current repo state を確認した前提を prompt に含める。
- UI/UX task は `docs/ui-ux-design-guidelines.md` と `docs/compliance/access-control-policy.md` を確認し、権限内の患者名・薬剤名・残数・本文・連絡先等は業務判断に必要なら表示してよい。制限は blanket redaction ではなく role / assignment / scope / consent / purpose / raw再認可で行う。

**2026-07-08 現行コード照合結果（今回の整理）**:

- 実装済みに分類するもの: Dashboard の lightweight summary / segment invalidation / inbound panel / stock-risks / report-billing / urgent主要source / ViewModel / Clock Island / segment payload budget、Inbound の正式 schema/API/task/risk、Medication Stock の schema/domain/summary/API/apply 初期版、Movement の tab/DTO/detail resolver / timeline list payload budget、AWS Backup read-only monitor、権限SSOT基本表、care-report non-palette `q` 患者検索の bounded/id-only 化、care-report keyword本文検索の bounded plus-one scan / truthful metadata 化、care-report index候補の SELECT-only EXPLAIN capture tool、critical read path query-shape watchlist guard。
- 一部実装済みに分類するもの: Dashboard UX統合、Inbound review UI、Medication Stock の処方・訪問・downstream接続、Movement standalone API/正式source、権限SSOTの新account種別同期、AWS live復旧証跡。
- 未実装として残すもの: `PERF-DB-006D-INDEX` の care-report index migration human gate、`API-CONTRACT-*`、`DB-EVENT-001`、`FILE-LIFE-001`、`TENANT-SUPPORT-001`、7画面UIの実装slice、live AWS human gate。
- 今回の追加照合で実装済みに分類するもの: dashboard segment payload budget、Movement timeline list payload budget、Inbound inbox/signals payload budget、MedicationStock summary payload budget、横断 perf-smoke matrix。`withRoutePerformance` は `Content-Length` がないと payload を `unmeasured` とするため、今後の critical read path も shared measured JSON helper を使う。残る payload-budget 未実装は patients board / reports 以外の remaining detail surfaces と、CI/環境別の運用展開である。
- 実装済みタスクは後段の `cc:REFERENCE` / `cc:WIP` checklist に残っていても active backlog から除外する。必要な背景は reference として残し、次PRは `Implementation-ready queue` / `Frontend implementation queue` の行からだけ切る。
- `care-reports` は `view=palette&q=` と通常list `q` 患者検索が bounded。`keyword` は cursor を拒否し、`CARE_REPORT_KEYWORD_SCAN_LIMIT=500` + plus-one read で overflow を検知し `search.count_basis='bounded_keyword_scan'` を返す。delivery summary は通常listでは既読page rows由来の `basis='page'`、keywordでは `basis='bounded_keyword_scan_result'` として全検索where aggregateを避ける。通常 list/search の `/api/care-reports` payload budget と summary/list boundary、SELECT-only EXPLAIN capture tool、query-shape watchlist guard は実装済み。残るDB速度課題は EXPLAIN artifact の実環境取得、rollback plan、human-gated index migration、watchlist拡張/CI定着である。

**2026-07-08 Archived Execution Board v2 — 旧分類証跡**:

> この board は `Plans.md` 後段の長い仕様群を直接 sprint backlog と誤読しないための実行入口である。
> 今回は `git log --oneline -40`、対象 route/service/type/doc の現行コード、`ops/refactor/STATE.md`、
> `docs/compliance/access-control-policy.md`、`docs/ui-ux-design-guidelines.md` を照合した。
> 下位 `cc:REFERENCE` / `cc:WIP` 節の未チェックboxは仕様背景であり、下表または
> `Implementation-ready queue` / `Frontend implementation queue` に昇格していないものは、次PR対象にしない。

| Bucket             | 今回の分類                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 実装判断                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Done / frozen      | dashboard segment payload budgets、patient movement timeline payload budget、inbound inbox/signals payload budgets、patient medication-stock summary payload budget、payload budget matrix smoke、care-report list payload budget、care-report bounded patient/keyword search、care-report delivery summary page-basis、care-report SELECT-only EXPLAIN tooling、critical read path query-shape watchlist guard、formal inbound schema/API/task/risk、MedicationStock schema/summary/accepted-signal apply、movement tab/common DTO/safe detail resolver、AWS backup read-only monitor、access-control policy base | 再実装しない。関連する後段TODOが残っていても、回帰防止testか残scopeだけを扱う。                                                             |
| Partial / residual | dashboard UX integration、inbound review/detail UX、MedicationStock prescription/visit/downstream、movement standalone API/formal sources、permission SSOT sync for future roles、module registry residual ports、live AWS recovery evidence                                                                                                                                                                                                                                                                                                                                                                       | 完了部分と残scopeを分け、残scopeだけを `Implementation-ready queue` / `Frontend implementation queue` の小IDへ切る。                        |
| Not started        | API envelope/error/request_id/cursor contract、DomainEventOutbox、FileAsset lifecycle、retention/legal hold、tenant support/session model、7画面UI slice contracts、route performance sink/CloudWatch integration                                                                                                                                                                                                                                                                                                                                                                                                  | 実装前に current code scan、DoD、validation、stopping condition を持たせる。DB/auth/PHI/billing/migrationはOracleまたは同等レビューを挟む。 |
| Human gate         | care-report index migration、live AWS restore drill、production AWS provisioning、PMDA/ISMS/UAT/legal、destructive or bulk migration, live data backfill                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Codexだけで完了扱いにしない。runbook、evidence、rollback、承認条件を残す。                                                                  |

**Archived execution lanes（v2当時の未実装候補）**:

| Lane                | 直近の未実装PR                                         | 拡充した実装Plan                                                                                                                                                                                                                                     | DoD / validation                                                                                                                          | Stopping condition                                                                                              |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Dashboard UX        | `DASH-P1-010-RAIL` + `DASH-P1-005-LINKS`               | Summary Rail、process tile clickable、hidden queue/carryover drilldownを追加する。既存 segment APIは再作成せず、必要なら合成view-modelから始める。                                                                                                   | dashboard component tests、relative href tests、mobile snapshot、render-boundary smoke。                                                  | summary/detailsの重複fetchを戻す設計、またはsigned/storage/external URLをaction hrefに入れる設計。              |
| Inbound workflow    | `INBOUND-002-REVIEW`                                   | 3カラムreview detail shellを作る。左=原文/添付/送信者/日時、中央=signal候補、右=反映先/Task/Record-only/Reject/MedicationStock。                                                                                                                     | raw omission list tests、detail re-auth/read-audit tests、review lifecycle tests、forbidden tests。                                       | raw_textを一覧、通知、監査差分、report自動本文へ流す必要が出たら停止。                                          |
| Medication Stock    | `STOCK-001-PRESCRIPTION` follow-up + `STOCK-001-VISIT` | 処方供給v1は実装済み。次は manual retry API、DrugPackage/GS1数量換算、review taskからの適用導線、訪問観測API/UIを別PRで実装。YJ/HOT/GS1(GTIN/JAN)/一般名/規格/剤形/メーカー候補、低confidence薬剤師review、append-only event、snapshot再計算を守る。 | API/integration tests、DrugPackage quantity conversion tests、review lifecycle tests、mobile observation tests、stockout forecast tests。 | 単位変換不能な供給を自動加算する設計、または他職種signalをreviewなしでledgerへ直書きする設計。                  |
| Patient Movement    | `MOV-001-API`                                          | standalone API と cursor/date/category filter は固定済み。残は map-less date card UX、formal inbound/stock/safety source、処方/訪問/文書 occurrence marker + deep link を整える。                                                                    | movement API tests、relative href tests、raw omission snapshot、mobile/a11y tests。                                                       | 一覧にSOAP本文、OCR全文、raw chat text、薬剤明細全文を出す必要が出たら停止。                                    |
| Permission / tenant | `PERM-DOC-SYNC-001` + `TENANT-SUPPORT-001`             | 新account種別/support mode/フリーランスassignment導入時は、capability表、permission-matrix、route forbidden tests、RLS proof、audit要件を同時更新する。                                                                                              | permission matrix tests、route forbidden tests、RLS proof、docs diff。                                                                    | support_sessionなしのtenant横断read/write、または文書だけ/コードだけの片側更新。                                |
| Durable backend     | `API-CONTRACT-*` + `DB-EVENT-001` + `FILE-LIFE-001`    | API envelope/request_id/error registry/cursor listを先に固定し、その後 DomainEventOutbox と FileAsset lifecycle を minimal payload / retention / legal hold と接続する。                                                                             | route snapshot tests、error registry tests、outbox payload PHI snapshot、FileAsset DTO snapshot。                                         | 既存routeを一括破壊する変更、outbox/file payloadに患者名・住所・薬剤名・free textを入れる設計。                 |
| Frontend            | `FRONTEND-CONTRACT-001` → 画面別slice                  | 7画面を一括改修せず、各画面に entrypoint、BFF/API、state matrix、PHI表示方針、mobile/a11y、right rail action、validation を持つslice contractを先に作る。                                                                                            | docs diff、component/API tests、exact-path lint、必要時 screenshot。                                                                      | 実在しないAPIを前提にproduction-like UIを作る設計、またはmovement/inbound/stockの実装済み土台を再作成する設計。 |
| Recovery / AWS      | `OPS-RECOVERY-LIVE-001`                                | `OPS-RECOVERY-EVIDENCE-001`、`OPS-RECOVERY-INTEGRITY-001`、`OPS-RECOVERY-MONITOR-003`、`OPS-RECOVERY-DOC-001` は実装済み。残は human gate として live AWS strict validation / restore drill evidence を収集する。                                    | backup-monitor regression、`backup:drill:check`、template validator、unsafe phrase rg、live AWS evidence。                                | runtime restore API、AWS destructive permission、PHI/ARN/endpoint/storage keyを出力する設計。                   |

**Derived tasks added by this cleanup**:

- `PLANS-ACTIVE-LINT-001`: `Plans.md` の active ID は `Plan Status Registry`、`Implementation-ready queue`、`Frontend implementation queue` に存在するものだけとし、後段 `cc:REFERENCE` / `cc:WIP` の未チェックboxを backlog 件数に数えない軽量lintまたは `rg` 手順を作る。
- `PLANS-ARCHIVE-002`: 後段のプロンプト型仕様を、削除ではなく `docs/plans-archive.md` または専用docsへのリンク化で圧縮する。active入口には status と残scopeだけを残す。
- `PAYLOAD-BUDGET-001C-A/B/C/D`（実装済み）: inbound inbox、inbound signals、patient medication-stock summary を measured JSON + route payload budget + additive count meta へ移行済み。今後は regression test と `PAYLOAD-BUDGET-001D` の横断smokeで守る。
- `PAYLOAD-BUDGET-001D`（実装済み）: `perf:smoke` に `--payload-budget-matrix` / `perf:smoke:payload-matrix` を追加し、configured GET payload budget route を route family ごとに独立測定する。matrix output は pathname のみを出し、query/search term/patientId/hash/header/body を出さない。`Content-Length` なしの configured route は runtime `withRoutePerformance` では `unmeasured` になるため `PAYLOAD_UNMEASURED` warning として失敗させる。
- `QUERY-SHAPE-TEST-002`（実装済み）: `tools/scripts/check-query-shape.mjs`、`tools/query-shape-watchlist.json`、`tools/query-shape-allowlist.json`、fixture tests を追加し、watchlist上の critical read path で broad include、unbounded `findMany`、missing stable `orderBy`、count/groupBy fan-out を検出する。現在 allowlist debt は 0。
- `QUERY-SHAPE-WATCHLIST-003A`（実装済み）: zero-debt watchlist batch を追加済み。対象は `src/app/api/care-reports/[id]/route.ts`、`src/lib/prescriptions/prescriber-institutions.ts`、`src/lib/reports/document-delivery-rules.ts`、`src/app/api/visit-schedules/route.ts`、`src/app/api/visit-preparations/brief-batch/route.ts`。allowlist debt は 0 のまま `pnpm db:query-shape:check` を通す。
- `QUERY-SHAPE-WATCHLIST-003B`: watchlist追加前に修正が必要なBFFを分ける。`patients/board` は nested relation bounds / `id` tie-breaker / rail read stable order を部分実装済み。残は main patient reads を DB側 `take: limit + 1` / cursor / truthful `count_basis` へ寄せる設計で、カード優先順位や安全患者を隠さないことを確認してから追加する。`visit-schedules/day-board` は hidden proposal `skip` scan、task aggregate fan-out、staff/shift/vehicle master reads、schedule/proposal order を整理してから追加する。
- `QUERY-SHAPE-WATCHLIST-003C`: reports / visit detail surfaces の cleanup を分ける。`care-reports/[id]` は nested `delivery_records` に `take` と `id` tie-breaker を入れる。`src/lib/contact-profiles.ts`、`visit-preparations/[scheduleId]`、`visit-brief.ts`、visit-record BFF は unbounded reads、broad include、aggregate fan-out、unstable top-N を直すまで watchlist に入れない。
- `QUERY-SHAPE-WATCHLIST-003D`（一部実装済み）: guard/test seam を強化済み。`tx.*.findMany` fixture、date-range-only unbounded fixture、nested relation `take` を top-level bound と誤認しないfixture、`patient-detail-timeline-registry` adapter-level query-shape test、MedicationStock snapshot fan-in scope/projection test を追加済み。`care-reports` 通常/keyword list は明示的な top-level `take` に整理済み。残る `care-reports/today-workspace` stable order / `take` assertions は同route修正PRで扱う。write-side ledger replay（例: accepted signal apply の full event replay）は read-path watchlist ではなく別ポリシーで扱う。
- `QUERY-SHAPE-WATCHLIST-003E`（read-shape実装済み）: `src/server/services/visit-schedule-service.ts` の list read を top-level `include` から explicit bounded `select` へ移行し、vehicle route validation read に stable `orderBy` を追加した。route test は `include` 不使用、root select、患者summary子relationの `org_id` / `take`、raw insurer番号非選択、response strip を検査する。service file は `tools/query-shape-watchlist.json` に追加済みで allowlist debt 0。RLS/requestContext の `withOrgContext` 化は auth semantics を変え得るため、別の permission/RLS proof task として扱う。
- `QUERY-SHAPE-WATCHLIST-003F`（read-shape実装済み）: `src/app/api/patients/[id]/movement-timeline/route.ts`、`src/app/api/patients/[id]/timeline/[eventId]/route.ts`、`src/app/api/visit-preparations/[scheduleId]/brief/route.ts` を watchlist に追加した。これらの route shell は直接DBを広く読まず、scoped serviceへ委譲する。今後 direct `findMany`、top-level `include`、aggregate fan-out が混入したら `pnpm db:query-shape:check` で止める。allowlist debt は 0。
- `DETAIL-SURFACE-REAUTH-001`: raw chat text、電話原文、添付、連絡先を detail/drawer で表示する共通条件を `purpose`、role/assignment/scope、read audit、request_id、no-store で固定する。
- `RIGHT-RAIL-ACTION-002`: dashboard、患者一覧、患者詳細、調剤、スケジュール、訪問、報告、他職種の右レール/下部CTAに「次に何をするか」と「止まっている理由」を最低1つずつ持たせるUI checklistを作る。
- `ACCESS-MATRIX-COVERAGE-001`: `docs/compliance/access-control-policy.md` と `src/lib/auth/permission-matrix.ts` の capability 差分を検査し、新機能PRがdocs/code/testsの片側更新で終わらないようにする。
- `OPS-RECOVERY-EVIDENCE-001`（実装済み）: `backup-recovery-check.ts` の `--append` は free text をそのまま永続化せず、ARN、account id、signed URL、token、db password、security group/subnet id、raw S3 key、患者名/電話らしき値を reject/redact する。live drill evidence は `environment`、ticket、approver、started/completed、RTO/RPO、health status、redaction check、sample counts などの構造化fieldへ寄せる。
- `OPS-RECOVERY-INTEGRITY-001`（実装済み）: `backup:drill:integrity` は復元済みDBまたはstaging/local DBへ SELECT-only で業務整合を検査する。患者・訪問・報告・請求/タスク・添付・監査ログ・Inbound/MedicationStock の count / orphan / latest timestamp / link integrity / RPO補助を PHI-free に出力し、`DATABASE_URL` が production-like の場合は `--allow-production` なしで拒否する。pg session は `default_transaction_read_only=on` に固定し、CLI failure path も provider raw error / endpoint / URL を丸める。
- `OPS-RECOVERY-MONITOR-003`（実装済み）: S3 Object Lock の read-only monitor と production strict mode を追加済み。Object Lock は `enabled`、mode、default retention だけを返し、bucket名/ARN/keyは出さない。production/admin evidence では backup-specific env 不足や critical skipped check を warning/degraded として扱う。今後は regression と live evidence human gate で守る。
- `OPS-RECOVERY-DOC-001`（実装済み）: `docs/compliance/backup-recovery-drill.md` を復旧SSOTにし、root `docs/backup-recovery-drill.md` は historical/reference と明記した。標準訓練から広範なAWS管理ポリシー前提、実データS3 key、unapproved migration apply、S3 destructive examples を外し、least-privilege / non-destructive / synthetic-drill-only 手順へ整合した。

**2026-07-08 Cleanup pass 2 — 実装済み / 未実装の分類ゲート**:

| Gate                  | 判定                                                                                     | Plans.md での処理                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Done evidence gate    | code path、test、commit/STATE evidence、または現行 route/service が確認できる。          | active queue から外す。下位 reference の未チェックboxは背景として残し、同じIDを再実装しない。            |
| Partial residual gate | 正本DB/API/BFFはあるが、review UI、downstream、role/forbidden tests、運用証跡が残る。    | 完了部分を固定し、残scopeだけを小IDへ切る。既存 schema/API を再作成しない。                              |
| Not-started gate      | 永続 code path がなく、計画文だけがある。                                                | 実装前に entrypoint、依存、DoD、validation、stopping condition を補い、active queue に昇格してから着手。 |
| Human-gate gate       | migration適用、live AWS、restore drill、法務/PMDA/UAT、production data mutation が必要。 | Codexだけで完了扱いにしない。runbook、evidence、rollback、承認条件を計画に残す。                         |
| Reference-only gate   | `cc:REFERENCE` / `cc:WIP` 配下の業務背景、受入条件、古い checklist。                     | sprint backlog として数えない。実装する場合は上位 queue へ新IDとして昇格する。                           |

**未実装Plan拡充マップ（次PRへ切る粒度）**:

| Area                | まず切るPR                                                                                                               | 再実装しないもの                                                                                         | 追加すべき acceptance / validation                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Dashboard UX        | `DASH-P1-010-RAIL` と `DASH-P1-005-LINKS` を分ける。Railは既存segments合成、Linksは相対URL builderとdrilldown tests。    | summary/details軽量化、urgent DTO、inbound/stock/report-billing segments、Clock/ViewModel。              | mobile rail変形、0件tile遷移、hidden/carryover drilldown、render-boundary smoke。                                      |
| Inbound review      | `INBOUND-002-REVIEW` は detail shell + raw再認可 + read audit を先に作る。                                               | formal InboundEvent/Signal schema、phone/MCS create、inbox、signal materialize、task/risk bridge。       | raw_text list omission、detail purpose/re-auth、review lifecycle、MedicationStock apply forbidden/allowed tests。      |
| Medication Stock    | 処方供給adapter v1は実装済み。次は `STOCK-001-PRESCRIPTION` follow-up と `STOCK-001-VISIT` を別PRにする。                | schema、append-only event、snapshot、accepted inbound signal apply、summary API、完全一致処方供給apply。 | DrugPackage/GS1 quantity conversion、manual retry API、review lifecycle、stockout forecast、mobile input tests。       |
| Patient Movement    | `MOV-001-API` は standalone API + map-less date cards + formal source adapters を対象にする。                            | movement tab、Timeline DTO、safe detail resolver、処方/訪問/文書 occurrence marker。                     | relative href、raw omission、date grouping、inbound/stock/safety source parity、mobile/a11y。                          |
| API contracts       | `API-CONTRACT-001` は代表routeから envelope / error / request_id を段階導入し、allowlistを減らす。                       | 既存 response guardrail と route catalog。                                                               | route snapshot、frontend reader、compatibilityError internal-only、request_id in success/error/audit。                 |
| Durable backend     | `DB-EVENT-001` と `FILE-LIFE-001` は migration design first。実装は additive schema + PHI-minimized payload tests から。 | 既存 WebhookDelivery/FileAsset 基礎service。                                                             | outbox payload PHI snapshot、FileAsset DTO snapshot、retention/legal-hold matrix、migration rollback plan。            |
| Permission / tenant | `TENANT-SUPPORT-001` は capability table + threat model + additive schema design を先に固定する。                        | access-control policy base、permission-matrix base。                                                     | support_session required tests、tenant-crossing forbidden tests、RLS proof、audit requirement、Oracle/security review. |
| Recovery evidence   | `OPS-RECOVERY-EVIDENCE-001` は実装済み。live復元自体はしない。                                                           | `backup-recovery-check.ts`、`external-readiness.ts`、drill docs。                                        | 今後は regression と live evidence収集のhuman gateで守る。                                                             |
| Recovery integrity  | `OPS-RECOVERY-INTEGRITY-001` は実装済み。live復元自体はしない。                                                          | `backup:drill:integrity`、backup drill docs、Prisma schema、read-only monitoring方針。                   | 今後は regression と live restore drill 前後の human-run evidence で守る。                                             |
| Recovery monitor    | `OPS-RECOVERY-MONITOR-003` は実装済み。restore/deleteはしない。                                                          | backup monitor、health sanitizer、S3/Object Lock方針。                                                   | 今後は backup-monitor regression、health redaction、strict skipped-check tests で守る。                                |
| Recovery / AWS      | `OPS-RECOVERY-LIVE-001` は live evidence collection。runtime restore APIは作らない。                                     | AWS Backup read-only monitor、template validator、backup docs。                                          | `--live-aws --strict` result、admin health AWS evidence、restore drill record、RTO/RPO、redaction check。              |
| Frontend 7 screens  | `FRONTEND-CONTRACT-001` で7画面の contract/state matrix を先に書く。各画面は Layout/Interaction/State-QA に分ける。      | AppShell、Sidebar、WorkspaceActionRail、Movement/Inbound/Stockの既存土台。                               | imagegen要否、state fixtures、mobile drawer/sheet、keyboard path、PHI/detail境界、exact-path lint/screenshot。         |

**Archive / reference 整理候補**:

- `直近トラック: 開発方針 2026-07-03` は大枠の program context として残すが、active task は `Implementation-ready queue` の小IDへ昇格してから扱う。
- `訪問スケジュール自動提案` と `横断リスク改善` は reference spec として残し、実装単位は `VS-AUTO-*` / `RISK-*` から active queue へ切り出す。
- `Medication Stock Ledger` の長文仕様は現行 schema/domain/処方供給v1 実装済み部分を再タスク化せず、処方供給follow-up、訪問観測、equivalence review、downstream connection だけを active に残す。
- UI/UX全面改善プロンプトは `FRONTEND-CONTRACT-001` の reference として扱い、7画面一括PRは禁止する。
- この archive 整理は内容喪失を避けるため、削除ではなく `docs/plans-archive.md` または専用 reference doc へのリンク化で行う。

**全体ステータス索引**:

| Track                    | Status     | 再実装しない完了範囲                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 未実装 / 残スコープ                                                                                                                                         |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DASH-OPS`               | 一部実装済 | summary/details軽量化、segment invalidation、inbound / stock-risks / report-billing segment、urgent主要source、ViewModel hook、Clock Island。                                                                                                                                                                                                                                                                                                                                                                       | Summary Rail、process tile clickable、drilldown最終UX、quick action安全境界、density/semantic tone、visual regression。                                     |
| `INB-001`                | 一部実装済 | `InboundCommunicationEvent` / `InboundCommunicationSignal` schema、RLS、phone/MCS登録、inbox、signal materialize、task/risk。                                                                                                                                                                                                                                                                                                                                                                                       | 3カラムreview UI、raw_text再認可detail、FAX/email/manual、source mapping UI、VisitBrief/Schedule/Report/Share downstream。                                  |
| `RX-002` / Stock         | 一部実装済 | MedicationStock schema、RLS/index、domain skeleton、stockout/equivalence helper、患者別summary API、accepted signal apply。                                                                                                                                                                                                                                                                                                                                                                                         | 処方供給adapter、訪問観測API/UI、usage-delta/frequency/refill、equivalence review UI、stock risk provider完全統合、VisitBrief/Schedule/Report/Share接続。   |
| `MOV-001`                | 一部実装済 | `movement` tab、`PatientMovementTimeline`、共通DTO、safe detail resolver、処方/訪問/文書のoccurrence-only土台、timeline list payload budget。                                                                                                                                                                                                                                                                                                                                                                       | standalone movement-timeline API、map-less date card UX、正式 inbound / stock / safety source、deep link coverage、raw再認可detail。                        |
| `OPS-RECOVERY-002`       | 一部実装済 | AWS Backup vault / recovery point / RDS backup settings の read-only health monitor、sanitizer、IAM forbidden-action validator、構造化/redaction付き recovery evidence append。                                                                                                                                                                                                                                                                                                                                     | 本番相当roleの `--live-aws --strict`、admin health実AWS確認、live restore drill evidence収集。runtime restore APIは作らない。                               |
| `PERM-DOC-001`           | 一部実装済 | `docs/compliance/access-control-policy.md` と `permission-matrix.ts` に基本 capability matrix がある。                                                                                                                                                                                                                                                                                                                                                                                                              | 新account種別 / support mode / assignment導入時の表・route tests・RLS proof・audit要件同期。                                                                |
| `MOD-*` backend boundary | 一部実装済 | module boundary ratchet、collaboration/risk provider contract、TaskTypeRegistry guardrail、直接import削減の一部。                                                                                                                                                                                                                                                                                                                                                                                                   | report/share/data crosswalk、DomainEventOutbox、module metadata、service_line/discipline/task.module migration plan。                                       |
| `RISK-*`                 | 一部実装済 | Case Risk Cockpit と risk/task bridge の基礎、inbound/stock初期risk source。                                                                                                                                                                                                                                                                                                                                                                                                                                        | 未接続domain adapters、domain別resolve predicate、billing/report/notification孤児task防止、risk UI regression pack。                                        |
| `VS-AUTO`                | 一部実装済 | proposal-first土台、planner、availability helper、proposal approve/contact/confirm flow。                                                                                                                                                                                                                                                                                                                                                                                                                           | DeadlinePolicy、direct generate cordon、review fields migration、PRN/topical stock hard gate、overload apply、Google matrix provider。                      |
| `UI-REDESIGN-001`        | 未実装     | 計画・品質基準・slice contractのみ。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 7画面を一括変更せず、Contract / Layout / Interaction / State-QA に分割して current path を上書き改善する。                                                  |
| `PERF-DB-001`            | 一部実装済 | inbound-only queue source gating、report workspace inbound evidence direct count、dashboard stock signal count consolidation、patient detail root scoped read + timeline fan-out removal、patient master bounded select、movement timeline caller-limit-aware source reads、patients board nested relation bounds / stable order、dashboard / patient timeline / inbound / stock measured payload budgets、payload budget matrix smoke、care-report SELECT-only EXPLAIN capture tool、query-shape watchlist guard。 | care-report EXPLAIN artifact取得 / index migration human gate、patients board main cursor redesign、query-shape watchlist拡張、環境別 perf-smoke 実行証跡。 |
| `API-CONTRACT-*`         | 未実装     | guardrail は存在するが response envelope / request_id / error registry / cursor list contract は未統一。                                                                                                                                                                                                                                                                                                                                                                                                            | API envelope、error code registry、request_id propagation、cursor list response、action namingをリリース前に固定する。                                      |
| `FILE/DATA/WEBHOOK`      | 未実装     | FileAsset / WebhookDelivery / retention の既存schemaと基礎serviceはある。                                                                                                                                                                                                                                                                                                                                                                                                                                           | FileAsset lifecycle、scan/retention/legal hold、webhook payload minimization、DomainEventOutboxを順に実装する。                                             |
| `FE-FOUNDATION`          | 一部実装済 | AppShell、Sidebar、MobileNav、SegmentError、DataTable、WorkspaceActionRail、dynamic tabs の基礎。                                                                                                                                                                                                                                                                                                                                                                                                                   | 患者詳細 island split、訪問記録 section split、mobile contextual CTA、storage PHI audit、interaction budget instrumentation。                               |
| `RELEASE/OPS`            | 一部実装済 | pilot readiness、performance utilities、backup monitor、route/auth guardrails、構造化 recovery evidence gate の基礎。                                                                                                                                                                                                                                                                                                                                                                                               | live AWS drift gate、CloudWatch alarm baseline、live restore drill evidence収集、production metrics persistence。                                           |
| `TENANT-*` / support     | 未実装     | platform operator console design、break-glass方針、権限SSOTの一部。                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Global User/Membership/Grant/Assignment、SupportSession、RLS context extension、forbidden tests。high-risk migration/human gate。                           |

**実装済み / 再タスク化しない項目**:

| 領域       | 実装済み内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 根拠例                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 残すべき扱い                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Dashboard  | Lightweight summary builder / summary-details 重複取得削減。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `512aeecda`, `3c59e8a7`, `src/server/services/dashboard-cockpit.ts` の `readAuditQueueSummary()` / `readTodayVisitSummary()`。                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `DASH-P0-002` は完了。追加は p95/payload smoke のみ。                                                                   |
| Dashboard  | Segment-specific realtime invalidation と inbound segment 初期導入。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `e024b66c5`, `src/app/(dashboard)/dashboard/dashboard-cockpit.tsx`、`/api/dashboard/cockpit/inbound`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 新segment追加時だけ同方針を踏襲。                                                                                       |
| Dashboard  | Unified Urgent Queue の主要 source。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `8907b2042`, `32e599bb7`, `b232a0a43`, `505022bca`, `be134449c`, `684d33139`, `e04af174f`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 残は source別 drilldown、role priority tuning、quick actions。                                                          |
| Dashboard  | ViewModel hook と Clock Island。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `src/app/(dashboard)/dashboard/use-dashboard-cockpit-view-model.ts`、`src/app/(dashboard)/dashboard/dashboard-clock.tsx`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `DASH-P0-004/005` は完了。残は render boundary evidence と visual regression。                                          |
| Dashboard  | Stock-risks / report-billing segment API。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `11db29fb3`, `3ce410210`, `ce28a01d3`, `/api/dashboard/cockpit/{stock-risks,report-billing}` tests。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 残は左レール/画面統合、snapshot本体連動、visual regression。                                                            |
| Inbound    | 正式 `InboundCommunicationEvent` / `InboundCommunicationSignal` schema、RLS、phone/MCS登録、inbox、task bridge、risk bridge。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `e024b66c5`, `d994ad693`, `46f2df1a8`, `prisma/schema/communication.prisma`、`src/app/api/communications/inbound/**`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 残は3カラムreview UI、raw detail再認可、FAX/メール/手入力。                                                             |
| Stock      | Medication Stock Ledger schema、append-only event、患者別summary API、inbound signal apply初期版、stockout/equivalence helper、処方供給adapter v1。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `9a62e12c2`, `52b26755c`, `c5c2ce7cb`, `46f2df1a8`, `src/modules/pharmacy/medication-stock/**`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 残は処方供給follow-up、訪問観測、usage/refill、UI、VisitBrief/Schedule。                                                |
| Movement   | `PatientMovementTimeline`、共通DTO、safe detail resolver API、処方/訪問/文書の occurrence-only 表示土台、`/api/patients/:id/movement-timeline` payload budget / measured response。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `1ae268009`, `src/app/(dashboard)/patients/[id]/patient-movement-timeline.tsx`, `src/types/patient-movement-timeline.ts`, `src/app/api/patients/[id]/timeline/[eventId]`, `src/app/api/patients/[id]/movement-timeline/route.ts`, `src/lib/utils/route-payload-budgets.ts`。                                                                                                                                                                                                                                                                                                               | 残は日付UI仕上げ、全source parity。                                                                                     |
| AWS Backup | RDS/AWS Backup baseline、recovery point monitor、Restore Testing metadata、IaC validation、read-only assurance health hardening、`backup:drill:check --append` の構造化/redaction/fail-closed evidence gate。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `9a62e12c2`, `0d2f025a4`, `3ccc8b8e2`, `src/server/services/backup-monitor.ts`, `src/app/api/health/route.ts`, `tools/scripts/backup-recovery-check.ts`, `src/lib/operations/external-readiness.ts`, `docs/compliance/backup-recovery-drill.md`。                                                                                                                                                                                                                                                                                                                                          | 残は live AWS strict validation、live drill evidence収集、復元済みDB integrity audit。                                  |
| 権限SSOT   | アカウント種別 / capability matrix の文書化。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `docs/compliance/access-control-policy.md`、`src/lib/auth/permission-matrix.ts`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 残は新account種別/新機能ごとの同期testと更新運用。                                                                      |
| DB速度     | inbound inbox / report workspace の不要な queue fan-out 削減、dashboard stock signal count consolidation、patient detail root scoped read / timeline fan-out removal、patient overview base の bounded select 化、movement timeline の caller-limit-aware source read、care-report non-palette q患者検索の bounded/id-only 化、care-report keyword本文検索の plus-one bounded scan / truthful metadata 化、care-report delivery summary の page-basis 化、patients board nested relation bounds / stable order、care-report list/search payload budget + summary/list boundary、dashboard segments / patient timeline measured payload budgets、care-report index候補の SELECT-only EXPLAIN capture tool、query-shape watchlist guard。 | `src/server/services/communication-queue.ts` の `sourceScope: 'requested'`、`src/app/api/care-reports/today-workspace/route.ts`、`readDashboardMedicationStockSignalRisks()`、`5fdea246e`、`src/server/services/patient-overview-base-query.ts`、`src/server/services/patient-detail-timeline-registry.ts`、`src/app/api/care-reports/route.ts`、`src/app/api/patients/[id]/movement-timeline/route.ts`、`src/app/api/patients/board/route.ts`、`src/lib/utils/route-payload-budgets.ts`、`tools/scripts/explain-care-report-index-candidates.ts`、`tools/scripts/check-query-shape.mjs`。 | 残は `PERF-DB-006D-INDEX`、patients board main cursor redesign、query-shape watchlist拡張、環境別 perf-smoke 実行証跡。 |

**Active backlog — 未実装 / 一部実装済みの拡充タスク**:

| ID                         | 優先度 | 分類                       | 依存 / 既存足場                                                                                      | 拡充Plan / 受入条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | validation / evidence                                                                                                                                             |
| -------------------------- | ------ | -------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLANS-HYGIENE-001          | P0     | 計画運用                   | この registry、`docs/plans-archive.md`                                                               | 新規Plan行には status、owner lane、根拠ファイル、依存、acceptance、validation を持たせる。実装済み項目はこの registry へ移し、同じIDの重複TODOを作らない。月次または主要PR後に `git log` と `rg` で status を更新する。                                                                                                                                                                                                                                                                                                                                                       | `rg` で同一ID重複を確認。実装済みIDが active checklist に残っていないこと。                                                                                       |
| PLANS-HYGIENE-002          | P1     | 計画運用                   | 3,000行超の `Plans.md`、既存 `docs/plans-archive.md`                                                 | 下位の長大プロンプト型仕様は active task と reference spec に分ける。active はこの registry + 各trackの残テーブル、reference は `docs/plans-archive.md` または専用docsへ移す。削除は内容喪失ではなくリンク化で行う。                                                                                                                                                                                                                                                                                                                                                          | Markdown link check、`Plans.md` の active TODO が実装可能粒度だけになっていること。                                                                               |
| PLANS-HYGIENE-003          | P1     | 計画運用                   | `Plans.md` 上位 registry、実装済み詳細契約、`docs/plans-archive.md`                                  | 実装済みの詳細契約を active 入口から外し、必要なら archive/reference へ移す。上位 registry では完了範囲を根拠ファイルと1行要約だけに圧縮し、詳細な「やること/tests」は未実装だけに残す。                                                                                                                                                                                                                                                                                                                                                                                      | active 入口に「実装前に失敗する前提の文言」や完了済み詳細契約が残らないこと。                                                                                     |
| PERF-DB-001                | P0/P1  | DB速度                     | dashboard segments、patients board、patient detail、movement timeline、inbound queue、stock、reports | 患者一覧、患者詳細、dashboard segments、movement timeline、inbound queue、medication-stock summary、report workspace の read path を棚卸しする。`EXPLAIN` 可能なquery、payload size、N+1、unbounded `findMany`、重複fetch、RLS条件を記録し、既存 index で足りない箇所だけ migration 案にする。blind index 追加は禁止。                                                                                                                                                                                                                                                        | query inventory、payload budget表、focused perf smoke。index案は `EXPLAIN` と rollback plan 必須。                                                                |
| PERF-DB-006                | P1     | DB速度/検索                | `/api/care-reports`, Prisma schema indexes                                                           | `PERF-DB-006A/B/C` は完了。残は pg_trgm/composite index 評価へ分離する。候補index: `CareReport(org_id, created_at DESC, id DESC)`, `CareReport(org_id, patient_id, created_at DESC, id DESC)`, `CareReport(org_id, status, created_at DESC, id DESC)`, `DeliveryRecord(org_id, report_id, created_at DESC, id DESC)`, `DeliveryRecord(org_id, status, sent_at, report_id)`, `Patient.name/name_kana` の pg_trgm。                                                                                                                                                             | payload budget、query-shape tests、SELECT-only EXPLAIN、migration rollback plan before index addition。                                                           |
| QUERY-SHAPE-WATCHLIST-003  | P1     | DB速度/品質                | `tools/scripts/check-query-shape.mjs`, `tools/query-shape-watchlist.json`                            | `003A` zero-debt batch、`003D` guard/test seam、`003E` visit-schedule-service read-shape ratchet、patients board nested relation bounds / stable order は実装済み。残は patients board main cursor redesign、day-board、contact profiles、visit-preparation detail、visit-brief、visit-record BFF。各対象は unbounded reads、broad include、unstable top-N、aggregate fan-out を直してから watchlist へ追加する。RLS/requestContext の `withOrgContext` 化は DB速度ではなく permission/RLS proof task として扱う。                                                            | `pnpm db:query-shape:check`、fixture tests、focused route/service tests、CI/perf-smoke wiring evidence。                                                          |
| DASH-STATUS-001            | P0/P1  | Dashboard                  | `DashboardCockpit`, `DashboardUrgentItem`, `useDashboardCockpitViewModel`, `dashboard-clock`         | `DASH-P0-004/005` は実装済みに移す。残P1は Summary Rail / process clickable / drilldown / role layout / quick actions、P2は density / semantic tone / visual regression / render-boundary evidence に整理する。既存 `stock-risks` / `report-billing` API は再作成しない。                                                                                                                                                                                                                                                                                                     | dashboard focused tests、render-boundary smoke、relative href tests、mobile snapshot。                                                                            |
| INBOUND-STATUS-001         | P0/P1  | Inbound                    | 正式 inbound schema/API、task/risk bridge、MedicationStock apply                                     | 正本DB/API/Task/Risk/MedicationStock apply は実装済みとして固定する。残は review detail shell、raw_text再認可、FAX/email/manual source、source mapping UI、VisitBrief/Schedule/Report/Share downstream に分割する。                                                                                                                                                                                                                                                                                                                                                           | raw omission tests、review lifecycle tests、audit/read-reason tests、forbidden tests。                                                                            |
| STOCK-STATUS-001           | P0/P1  | Stock                      | MedicationStock schema/domain/summary/apply、DrugMaster/DrugPackage                                  | DB/schema/summary/apply初期版は再実装しない。残は prescription supply adapter、visit observation UI/API、usage-delta/frequency/refill request、equivalence review UI、stockout provider、backfill、VisitBrief/Schedule/Report/Share連動に分割する。                                                                                                                                                                                                                                                                                                                           | stock adapter unit/API tests、idempotency、role/scope tests、risk/task bridge tests。                                                                             |
| MOV-STATUS-001             | P0/P1  | Movement                   | movement tab、timeline DTO、safe resolver、standalone API、cursor/date/category filter               | `PatientMovementTimeline` 土台は再実装しない。残は map-less date card UX、formal inbound/stock/safety sources、relative href builder、raw detail再認可。処方・訪問・文書は occurrence marker + deep link のまま維持する。                                                                                                                                                                                                                                                                                                                                                     | movement API tests、raw omission snapshot、relative href tests、mobile/a11y tests。                                                                               |
| UI-STATUS-001              | P1     | Frontend                   | `UI-REDESIGN-001`, `docs/ui-ux-design-guidelines.md`                                                 | `UI-REDESIGN-001` は見た目の全面作り直しではなく既存 current path の上書き改善。各画面は paired backend task、DTO readiness、権限内表示方針、raw/detail境界、mobile/a11y、validation を持つ slice contract にしてから着手する。                                                                                                                                                                                                                                                                                                                                               | UI slice template、state matrix、focused component/API tests、exact-path lint、必要時 screenshot。                                                                |
| PERM-DOC-001               | P0/P1  | 権限SSOT                   | `docs/compliance/access-control-policy.md`, `permission-matrix.ts`, RLS proof                        | 新規 account 種別（フリーランス薬剤師、PH-OS運営者support mode、外部連携者、施設/家族）を導入するPRでは、capability表、scope、consent、support_session、audit requirement、forbidden test を同時更新する。                                                                                                                                                                                                                                                                                                                                                                    | permission matrix tests、route forbidden tests、RLS proof、docs diff。                                                                                            |
| OPS-RECOVERY-INTEGRITY-001 | P0/P1  | AWS復旧/DB整合（実装済み） | `backup:drill:integrity`, backup drill docs、Prisma schema、read-only recovery policy                | 復元済みDBへ対して SELECT-only で業務整合を検査するCLIを実装済み。対象は患者、訪問予定/記録、報告書/送付、請求候補/タスク、FileAsset、AuditLog、Inbound/MedicationStock の主要link/count/latest timestamp/RPO補助。出力はcount/status/timestamp/issue countに限定し、患者名、薬剤名、住所、電話、free text、storage key、ARN、endpoint、raw provider errorを出さない。`DATABASE_URL` が production-like の場合は `--allow-production` なしで停止する。                                                                                                                        | regression tests、PHI-free output snapshot、production URL guard、`backup:drill:check` で守る。DB mutation / restore API / AWS destructive call は引き続き禁止。  |
| OPS-RECOVERY-MONITOR-003   | P1     | AWS復旧監視（実装済み）    | `backup-monitor.ts`, health route, S3 compliance docs                                                | S3 Object Lock configuration を read-only で確認し、admin health には enabled/mode/default retention の safe fields だけを返す。production/strict evidence mode では backup vault/RDS/S3/audit archive/Cognito など critical check が設定不足で skip された場合に warning/degraded とする。snapshot id、bucket名、vault名、user pool id は health output からomitする。                                                                                                                                                                                                       | backup-monitor tests、health redaction tests、strict-mode testsで守る。restore/delete/put-secret/pass-role が必要になったら停止。                                 |
| OPS-RECOVERY-DOC-001       | P1     | AWS復旧文書（実装済み）    | `docs/compliance/backup-recovery-drill.md`, `docs/backup-recovery-drill.md`                          | compliance doc を復旧SSOTにし、root runbook は historical/reference と明記済み。least-privilege role、dedicated recovery VPC/subnet/security group、synthetic/drill-only S3 prefix、SELECT-only integrity before migration、explicit ticket/approver へ整合した。広範なAWS管理ポリシー前提、実データS3 key、delete/copy-object、unapproved migration は標準訓練から外した。                                                                                                                                                                                                   | unsafe phrase rg、Prettier、diff check、backup drill preflight、template validator で守る。緊急時break-glass権限やPHI sample方針は live drill human gate で扱う。 |
| OPS-RECOVERY-002-HG        | P0/P1  | AWS復旧                    | read-only backup monitor、backup drill docs、template validator                                      | 残: `--live-aws --strict` と本番相当 role での AccessDenied/allow確認、admin `/api/health` の実AWS確認、live drill evidence。runtime `StartRestoreJob` API は作らず、復元は runbook / AWS console / controlled ops で行う。                                                                                                                                                                                                                                                                                                                                                   | live AWS validator result、drill record、RTO/RPO evidence、redaction check。                                                                                      |
| ROUTE-LINK-001             | P1     | 派生/横断                  | dashboard drilldown、movement links、inbound/stock deep links                                        | dashboard urgent、movement timeline、inbound review、stock panel の相対URL builderを統一する。外部URL、storage URL、signed URLはaction hrefに入れない。未実装詳細は safe fallback route へ寄せる。                                                                                                                                                                                                                                                                                                                                                                            | href allowlist unit tests、relative URL tests、forbidden/fallback tests。                                                                                         |
| PAYLOAD-BUDGET-001         | P1     | 派生/性能/PHI              | dashboard segments、movement API、patients board、inbound/stock                                      | dashboard segments、movement timeline、inbound inbox/signals、patient medication-stock summary、横断 perf-smoke matrix は payload budget 済み。残は patients board / reports 以外の remaining detail surfaces と運用環境別の matrix実行定着。list/summary DTO は `visible_count` / `hidden_count` / `generated_at` / `partial_failures` を持ち、raw text、storage key、signed URL、provider raw errorを含めない。権限内 detail surface では患者名・薬剤名・本文・連絡先・添付等の判断情報を表示してよいが、summary/list payload は肥大化させず、詳細/preview/drawerへ分ける。 | DTO snapshot、payload size smoke、PHI omission snapshot、forbidden tests。                                                                                        |

**実装済み詳細契約の扱い**:

- `PERF-DB-005B` の broad patient master include 排除は実装済み。active 入口に詳細な実装前契約は残さず、再発防止は route/service test と `PERF-DB-001` / `PAYLOAD-BUDGET-001` の payload/query-shape smoke で扱う。
- 実装済み詳細を調べる場合は、`git log`、該当 route/service test、`docs/plans-archive.md`、`ops/refactor/STATE.md` の landed slice evidence を確認する。

**派生タスクとして今回の整理で追加したもの**:

- `PERF-DB-002`（実装済み）: `readDashboardMedicationStockRisks()` の inbound signal count fan-out を `readDashboardMedicationStockSignalRisks()` の window aggregate reader へ寄せる。
- `PERF-DB-003`（実装済み）: inbound-only queue request で unrelated queue sources を読まない source gating を入れる。
- `PERF-DB-004`（実装済み）: report workspace の action rail 用 inbound evidence を full queue reader から直接 count helper へ置換する。
- `PERF-DB-005A`（実装済み）: legacy patient detail root GET を scoped transaction へ寄せ、timeline-only fan-out を削除する。
- `PERF-DB-005B`（実装済み）: root/overview base の broad patient master include を bounded select / relation take へ置換する。
- `PERF-DB-006A`（実装済み）: care-report list/search の non-palette patient search を bounded/id-only/stable order にする。palette search は既に bounded なので再実装しない。
- `PERF-DB-006B`（実装済み）: care-report keyword scan は `CARE_REPORT_KEYWORD_SCAN_LIMIT=500` + plus-one read にし、overflow を `search.keyword_scan_truncated` / `count_basis='bounded_keyword_scan'` で明示する。cursor paginationは引き続き拒否し、矛盾する `nextCursor` は返さない。
- `PERF-DB-006C`（実装済み）: care-report delivery summary は通常listでは `basis='page'` として既取得page rowsから生成し、`DeliveryRecord` count/groupBy/findMany fan-outを廃止する。keywordでは bounded scan結果に基づく `basis='bounded_keyword_scan_result'` とする。
- `PERF-DB-006D-EXPLAIN`（実装済み）: care-report index候補の SELECT-only EXPLAIN capture script / artifact を追加済み。DDL/DML、migration適用、live ANALYZE は含めない。
- `PERF-DB-006D-INDEX`: care-report index backlog は blind migration ではなく SELECT-only EXPLAIN と rollback plan 後に human gate へ送る。
- `CARE-REPORT-SEARCH-TEST-001`: `PERF-DB-006A/B/C` と `PAYLOAD-BUDGET-003` の regression tests は実装済み。残は `PERF-DB-006D` の SELECT-only EXPLAIN 証跡に限定する。
- `PAYLOAD-BUDGET-003`（実装済み）: `/api/care-reports` list/search payload budget を追加し、summary/list rows に `delivery_records` 配列、delivery raw detail、`pdf_url`、search helper、content-derived billing context を戻さない。
- `PERF-DB-007`（実装済み）: movement timeline の caller `timelineLimit` を `TimelineFetchCtx` に渡し、false recency を起こしにくい source だけ per-source `take` を caller limit + buffer へ縮小する。`visit_schedule`、operation-history seed、child-event source は既定 cap を維持する。
- `PLANS-HYGIENE-002`: 長大なプロンプト型仕様を active backlog と reference docs に分け、実装済みTODOを `Plans.md` から圧縮する。
- `ROUTE-LINK-001`: dashboard / movement / inbound / stock の deep link builder を統一する。
- `PAYLOAD-BUDGET-001`: UI改善前に list/summary DTO の payload budget と PHI omission snapshot を固定する。
- `PLAN-ARCHIVE-001`: registry で完了扱いにした旧プロンプト型セクションを、実装判断ではなく reference spec として `docs/plans-archive.md` へ段階移管する。
- `FRONTEND-CONTRACT-001`: 7画面UI改善を「見た目PR」ではなく contract / layout / interaction / state-QA の4種類へ分類し、各PRに paired backend task、DTO owner、state matrix、mobile/a11y、validation を要求する。
- `PLANS-HYGIENE-003`: 実装済みの詳細契約を active 入口から削除し、未実装だけが `DoD / validation / stopping condition` を持つ状態を維持する。

**次に着手する推奨順**:

1. `DASH-P1-010-RAIL` + `DASH-P1-005-LINKS` Dashboard Summary Rail と process tile / drilldown。
2. `FRONTEND-CONTRACT-001` 7画面UI改善の slice contract / state matrix 整理。
3. `QUERY-SHAPE-WATCHLIST-003` zero-debt watchlist batch 追加後、patients board / day-board / visit detail BFF の query-shape cleanup。
4. `PLANS-HYGIENE-002` / `PLANS-ACTIVE-LINT-001` 長大な reference spec の段階移管と active backlog lint。
5. `PERF-DB-006D-INDEX` は SELECT-only EXPLAIN artifact と rollback plan の実環境証跡が揃ってから human gate へ進める。

**Archived Implementation-ready queue — v2当時の未実装 / Partial 拡充Plan**:

> 下表は、後段の詳細仕様から「次PRに切れる粒度」だけを抽出した実装キュー。<br>
> 実装済みの再作成、巨大UI一括変更、blind index追加、migration適用、AWS live操作はここから除外する。<br>
> 2026-07-08 整理で `PERF-DB-006D-EXPLAIN`、`PAYLOAD-BUDGET-001A`、`PAYLOAD-BUDGET-001B`、`PAYLOAD-BUDGET-001C-A/B/C/D`、`PAYLOAD-BUDGET-001D` はこの active queue から削除し、上位の Done / frozen evidence にだけ残した。

| ID                           | Status     | 優先度 | Owner lane              | 依存 / 現行足場                                                                          | 実装Plan / DoD                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | validation / stopping condition                                                                                                                                                                                 |
| ---------------------------- | ---------- | ------ | ----------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PERF-DB-006D-INDEX`         | Human gate | P1/P2  | DB migration plan       | Prisma schema indexes, Postgres EXPLAIN                                                  | `CareReport(org_id, created_at DESC, id DESC)`、`CareReport(org_id, patient_id, created_at DESC, id DESC)`、`CareReport(org_id, status, created_at DESC, id DESC)`、`DeliveryRecord(org_id, report_id, created_at DESC, id DESC)`、`DeliveryRecord(org_id, status, sent_at, report_id)`、`Patient.name/name_kana` pg_trgm は EXPLAIN と rollback plan 後に migration候補化する。`updated_at` 系候補は現行 `/api/care-reports` GET の order と一致しないため、別route evidence が出るまでこのsliceの候補にしない。 | SELECT-only EXPLAIN artifact、migration rollback plan、Oracle/DB review。blind index migration は禁止。                                                                                                         |
| `INBOUND-002-REVIEW`         | Partial    | P0/P1  | Inbound UI/API          | formal `InboundCommunicationEvent/Signal`, `/communications/inbound`, signal PATCH/apply | 3カラム review detail shell を作る。左=原文/添付/送信者/日時、中央=signal候補、右=反映先/Task/Record-only/Reject/MedicationStock。raw_text は list DTO には出さず、detail drawer/route で role + assignment + purpose + read audit を通す。                                                                                                                                                                                                                                                                       | raw omission snapshots、review lifecycle tests、read-reason/audit tests。raw_textを通知/監査changes/listへ流す必要が出たら停止。                                                                                |
| `STOCK-001-PRESCRIPTION`     | Partial    | P1     | Pharmacy stock          | `src/modules/pharmacy/medication-stock`, DrugMaster/DrugPackage, prescription intake     | v1は実装済み。処方作成後 hook で、完全一致の既存 `PatientMedicationStockItem` にだけ `MedicationStockEvent(event_type='prescription_supply')` をappendし、snapshotを再計算する。未一致、曖昧、GS1/GTIN/JAN包装コードのみ、名前のみ、単位不一致、数量欠落は `pharmacy.medication_stock_unlinked_prescription_supply` taskへ回す。残は manual retry API、DrugPackage.package_quantity を使う数量換算、review taskからのstock item作成/適用導線、route integration test。                                            | adapter unit/idempotency/PHI-free metadata testsは実装済み。残は API/integration tests、DrugPackage quantity conversion tests、equivalence review lifecycle tests。単位変換不能を自動加算する必要が出たら停止。 |
| `STOCK-001-VISIT`            | 未実装     | P1     | Pharmacy stock/UI       | visit record form, MedicationStockEvent/Snapshot                                         | 訪問観測 API/UI を追加する。外用/頓服/OTC/他院薬の残数、使用頻度、最終使用日、未確認理由を入力し、append-only event と snapshot 再計算へつなぐ。`残り4枚` と `2枚使用` を区別する。                                                                                                                                                                                                                                                                                                                               | unit/API/UI tests、mobile input tests、stockout forecast tests。他職種signalを直接ledgerへ書く設計なら停止。                                                                                                    |
| `MOV-001-API`                | Partial    | P1     | Patient detail          | movement tab, movement list API, safe resolver, standalone API                           | `/api/patients/:id/movement-timeline` と cursor/date/category filter は実装済み。旧 `/api/patients/:id/timeline` list alias は残さない。残は map-less date card UX、formal inbound/stock/safety sources、処方・訪問・文書 occurrence marker + deep link を返す。本文、薬剤明細、SOAP、OCR、raw text は一覧に載せない。                                                                                                                                                                                            | movement API tests、relative href tests、raw omission snapshot、mobile/a11y tests。event detail shellを全イベントのprimaryにする設計なら停止。                                                                  |
| `VISIT-BRIEF-010`            | 未実装     | P1     | Visit brief             | `InboundCommunicationSignal`, MedicationStockSnapshot, VisitBrief contributor            | 直近他職種受信、残数不足、服薬困難、副作用疑い、日程相談を訪問ブリーフの確認項目へ変換する。未処理/安全/残数を優先し、現場で迷わない順序にする。                                                                                                                                                                                                                                                                                                                                                                  | visit brief tests、provider contract tests、PHI omission for list/notification。raw_textをbrief本文へ自動挿入する必要が出たら停止。                                                                             |
| `PERM-DOC-SYNC-001`          | Partial    | P0/P1  | Permission docs         | `docs/compliance/access-control-policy.md`, `permission-matrix.ts`, route tests          | 新account種別、support mode、フリーランス薬剤師assignment、external viewer/token scope を導入するPRでは、capability表、RLS proof、route forbidden tests、audit requirement を同時更新する。                                                                                                                                                                                                                                                                                                                       | permission matrix tests、forbidden tests、docs diff。コードと文書の片方だけ変える必要が出たら停止。                                                                                                             |
| `OPS-RECOVERY-INTEGRITY-001` | 実装済み   | P0/P1  | AWS recovery / DB audit | `backup:drill:integrity`, backup drill docs、read-only DB access                         | `tools/scripts/backup-recovery-integrity-audit.ts` を追加済み。復元済みDB/staging/local DBに対して SELECT-only の整合auditを行い、患者・訪問・報告・請求/タスク・添付・監査ログ・Inbound/MedicationStock の orphan/count/latest timestamp/RPO補助を PHI-free JSON/Markdown で出す。production-like `DATABASE_URL` は `--allow-production` なしで拒否する。runtime restore API、AWS restore call、Secrets書換、migration、UPDATE/DELETE/INSERT は実装しない。                                                      | regression tests、PHI-free snapshot、production guard test、`pnpm backup:drill:check`。live復元証跡は `OPS-RECOVERY-LIVE-001` のhuman gateで扱う。                                                              |
| `OPS-RECOVERY-MONITOR-003`   | 実装済み   | P1     | AWS recovery monitor    | `backup-monitor.ts`, `/api/health`, S3/Object Lock docs                                  | S3 Object Lock read-only check と strict skipped-check behavior を追加済み。admin health は infra identifiers を最小化し、snapshotId/bucket/vault/userPoolId を直接出さない。production evidence mode では backup-specific env 未設定で critical checks が skip された場合に degraded/warning にする。                                                                                                                                                                                                            | backup-monitor tests、health route redaction tests、strict missing env testsで守る。AWS write permission が必要なら停止。                                                                                       |
| `OPS-RECOVERY-DOC-001`       | 実装済み   | P1     | AWS recovery docs       | compliance/root recovery docs                                                            | `docs/compliance/backup-recovery-drill.md` をSSOT化し、root runbook の historical化とleast-privilege整合を実施済み。広範なAWS管理ポリシー前提、実データS3 key、destructive S3 examples、unapproved migration command は標準訓練から外した。                                                                                                                                                                                                                                                                       | unsafe phrase rg、Prettier、diff check、backup drill preflight、template validator で守る。emergency break-glass / live evidence は `OPS-RECOVERY-LIVE-001` へ残す。                                            |
| `OPS-RECOVERY-LIVE-001`      | Human gate | P0/P1  | AWS recovery ops        | backup monitor、template validator、runbook                                              | 本番相当roleで `--live-aws --strict`、admin health の実AWS確認、restore drill evidence を収集する。runtime restore API は作らず runbook / AWS console / controlled ops で復元する。                                                                                                                                                                                                                                                                                                                               | live AWS result、drill record、RTO/RPO evidence。AWS credential/approval がない場合は実行せず blocked evidence を残す。                                                                                         |
| `TENANT-SUPPORT-001`         | 未実装     | P0/P1  | Platform access         | platform operator design, access-control policy                                          | Global User/Membership/Grant/Assignment、SupportSession、break-glass、RLS context extension、audit search を設計する。migrationは additive-first、人間承認後。                                                                                                                                                                                                                                                                                                                                                    | design review、threat model、migration rollback plan、forbidden tests。tenant横断read/writeをsupport_sessionなしで許す設計なら停止。                                                                            |
| `MOD-REGISTRY-REMAIN`        | Partial    | P1     | Architecture            | module registry/boundary check、collaboration/risk provider contracts                    | report/share/data crosswalk、DomainEventOutbox、module metadata、service_line/discipline/task.module migration plan を分割する。common-core -> pharmacy direct import は増やさない。                                                                                                                                                                                                                                                                                                                              | boundaries check、provider contract tests、allowlist ratchet。allowlist増加が必要なら architecture review。                                                                                                     |
| `API-CONTRACT-001`           | Partial    | P0     | API contract            | `src/lib/api/response.ts`, response shape guardrail                                      | success/error envelope を `ApiSuccess<T>{ data, meta? }` / `ApiError{ error:{ code,message,field_errors?,request_id? } }` へ統一する。`API-CONTRACT-001A-BS` で response-shape guard と代表 route/readers を新 envelope へ移行し、allowlist debt は 240 → 114 へ削減済み。`compatibilityError` は internal-only へ退避し、public route allowlist をさらに減らす。                                                                                                                                                 | route snapshot tests、frontend reader tests、`api-response-shape:check` expectedCount減。既存routeを無根拠に一括変更する場合は停止。                                                                            |
| `API-CONTRACT-002`           | 未実装     | P0/P1  | API observability       | request context、AuditLog、security events、jobs/outbox                                  | `request_id` / `correlation_id` を success meta、error body、AuditLog、security event、job/outboxへ伝播する。UI ErrorState は PHIを出さず request_id を任意表示できる。                                                                                                                                                                                                                                                                                                                                           | representative route tests、audit/security event tests。provider raw errorやPHIをrequest_id周辺へ混ぜる必要が出たら停止。                                                                                       |
| `API-CONTRACT-003`           | 未実装     | P0/P1  | API contract            | route errors、frontend recovery                                                          | error code registry を作り、HTTP status、log level、retryability、user recovery action を定義する。route は任意string errorを返せないよう helper 経由へ寄せる。                                                                                                                                                                                                                                                                                                                                                   | registry snapshot、representative route tests、unknown code reject。                                                                                                                                            |
| `API-LIST-001`               | 未実装     | P0/P1  | API list                | patients board、prescription intake、dispense queue、tasks、reports                      | cursor list response を `data[] + meta{ generated_at, limit, next_cursor, has_more, total_count?, count_basis, facets?, truncated? }` に寄せる。camelCaseとroute-local metaの混在を段階廃止する。                                                                                                                                                                                                                                                                                                                 | list API tests、frontend normalizer tests、pagination/facet tests。                                                                                                                                             |
| `DB-EVENT-001`               | 未実装     | P0/P1  | Durable events          | webhook/notification/task/realtime mutation callers                                      | DomainEventOutbox を追加し、mutation transaction 内では minimal event insert までにする。payload は aggregate refs、schema version、pii_class、minimal json に限定する。                                                                                                                                                                                                                                                                                                                                          | migration design、outbox unit tests、payload PHI snapshot。migration適用は human gate。                                                                                                                         |
| `FILE-LIFE-001`              | 未実装     | P0/P1  | File/PHI                | FileAsset schema/service                                                                 | FileAsset lifecycle を `pending_upload/uploaded/scan_pending/scan_passed/scan_failed/attached/detached/expired/deleted/quarantined` に固定し、safe display name、retention、legal hold、scan gateを設計する。                                                                                                                                                                                                                                                                                                     | FileAsset DTO snapshot、external share/report gate tests。`storage_key` / signed URL をpublic DTOへ出す必要が出たら停止。                                                                                       |
| `DATA-RET-001A`              | 未実装     | P1     | Retention               | Patient/CareCase/Report/Billing/File/Audit/Notification/Webhook                          | entity別の保持期間、削除可否、匿名化可否、legal hold、archive後 write/export/download guard を policy matrix と migration plan にする。                                                                                                                                                                                                                                                                                                                                                                           | policy matrix、archive/write/export guard tests。法務判断が必要な保持期間は human gate。                                                                                                                        |
| `VISIT-SYNC-001`             | Partial    | P0/P1  | Visit/mobile            | visit record form、offline drafts、attachments                                           | 添付を含む訪問記録の reload recovery と encrypted evidence draft contract を必要範囲に限定して設計する。section-level split と mobile E2E は `FE-VISIT-001` と連動する。                                                                                                                                                                                                                                                                                                                                          | mobile E2E、storage PHI audit、sync conflict tests。raw sync error/PHIをtoast/logへ出す必要が出たら停止。                                                                                                       |
| `PERF-RTE-001A`              | 未実装     | P0/P1  | Ops/perf                | `performance.ts`, admin metrics, deploy readiness                                        | current-process metrics だけに依存せず、route/method/status/p95/p99/org_scope/deploy_sha を横断集計できるようにし、live AWS drift / CloudWatch alarm へ接続する。                                                                                                                                                                                                                                                                                                                                                 | metrics tests、deploy readiness smoke、CloudWatch config review。live AWS 操作は human gate。                                                                                                                   |

**Care-report residual test contract（未実装のみ）**:

- `PERF-DB-006A/B/C` は実装済み。実装前に失敗する前提の red-test 文言は active backlog から削除する。
- `PERF-DB-006D-EXPLAIN` は実装済み。`tools/scripts/explain-care-report-index-candidates.ts` は `EXPLAIN (FORMAT JSON)` を既定にし、DDL/DML/ANALYZE/live DB mutation は含めない。
- `PERF-DB-006D-INDEX`: index追加は human gate。EXPLAIN artifact と候補indexごとの rollback plan を evidence として残した後、Oracle/DB review と人間承認を通す。blind migration は作らない。
- `PAYLOAD-BUDGET-003` は実装済み。`GET /api/care-reports` は payload budgeted route になり、通常list/search row は allow-list response で `delivery_records` 配列、delivery raw recipient detail、`pdf_url`、hidden report content、`_searchable_report_text`、content-derived billing context を返さない。`include_content=1` は `content_summary` のみ許可する。

**Archived Frontend implementation queue — v2当時の7画面UI改善候補**:

| ID                      | Status  | 画面 / foundation | Slice type   | 実装Plan / DoD                                                                                                                                                                                             | validation                                                               |
| ----------------------- | ------- | ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `FRONTEND-CONTRACT-001` | 未実装  | 横断              | Contract     | 7画面それぞれについて entrypoint、BFF/API、shared component、state matrix、PHI表示方針、mobile構成、validation を1ページのslice contractへ落とす。モック追従ではなく、既存 current path を上書き改善する。 | docs diff、対象 entrypoint link、state matrix review。                   |
| `FE-SHELL-001`          | 未実装  | Shell/Header/Rail | Layout       | AppShell / Sidebar / Top Header / WorkspaceActionRail の見え方を PH-OS SSOT に合わせる。ナビ順・active state・右レールの役割を統一するが、各業務データ contract は変えない。                               | layout component tests、a11y landmarks、mobile nav smoke。               |
| `FE-PATIENT-LIST-001`   | 未実装  | 患者一覧          | Layout       | 患者一覧を「左summary / 中央list or card / 右selected patient preview」へ寄せる。要対応、他職種受信、残数不足、報告未提出は権限内で表示し、preview/detailへのdeep linkを持つ。                             | component tests、patients board API contract、mobile drawer screenshot。 |
| `FE-PATIENT-DETAIL-001` | Partial | 患者詳細          | Layout/State | Command Center、Must Check、Safety、Next Action、薬剤/訪問、Movement tab、右レールの情報階層を整理する。movement tab 土台は再作成しない。                                                                  | card-workspace tests、movement tests、a11y heading order。               |
| `FE-DISPENSE-001`       | 未実装  | 調剤              | Layout       | 左queue、中央作業台、工程stepper、処方table、右監査railへ整理する。調剤/監査/セット/セット監査の既存 workflow contract は変えない。                                                                        | dispense workbench tests、route smoke、keyboard tab order。              |
| `FE-SCHEDULE-001`       | 未実装  | スケジュール      | Layout       | 薬剤師別 timeline、状態凡例、提案rail、患者連絡待ちを整理する。proposal-first contract と confirmed schedule 不変を守る。                                                                                  | schedule board tests、proposal tests、responsive screenshot。            |
| `FE-VISIT-001`          | 未実装  | 訪問中モード      | Interaction  | 訪問中に残数入力、観察、他職種受信確認、音声メモ、下部固定barを迷わず扱えるUIにする。MedicationStock/Inbound の正本実装がない操作は mock確定にしない。                                                     | visit record tests、mobile tests、offline/conflict state tests。         |
| `FE-REPORT-001`         | 未実装  | 報告書            | Interaction  | 左報告書一覧、中央editor、右AI/送付railへ整理する。医療チャット/残数/訪問記録は候補として選択投入し、raw text自動挿入や外部送付のdashboard quick actionはしない。                                          | report workspace tests、delivery/masking tests、PDF/send route tests。   |
| `FE-INBOUND-001`        | Partial | 他職種受信        | Interaction  | 受信inbox、message detail、structured signal panel、action railを3ペイン化する。formal InboundEvent/Signal は既存を使い、raw_text detail は再認可とread auditを通す。                                      | inbound route/UI tests、raw omission snapshots、review lifecycle tests。 |
| `FE-QA-001`             | 未実装  | 横断              | State/QA     | 7画面の loading/empty/data/partial/error/forbidden/stale/offline/conflict fixtures、mobile snapshot、keyboard navigation、PHI omission snapshot を追加する。                                               | Playwright/component screenshot、exact-path lint、typecheck。            |

**派生タスク（今回の整理で追加・昇格）**:

- `PLAN-ARCHIVE-001`: 後段の長大なプロンプト型仕様を、active backlog から参照する reference spec として段階的に `docs/plans-archive.md` または専用docsへ移す。内容削除ではなくリンク化する。
- `TASK-ID-DEDUP-001`: `TASK-010 -> TASK-011`、`RISK-020 -> RISK-021` のような統合済みIDを registry に集約し、同じ意味の新IDを増やさない。`rg` で重複IDを検査する。
- `QUERY-SHAPE-TEST-002`（実装済み）: DB速度改善の各PRで使う watchlist query-shape guard を追加済み。今後の派生は `QUERY-SHAPE-WATCHLIST-003` として対象read pathを増やす。
- `PAYLOAD-BUDGET-002`: patients board / reports / remaining detail surfaces について list/summary/detail の payload budget を表にし、summary/list では raw text・storage key・signed URL・provider raw error を出さないことを snapshot で固定する。dashboard / movement / inbound / stock の主要summary/listは実装済み evidence を参照する。
- `ROUTE-PERF-MEASURE-001`: `success()` / `NextResponse.json()` route が `withRoutePerformance` で `unmeasured` にならないよう、shared measured JSON success helper を `src/lib/api/response.ts` に集約する。route-local `TextEncoder` helper は段階削除し、payload budgeted route だけに適用する。
- `BFF-COUNT-META-001`: list/summary BFF の count metadata を棚卸しし、`returned_count` / `total_count` / `visible_count` / `hidden_count` / `count_basis` の意味を route ごとに固定する。表示行数を総件数として扱う文言や API meta を残さない。
- `PLANS-ACTIVE-LINT-001`: `Plans.md` の `cc:REFERENCE` / `cc:WIP` 節に残る未チェックboxを active backlog と誤認しないよう、active ID は registry / implementation queue / frontend queue に存在するものだけとする軽量 lint または `rg` 手順を追加する。
- `RIGHT-RAIL-ACTION-002`: dashboard、患者一覧、患者詳細、調剤、スケジュール、訪問、報告、他職種の右レール/下部CTAに「次に何をするか」と「止まっている理由」が必ずあることをUI checklist化する。
- `RAW-DETAIL-REAUDIT-001`: raw chat text、電話原文、添付、連絡先詳細を dedicated detail surface で表示する場合の `purpose`、再認可、read audit、request_id を共通 helper / test に寄せる。

**Plans.md セクション分類（2026-07-08整理後）**:

| Section                         | 扱い                        | 実装時の読み方                                                                     |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `Plan Status Registry`          | Archive                     | 旧分類証跡。現在の正は `Active Plan Board v8`。                                    |
| `Implementation-ready queue`    | Archive                     | v2当時の候補。現在は v8 の queue だけを実装入口にする。                            |
| `Frontend implementation queue` | Archive                     | v2当時の候補。現在は v8 の queue だけを実装入口にする。                            |
| `cc:PARTIAL` sections           | Reference + residual detail | 実装済み部分は再作成しない。残タスクは active queue の対応IDへ戻してから着手する。 |
| `cc:REFERENCE` sections         | Reference only              | 背景、受入条件、停止条件、仕様詳細。直接sprint backlog化しない。                   |
| `cc:WIP` sections               | Program context             | 大きなプログラムの背景。実装する場合は active queue へ小さいIDとして切り出す。     |
| `cc:blocked` / Human gate       | External gate               | Codexだけで完了扱いにしない。必要な証跡、runbook、承認条件を管理する。             |

### 新機能: プラットフォーム運営者コンソール（監査付きブレークグラス） `cc:WIP`

<!-- 2026-07-03 ユーザー要望「システム開発者・管理者が裏からテナント横断でデータ確認・アクセス・操作」を、無記録バックドアではなくベストプラクティス準拠の監査付きブレークグラスとして設計・実装。設計判断は fable(ユーザー委任)。SSOT=docs/design/platform-operator-console-design.md -->

- [ ] **P-1**: write ops の限定操作+追加監査+アラート / hash-chain tamper-evidence / operator suspend時のsession cascade revoke / MFA試行レート制限 / 全テナント横断監査ダッシュボード
- [ ] **P-2**: 多職種展開（医科・訪問看護）向け operator 権限汎用化

### 直近トラック: 開発方針 2026-07-03 — 実装ロードマップ v2（3レビュー再構成） `cc:WIP`

<!-- 2026-07-03: v1(9観点スキャン)を ①リリースクリティカルパス監査 ②網羅性批判レビュー(BLOCKED/ULTRACODE/FEATURE_QUEUE/spec 突合+コード抜き打ち7点=全て新鮮を確認) ③依存・実装順検証 の3独立レビューで実装向けに再構成。リリース判定は既存の pilot-launch-dossier(src/server/services/pilot-launch-dossier.ts: UAT/PMDA/backup/ISMS 4軸+org監査)を SSOT とし、外部依存を前提条件へ分離、技術タスクを Wave 0-3 へ再配列。計画のみ・実装未着手。v1 全文はコミット 1d315a86 参照。 -->

**v1 所見サマリ（有効）**:

- 基盤は高水準: 認可wrapper 約293route / no-store 260file / DBトリガ監査 / unit 1,229file・APIカバー97% / E2E主要5動線 / 点数改定レジストリはデータ駆動で2026医療改定 confirmed 済 / 依存EOLなし
- 最大の製品ギャップ: **算定要件の構造化未着手**（`docs/visit-report-collab-spec.md` v2 算定カバレッジ32項目中 充足5）
- 医療安全: CDS false-negative 8件 + safety5(CE01/CE02) / セキュリティ: RLS 実体欠落~33表+DB層未証明・PHI閲覧監査36route未記録 / 速度: prescription-intakes POST 33.7s / FE: React Compiler未有効・仮想化ゼロ・画像無圧縮 / 改定耐性: 点数=優秀、薬価版管理なし・next-auth v4 / 水平展開: そのまま展開可8+軽い分離6、要リファクタ=薬局間連携層

**v1 からの主な補正（網羅性レビュー）**:

- 追加: CE01/CE02 safety5（PCA未検品再貸出/訪問prep偽完了）/ EPIC1 RLS 実体欠落~33表+contract再設計 / **billing aggregation over-claim 修正群**（BLOCKED制限解除済・即効）/ spec P2・P5・P6・P7 の未収容分（B-7〜B-10）/ リリースエンジニアリング R群 / BLOCKED human-gate 残6件 / F-20260702-001
- 訂正: 実参照切れは `docs/decisions.md`+旧spec 2ファイル（`visit-report-collab-spec.md` は実在し正）/ O-1 は v0.2 トラックへ統合
- 昇格: afterhours-tz off-by-9h（夜間/休日加算の over/under-claim・confirmed）を P2→Wave1 算定正確性へ
- 分割: B-6→4分割+B-7〜B-10 / H-1→tx-guard epic 14件 / H-2→TZ epic ~14件 / C-7・E-6 は独立作業へ

**リリースマイルストーン**:

- **M1 安全・正確性 green** = Wave 0+1 完了（医療安全 / セキュリティ / 算定正確性の既知バグ 0）
- **M2 パイロット技術線** = Wave 2 R群完了で dossier のコード側 blocker 0。外部前提の完了をもって pilot GO
- **M3 製品の芯** = Wave 3 B群（算定要件構造化 = multi-quarter プログラム）

#### 前提条件（外部・人間作業） `cc:blocked`

- [ ] PMDA メディナビ/マイ医薬品集 登録 + `PMDA_*_URL` secrets（旧0-2i）
- [ ] backup live drill 実施と `[mode:live]` 記録（旧I-04/12-8）
- [ ] ISMS 審査機関見積・予算・キックオフ（旧1a-6/1b-6。vendor comparison/decision memo の記入で dossier green）
- [ ] AWS 本番プロビジョニング + `ALERT_EMAIL` 設定 + SNS email 購読 confirm + 本番 Sentry DSN
- [ ] パイロット薬局 UAT（critical/high blocker 0 で phase2_entry green。旧1b-9）
- [ ] 利用規約/プライバシーポリシー本文の法務確定（掲示ページ実装は W2-R4）
- [ ] 音声メモ STT の AWS Transcribe creds（旧D-8-3）

#### Wave 3 — 製品の芯・高 blast（安全網整備後） `cc:REFERENCE`

安全網先行（破壊的 migration の前提）:

- [ ] W3-S1 staging 環境（旧O-2/12-4・AWS 実環境待ち）

B 算定構造化（spec ロードマップ順。W1-13/W2-B1 済前提）:

- [ ] W3-B3 加算エビデンス群（StructuredSoap 拡張+加算コードマスタ）
- [ ] W3-B4 claim-record projector（report-generator 分割。F-5 境界 API 化と直列調整）: 残は report-generator の11表直読みの読み取り関数集約（W3-M1 と直列）と、手動作成への billing_context 付与（billing 経路のデータ plumbing を伴う別スライス・要 billing レビュー）
- [ ] W3-B6a 報告書 finalize/lock 版管理[RPT-007] / W3-B6b 到達証跡ハードゲート[KYO-007/008] / W3-B6c 保存年限構造化[RPT-002/009] / W3-B6d 単一建物月次動的計数[ZTK-06]（旧B-6 の4分割）
  - 設計メモ（2026-07-03 ラティファイ済、3a39f69e、docs/design/care-report-finalize-lock-design.md、codex 起草+opus critic 2巡）。確定方向: 行ロック=updated_at 維持(D-14 意図的逸脱を記録)/改訂連番=report_revision/Option B 推奨。B vs C 最終選択+未決事項は migration 提案の human 承認時に確定。実装(migration 含む)は据え置き=human gate
- [ ] W3-B7 spec P2: ManagementPlanContent 構造化+医療保険の月次見直し強制（KYO-003/004）
- [ ] W3-B8 spec P6: 多職種 inbound 双方向モデル（多対多 resolution_status, ARCH-6）+FAX/紙 OCR 取込(COLLAB-01)+到着通知(COLLAB-02)+outbound 受領ループ(COLLAB-03)
- [ ] W3-B9 spec P5: cycle_id 任意化+緊急訪問薬剤管理指導料（料1/料2）+オンライン46単位・緊急通算の月キャップ統合。残は online/shared monthly cap と cycle_id 任意化全体整理。
- [ ] W3-B10 spec P7: 破壊的 migration 群（CareReport.visit_record_id FK 昇格 / 残薬 canonical 一本化 / レガシー SOAP 削除。human 承認+W3-S1/S2 前提）

改定・依存耐性:

- [ ] W3-C1 薬価 effective-dated 版管理+調剤時スナップショット（旧C-1・L・mig） / W3-C5 next-auth v4→Auth.js v5（旧C-5・L）

FE 仕上げ（低優先）:

- [ ] W3-E1 フォーム RHF 統一（旧E-6a）
- [ ] W3-E3 drug-master-content 分割（旧E-6c）: 残は `DrugMasterOperationalContent` 本体の段階分割と、detail Sheet / hooks / mutation state の責務分離。

運用:

- [ ] W3-O1 v0.2 e2e 実証（下記 v0.2 トラックで管理・重複解消） / W3-O3 RUM（旧12-7残） / W3-O5 TZ fail-close 有効化（prod TZ 設定後・prod ゲート） / W3-O6 証跡写真+S3 Object Lock+set-photo 束縛 / W3-O7 音声メモ STT `cc:blocked`

**直列化必須ペア**: W2-P1 内 D-1↔D-3（同一 service）/ W0-16→W1-1（CDS 系）/ W1-13→W2-B1→B 全系 / W3-B4↔W3-B6↔W3-M1（report-generator 競合）/ W3-B2・B3・B5 の mig は逐次 / W1-14 決定→React Compiler 実装。Wave 内の各レーンはファイル非重複で並行可。

**実行規律**: 各スライス = maker(Claude) → reviewer-audit 独立レビュー → objective gate（typecheck / typecheck:no-unused / lint / test / build / colors:check）。auth/security/migration/prod-deploy は human 承認（§15）。破壊的 mig（W3-B6d/B10/C1）は W3-S1/S2 完了が前提。perf 系は perf:smoke 実測を前段に。

### 新トラック: 訪問スケジュール自動提案 上書きアップデート（2026-07-05） `cc:REFERENCE`

<!-- source: docs/careviax_visit_schedule_update_spec.docx（CareVIAx / PH-OS 訪問薬剤管理スケジュール自動提案 既存実装調査・上書きアップデート仕様書）。2026-07-05 に仕様書と実コードを再レビューし、既存の planner / proposal workflow / visit availability / route matrix contract を前提に実装順を練り直した。計画のみ・実装未着手。 -->

**最重要方針（SSOT）**:

- 自動提案の仮予定 SSOT は `VisitScheduleProposal`。`VisitSchedule` は患者連絡 confirmed 後に作る確定予定。
- `confirmed_at` あり `VisitSchedule`、ready/departed/in_progress/completed 予定、患者連絡済み候補は自動再配置しない。変更は既存リスケジュール/再提案フローに限定する。
- 手動 `POST /api/visit-schedules` と管理者/互換用途の直接 `VisitSchedule` 作成は残すが、「自動生成」は proposal-first に寄せる。
- 休業日/訪問不可日の上書きは理由必須、監査ログ必須。薬剤師確認必須はスコア減点ではなく患者連絡前のハードゲートにする。
- Google Routes / OSRM / fallback はルート・移動時間評価だけに使い、薬学判断・服薬期限判断の根拠にはしない。

**コードレビューで確定した現状（2026-07-05）**:

- `src/app/api/visit-schedule-proposals/route.ts` は候補生成、idempotency、算定ガード、`VisitScheduleProposalBatch`、route_order allocation、diagnostics/audit を既に持つ。ここを自動提案の正式入口として維持する。
- `src/app/api/visit-schedule-proposals/[id]/route.ts` は approve → contact_attempt confirmed → confirm → `VisitSchedule.create` の患者承認後確定フローを既に持つ。仕様書の proposal-first 方針と一致している。
- `src/app/api/visit-schedules/generate/route.ts` は recurrence から `VisitSchedule` を直接作成し、`confirmed_at` / `confirmed_by` を入れる。仕様書との差分として最重要の互換移行対象。
- `src/server/jobs/daily/visits.ts` は服薬期限から `generateVisitScheduleProposalDrafts` を呼び `VisitScheduleProposal` を作る。daily demand は既に proposal-first で、強化対象は deadline policy と diagnostics。
- `src/server/services/visit-schedule-planner.ts` は患者希望/施設受入/薬局営業時間/薬剤師シフトの時間窓 intersection、日次/週次容量、車両、route insertion、算定 cadence、確定済み予定固定を持つ。新設ではなく接続・精密化する。
- `src/lib/calendar/visit-availability.ts` は `canVisitOn` で PharmacyOperatingHours/BusinessHoliday と PharmacistShift の AND 判定を pure helper 化済み。VisitAvailabilityPolicy はこの helper の拡張・DB adapter 接続として扱う。
- `src/server/services/visit-medication-deadline.ts` は通常薬 end_date / start_date+days、次回調剤日、前回訪問時 next_visit_suggestion_date を最小日で折り、頓服を通常期限から除外済み。営業日バッファは未実装。
- `src/server/services/road-routing.ts` は `RoadTravelEstimator.estimateMatrix` と OSRM table matrix / pairwise fallback を既に持つ。Google provider は現状 pairwise `computeRoutes` のみなので、追加対象は `GoogleRoutesProvider.estimateMatrix`。
- `prisma/schema/visit.prisma` の `VisitScheduleProposal` には `pharmacist_review_required` / `review_reason_code` / `reviewed_at` は未存在。review gate は diagnostics 先行、DB field 追加は HR migration に分離する。

**監査・PHI payload 方針**:

- proposal / overload / review / route diagnostics を audit に残す場合は whitelist 方式にする。
- audit に保存してよいもの: reason code、entity id、dateKey、actor、status before/after、算定/期限/availability の短い machine code、hash 化した診断 snapshot。
- audit/log/export に保存しないもの: 患者名、住所、緯度経度、電話番号、連絡 note、薬剤 free text、処方全文、Google/OSRM request body、API key、provider raw error。
- 詳細表示が必要な場合は、audit ではなく権限制御済み detail API で再計算または最小化済み snapshot を返す。
- `audit-logs` API/export は reject_reason redaction と同じ方針で diagnostics/free text/drug/address/phone を redaction test で固定する。

**追加・変更する設計要素（通常変更 / HR 分離）**:

| 領域                   | 現コードとの差分                                                                                                                                     | リスク分類          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| DeadlinePolicy         | 既存 `resolveMedicationDeadlineSummary` の後方互換を保ち、営業日/訪問可能日 buffer を別出力として追加する。                                          | P1                  |
| Planner connection     | 現 planner の `planningEnd` / `candidateDeadlineDate` を policy 出力へ接続。候補取得期間は縮めすぎず、site/shift 判定後に per-site deadline を適用。 | P1                  |
| Availability policy    | 既存 `canVisitOn` と planner 内 intersection を統合し、訪問可能枠 DB 化は HR へ分離。                                                                | P1→HR               |
| Review gate            | まず diagnostics/audit/UI で表示し、DB field 追加後に approve/contact/confirm hard gate 化。                                                         | P1→HR               |
| OverloadRebalancer     | 確定予定ではなく未承認 proposal のみを preview-first で前倒し。既存 open proposal も容量計算に入れる。                                               | P1 / audit注意      |
| PRN/topical stock/risk | 頓服・外用薬残量、薬剤変更 risk は医療安全上 HR。既存通常薬 deadline とは分離し、薬剤師確認必須を伴う。                                              | HR                  |
| Google Matrix          | 既存 estimator contract に `GoogleRoutesProvider.estimateMatrix` を足す。key 未設定/失敗時は OSRM/fallback を維持。                                  | P1 / deploy設定注意 |

#### VS-AUTO-0. 方針固定・責務境界の残作業 `cc:REFERENCE`

- [ ] `VisitScheduleProposal` と `VisitSchedule` の責務境界を API test 名・UI文言・operator docs で統一する。
- [ ] `localDateKey` / `formatUtcDateKey` / `japanDateKey` 使用箇所を棚卸しし、期限・休業日・患者希望曜日・locked_date の user-facing date は Asia/Tokyo dateKey を SSOT にする。
- DoD: 「自動提案は proposal、確定予定は患者確認後」の方針が実コード参照付きで追跡可能。

#### VS-AUTO-1. 営業日バッファ付き DeadlinePolicy（DBなし pure first） `cc:REFERENCE`

- テスト:
- rollback: policy 接続 commit を revert。既存 `resolveMedicationDeadlineSummary` に戻せる。

#### VS-AUTO-4. AvailabilityPolicy / 薬剤準備 / 緊急予備枠 `cc:REFERENCE`

- [ ] `src/lib/calendar/visit-availability.ts` を新設せず拡張する。現 `canVisitOn` の reason code を planner/API diagnostics と共有する。
- [ ] 訪問可能枠 DB 化前は、既存 PharmacyOperatingHours/BusinessHoliday + PharmacistShift + patient/facility preference の intersection を唯一の訪問可能判定にする。
- テスト:
  - `canVisitOn` の既存 fail-closed tests を維持。
  - max_daily/max_weekly/vehicle capacity rejected diagnostics 維持。

#### VS-AUTO-5. Proposal diagnostics / review-gate 表示（migration 前の低リスク層） `cc:REFERENCE`

- [ ] VS-AUTO-7 の field-backed hard gate 前は、diagnostics-only と明記する。UI の disabled だけで患者連絡/確定を止めた扱いにしない。
- [ ] `/schedules/proposals` の詳細 Sheet と候補カードに、過密前倒し理由を業務用語で表示する。
- [ ] HR field 追加前は `pharmacist_review_required` 永続 field を参照しない。UI では `review_required_candidate` として「患者連絡前に薬剤師確認推奨」を出し、ハードブロックは VS-AUTO-7 後に有効化する。
- テスト:
  - server `message` / validation error が既存 UI fallback で表示される。

#### VS-AUTO-6a. OverloadRebalancer preview/read-only 残作業 `cc:REFERENCE`

- [ ] VS-AUTO-7 後は preview 対象条件へ `pharmacist_review_required=false` を追加する。
- [ ] billing cap / review candidate の永続 field 判定を preview skip reason に接続する。
- テスト:
  - billing cap / review required 永続判定で preview replacement を出さない。

#### VS-AUTO-6b. OverloadRebalancer apply/supersede/audit `cc:REFERENCE HR`

- [ ] VS-AUTO-7 の review fields / audit schema / hard gate と、VS-AUTO-8 の薬剤師確認 hard gate が入るまで write/apply は実装しない。
- [ ] 前倒し apply 時は旧候補を `superseded` にし、replacement proposal を transaction で作る。confirmed schedule、patient contact confirmed/pending proposal、reschedule pending は不変。
- [ ] `reproposal_reason` など存在しない field を前提にせず、HR migration 後の専用 field または `OverloadRebalanceAudit` に `reason_code='overload_advance'` と最小化 diagnostics を保存する。
- [ ] billing cap recheck、vehicle capacity、pharmacist capacity、review field gate、patient contact state、same-run duplicate を server-side で再検証する。
- [ ] apply 失敗や blocked attempt は、患者名・住所・薬剤名・provider raw payload を含まない audit/security-safe event に残す。
- テスト:
  - old proposal superseded + replacement proposal が同一 transaction で作られる。
  - confirmed/contacted/reschedule pending は変更されない。
  - billing cap / review required / vehicle full / pharmacist full で apply しない。
  - audit は reason code、entity ids、dateKey、actor、minimized diagnostics のみ。

#### VS-AUTO-7. HR migration: review fields / availability rule / rebalance audit `cc:REFERENCE HR`

- [ ] W3-S1/S2 相当の migration 検証、RLS/requestContext、rollback plan、display_id registry、seed/factory、human review を前提にする。migration 適用は current-task 明示承認まで実行しない。
- [ ] additive migration 候補:
  - `VisitScheduleProposal.pharmacist_review_required Boolean @default(false)`
  - `review_reason_code String?`
  - `pharmacist_reviewed_at DateTime?`
  - `pharmacist_reviewed_by String?`
  - `VisitAvailabilityRule`: org_id、site_id、曜日/日付、from/to、is_available、reserve_minutes、max_auto_fill_ratio。
  - `OverloadRebalanceAudit`: old proposal、新 proposal、理由、計算時点、actor/system、diagnostics snapshot。
- [ ] `display_id` registry、data explorer catalog、RLS/tenant policy、app-layer `org_id` where、migration rollback、seed/factory を同時に計画する。
- [ ] 既存 proposal は `pharmacist_review_required=false` default で互換。contract migration や field required 化は別フェーズ。
- [ ] human review 必須: 休業日上書き・薬剤師確認・過密前倒しの監査粒度、患者連絡前 gate の運用責任。
- [ ] migration 適用は current-task 明示承認まで実行しない。
- [ ] migration 後の最小 hard gate を先に実装する:
  - approve/contact_attempt/confirm は `pharmacist_review_required=false OR pharmacist_reviewed_at IS NOT NULL` を server side で検証。
  - bulk action / updateMany claim でも同条件を要求し、古いクライアントや race で bypass できないようにする。
  - review 済み actor/time は audit whitelist で記録する。

#### VS-AUTO-8. 薬剤師確認 hard gate / 頓服・外用薬残量 / 薬剤変更 risk `cc:REFERENCE HR`

- [ ] VS-AUTO-7 の最小 server hard gate 後に実装する。Google Matrix や Overload apply より優先し、患者連絡前の医療安全 gate として扱う。
- [ ] `VisitStockProfile` または既存訪問準備/処方データから導出する stockout candidate を設計する。
  - 対象: 頓服、外用薬、使用量が患者状態に左右される薬剤。
  - 入力: `last_confirmed_at`、`remaining_amount`、`avg_daily_use`、`stockout_date_key`、`confidence`、`confirmed_by`、根拠。
  - 出力: stockout date candidate、confidence、review reason。
- [ ] `MedicationChangeRisk` helper/service を設計する。
  - 増量/減量/追加/削除、麻薬/冷所/粉砕/一包化、疑義照会未解決、処方差分を risk reason にする。
  - 高 risk は早期訪問候補 + `pharmacist_review_required=true`。
- [ ] `[id]` PATCH approve/contact_attempt/confirm に hard gate を入れる:
  - `pharmacist_review_required=true` かつ `pharmacist_reviewed_at is null` なら患者連絡・確定不可。
  - review 済みの actor/time を audit。
- テスト:
  - 頓服/外用薬 stockout が通常薬より早い場合に deadline candidate 採用。
  - confidence low / stale stock confirmation は review required。
  - 薬剤変更ありで review gate が立つ。
  - review 未了では approve/contact/confirm に進めない。
  - review 済みでのみ既存 proposal workflow が進む。

#### VS-AUTO-9. Google Routes Matrix provider `cc:REFERENCE`

- [ ] `src/server/services/road-routing.ts` の既存 `RoadTravelEstimator.estimateMatrix` contract を維持し、`GoogleRoutesProvider.estimateMatrix` を追加する。
  - Google provider: Compute Route Matrix 相当。
  - OSRM provider: 既存 table API を維持。
  - Google matrix 未設定/失敗時: 既存 pairwise `computeRoutes` fallback、さらに OSRM/fallback behavior を壊さない。
- [ ] API key / quota / timeout / retry / max matrix size は deploy 設定として明示し、secret 値は出さない。
- [ ] route diagnostics に provider/source/confidence を出すが、患者住所・氏名・座標をログに出さない。
- テスト:
  - Google key 未設定で fallback して proposal 生成継続。
  - Google provider で matrix が使える時は pairwise fallback 呼び出しを抑制。
  - provider failure が PHI をログに出さない。
  - `visit-route-engine` / planner の route score 既存期待を維持。

#### VS-AUTO-10. 検証・リリース計画 `cc:REFERENCE`

- Unit:
  - `src/server/services/visit-medication-deadline.test.ts`
  - `src/lib/calendar/visit-availability.test.ts`
  - `src/server/services/visit-schedule-planner.test.ts`
  - `src/server/services/visit-schedule-overload-rebalancer.test.ts`
  - `src/server/services/road-routing.test.ts`
- API:
  - `src/app/api/visit-schedule-proposals/route.test.ts`
  - `src/app/api/visit-schedule-proposals/[id]/route.test.ts`
  - `src/app/api/visit-schedules/generate/route.test.ts`
  - `src/server/jobs/daily.test.ts`
  - RLS/tenant rejection for new HR tables.
- UI:
  - `/schedules/proposals` diagnostics、review gate、bulk action regressions。
  - `/schedules` day planner の「訪問候補を生成」から proposal-first を確認。
- E2E/smoke:
  - 「薬切れ日曜 → 木曜候補 → 患者連絡 confirmed → VisitSchedule 確定」。
  - 「direct generate 自動入口 → VisitScheduleProposal 作成 → confirm まで VisitSchedule 未作成」。
  - 「過密日 → 未承認候補だけ前倒し → 確定予定不変」。
  - Google key なし / provider failure 時の fallback diagnostics。
- Release:
  - direct generate は 410 `ENDPOINT_REMOVED` contract を維持し、proposal-first 移行 flag として復活させない。
  - rollout flag は HR review fields、Overload apply、Google Matrix provider のみに使う。
  - 初回は preview/recommendation と diagnostics-only、次に field-backed hard gate、最後に apply/write path。
  - operator runbook: Google quota、fallback、薬剤師 review queue、過密再配置 audit の確認手順。

**優先実装順**:

1. VS-AUTO-0 方針固定 + 実コード inventory。
2. VS-AUTO-0b direct generate 自動確定経路の cordon（feature flag / warning / 管理者手動限定）。
3. VS-AUTO-1 DeadlinePolicy pure helper（DBなし、provenance + JST dateKey + 既存関数後方互換）。
4. VS-AUTO-2 Planner deadline 接続（既存 planner/visit-availability 拡張）。
5. VS-AUTO-3 direct generate proposal-first 互換移行。
6. VS-AUTO-5 Proposal diagnostics/UI（migration 前の diagnostics-only 可視化）。
7. VS-AUTO-4 AvailabilityPolicy / readiness / emergency reserve の shared helper 整理。
8. VS-AUTO-6a OverloadRebalancer preview の billing cap recheck 残。
9. VS-AUTO-7 HR migration + minimal server hard gate。
10. VS-AUTO-8 review hard gate + PRN/topical/medication-change risk。
11. VS-AUTO-6b OverloadRebalancer apply（field-backed gate と audit policy 後）。
12. VS-AUTO-9 Google Matrix provider。
13. VS-AUTO-10 E2E / rollout / runbook。

**停止条件 / human review 必須**:

- 患者承認済み日時や `confirmed_at` あり予定を自動で変更する必要が出た場合。
- `visit-schedules/generate` の default behavior を直接確定から proposal-first へ切り替える rollout flag/運用日が未定の場合。
- direct generate が患者未確認の `confirmed_at` schedule を作る経路を残したまま、DeadlinePolicy を本番経路へ接続しようとする場合。
- review gate field 未導入のまま、患者連絡/確定導線を hard gate 済みとして扱う場合。
- DeadlineCandidate の provenance が薬剤名 text だけで、処方行/薬剤コード/根拠/信頼度を追跡できない場合。
- 薬剤師確認必須の判断理由がコードだけで確定できない場合。
- 休業日上書き、連休前倒し、緊急枠予約の運用責任者が未定の場合。
- Google API quota/cost/障害時運用が preview 環境で検証できない場合。
- DB migration が既存 proposal/schedule の意味を変える場合。

### 新トラック: 横断リスク改善 / Risk Finding Cockpit（2026-07-05） `cc:REFERENCE`

<!-- source: 2026-07-05 ユーザー提示「CareVIAx リスク改善 多角的修正計画・実装タスク化レポート（拡張版）」。単純追記ではなく、現行コードの readiness / blocker / task / audit / permission / report / billing / notification 実装を再確認して、既存 VS-AUTO・Wave 3・Phase 5 と矛盾しない実装計画へ再構成した。計画のみ・実装未着手。 -->

**このトラックの位置づけ**:

- VS-AUTO は「訪問スケジュール自動提案」の scheduling track として継続する。VS-AUTO-8 の薬剤師確認 / 頓服・外用薬残量 / 薬剤変更 risk は、この横断リスク基盤の `CORE-*` / `RX-*` を利用する下流タスクとして扱う。
- Wave 3-B の報告・請求構造化、Phase 5-PRE の患者モデル変更、ID 統一プログラムとは別 track。DB migration が必要な task は additive-first とし、migration 適用は current-task 明示承認まで実行しない。
- 互換性維持は不要。古い warning-only 表示や曖昧な旧挙動は、最新 contract に完全上書きする。ただし患者安全、PHI、請求、権限、監査、migration/deploy の安全 gate は緩和しない。

**コードレビューで確認した既存土台（2026-07-05）**:

| 領域                    | 既存の接続点                                                                                                                                                                                                          | 実装計画上の扱い                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 訪問準備 / ready gate   | `src/server/services/visit-preparation-readiness.ts` は `medication_changes_reviewed`、`previous_issue_reviewed`、`carry_items_status`、`offline_synced`、onboarding/billing blocker を ready transition に集約する。 | `RiskFinding` adapter を作り、boolean checklist を構造化 risk に置換していく。                                    |
| 患者 board / foundation | `src/app/api/patients/board/route.ts` と `src/server/services/patient-detail-foundation.ts` は safety tag、foundation summary、監査待ち、例外、同意/計画不足を集約する。                                              | 一覧は圧縮表示のまま維持し、詳細判断は `CaseRiskCockpit` API へ分離する。                                         |
| 同意 / 管理計画         | `src/server/services/management-plans.ts` は `missing_visit_consent`、`missing_management_plan`、`management_plan_review_overdue` を workflow gate と task に接続できる。                                             | renewal board と gate failure task auto-upsert の source とする。                                                 |
| 調剤 task               | `src/app/api/dispense-tasks/route.ts` は priority/due_date/assigned_to と emergency notification を持つ。                                                                                                             | 調剤 SLA board は既存 task/cycle status を横断集計し、監査待ち・冷所・麻薬・期限超過を risk sort する。           |
| 請求 blocker            | `src/server/services/billing-evidence/core.ts` は `BillingEvidenceBlocker` と `describeBillingEvidenceBlockers` で同意、計画、報告未送付、認定/公費/QR保険レビュー等を表現する。                                      | blocker を `RiskFinding` と `OperationalTask` に lossless に近く map する。                                       |
| 報告 / 送付             | `src/app/api/care-reports/route.ts` は report_type、delivery_records、pdf_url、送付 status を扱い、`care-report-output-policy.ts` は author/send 権限を分ける。                                                       | 宛先別 masking profile、送付完了 gate、送付失敗 task、billing blocker 解消へ接続する。                            |
| 訪問記録                | `src/lib/validations/visit-record.ts` は completed 時に S/P/structured SOAP のいずれかで通る。`visit-records/route.ts` は residual medications、attachments、handoff、billing/report 連動を持つ。                     | outcome 別 quality gate を追加し、残薬/副作用/服薬/次回方針/薬剤変更説明を構造化する。                            |
| task 基盤               | `src/server/services/operational-tasks.ts` は `dedupe_key`、`priority`、`due_date`、`sla_due_at`、related entity の upsert/resolve を持つ。                                                                           | `RiskFinding -> OperationalTask` bridge と `task-registry` の中心にする。                                         |
| 通知                    | `src/server/services/notifications.ts` は in_app / sms / line / fax / mcs と dedupe を扱い、OS/web-push は `/notifications` landing に寄せる。                                                                        | delivery ledger / failed external task / critical recipient audit を追加し、PHI redaction regression を固定する。 |
| PII redaction           | `src/lib/notifications/os-bridge-redaction.ts`、`src/lib/visit-schedule-proposals/response.ts`、route diagnostics normalizer 群が最小化パターンを持つ。                                                               | 共通 PII policy matrix と endpoint/output audit script に統合する。                                               |
| 権限                    | `src/lib/auth/permission-matrix.ts` は visit/report/billing/patient sharing 等の capability を role に割り当てる。                                                                                                    | endpoint/action/export/attachment coverage test を追加し、「定義済みだが未使用」を検出する。                      |

**統合原則**:

- P0 は単なる UI warning で完了にしない。`blocking` / `urgent` は必ず readiness/blocker、operational task、audit の少なくとも 1 つへ接続する。
- 患者安全・請求・報告・通知・外部出力に影響する waiver/override は薬剤師または admin 権限、理由必須、audit 必須にする。
- PHI/PII を含む可能性がある自由記載、住所、電話、薬剤名、保険番号、報告本文、添付 metadata は list API / audit response / OS・外部通知で本文を返さない。detail は permission と no-store を前提に最小化する。
- 後段処理が前段データを暗黙変更しない。訪問記録 → 報告 → 請求 → 外部出力は一方向の依存関係にする。
- task explosion を防ぐため、P0/P1 の新規 task は `task-registry` に owner domain、dedupe builder、resolve condition、stale threshold、patient-safety/billing flags を登録してから生成する。

#### RISK-CORE-1. 未接続 domain adapter / resolve predicate 残作業 `cc:REFERENCE`

> 2026-07-07 整理: VS-AUTO と Risk track の責務分離、VS-AUTO-8 が `RX-001` / `RX-002` を参照する方針、migration human gate は上位方針へ反映済み。ここには未接続 domain と domain 別 resolve predicate だけを残す。

- 残:
  - `visit_record`、未接続の `report_delivery`、`notification`、`privacy_security`、`integration`、`data_quality` の adapter 拡張。
  - foundation summary 全体、検査値/薬学 risk、担当未割当 finding の domain 分離。
  - billing / report / notification の task が月末・外部送付で孤児化しないための domain 別 resolve predicate。
  - PatientBoard / renewal board / notification health から既存 `RiskFinding` contract を再利用する接続。
- 受入条件:
  - 追加 adapter は PHI/free text を audit/log/list DTO に流さない。
  - 同一 risk の重複 task が増えない。
  - blocker 解消後の task close / waive / stale resolution が registry 条件で説明できる。
  - 全 finding に `action_href` がある。
  - no-store、withOrgContext、case ownership / org boundary、forbidden tests を持つ。

#### RISK-P0. 最優先実装バックログ `cc:REFERENCE`

| ID       | 領域           | タスク                                         | 主な対象                                                                                           | 残タスク / 受入条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------- | -------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RX-001   | 薬剤変更       | Medication Change Review Gate                  | `medication-change-review`, `visit-preparation-readiness`, `today-preparation`                     | 追加/削除/増量/減量/用法/剤形変更を分類し、high-risk は薬剤師確認完了まで ready/contact/confirm 不可。確認者・日時・判断結果・理由を audit。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| RX-002   | 残薬/頓服/外用 | Medication Stock Ledger / Stock Risk           | `modules/pharmacy/medication-stock`, `visit-records`, patient board                                | 済: DB schema / RLS / index、患者別 stock summary API、accepted inbound medication-stock signal から append-only `MedicationStockEvent` への初期反映、snapshot再計算、review task close、処方供給adapter v1（完全一致のみ自動反映、その他はreview task）。残: 処方供給follow-up、訪問時観測、usage-delta/frequency/refill request、UI、VisitBrief/Schedule接続、stock risk provider の完全統合。                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| DSP-001  | 調剤/監査      | Dispensing SLA Board                           | `dispense-tasks`, patient board, `dispense-tasks/sla-board`                                        | 調剤中、監査待ち、セット中、保留、緊急、期限超過を一覧化し、麻薬/冷所/一包化/訪問当日を上位表示。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| BIL-001  | 請求           | Billing Close Work Queue                       | `billing-evidence/core.ts`, billing close board                                                    | `unreviewed` / `blocked` / `confirmed` / `excluded` / `exported` を患者/訪問/根拠単位で処理。除外/確認は理由と reviewer 必須。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| BIL-002  | 請求           | Billing blocker task bridge                    | `billing-evidence/core.ts`, `risk-task-bridge.ts`                                                  | 同意なし、計画なし、報告未送付、認定/公費/QR保険レビュー等を dedupe task 化し、再評価で解消。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| REC-001  | 訪問記録       | Visit Record Quality Gate                      | `visit-record-quality`, `visit-records`                                                            | outcome 別に服薬状況、残薬、副作用、薬剤変更説明、次回方針、連携事項を検査。warning は acknowledgement、block は保存不可。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| REP-001  | 報告/共有      | Report Delivery Policy                         | `care-reports`, `care-report-output-policy`, `report-masking-profile`                              | physician/care_manager/facility/nurse/family/internal 別に出力項目・権限・送付完了判定を分け、失敗は task 化。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| INB-001  | 他職種受信     | Inbound Interprofessional Communication Module | `InboundCommunicationEvent`, `InboundCommunicationSignal`, `communication-queue`, medication-stock | `/communications/inbound`、`GET /api/communications/inbound`、`POST /api/communications/inbound/{phone,mcs}`、`GET /api/communications/inbound/signals`、`POST /api/communications/inbound/signals/tasks` は正式 `InboundCommunicationEvent` source へ cutover 済み。正式DB正本: `InboundCommunicationEvent` / `InboundCommunicationSignal` / attachment / source mapping の Prisma schema、migration、RLS policy は追加済み。Signal materialize、Task bridge、MedicationStock apply、Case Risk source 連動も初期実装済み。残: 3カラム review UI、FAX/メール/手入力 source、raw_text再認可 detail、VisitBrief/Report 変換。raw text は通知・監査・共有・timeline一覧・queue item・report workspace・case risk に直接出さない。                                                                                                                                   |
| MOV-001  | 患者詳細/UI    | Patient Movement Timeline                      | `PatientMovementTimeline`, `patient-detail-timeline-*`, INB/MedicationStock sources                | 残: 地図なし Google Maps Timeline 風の最終UX、standalone movement-timeline API、正式 INB / MedicationStock / safety source。処方・訪問・文書は詳細本文を payload に出さず正本 deep link のみ。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DASH-OPS | ダッシュボード | Dashboard Operations Command Center            | `DashboardCockpit`, dashboard cockpit BFF, INB/RX/report/billing segments                          | 済: `DASH-P0-002` summary/details 重複取得削減、`DASH-P0-003` segment-specific invalidation、`DashboardUrgentItem` 初期導入、inbound segment、stock-risks/report-billing segment、task/visit/report/callback/billing/stock urgent source、role priority、source drilldown、`DASH-P0-004` Clock Island、`DASH-P0-005` ViewModel hook。残: Summary Rail、Process tile clickable、dashboard quick action、density/semantic tone、render-boundary evidence、visual regression。監査中心の「今すぐ対応」を、他職種受信、残数不足、報告送付失敗、折返し期限、請求blockerまで含む運用司令塔に拡張する。ダッシュボードは認証済み業務画面なので、権限内の患者名・薬剤名・残数・MCS/電話本文・連絡先・添付導線など判断に必要な情報は表示してよい。制限は dashboard 固有の blanket redaction ではなく、role / assignment / scope / consent / purpose による権限制御で行う。 |
| SEC-001  | PII/監査       | PII Policy Matrix / endpoint audit             | `pii-policy.ts`, `pii-endpoint-audit.ts`, `permission-matrix.ts`                                   | field class と role/output profile を定義し、list API/audit/外部通知/PDF/CSV/添付の PHI 漏洩候補を検出。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| SEC-002  | PII/監査       | AuditLog changes allowlist/minifier registry   | `audit-entry.ts`, audit redaction/export/admin APIs                                                | action ごとに許可 `changes` field を宣言し、raw diagnostics / provider error / token / storage key は export/admin response で要約または drop。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| EXP-001  | 出力           | Bulk export audit/job minimization             | `pdf-bulk-export.ts`, admin jobs API, export audit                                                 | AuditLog は patient_count、hash snapshot、job/file id、status のみ。job output/error/admin response に raw patient id array や per-patient raw error を出さない。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| EXP-002  | 出力           | Export Surface Matrix                          | patients/prescriptions/billing/communication/audit/file/PDF exports                                | permission、org/RLS/case assignment、no-store、CSV formula neutralization、非PHI filename、fail-closed audit、row limit/truncation を surface ごとに固定。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| NTF-001  | 通知           | Notification Delivery Health Board             | `notifications.ts`, notification health board, notification rules UI                               | rule 未設定、送信先0、外部通知失敗、urgent 未達を一覧化し task 化できる。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ONB-001  | 同意/計画      | Renewal Board                                  | `management-plans.ts`, `operational-tasks.ts`, onboarding renewal board                            | 同意期限・管理計画見直し期限が近い/超過した患者を抽出し、更新 task を生成/解決。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| PERM-001 | 権限           | Permission Coverage Test                       | `permission-matrix.ts`, route tests                                                                | patient/report/billing/visit-record/audit/export/attachment の主要 API で role forbidden tests を追加。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| QA-001   | 品質保証       | 横断リスク regression pack                     | vitest suites, API tests, targeted Playwright                                                      | 薬剤変更、残薬、患者基盤、請求 blocker、記録品質、報告送付、通知 redaction、task SLA、PII redaction を固定。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

#### RISK-P1/P2. 次フェーズ不足領域 `cc:REFERENCE`

| ID       | 優先度 | 領域       | タスク                                      | 受入条件                                                                                                                                                                                                                                |
| -------- | ------ | ---------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MED-001  | P1     | 薬学リスク | Medication Risk Tag Registry                | narcotic/cold_storage/unit_dose/renal/swallowing/allergy/LASA 等を辞書化し、表示名・severity・必要 checklist・記録/報告影響を一元化。                                                                                                   |
| MED-002  | P1     | 薬剤マスタ | Drug Master Match Queue                     | prescription/residual medication の未照合、薬剤コード欠落、同名別規格疑いを一覧化し、修正後に risk を再評価。                                                                                                                           |
| LAB-001  | P1     | 検査値     | Lab Risk Evaluator                          | eGFR の値・鮮度・異常 flag を薬剤 risk と照合し、腎機能注意薬の確認 gate に出す。                                                                                                                                                       |
| PAT-002  | P1     | 患者条件   | Negative Constraint / recurring event model | デイサービス、通院、家族不在、一時不在を recurrence/one-off として保存し、提案・訪問準備・架電に使う。                                                                                                                                  |
| PAT-003  | P1     | 住所/地図  | Geocode Quality Queue                       | 住所/座標未設定、0/0、低精度、緯度経度同値を検出し、再ジオコード/人手確認 task を生成。                                                                                                                                                 |
| DSP-002  | P1     | 持参物     | Structured Carry Item Checklist             | 薬剤、麻薬、保冷、書類、衛生物品、機器、回収物を項目化し、未解決理由を ready gate へ反映。                                                                                                                                              |
| FILE-001 | P1     | 添付       | Attachment Security Policy                  | file type、size、scan status、owner entity、retention、download permission を定義。                                                                                                                                                     |
| FILE-002 | P1     | 出力       | Export Masking Profile                      | PDF/CSV/外部共有ごとに role と宛先種別で masking profile を切り替える。                                                                                                                                                                 |
| AUD-001  | P1     | 監査       | Audit Log Search Board / action taxonomy    | 患者/ケース/請求/報告/出力/添付/権限変更を検索し、重要操作理由・before/after masking を統一。                                                                                                                                           |
| DATA-001 | P1     | データ保持 | Retention / Archive Policy Matrix           | 患者アーカイブ後の read-only、保持、削除、匿名化、legal hold を実装可能な表にする。                                                                                                                                                     |
| INT-001  | P1     | 外部連携   | Integration Health Registry                 | 連携ごとの last_success / last_failure / retry_count / affected entity を可視化する。                                                                                                                                                   |
| IMP-001  | P1     | データ取込 | Prescription Intake Quality Board           | QR/JAHIS/manual の source、未照合薬剤、重複疑い、手修正差分を一覧化。                                                                                                                                                                   |
| INS-001  | P0/P1  | 保険/公費  | Insurance / Certification Work Queue        | 介護認定、公費、QR保険レビュー、資格期限を月次締めと連動。BIL-001 と直列。                                                                                                                                                              |
| FAC-001  | P1     | 施設       | Facility Identity Quality Board             | facility/building/unit/address の重複・未設定・算定影響を抽出。                                                                                                                                                                         |
| MOB-001  | P1     | モバイル   | Offline Sync Manifest                       | `offline_synced` boolean を同期対象、生成時刻、端末、失敗理由、再送状態、競合状態へ拡張。                                                                                                                                               |
| MOB-002  | P1     | 位置情報   | Visit Geo Log privacy/retention             | 保存可否、精度、保持期間、表示権限、監査ログ、患者説明文を定義し不要な位置情報を保存しない。                                                                                                                                            |
| REP-002  | P1     | 報告/共有  | External document-delivery wording gate     | 外部 email/FAX/MCS 本文に患者名、臨床本文、薬剤/free text、内部IDを出さず、短期 shared link の expiry/revoke/resend idempotency を固定。                                                                                                |
| UX-001   | P1     | UI/A11y    | Risk UI Accessibility Pass                  | severity が色だけに依存せず、キーボード/読み上げ/モバイルで処理できる。                                                                                                                                                                 |
| OPS-001  | P1     | 復旧       | Business Recovery Drill                     | 済: AWS Backup RDS recovery point admin health check、Restore Testing の隔離 subnet/security group metadata、IaC契約チェックを追加。残: live drill で RDS/PITR 復元後に visit/report/billing/task/attachment link の整合 audit を実行。 |

#### P0/P1: 他職種から薬局への情報受信・処理基盤 Inbound Interprofessional Communication Module `cc:PARTIAL`

> 2026-07-06 追加。これは `INB-001` として、既存の薬局→他職種 outbound（報告書、外部共有、delivery record、tracing report）とは逆方向の **他職種→薬局 inbound** を正本化するタスク。Medication Stock Ledger はこの inbound signal の活用先の 1 つであり、主役ではない。現行コードでは `CommunicationEvent.direction` は `inbound/outbound` を表現でき、`PatientMcsMessage` は MCS 投稿本文/投稿者/職種/所属/source URL/raw payload を持ち、`PartnerVisitRecord.record_content` は協力薬局や共有ケース由来の訪問記録を保持できる。`communication-queue.ts` は self report、架電 follow-up、communication request、delivery backlog、external share、care/tracing report timeline を統合する reader を持つため、UI 表示は既存 queue に接続しつつ、受信情報の正本は新しい `InboundCommunicationEvent` / `InboundCommunicationSignal` に分離する。
>
> 2026-07-07 実装メモ: `/communications/inbound`、`GET /api/communications/inbound`、`POST /api/communications/inbound/phone`、`POST /api/communications/inbound/mcs`、`GET /api/communications/inbound/signals`、`POST /api/communications/inbound/signals/tasks` は正式 `InboundCommunicationEvent` source へ cutover 済み。`communication-queue.ts` は summary-only `inbound_communication` item だけを薬局全体 inbox に出し、raw text / 相手連絡先 / 添付名 / storage key / signed URL は list API と UI に出さない。電話/MCS登録レスポンスには本文・送信者・連絡先・subject を返さない。signal candidate API は `InboundCommunicationEvent.raw_text` をサーバー側分類器の入力としてのみ読み、route-level allowlist DTO に `domain/type/has_quantity/unit/quantity_effect/evidence_code` などの controlled fields だけを返す。取得失敗と空状態は分離済み。`/communications` は inbound inbox へ redirect する。
>
> 2026-07-08 実装メモ: `POST /api/communications/inbound` を FAX/email/manual 専用の strict canonical intake として追加済み。create は `source_channel=fax|email|manual`、canonical `event_type`、`raw_text` を使い、`phone/mcs` や `content` / `subject` / `source_url` / `attachments` などの互換 alias は拒否する。登録レスポンスは `id`、`channel`、`event_type`、`status`、`action_href` のみで raw本文・送信者・連絡先・URL・添付名を返さない。`/communications/inbound` の入力面は FAX/email/manual の新フォームへ寄せ、manual channel は inbox / signal candidate / signal task / report workspace inbound count の allowlist に追加済み。
>
> 2026-07-07 実装メモ: 正式DB正本として `InboundCommunicationEvent`、`InboundCommunicationSignal`、`InboundCommunicationAttachment`、`InboundSourceMapping` の Prisma schema / migration / RLS policy を追加済み。`org_id` は非nullable、RLS は ENABLE + FORCE、tenant policy は `public.app_enforced_org_id()` を使う。`raw_text` は Event に閉じ、Signal は業務変換用の構造化情報として分離する。登録API、inbox queue、signal candidate、task bridge は正式 `InboundCommunicationEvent` へ cutover 済み。`GET /api/communications/inbound/signals` は候補を `InboundCommunicationSignal` に idempotent materialize し、以後の task/review action は `inbound_signal:<id>` を優先する。
>
> 2026-07-07 実装メモ: `PATCH /api/communications/inbound/signals/:id` の `apply_to_medication_stock` で、accepted/not_linked の medication stock signal を append-only `MedicationStockEvent` へ反映し、`linked_to_stock_event` へ進め、snapshot 再計算と review task close まで行う初期実装を追加済み。Case Risk Cockpit は正式 `InboundCommunicationEvent` / `InboundCommunicationSignal` を読み、未処理受信、薬剤師レビュー待ち、安全シグナル、残数台帳反映待ち、日程相談を controlled finding として出す。
>
> 残: source mapping UI、VisitBrief/Schedule/Report 連動、usage-delta/frequency/refill request の MedicationStock 反映。raw text は通知・監査・共有・timeline一覧・queue item・report workspace・case risk に直接出さない。

外部参照:

- MedicalCareStation (MCS) は医療介護向けの多職種連携コミュニケーションツールで、電話/FAX等の連絡負荷削減、時系列投稿、症状写真/動画/資料共有、患者・家族招待、医療情報システム安全管理ガイドライン準拠を掲げる。PH-OS では MCS を「外部 source の 1 つ」として扱い、MCS raw text や URL をそのまま下流業務データに混入させない。

**情報方向の責務分離**:

```text
outbound:
  薬局 → 他職種
  報告書 / トレーシングレポート / 外部共有 / delivery record / shared link

inbound:
  他職種 → 薬局
  MCS投稿 / 電話 / FAX / メール / 施設メモ / 家族・患者申告 / 協力薬局記録 / 手入力
```

**モジュール配置**:

```text
src/core/interprofessional/inbound/
  domain/
    inbound-communication-event.ts
    inbound-communication-signal.ts
    inbound-communication-source.ts
    inbound-signal-classifier.ts
  application/
    record-inbound-communication.ts
    extract-inbound-signals.ts
    review-inbound-signal.ts
    link-inbound-signal-to-workflow.ts
    create-inbound-communication-task.ts
  infrastructure/
    inbound-communication-repository.ts
    mcs-source-adapter.ts
    communication-event-source-adapter.ts
    partner-visit-record-source-adapter.ts
    phone-source-adapter.ts
    fax-source-adapter.ts
    email-source-adapter.ts
  presenters/
    inbound-communication-presenter.ts
    inbound-signal-review-presenter.ts
    patient-inbound-timeline-presenter.ts

src/modules/pharmacy/medication-stock/
  application/
    apply-inbound-stock-signal.ts
    medication-stock-signal-adapter.ts
```

依存方向:

```text
Inbound interprofessional module:
  raw source を受信し、Event と Signal を作る。
  MedicationStock / Schedule / Report を直接更新しない。

MedicationStock / Risk / Task / VisitBrief / Schedule / Report:
  InboundCommunicationSignal を参照し、権限・レビュー・idempotency を通して反映する。
```

**既存コードとの整合**:

| 現行実装                                                               | 確認できた状態                                                                                                                                   | inbound module での扱い                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema/communication.prisma::CommunicationEvent`               | `channel`、`direction`、`counterpart_name/contact`、`subject`、`content`、`attachments`、`occurred_at` を持つ。                                  | 既存手入力・電話/FAX/メール系の互換 source。新規正本は `InboundCommunicationEvent` へ寄せ、既存 row は adapter で読み替える。                           |
| `CommunicationRequest` / `CommunicationResponse`                       | 薬局から相手へ依頼し、返信内容を受ける構造がある。                                                                                               | outbound request の response は inbound source として候補化できる。ただし raw response content は signal に直接使わず extractor 経由にする。            |
| `PatientMcsMessage`                                                    | MCS 投稿の author、role、organization、body、source_url、raw_payload を保持する。                                                                | `source_channel=mcs` の source。`body` / `raw_payload` / `source_url` は raw PHI 扱いで、public DTO / notification / audit changes には出さない。       |
| `PatientMcsLink` / MCS integration finding                             | MCS 同期状態は `RiskFinding` integration domain に接続済み。                                                                                     | 同期失敗リスクと inbound signal review は別タスクにする。同期成功しても signal は薬剤師レビューを通す。                                                 |
| `PartnerVisitRecord`                                                   | 協力薬局/共有ケース由来の `record_content`、attachments、confirmed status を持つ。                                                               | confirmed record のみ inbound source adapter で候補化。draft/submitted/returned は自動候補化しない。                                                    |
| `communication-queue.ts`                                               | `CommunicationQueueItem` / `CommunicationTimelineItem` / `CommunicationDraftSuggestion` があり、患者詳細や workflow dashboard へ統合表示できる。 | 正本にはしない。`queue_type=inbound_communication` 等を追加し、未処理 signal / review task の entrypoint として表示する。                               |
| `src/modules/pharmacy/medication-stock/domain/external-observation.ts` | 他職種・MCS・communication_event・partner_visit_record 由来の残数観測を直接 ledger に書かず staging する純粋 domain helper。                     | Phase 0/1 の短期 shim。中長期は generic `InboundCommunicationSignal(signal_domain='medication_stock')` に置き換え、MedicationStock adapter が取り込む。 |

**DB設計（schema/migration/RLS 追加済み、API cutover は別slice）**:

| table                            | 目的                                                                                            | 主な field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InboundCommunicationEvent`      | 他職種から薬局へ届いた情報の正本。原文・発信者・経路・日時・添付・患者/ケース紐づけを保持する。 | `org_id`, `patient_id nullable`, `case_id nullable`, `source_channel`, `source_system`, `external_thread_id`, `external_message_id`, `external_url`, `direction='inbound'`, `sender_name`, `sender_role`, `sender_organization_name`, `sender_contact`, `event_type`, `received_at`, `occurred_at`, `raw_text`, `normalized_summary`, `attachment_count`, `has_medication_stock_signal`, `has_patient_safety_signal`, `has_schedule_signal`, `has_report_signal`, `confidence`, `processing_status`, `reviewed_by`, `reviewed_at`, `created_by` |
| `InboundCommunicationSignal`     | 原文から抽出した薬局業務上の意味。残数、使用量、副作用疑い、補充希望、訪問希望、処方意図など。  | `org_id`, `patient_id`, `case_id`, `inbound_event_id`, `signal_domain`, `signal_type`, `extracted_text`, `extracted_medication_name`, `extracted_quantity`, `extracted_unit`, `extracted_occurred_at`, `structured_payload`, `source_confidence`, `review_status`, `action_status`, `reviewed_by`, `reviewed_at`, `rejection_reason`                                                                                                                                                                                                            |
| `InboundCommunicationAttachment` | MCS画像、薬剤写真、FAX画像、資料などを FileAsset へ接続する。                                   | `org_id`, `inbound_event_id`, `signal_id nullable`, `file_asset_id`, `attachment_type`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `InboundSourceMapping`           | MCS thread / 電話相手 / FAX番号 / 外部 room と PH-OS 患者/ケースの対応関係。                    | `org_id`, `patient_id`, `case_id`, `source_system`, `external_patient_label`, `external_thread_id`, `external_room_id`, `external_contact_name`, `external_contact_role`, `external_organization_name`, `mapping_status`, `confidence`, `created_by`, `reviewed_by`, `reviewed_at`                                                                                                                                                                                                                                                              |

**Signal分類**:

```text
signal_domain:
  medication_stock
  medication_safety
  adherence
  symptom
  schedule
  report
  care_coordination
  urgent
  other

signal_type:
  observed_quantity
  usage_delta
  usage_frequency
  low_stock_text
  out_of_stock_text
  refill_request
  side_effect_suspected
  medication_not_taken
  medication_overuse
  medication_lost
  storage_issue
  schedule_change_request
  visit_request
  urgent_review_required
  unknown
```

**残数管理との接続**:

```text
InboundCommunicationEvent
  ↓ extract / classify
InboundCommunicationSignal
  ↓ pharmacist review / idempotency / permission
MedicationStockSignalAdapter
  ↓
MedicationStockEvent
  ↓
MedicationStockSnapshot
  ↓
RiskFinding / OperationalTask / VisitBrief / Schedule / Report候補
```

処理区分:

| action        | 条件                                                                                                  | 注意                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `auto_apply`  | patient_id、stock_item_id、数量、単位、signal type、source trust、idempotency、薬局設定がすべて確定。 | 初期 rollout では原則 off。適用しても audit と source link は必須。             |
| `proposed`    | 薬剤名は近いが規格不明、同一成分候補が複数、単位が曖昧、自然文抽出 confidence が低い、情報源未確認。  | 薬剤師レビュー後に MedicationStockEvent へ昇格。                                |
| `record_only` | 「少ない」「なくなりそう」等の曖昧表現、数量不明、薬剤不明だが申し送りとして有用。                    | Risk/Task/VisitBrief には「確認項目」として出せる。                             |
| `reject`      | 患者違い、薬剤違い、重複、誤情報、処理済み。                                                          | raw text を audit changes に保存せず、reason code と note present/length のみ。 |

「差し引き」と「観測」を必ず分ける:

```text
湿布は残り4枚です
  => signal_type=observed_quantity
  => observed_quantity=4

湿布を昨日2枚使いました
  => signal_type=usage_delta
  => quantity_delta=-2

「残り4枚」を -4 として差し引かない。
「2枚使った」を 残り2枚 として扱わない。
```

**MCS / 電話 / FAX / メールの段階導入**:

| phase   | 内容                                                                                                                                                   | 実装メモ                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | MCS API 連携を前提にせず、MCS投稿本文の貼り付け、投稿日時、投稿者、職種、所属、MCSスレッドURL、スクリーンショット添付、残薬/使用状況 checkbox で開始。 | raw text は `InboundCommunicationEvent.raw_text` に閉じ、summary/signal DTO は controlled fields のみ。               |
| Phase 1 | 電話メモを `InboundCommunicationEvent(source_channel='phone')` として登録。                                                                            | 発信/着信、相手、職種/関係、電話番号、所属、日時、要件、残数/使用量/補充/副作用/スケジュール checkbox、次アクション。 |
| Phase 2 | FAX/メール/施設メモを source adapter 化。                                                                                                              | 添付は `FileAsset` scan / retention / access audit を通す。                                                           |
| Phase 5 | MCS API/export/webhook、thread mapping、自動取込を調査。                                                                                               | 連携仕様は公式/契約/許諾を確認してから実装。raw provider payload 永続化は最小化。                                     |

**自動抽出**:

Phase 1 は AI ではなく rule-based + 手動補助。

```text
検出語:
  残りN / あとN / N枚 / N錠 / N包 / N本
  使いました / 使用しました / 貼りました / 塗りました
  なくなりました / 足りません / 少ない / 補充
  処方してほしい / 増えています / よく使っています
```

AI を使う場合も `AI抽出 -> proposed -> 薬剤師確認 -> accepted -> 反映` の順にし、自動反映しない。

**UI/UX**:

| 画面                     | 要件                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 患者詳細 Command Center  | 未処理の他職種情報、薬剤師確認待ち、残数報告あり、安全シグナルありを next action として表示。                                                  |
| 患者詳細 連絡・共有      | `他職種受信` / `受信連携` timeline を配置し、MCS/電話/FAX/メールを source badge で表示。                                                       |
| 患者詳細 薬剤・訪問      | MedicationStockPanel に「他職種からの残数報告」queue を表示。未確認候補、自動反映済み、数量不明、名寄せ確認待ちを分ける。                      |
| InboundSignalReviewPanel | 3カラム: 左=原文/添付/投稿者/日時、中央=抽出候補/薬剤名/数量/単位/confidence、右=反映先/既存stock item/新規stock item/記録のみ/却下/タスク化。 |
| VisitBrief               | 正式 `InboundCommunicationSignal` 追加後、残数/安全/日程の優先順で `multidisciplinary_updates` / `must_check_today` を拡張する。               |

UI 実装時は PH-OS UI/UX SSOT に従い、必要な redesign では `gpt-image-2` で非PHI mockup を再構築してから実装する。

**既存機能との接続**:

| 接続先             | 実装方針                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CommunicationQueue | `queue_type`: `inbound_communication`, `inbound_medication_stock_signal`, `inbound_safety_signal`, `inbound_schedule_request`, `inbound_review_required` を追加。正本は `InboundCommunicationEvent`。                                                         |
| RiskFinding        | `inboundInterprofessionalRiskProvider` を追加。未処理情報、残数不足報告、副作用疑い、薬剤名未紐づけ、数量不明の補充希望、MCS患者安全シグナル、電話連絡確認事項を controlled finding として返す。                                                              |
| OperationalTask    | 正式 `InboundCommunicationSignal` の review/action lifecycle と TaskTypeRegistry を接続し、review済み/却下/適用済みで task が解消するようにする。patient 関連 task だけ患者詳細 anchor へ遷移し、MCS/電話/FAX/メール/抽出signalの source id はURLへ出さない。 |
| MedicationStock    | `signal_domain='medication_stock'` の accepted signal だけを adapter で取り込む。inbound module から stock module を直接 import しない。                                                                                                                      |
| Schedule           | 不足報告、補充希望、副作用疑い、服薬困難、訪問希望を候補理由・薬剤師確認 gate・患者連絡時確認事項に出す。自動確定しない。                                                                                                                                     |
| Report             | 自動挿入しない。薬剤師が「報告書に含める / 申し送りのみ / 内部記録のみ」を選択。                                                                                                                                                                              |
| External Share     | scope: `inbound_communication_summary`, `inbound_communication_detail`, `inbound_communication_raw_text`。raw_text は明示許可、理由、監査ログ必須。                                                                                                           |

**タイムライン外の必須業務導線（2026-07-07 追記）**:

> `MOV-001` は患者ごとの「見える化」。`INB-001` の本体は、薬局全体で受信情報を見つけ、薬剤師が確認し、MedicationStock / Task / Risk / VisitBrief / Report へ安全に変換する業務導線である。患者詳細を開かないと気づけない構造は運用事故になるため、inbox / review queue を timeline と別に作る。
>
> 2026-07-07 のコードスキャンでは、`communication-queue.ts` の `inbound_communication` item、`TaskTypeRegistry` の inbound task type 群、`core.inbound_interprofessional` Risk provider、VisitBrief への inbound queue 反映、患者 movement timeline への task/communication marker は導入済み。さらに正式 `InboundCommunicationEvent` / `InboundCommunicationSignal` / attachment / source mapping の schema/migration/RLS と、phone/MCS 登録・inbox・signal candidate・task bridge の正式 `InboundCommunicationEvent` cutover も追加済み。`GET /api/communications/inbound/signals` は candidate を `InboundCommunicationSignal` へ idempotent に materialize し、公開DTOは `signal_id` / controlled status / badge情報だけを返す。ここでは実装済み task registry / risk provider / DB schema / event source cutover / signal materialize そのものは再掲せず、薬局全体 review lifecycle、正式 review action、downstream 連動を残タスクとして扱う。
>
> ID整合: 以前の検討メモにある `TASK-010` は現行 `TASK-011` へ、`RISK-020` は現行 `RISK-021` へ統合する。重複IDは作らない。`INBOUND-001` は薬局全体の受信インボックス、`INBOUND-002` は受信シグナルレビューと反映前確認、`MOV-001` は患者ごとの経緯表示に限定する。

| ID             | 優先度 | タスク                                     | 主な対象                                                                                                                                                                                                 | 受入条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INBOUND-001    | P0     | 他職種受信インボックス / レビューキュー    | `/communications/inbound`, `GET/POST /api/communications/inbound`, `communication-queue.ts`, `InboundCommunicationEvent`                                                                                 | 正式 `InboundCommunicationEvent` source への cutover 済み: phone/MCS route、FAX/email/manual canonical intake、inbox list、task status projection は formal event を使う。MCSは `source_channel=mcs`、手入力は `source_channel=manual` として扱う。false-empty と取得失敗を分離する。正式 schema/migration/RLS は追加済み。薬局全体の未処理受信を患者詳細を開かずに見つけられることをDoDにする。左filter、中央card list、右review/反映panelの3ペインを基本とし、未処理、薬剤師確認待ち、残数関連、副作用/安全、スケジュール相談、MCS、電話、FAX、メール、手入力で絞り込む。残: source mapping、未処理/確認待ち/タスク化済み/反映済み/却下の正式状態遷移、3カラム review queue の永続 action 連動。 |
| INBOUND-002    | P0     | Inbound Signal Review 画面                 | `GET /api/communications/inbound/signals`, `PATCH /api/communications/inbound/signals/:id`, `/communications/inbound`, `InboundSignalReviewPanel`, `InboundCommunicationSignal`, MedicationStock adapter | 済: signal candidate materialize、controlled DTO、minimal review action (`accept` / `record_only` / `reject`)、review task close、`apply_to_medication_stock` による `linked_to_stock_event` への初期反映、MedicationStock snapshot 再計算。公開DTO/response/task metadata に raw本文・subject・相手名・連絡先・患者名・薬剤名・数量値・添付情報・MCS URL は返さない。残: 正式 review detail shell、raw_text再認可 UI、usage-delta/frequency/refill request の反映、3カラム review UX の完成。受信情報を直接 MedicationStock へ反映せず、必ず signal lifecycle と明示 action を経由する。                                                                                                          |
| STOCK-001      | P0     | 外用薬・頓服薬残数管理の独立モジュール化   | `RX-002`, `src/modules/pharmacy/medication-stock`, `PatientMedicationStockItem`, `MedicationStockEvent`                                                                                                  | `RX-002` の実装 lane として扱う。処方供給、訪問時観測、他職種報告、補正、廃棄を append-only event として記録し、snapshot は再計算可能にする。YJ/HOT/GS1(=GTIN/JAN)/一般名/規格/剤形/メーカー連動と薬剤師確認つき名寄せに対応する。                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| TASK-011       | P0/P1  | 他職種受信 task lifecycle 連動             | `InboundCommunicationSignal`, `communication-queue.ts`, `operational-tasks.ts`, `risk-task-bridge.ts`, `POST /api/communications/inbound/signals/tasks`                                                  | 済: `inbound_signal:<signal_id>` selector、正式 dedupe key `inbound:{signal_id}:{task_type}`、controlled task metadata、formal signal review後の open review task close、MedicationStock apply後の `linked_to_stock_event` 処理済み投影。旧 `inbound_event:<id>:candidate:<n>` / `inbound-signal-task:{event_id}:{candidate_index}:{task_type}` は fallback として残る。残: legacy event-index task の移行、task解消の双方向同期、VisitBrief/Schedule/Report 由来 task との再評価 close。                                                                                                                                                                                                          |
| RISK-021       | P0/P1  | Inbound formal source Risk連動             | `InboundCommunicationEvent`, `InboundCommunicationSignal`, Case Risk Cockpit, patient command center                                                                                                     | 済: Case Risk Cockpit が正式 `InboundCommunicationEvent` / `InboundCommunicationSignal` を読み、未処理受信、薬剤師レビュー待ち、安全シグナル、MedicationStock反映待ち、日程相談を controlled finding として返す。legacy `CommunicationEvent` fallback は維持。finding title/detail は free text を使わず、`/communications/inbound` の正本 review へ deep link する。残: 患者Command Centerでの表示優先度調整、患者紐づけ不明 source mapping risk、VisitBrief/Schedule/Report への downstream risk再評価。                                                                                                                                                                                         |
| MCS-001        | P1     | MCS情報貼り付け入力 UI                     | `POST /api/communications/inbound/mcs`, `InboundCommunicationEvent(source_channel=mcs)`                                                                                                                  | 正式 event source へ cutover 済み: MCS route は本文、投稿者、職種、所属、MCSスレッドURL、種別を最小レスポンスで登録できる。現行 `/communications/inbound` の新 intake 面は FAX/email/manual 専用で、MCS は route/API 正本として維持する。登録レスポンスと inbox/signal 一覧には raw本文・投稿者・所属・MCS URL・薬剤名・数量値を出さない。`PatientMcsMessage` は同期専用正本として維持する。スクリーンショット添付、残薬/使用状況 checkbox、API/export/webhook 自動連携は後続。                                                                                                                                                                                                                    |
| PHONE-001      | P1     | 電話メモ構造化                             | `POST /api/communications/inbound/phone`, `InboundCommunicationEvent(source_channel=phone)`                                                                                                              | 正式 event source へ cutover 済み: phone route は患者ID/ケースID/相手/連絡先/種別/本文を最小レスポンスで登録できる。現行 `/communications/inbound` の新 intake 面は FAX/email/manual 専用で、電話は route/API 正本として維持する。登録レスポンスと inbox 一覧に raw本文・相手名・連絡先は出さない。`GET /api/communications/inbound/signals` で電話由来 signal は正式 `InboundCommunicationSignal` へ materialize される。残: 職種/所属/残数/副作用/補充/スケジュール/次アクションの正式 structured field、review action UI。                                                                                                                                                                      |
| REPORT-020     | P1     | 他職種受信情報の報告書候補化               | report workspace, draft suggestion, masking profile                                                                                                                                                      | `normalized_summary` を報告書候補として提示する。raw_text は自動挿入しない。薬剤師が `報告書に含める` / `申し送りのみ` / `内部記録のみ` を選択できる。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| INBOUND-010    | P1/P2  | Inbound Source Mapping                     | `InboundSourceMapping`, MCS thread, phone/fax/email source mapping                                                                                                                                       | MCSスレッドURL、外部room ID、電話番号、発信者名、職種、所属を patient_id / case_id に mapping し、confidence と review status を持つ。患者紐づけ不明は review queue と RiskFinding に出す。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| SECURITY-030   | P0/P1  | Inbound raw_text / summary / signal の分離 | DTO/presenter, audit, notification, SSE, export/share                                                                                                                                                    | `raw_text` は一覧、通知、SSE、OS push、監査 changes、report候補、timeline card に出さない。業務 UI は `normalized_summary` と `Signal` を使う。raw_text 閲覧は権限、理由、監査ログ、request_id を必須にする。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| SHARE-010      | P1/P2  | Inbound情報の共有scope追加                 | external share scope registry, masking profile, consent/audit                                                                                                                                            | `inbound_communication_summary`, `inbound_communication_detail`, `inbound_communication_raw_text` を追加する。raw_text 共有は明示許可、理由、監査ログ必須。default は summary のみ。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| COLLAB-001     | P1     | Collaboration Entity Access Provider化     | `collaboration-access.ts`, module registry, pharmacy collaboration providers                                                                                                                             | common collaboration が `dispense_task` / `medication_cycle` / `set_plan` など薬局固有 entity を直接知らない。pharmacy 側 provider 登録で既存 entity を維持し、将来 home_nursing / home_medical entity を core 変更なしに追加できる。                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ARCH-010       | P1     | Module boundary allowlist 削減             | module boundary check, patient-detail-workspace, visit-brief, report-templates, collaboration-access                                                                                                     | patient detail の薬局依存は panel provider、visit brief の薬局依存は pharmacy contributor、report templates は pharmacy report provider、collaboration access は provider 化へ移す。allowlist expectedCount を増やさない。                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PATIENT-UI-020 | P1     | Patient Workspace Panel Provider化         | patient detail shell, pharmacy/inbound/stock/movement/billing/document panels                                                                                                                            | `card-workspace.tsx` に残数管理、他職種受信、患者の動き、リスク、タスクを直接積み増さない。非active tab / panel の mutation hooks は初期化せず、panel provider で module 境界を保つ。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**2026-07-07 bridge実装メモ（正式DB event cutover後 / Signal materialize 後の現在地）**:

- `INBOUND-001`: `/communications/inbound` は正式 `InboundCommunicationEvent`
  を薬局全体の summary-only inbox として表示し、`needs_review` / `task_created`
  / `task_completed` の短期 status filter を持つ。`CommunicationQueue` は bridge
  task の dedupe key を読み、task化済み受信を `タスクを確認` action に切り替える。
  これにより、候補を task 化した後も inbox に未処理として残り続ける状態を避ける。
- `INBOUND-001`: `accepted/auto_accepted` かつ `not_linked` の signal は
  `reviewed_pending_action` として薬局全体 inbox に投影する。薬剤師レビュー完了と
  MedicationStock 等への業務データ反映完了を混同しないため、この状態は処理済みではなく
  「確認済み未反映」として filter / summary で扱う。
- `INBOUND-002`: candidate review panel は `InboundCommunicationSignal` を
  idempotent に materialize した `signal_id` を持つ。公開DTOは signal id、controlled
  domain/type/status、stock_review summary のみで、raw text / sender / drug name /
  quantity value / MCS URL / storage key は出さない。
- `TASK-011`: `POST /api/communications/inbound/signals/tasks` は
  `inbound_signal:<id>` 形式を優先し、controlled metadata の task を
  `inbound:{signal_id}:{task_type}` で dedupe 作成する。旧
  `inbound_event:<id>:candidate:<n>` は fallback。既存 task は status を保持し、完了済み
  task を再オープンしない。task 作成後、signal は `linked_to_task` へ進む。
- `INBOUND-002`: `PATCH /api/communications/inbound/signals/:id` は
  `accept` / `record_only` / `reject` を no-store response で処理し、UI は `signal_id`
  と `action` だけを送る。reject reason は controlled fixed reason を使い、raw本文、
  薬剤名、数量値、送信者、連絡先を request/response に混ぜない。
- `INBOUND-002`: inbox の signal review panel は `review_status` と `action_status`
  を badge で表示する。`needs_review` 以外の signal は review ボタンと
  薬剤師確認タスク化ボタンを無効化し、`accepted` かつ `not_linked` の
  medication stock signal は残数台帳への明示反映待ちとして表示する。
- `TASK-011`: `CommunicationQueue` は正式 `inbound:{signal_id}:...` task dedupe を
  `InboundCommunicationSignal.inbound_event_id` 経由で event に戻す。`record_only` /
  `rejected` / `ignored` / `linked_to_stock_event` の signal だけで構成される受信は
  `task_completed` として投影し、処理済み filter に乗せる。
- `INBOUND-002`: `apply_to_medication_stock` は `accepted` かつ `not_linked` の
  medication stock signal だけを対象に、MedicationStockEvent 作成、snapshot 再計算、
  `linked_to_stock_event` への遷移、review task close を行う。usage-delta/frequency/
  refill request は後続。
- `RISK-021`: Case Risk Cockpit は正式 `InboundCommunicationEvent` /
  `InboundCommunicationSignal` を参照し、未処理受信、レビュー待ち、安全、残数反映待ち、
  日程相談を controlled finding として返す。legacy `CommunicationEvent` fallback は
  formal source が空のときだけの互換 path として維持する。
- 残タスク: legacy event-index task の移行、task解消の双方向同期、raw_text再認可
  detail、VisitBrief/Schedule/Report 連動。

**INBOUND-001/002 の review workflow 受入条件**:

```text
薬局全体インボックス:
  - 患者詳細を開かなくても未処理のMCS/電話/FAX/メール/手入力が分かる。
  - 未処理、確認待ち、タスク化済み、反映済み、却下を同じstatus vocabularyで扱う。
  - false-empty、取得失敗、権限不足を別状態で表示する。

3カラムレビュー:
  左: 原文/添付/送信者/日時。ただし raw_text は権限確認後のみ。
  中央: 抽出候補、signal type、数量/単位の有無、confidence、review status。
  右: 反映先、MedicationStock候補、Task化、記録のみ、却下、詳細deep link。

業務変換:
  - 「残り4枚」は observed_quantity、「2枚使用」は usage_delta として区別する。
  - 曖昧な「少ない」「足りない」は low_stock_text / record_only / review_required に留める。
  - auto apply は当面禁止し、薬剤師review後に accepted signal だけ downstream へ渡す。
  - `record_only` / `reject` は downstream side effect を起こさない。
  - `accept` だけでは MedicationStock へ直接書かず、`apply_to_medication_stock` 相当の明示actionで `linked_to_stock_event` に進める。
```

**Inbound Source別の初期導線**:

| source         | Phase 1入力                                                     | Phase 1活用                                         | 後続                                             |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| MCS            | 投稿本文、投稿日時、投稿者、職種、所属、スレッドURL、添付候補。 | signal抽出、review queue、task化、timeline marker。 | API/export/webhookは公式仕様・契約・許諾確認後。 |
| 電話           | 相手、職種/関係、電話番号、所属、日時、要件、本文。             | 残数/安全/日程/補充希望 checkbox、signal抽出。      | structured field化、録音/STTは別gate。           |
| FAX/メール     | 受信日時、送信元、本文または添付、患者/ケース候補。             | review queue、source mapping、FileAsset scan連動。  | OCR/自動取込は raw payload最小化後。             |
| 施設/家族/口頭 | 手入力メモ、関係者、確認項目、次アクション。                    | record_only、task化、VisitBrief確認項目化。         | source mapping と権限scope整理後。               |

**タイムライン外の実装優先順**:

```text
1. INBOUND-001 他職種受信インボックス
2. INBOUND-002 受信シグナルレビュー画面
3. STOCK-001 / RX-002 外用薬・頓服薬残数管理の独立モジュール
4. TASK-011 受信情報 -> OperationalTask lifecycle 変換
5. RISK-021 受信情報 -> 正式 RiskFinding source 変換
6. MCS-001 / PHONE-001 MCS貼り付け・電話メモ入力UI
7. VISIT-BRIEF-010 訪問ブリーフ連動
8. REPORT-020 報告書候補化
9. COLLAB-001 Collaboration Access provider化
10. ARCH-010 Module boundary allowlist削減
```

**インボックス UI 方針**:

```text
左: フィルタ
  未処理 / 薬剤師確認待ち / 残数関連 / 副作用・安全 /
  スケジュール相談 / MCS / 電話 / FAX / メール

中央: 受信カード一覧
  患者名（権限内）/ 送信者・職種 / チャネル / controlled summary /
  緊急度 / 受信日時 / 処理状態 / action label

右: レビュー・反映パネル
  原文（権限確認後）/ 抽出シグナル / 反映先 /
  タスク化 / 記録のみ / 却下 / deep link
```

Google Maps Timeline 風の `MOV-001` は「経緯を追う UI」。この `INB-001` backlog は「薬局全体で受信情報を処理する UI/API」。両者は同じ source を共有するが、完了条件は別にする。

**API案**:

| method/path                                                  | 用途                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/patients/:id/inbound-communications`              | 他職種受信情報の手入力登録。                                                                                                    |
| `POST /api/patients/:id/inbound-communications/phone`        | 電話情報の登録。内部的には `InboundCommunicationEvent`。                                                                        |
| `POST /api/patients/:id/inbound-communications/mcs`          | MCS情報の貼り付け/手入力登録。API連携は後続。                                                                                   |
| `GET /api/inbound-communication-signals?status=needs_review` | 受信シグナル review queue。list envelope は `API-LIST-001` に合わせる。                                                         |
| `PATCH /api/inbound-communication-signals/:id`               | `accept`, `apply_to_medication_stock`, `create_new_stock_item`, `record_only`, `reject`, `create_task`, `link_to_visit_brief`。 |

**権限 / 監査 / 通知**:

```text
permissions:
  canCreateInboundCommunication
  canViewInboundCommunication
  canViewInboundRawText
  canReviewInboundSignal
  canApplyInboundSignalToMedicationStock
  canShareInboundCommunication

audit:
  MCS情報登録 / 電話情報登録 / raw_text閲覧 / signal抽出 / signal review /
  残数台帳反映 / task化 / 報告書反映 / 共有 / 却下 / 補正

audit changes:
  raw_text全文は保存しない。
  raw_text_length, source_channel, signal_type, review_action, target_entity_id,
  reason_present, reason_length, reason_redacted のみ。

notification:
  OS通知には患者名・薬剤名・本文を出さない。
  「他職種からの確認事項があります」の controlled wording で /notifications へ誘導。
```

**Phased PR plan（未完のみ）**:

| phase    | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | validation                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 2  | DB schema: `InboundCommunicationEvent`, `InboundCommunicationSignal`, attachment/mapping。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 実装済み: Prisma schema、migration、RLS ENABLE/FORCE、RLS ledger 更新、Prisma validate/generate。残: DTO snapshot、raw_text permission tests を正式 API cutover と同時に追加。                                                                                                                                                                                                 |
| Phase 3a | Event-source API + CommunicationQueue: 正式 `InboundCommunicationEvent` の item を `/communications/inbound` に summary-only 表示し、電話メモを `POST /api/communications/inbound/phone`、MCS貼り付けを `POST /api/communications/inbound/mcs`、FAX/email/manual を `POST /api/communications/inbound` で最小レスポンス登録し、`GET /api/communications/inbound/signals` で controlled signal candidate と MedicationStock `stock_review` summary だけを返し、inbox UI に candidate panel を出す。`POST /api/communications/inbound/signals/tasks` で `inbound_event:<id>:candidate:<n>` から薬剤師確認 task を dedupe 作成し、bridge task 状態を inbox の `task_created` / `task_completed` status に反映する。 | 実装済み。API/UI tests、no-store、false-empty separation、raw text omission、safe relative href fallback、phone/MCS/FAX/email/manual create minimal DTO、assignment-scoped signal candidate DTO、candidate panel raw omission、stock review DTO omission、task response/metadata PHI omission、completed task reopen 防止、task化済み受信の status filter / action_href 反映。 |
| Phase 3b | 正式 API + CommunicationQueue: review queue、source mapping、queue item 接続。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | API tests、forbidden tests、no-store、false-empty separation、review status/action status tests、source mapping tenant tests。                                                                                                                                                                                                                                                 |
| Phase 4  | MedicationStock adapter: accepted stock signal を MedicationStockEvent へ反映。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 実装済み: `apply_to_medication_stock` で accepted/not_linked signal から append-only StockEvent 作成、snapshot 再計算、review task close。残: usage-delta/frequency/refill request、UI apply導線、処方供給/訪問観測との統合。                                                                                                                                                  |
| Phase 5  | Risk/Task/VisitBrief/Schedule/Report/Share 接続。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Risk/Task 初期連動は実装済み: formal inbound signal から controlled Case Risk finding と review/apply task lifecycle を返す。残: VisitBrief/Schedule/Report/Share 接続、patient command center 表示優先度、cockpit/task/brief/schedule/report masking/share scope tests。                                                                                                      |
| Phase 6  | MCS API/export/webhook 調査と自動取込。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 公式仕様/契約確認、provider payload minimization、retry/idempotency tests。                                                                                                                                                                                                                                                                                                    |

**受入基準**:

- 他職種から薬局への情報を患者/ケースに紐づけて記録できる。
- MCS投稿、電話情報、FAX/メール/施設メモを PH-OS 上に登録できる。
- 原文と要約・signal を分けて保存できる。
- 残数、使用量、補充希望、副作用疑い、服薬困難、訪問希望などの signal を作れる。
- Signal は薬剤師レビューでき、`accepted` / `record_only` / `rejected` / `superseded` を持つ。
- 残数報告は MedicationStock に反映できるが、inbound module は MedicationStock を直接更新しない。
- 「残り4枚」と「2枚使った」を区別できる。
- 曖昧な情報は記録のみ、またはレビュー待ちにできる。
- 他職種情報は RiskFinding、OperationalTask、VisitBrief、Schedule、Report 候補へ連動できる。
- raw_text は外部共有、監査ログ、通知、SSE、OS push に直接出ない。
- 既存の薬局→他職種 outbound と、今回の他職種→薬局 inbound が責務分離されている。

#### P0/P1: 患者の動きタイムライン Patient Movement Timeline（MOV-001） `cc:PARTIAL`

> 2026-07-07 整理。既存コードでは `movement` タブ、`PatientMovementTimeline`、共通型
> `src/types/patient-movement-timeline.ts`、`/api/patients/:id/timeline/:eventId` の
> safe detail resolver、処方/訪問/文書の occurrence-only 表示、MCS/partner visit/task bridge
> は導入済み。MOV-001 は、実装済みタスクを再掲せず、正式 inbound / MedicationStock source と、
> Google Maps Timeline 風（上部地図なし）の最終UXへ絞る。

**画面方針**:

- 患者詳細の新規タブ **患者の動き** が、日常業務で見る時系列の正本。
- `history` タブは変更履歴、構造化ケア、監査寄り情報へ寄せる。
- Google Maps Timeline は「日付ごとに、その日の出来事が時刻順カードで追える」情報設計だけを参照する。地図、移動軌跡、位置履歴 UI は作らない。
- 処方、訪問、文書登録は「発生したこと」を timeline で確認できればよい。処方内容、訪問本文、文書本文は timeline payload に載せず、正本画面への deep link で確認する。
- 他職種受信、残数/使用量シグナル、タスク、安全情報は、薬剤師が次に見るべきものが分かるように `interprofessional` / `medication_stock` / `task` / `safety` category へ分ける。

**実装済み前提（再実装しない）**:

- `PatientDetailTab` に `movement` があり、`#patient-movement` / `#inbound-communications` / `#inbound-signals` / `#medication-stock-events` は movement へ解決される。
- `PatientMovementTimeline` は検索、カテゴリフィルタ、日付グループ、summary cards、右側要約、イベントごとの `href` / `action_label` を持つ。
- `PatientMovementEventType` / `PatientMovementCategory` / `PatientMovementTimelineEvent` は `src/types/patient-movement-timeline.ts` に共通化済み。
- `visit_event` / `prescription_event` / `document_registered` は occurrence-only として controlled summary を出し、metadata や詳細本文を一覧に出さない。
- `/api/patients/:id/timeline/:eventId` は movement-safe detail resolver として存在し、raw text は返さない。

**残スコープ**:

| 残ID          | 優先度 | タスク                               | 実装単位                                                                                                                                                                                                                            | 受入条件                                                                                                                               |
| ------------- | ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| MOV-UX-001    | P0/P1  | Google Maps Timeline風の最終UX       | `PatientMovementTimeline` を日付カード + 縦タイムライン + 時刻 + event card + 詳細CTAに磨く。1日サマリー、今日/昨日/7日/30日、未処理 filter、モバイル bottom sheet を追加。                                                         | 上部地図なし。日ごとの流れが見える。種別は色だけでなく icon + label。処方/訪問/文書は発生 marker と正本 deep link のみ。               |
| MOV-API-001   | P0/P1  | standalone movement-timeline API     | `GET /api/patients/:id/movement-timeline?limit&cursor&date_from&date_to&category` を追加し、患者詳細初期 BFF から重い timeline を分離する。旧 `/api/patients/:id/timeline` list alias は残さない。                                  | 初期表示は直近20-40件。cursor追加取得、category/date filter、partial failures、`meta.next_cursor`。payload budget と no-store を持つ。 |
| MOV-INB-001   | P0/P1  | Formal inbound source                | `InboundCommunicationEvent` / `InboundCommunicationSignal` schema 実装後、正式 API/queue cutover に合わせて source adapter を追加する。既存 `CommunicationEvent` / `PatientMcsMessage` / task marker は短期 bridge として維持する。 | raw_text は一覧DTO、timeline card、search haystack、通知、監査changesへ出さない。source failure は fail-soft。                         |
| MOV-STOCK-001 | P0/P1  | Medication Stock source              | `MedicationStockEvent`、equivalence review、shortage finding が入った後に medication stock source を追加する。                                                                                                                      | 残数・使用量・名寄せ・不足イベントは発生 marker と status/badge のみ。薬剤名/数量は必要最小限または詳細先で確認する。                  |
| MOV-SAFE-001  | P1     | Formal safety finding source         | Case Risk / safety finding の formal source を追加し、urgent safety signal を movement の上位表示へ接続する。                                                                                                                       | safety finding は controlled title/summary と finding deep link を持つ。free text finding detail は一覧に出さない。                    |
| MOV-RAW-001   | P1     | raw_text re-auth detail UI           | MCS/電話/FAX/メールなど raw PHI を読む detail UI を、再認可・理由・監査ログ付きで実装する。                                                                                                                                         | 一覧から raw_text は見えない。raw 閲覧は permission、reason、audit、request_id を持つ。                                                |
| MOV-LINK-001  | P1     | deep link coverage / safe navigation | `src/lib/patient-movement/navigation.ts` 相当の href builder を整備し、visit/prescription/report/billing/share/task/inbound/stock を相対URLへ統一する。                                                                             | 全 event が相対 `href` を持つ。未実装詳細は `/patients/:id/timeline/:eventId` fallback。権限なしは 403 または summary-only。           |

**Google Maps Timeline風 UI 要件（地図なし）**:

- 上部: 日付ジャンパー `[今日] [昨日] [7日] [30日] [日付選択]`、イベント件数、未処理件数。
- 中央: 日付カード、1日サマリー、縦タイムライン、時刻、event card、詳細リンク。
- 右側: 選択中イベント概要、未処理イベント、残数関連、安全シグナル。モバイルでは下部 sheet。
- 1日サマリー例: `訪問 1件 / 処方・調剤 2件 / 他職種受信 3件 / 残数 2件 / 文書 1件 / タスク 1件`。
- filter: `すべて`、`訪問`、`処方・調剤`、`他職種受信`、`残数・薬剤`、`安全`、`報告・共有`、`請求`、`タスク`、`未処理`、`薬剤師確認待ち`、`今日の動き`。
- search placeholder: `例: MCS、電話、処方、訪問、文書登録、湿布、残り4枚、ケアマネ、補充希望`。

**API DTO 方針**:

```ts
type PatientMovementTimelineResponse = {
  data: {
    patient_id: string;
    events: PatientMovementTimelineEvent[];
    summary: {
      total_count: number;
      unprocessed_inbound_count: number;
      medication_stock_signal_count: number;
      safety_signal_count: number;
      latest_event_at: string | null;
    };
    partial_failures: Array<{
      source: string;
      message: string;
    }>;
  };
  meta: {
    generated_at: string;
    next_cursor: string | null;
  };
};
```

**Source adapter ガード**:

- source adapter の `select` に、処方明細、訪問本文、SOAP、文書本文、OCR、添付ファイル名、storage key、signed URL を追加しない。
- `PatientMovementTimelineEvent.summary` は controlled sentence に固定し、DB自由記載を転記しない。
- 処方・訪問・文書登録は `visit_event` / `prescription_event` / `document_registered` marker として出す。内容は正本 deep link で確認する。
- `href` は相対パスのみ。外部URL、S3 URL、signed URL、storage URL は破棄し、正本画面または患者の動き fallback へ丸める。
- deep link が未整備の source は本文を出して埋め合わせない。まず正本画面の相対 href builder を追加する。
- safe resolver `/api/patients/:id/timeline/:eventId` は fallback / destination 解決用に残すが、処方・訪問・文書の本文を返さない。

**残Phased PR plan**:

| phase   | 内容                                                                                                        | validation                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Phase 1 | `PatientMovementTimeline` を map-less date card UI へ磨く。                                                 | UI unit/RTL、mobile viewport、a11y label、occurrence-only summary snapshot。              |
| Phase 2 | standalone `movement-timeline` API と cursor/date/category filter。                                         | API tests、partial failure tests、payload budget、no-store、forbidden tests。             |
| Phase 3 | 正式 `InboundCommunicationEvent` / `InboundCommunicationSignal` source 追加。                               | formal inbound source tests、raw_text omission tests、partial failure tests。             |
| Phase 4 | 正式 `MedicationStockEvent`、equivalence review、shortage finding source 追加。                             | stock integration tests、risk/task link tests、drug/quantity omission tests。             |
| Phase 5 | formal safety finding source と未処理/薬剤師確認待ち filter。                                               | safety finding source tests、free text omission tests、severity ordering/filter tests。   |
| Phase 6 | raw_text 再認可 UI、detail shell、deep link coverage、event間関連線（MCS受信 -> Signal -> Stock -> Task）。 | route authz tests、raw omission tests、audit log tests、relative href tests、mobile e2e。 |

**残テスト観点**:

- formal inbound event が `interprofessional` category の timeline event へ変換される。
- accepted stock signal / stock event が `medication_stock` category になる。
- urgent safety signal は `safety` category になる。
- 処方・訪問・文書登録は controlled marker と正本 `href` だけで、本文・薬剤明細・SOAP・OCR を出さない。
- `href` が相対パス以外なら拒否される。
- raw_text、raw payload、storage key、signed URL、処方薬剤明細、SOAP本文、訪問記録本文、MCS本文、電話メモ全文、文書本文、添付ファイル名が一覧DTOに出ない。
- 処方・訪問・文書 marker の primary CTA は正本画面へ直接遷移し、event detail shell を primary にしない。
- 日付ジャンパー、1日サマリー、未処理 filter、右側 preview / mobile sheet が破綻しない。
- mobile で map-less vertical timeline が崩れない。

#### P0/P1: Dashboard Operations Command Center Expansion（DASH-OPS） `cc:PARTIAL`

> 2026-07-07 追加。現行ダッシュボードは `DashboardContent -> DashboardCockpit` に集約され、
> `summary` / `details` / `team` / `comments` の分割取得、`SegmentError` による部分失敗、
> role focus、リアルタイム更新、右レールの「次にやること / 止まっている理由 / 根拠・記録」
> まで実装済み。ここでは実装済みの分割取得や部分失敗UIを再タスク化せず、ダッシュボードを
> 「今日の薬局業務コックピット」から、他職種受信・残数・安全シグナル・報告/請求ブロッカー・
> チーム稼働まで含む運用司令塔へ拡張する。

**現行コードとの整合**:

| 現行実装                                              | 確認できた状態                                                                                                                                                                                     | DASH-OPS での扱い                                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/(dashboard)/dashboard/dashboard-cockpit.tsx` | `summary` / `details` / `team` / `comments` / `inbound` を segment query として取得。comments、summary、details、team、inbound の realtime invalidation は source 別に分離済み。                   | segment 分割と source 別 invalidation は維持する。ViewModel hook と Clock Island は実装済み。次は Summary Rail、process tile/drilldown、render-boundary evidence を追加する。 |
| `UrgentNowSection`                                    | `DashboardUrgentItem[]` を最大3件表示し、監査、他職種受信、残数管理、訪問準備、報告送付失敗、折返し期限、請求blockerの初期 source は統合済み。                                                     | 既存 source は維持し、残る task source と drilldown/role focus を強化する。                                                                                                   |
| `buildNextAction()`                                   | 監査待ちを最優先、次に本日の訪問、最後に予定確認。                                                                                                                                                 | `DashboardUrgentItem` の severity / due_at / waiting_since / role focus を使って next action を決める。                                                                       |
| `src/server/services/dashboard-cockpit.ts`            | `buildCockpitSummary()` は `readAuditQueueSummary()` / `readTodayVisitSummary()` に分離済み。details だけが患者名付き queue / visit list を返す。stock-risks / report-billing segment も実装済み。 | 軽量 summary は維持する。次は p95/payload smoke、stock-risks/report-billing のUI統合、summary rail BFF 化を進める。                                                           |
| `PROCESS_WIP_GUIDES`                                  | フロント固定値。コメント上も「バックエンドに目安マスタが無いため第一版はクライアント定数」。                                                                                                       | P1で薬局設定化し、規模・曜日・時間帯・role focus に応じて API から guide を返す。                                                                                             |
| `TeamConversationPanel`                               | 内部コメントを表示し、コメントだけ fail-soft に再試行可能。                                                                                                                                        | 内部コメントと MCS/電話/FAX/メール等の inbound feed を分離する。inbound 正本は `INBOUND-001/002` を使う。                                                                     |

**DashboardUrgentItem DTO 方針**:

```ts
type DashboardUrgentItem = {
  id: string;
  source:
    | 'audit'
    | 'inbound'
    | 'medication_stock'
    | 'visit_preparation'
    | 'report'
    | 'callback'
    | 'billing'
    | 'task';
  source_id: string;
  source_label: string;
  reference_label: string | null;
  severity: 'blocking' | 'urgent' | 'warning';
  patient_id: string | null;
  patient_name: string | null;
  title: string;
  summary: string;
  due_at: string | null;
  waiting_since: string | null;
  badges: Array<{
    label: string;
    tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  }>;
  action_href: string;
  action_label: string;
};
```

Dashboard disclosure policy:

- ダッシュボードは認証済みの業務コックピットであり、権限内で閲覧できる患者名、薬剤名、残数、MCS/電話本文、連絡先、添付、報告/請求/訪問の具体情報は出してよい。判断するのは現場の人間であり、情報を過度に隠して業務判断を妨げない。
- 制限は `role`、担当/assignment、case scope、consent、support session、purpose によって行う。`pharmacist`、`clerk`、`manager`、PH-OS運営者 support mode、フリーランス薬剤師 assignment で表示範囲を変える。
- 一覧カードは最初から全情報を押し込まず、業務判断に必要な要約と主要項目を出し、全文・添付・連絡先・詳細メタデータは展開行、右側preview、drawer、詳細画面で表示する。これは秘匿ではなく情報密度制御である。
- `action_href` は相対URLのみ。添付表示やダウンロードは権限確認済みの専用 endpoint / 短時間URL経由にする。storage key を人間向けラベルとして直接表示する必要はないが、権限内の添付・原文・連絡先への導線は隠さない。
- OS通知、SSE payload、監査 `changes`、server log、外部共有、CSV/PDF export、public URL には dashboard 表示内容をそのまま流用しない。それぞれの出力境界で別の redaction / masking / audit policy を適用する。

**Dashboard target UI gap review（2026-07-07追記）**:

目標画面は、現行 `DashboardCockpit` を全面作り直しせず、次の構造へ拡張する。

```text
ダッシュボード
  ├─ 左サマリーレール
  │   ├─ 今日のサマリー
  │   ├─ 主なタスク
  │   ├─ チーム状況
  │   └─ 最終更新
  │
  ├─ メイン領域
  │   ├─ 今すぐ対応
  │   ├─ 今日の流れ
  │   ├─ 工程の今
  │   └─ 下部カード群
  │       ├─ チーム余白
  │       ├─ チームの会話
  │       └─ 根拠・記録
  │
  └─ 右側補助領域 / WorkspaceActionRail
      ├─ 次にやること
      ├─ 止まっている理由
      ├─ 根拠・記録
      └─ チームの会話 / 他職種受信
```

実装方針:

```text
1. 既存 DashboardCockpit と segment API を活かす。
2. 監査待ち中心の「今すぐ対応」は Unified Urgent Queue として拡張する。
3. 左サマリーレール、役割別表示、他職種受信、残数リスクを追加する。
4. summary/details の重複取得削減は完了済みとして扱い、再タスク化しない。
5. realtime invalidation 分離は完了済みとして扱い、追加segmentだけ同じ方針を踏襲する。
6. Clock Island と ViewModel hook は実装済みのため再タスク化しない。残る性能タスクは、section boundary、lazy mount、render-count smoke、visual regression で更新波及が小さいことを証明する。
7. ダッシュボード固有の semantic tone を定義し、色だけに依存しない。
```

**Dashboard Summary Rail 仕様**:

不足している左側サマリーレールを追加する。最小実装では既存 `summary` / `details` / `team` からフロントで合成し、将来は専用BFFへ移す。

```ts
export type DashboardSummaryRailResponse = DashboardCockpitScopeMetadata & {
  patient_cycle_summary: {
    stable_count: number;
    attention_count: number;
    waiting_review_count: number;
  };
  task_summary: Array<{
    key: 'audit' | 'visit' | 'report' | 'handoff' | 'carryover' | 'inbound' | 'stock';
    label: string;
    count: number;
    tone: 'normal' | 'warning' | 'urgent' | 'info';
    href: string;
  }>;
  team_summary: {
    total_slack_minutes: number | null;
    bottleneck_label: string | null;
  };
  generated_at: string;
};
```

追加候補:

```text
GET /api/dashboard/cockpit/rail?scope=mine|team
src/app/(dashboard)/dashboard/dashboard-summary-rail.tsx
```

受入条件:

```text
- ダッシュボード左側に今日のサマリーが表示される。
- 通常運用/要対応/確認待ちの患者サイクル数が表示される。
- 主なタスク件数から該当画面へ遷移できる。
- 最終更新時刻が表示される。
- 狭い画面では上部折りたたみまたは横スクロールカードになる。
```

**DASH-OPS completed / initial cutover（再タスク化しない）**:

```text
- DASH-P0-002 Lightweight summary builder / query duplication削減
  - summary は PHI 詳細を読まず、count / earliest_due_at / today_visit_times の軽量取得へ分離済み。
  - details だけが患者名付き audit_queue / today_visits を返す。

- DASH-P0-003 Segment-specific realtime invalidation
  - summary / details / team / comments / inbound の invalidate source は分離済み。
  - comment_refresh で summary/details/team が再取得されない構造に整理済み。

- Dashboard inbound segment 初期cutover
  - /api/dashboard/cockpit/inbound と inbound feed の初期表示は追加済み。
  - 残: review UX、role focus、MedicationStock/Report/Billing 連動、drilldown。

- DashboardUrgentItem 初期cutover
  - audit、inbound、medication-stock、visit-preparation、report、callback、billing、task は urgent item として統合済み。
  - 残: source別 drilldown の最終UX、role focus priority tuning、quick action。

- DASH-P0-005 Dashboard ViewModel hook
  - `useDashboardCockpitViewModel` は実装済み。
  - 残: hook 自体ではなく、render boundary / visual regression で更新波及を証明する。

- DASH-P0-004 Dashboard Clock Island
  - `src/app/(dashboard)/dashboard/dashboard-clock.tsx` の `useDashboardClock`、`DeadlineCountdownLabel`、`DashboardNowMarker` は実装済み。
  - 残: Clock Island自体ではなく、render-count smoke / visual regression / state fixture で過剰再描画が戻らないことを固定する。

- Dashboard stock-risks / report-billing segment
  - `/api/dashboard/cockpit/stock-risks` と `/api/dashboard/cockpit/report-billing` は実装済み。
  - 残: dashboard画面上のレール/カード統合、snapshot本体連動、drilldown、visual regression。
```

**P0 backlog**:

| ID          | 優先度 | タスク                      | 主な対象                                                                                | 受入条件                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------ | --------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DASH-P0-001 | P0     | Unified Urgent Queue 仕上げ | `DashboardUrgentItem`, dashboard summary/details, `UrgentNowSection`, `buildNextAction` | 済: `audit_queue`、`inbound_signal`、reviewed `medication_stock` apply-wait、`visit_preparation`、`report_delivery`、`callback`、`billing`、汎用 `task` source、role priority、source別 drilldown を統合。残: drilldown先の最終UX、role focus priority の運用調整、quick action の安全境界。既存監査カードは `source='audit'` として維持する。「今すぐ対応」は severity/due/waiting で3件を表示し、残件 drilldown を持つ。 |
| DASH-P0-004 | Done   | Dashboard Clock Island 分離 | `DashboardCockpit`, `dashboard-clock.tsx`, countdown/freshness components               | 実装済み。再実装しない。残タスクは `DASH-PERF-001` の render boundary / update isolation で証跡化する。                                                                                                                                                                                                                                                                                                                    |

**P1 backlog**:

| ID           | 優先度 | タスク                                   | 主な対象                                                 | 受入条件                                                                                                                                                                                                                                                               |
| ------------ | ------ | ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DASH-P1-001  | P1     | Hidden queue drilldown                   | `audit_queue_hidden_count`, `/audit` link builder        | 「残りN件を見る」を明示ボタン化し、`/audit?filter=dashboard_urgent` など条件付き遷移を使う。麻薬監査、期限超過、担当分へ絞れる。                                                                                                                                       |
| DASH-P1-002  | P1     | Carryover task drilldown                 | `carryover_count`, tasks API/UI                          | 持ち越しを患者連絡、報告、請求、訪問準備、他職種受信、残数確認に分解する。`/tasks?filter=carryover` へ遷移し、右レールに上位3件を表示する。                                                                                                                            |
| DASH-P1-003  | P1     | Team handoff recommendation              | `team_capacity`, handoff workspace                       | 余白が少ない担当者と余白がある担当者をペア化し、「Aさんの報告2件をBさんへ」のような候補を出す。候補付きで handoff へ遷移する。                                                                                                                                         |
| DASH-P1-004  | P1     | Team conversation と Inbound feed の分離 | `TeamConversationPanel`, inbound segment                 | 内部コメントは「チームの会話」、MCS/電話/FAX/メールは「他職種受信」として別カードにする。未処理N件、薬剤師確認待ちN件、残数報告N件を表示する。                                                                                                                         |
| DASH-P1-006  | P1     | WIP guide 薬局設定化                     | `PROCESS_WIP_GUIDES`, dashboard settings, summary API    | フロント固定のWIP目安を薬局設定へ移す。チーム人数、曜日、時間帯で guide を変えられる。Dashboard API が `guide` と `count` を返す。                                                                                                                                     |
| DASH-P1-007  | P1     | Today Flow 担当者別表示                  | `TodayFlowSection`, schedule/team data                   | 現在の薬局全体横棒に加え、担当者別表示と未配置タスクを追加する。訪問、監査、セット、報告、患者連絡を block 化する。                                                                                                                                                    |
| DASH-P1-008  | P1     | Dashboard quick actions                  | urgent card, inbound card, task assignment               | ダッシュボード内で既読、タスク作成、担当者割当、メモ追加、詳細への deep link までを許可する。不可逆操作は詳細画面へ遷移させる。                                                                                                                                        |
| DASH-P1-009  | P1     | Role-based dashboard layout              | `focusRole`, section order, next action priority         | pharmacist は監査/訪問準備/薬剤変更/残数不足/他職種薬剤情報、clerk は患者連絡/報告書送付/請求/書類/MCS電話受付、manager はチーム余白/詰まり/SLA/負荷を優先する。                                                                                                       |
| DASH-BFF-002 | P1     | Medication stock risk segment UI統合     | `/api/dashboard/cockpit/stock-risks`, `STOCK-001/RX-002` | APIは実装済み。次は `MedicationStockSnapshot` 本体の不足見込み、使用頻度不明、名寄せ確認待ちを dashboard card / rail に統合する。`STOCK-001` の台帳と `InboundCommunicationSignal` を消費し、権限内では薬剤名、規格、残数、使用頻度、他職種報告本文/要約を表示できる。 |

**P2 backlog / UX・性能**:

| ID              | 優先度 | タスク                                       | 主な対象                                                                                                                    | 受入条件                                                                                                                                                                                                                    |
| --------------- | ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DASH-DESIGN-001 | P2     | Dashboard semantic tone 定義                 | dashboard UI tokens, PH-OS UI guidelines                                                                                    | `urgent`, `warning`, `inbound`, `medication_stock`, `visit`, `document`, `billing`, `neutral` の semantic tone を定義する。色だけで意味を伝えず、icon + label + text を併用する。赤は本当に止まる/危険/期限超過に限定する。 |
| DASH-UX-001     | P2     | Dashboard density mode                       | dashboard shell/settings                                                                                                    | `標準`、`コンパクト`、`管理者` の密度を切り替える。日常利用では説明文を減らし、件数とCTAを優先できる。                                                                                                                      |
| DASH-PERF-001   | P2     | Dashboard render boundary / update isolation | `ConditionBanner`, `UrgentNowSection`, `TodayFlowSection`, `ProcessNowSection`, `TeamCapacityCard`, `TeamConversationPanel` | manual `useMemo` / `useCallback` の追加を目的化せず、Clock Island、component boundary、lazy mount、stable presenter DTO、render-count smoke で `now` と query state の変更が無関係 section へ波及しないことを証明する。     |
| DASH-BFF-003    | P2     | Report/billing segment UI統合                | `/api/dashboard/cockpit/report-billing`                                                                                     | APIは実装済み。報告書送付失敗、報告書未作成、請求締め前未処理、算定 blocker を dashboard card / rail に統合する。請求確定や報告送付は dashboard quick action では行わない。                                                 |
| DASH-QA-001     | P2     | Dashboard visual regression                  | dashboard story/test route, Playwright screenshot                                                                           | Summary Rail、Unified Urgent Queue、Today Flow、Process Tiles、Inbound Panel の主要状態を screenshot で固定する。PHIを含むfixtureは非実在データのみ使う。                                                                   |

**Dashboard quick action 安全ルール**:

```text
Dashboardで許可:
  - 既読 / レビュー待ちへの状態付け
  - タスク作成
  - 担当者割当
  - メモ追加
  - 詳細画面へのdeep link

Dashboardで禁止:
  - 請求確定
  - 報告書送付
  - 薬剤師確認完了
  - 患者情報の削除
  - MedicationStockへの直接反映
```

**追加 segment 方針**:

```text
既存:
  /api/dashboard/cockpit/summary
  /api/dashboard/cockpit/details
  /api/dashboard/cockpit/team
  /api/dashboard/cockpit/comments

追加:
  /api/dashboard/cockpit/inbound
  /api/dashboard/cockpit/stock-risks
  /api/dashboard/cockpit/report-billing
```

初期表示ではすべてを取らない。`role focus` と first viewport に応じて `summary`、`urgent`、`inbound`
を優先し、stock/report/billing は lazy segment とする。

**追加/変更コンポーネント一覧**:

```text
DashboardSummaryRail
DashboardUrgentQueueSection
DashboardUrgentItemCard
DashboardTodayFlowSectionV2
DashboardProcessTiles
DashboardTeamSlackCard
DashboardInboundPanel
DashboardMedicationStockRiskPanel
DashboardReportBillingPanel
DashboardMetricCard
DashboardSegmentCard
DashboardClockLabel
DashboardNowMarker
DashboardDensityToggle
```

既存再利用:

```text
WorkspaceActionRail
SegmentError
SegmentStaleBanner
FilterChipBar
SafetyBoard badge helpers
buttonVariants
```

**実装順**:

| PR   | 内容                                                                                                                                                                                      | validation                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| PR-1 | `DASH-P1-010` Dashboard Summary Rail。既存 segment から合成し、狭い画面では上部カードへ変形する。                                                                                         | responsive UI tests、rail link tests、a11y label tests。                            |
| PR-2 | `DASH-P1-001/002/005` drilldown と clickable process tiles。                                                                                                                              | route builder unit tests、dashboard UI tests、href allowlist tests。                |
| PR-3 | `DASH-P0-001` Unified Urgent Queue の仕上げ。audit/inbound/stock/report/callback/billing/visit_preparation/task と drilldown は初期統合済み。次は drilldown UX と role focus を調整する。 | urgent item presenter tests、relative href tests、role/scope tests。                |
| PR-4 | `DASH-PERF-001` render boundary / update isolation。Clock Island と ViewModel は実装済みなので、戻り防止の state fixture と render-count smoke を追加する。                               | render count smoke、clock-only update tests、dashboard component tests、typecheck。 |
| PR-5 | `DASH-BFF-002` medication stock risk segment と `DASH-BFF-003` report/billing segment のUI統合。                                                                                          | segment API tests、false-empty/error tests、role focus tests。                      |
| PR-6 | `DASH-DESIGN-001` semantic tone、`DASH-UX-001` density mode、`DASH-QA-001` visual regression。                                                                                            | screenshot regression、mobile layout tests、contrast/a11y tests。                   |

**次のPR推奨**:

```text
1. DASH-P1-010 Dashboard Summary Rail
2. DASH-P1-001/002/005 drilldown と clickable process tiles
3. DASH-P0-001 Unified Urgent Queue の drilldown / role focus 仕上げ
4. DASH-PERF-001 render boundary / update isolation evidence
```

理由: `DASH-P0-002`、`DASH-P0-003`、`DASH-P0-004`、`DASH-P0-005`、主要 urgent source、stock-risks/report-billing API は完了済みなので、次は左レールと drilldown で「今すぐ対応」の運用導線を強くする。
再描画範囲は新UI追加後の `DASH-PERF-001` で戻り防止として固定する。

**最終受入基準**:

```text
- ダッシュボード左側に今日のサマリーがある。
- 今すぐ対応に監査以外の urgent item を表示できる。
- 今日の流れで訪問とデスク作業の流れが見える。
- 工程の今から各工程へクリック遷移できる。
- チーム余白が見える。
- チームの会話と他職種受信が分離される。
- 右レールに次にやること/止まっている理由/根拠・記録がある。
- summary/details の重複取得削減が維持されている。
- 30秒更新で全体が過剰再描画されない。
- 色の意味が semantic tone として整理されている。
- モバイルでも主要CTAが見える。
```

#### P0/P1: PH-OS 7画面 UI/UX全面改善 Mock Alignment（UI-REDESIGN-001） `cc:REFERENCE`

> 2026-07-07 追加。生成済み7画面UIモックに、現在のPH-OS実コードを可能な限り近づけるための横断UI/UX仕様。
> これは全面作り直しではない。既存の `AppShell`、`Sidebar`、`WorkspaceActionRail`、`DataTable`、`SegmentError`、各BFF/API、権限、監査、RLS、no-store を維持し、現行画面を上書き改善する。
>
> このタスクは新しい業務概念を増やすためのものではなく、既存/計画済みレーンを画面体験へ接続するためのUI統合レーンである。
> 対応する既存レーン: `DASH-OPS`、`MOV-001`、`INB-001`、`RX-002`、`VISIT-SYNC-001`、`REPORT-001`、`PATIENT-UI-020`、`DASH-DESIGN-001`。

Dashboard ownership guard:

```text
DASH-OPS:
  dashboard data contracts、urgent queue、segment API、role focus、operational prioritization を所有する。

UI-REDESIGN-001:
  DASH-OPS の contract が存在する範囲だけ、visual composition、shared layout alignment、right rail の見せ方を所有する。

禁止:
  UI-REDESIGN 側で dashboard urgent source / segment API / authorization / PHI projection を再実装しない。
```

対象画面:

```text
1. 患者一覧
2. 患者詳細
3. 調剤ワークスペース
4. スケジュール管理
5. 訪問時機能
6. 報告書機能
7. 他職種機能
```

参照UIイメージ:

```text
/mnt/data/患者一覧ダッシュボードの詳細.png
/mnt/data/薬局患者管理ダッシュボード.png
/mnt/data/調剤ワークスペースダッシュボード.png
/mnt/data/薬局スケジュール管理ダッシュボード.png
/mnt/data/医療訪問管理ダッシュボード.png
/mnt/data/医療報告書作成画面.png
/mnt/data/薬局連携ツールダッシュボード.png
```

実装前に必ず確認するコード:

```text
src/app/(dashboard)/layout.tsx
src/components/layout/app-shell.tsx
src/components/layout/sidebar.tsx
src/components/layout/navigation-config.ts
src/components/ui/*
src/components/features/workspace/action-rail.tsx
src/components/ui/data-table.tsx

src/app/(dashboard)/patients/page.tsx
src/app/(dashboard)/patients/patients-board.tsx
src/app/(dashboard)/patients/[id]/page.tsx
src/app/(dashboard)/patients/[id]/card-workspace.tsx
src/app/(dashboard)/patients/[id]/patient-activity-timeline.tsx
src/app/(dashboard)/patients/[id]/patient-movement-timeline.tsx

src/components/features/dispense-workbench/dispensing-workbench.tsx
src/components/features/dispense-workbench/dispensing-workbench.adapter.ts

src/app/(dashboard)/schedules/page.tsx
src/app/(dashboard)/schedules/schedule-team-board.tsx
src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx
src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.tsx

src/app/(dashboard)/visits/page.tsx
src/app/(dashboard)/visits/visits-today.tsx
src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx

src/app/(dashboard)/reports/page.tsx
src/app/(dashboard)/reports/report-share-workspace.tsx

src/app/(dashboard)/communications/page.tsx
src/app/(dashboard)/communications/inbound/*
src/server/services/*
src/types/*
docs/ui-ux-design-guidelines.md
```

**共通レイアウト方針**:

7画面すべてを、次の情報構造へ寄せる。

```text
Top Header
  - 薬局/拠点 selector
  - global search
  - notification bell
  - user avatar / role

Left Sidebar
  - PH-OS logo
  - icon + Japanese label
  - active item = subtle teal background
  - bottom: お知らせ / ヘルプ・サポート

Main Workspace
  - page header / context
  - status / filter / summary
  - main card / table / board
  - right rail / detail panel
```

右レールは全画面で「次に何をするか」の場所として統一する。

```text
患者一覧:
  選択患者の次アクション

患者詳細:
  重要アラート / 次回までのタスク / 医療チャット

調剤:
  監査チェック / 次工程

スケジュール:
  AI提案 / 患者連絡待ち

訪問:
  保存 / 報告書草案 / 終了

報告書:
  AI抽出 / 送付先ステータス

他職種:
  構造化シグナル / 推奨アクション
```

**色・状態・密度**:

```text
teal:
  primary action, active nav, selected tab, main CTA

blue:
  schedule, visit, info, links

green:
  completed, safe, enough, submitted

orange:
  caution, soon, waiting

red:
  urgent, shortage, overdue, must check, high risk

purple:
  interprofessional / inbound medical chat / shared communication

gray:
  neutral, disabled, secondary, metadata
```

この色 family は非規範の説明語である。実装時は必ず `docs/ui-ux-design-guidelines.md` の
`--primary`、`--state-blocked`、`--state-done`、`--state-confirm`、`--state-waiting`、
`--state-readonly`、`--tag-info`、`--tag-hazard`、neutral token へ写像する。画面ローカルな
`bg-*-100` / raw hex / 独自 semantic color を追加しない。

原則:

```text
- raw color を増やさず design token / Tailwind token を優先する。
- 色だけで状態を伝えず、icon + label + text + badge を併用する。
- 主要CTAは画面に1-2個までにし、それ以外は右レールまたはmenuへ逃がす。
- カードは `rounded-lg` or `rounded-xl`、`border border-border/70`、`bg-card`、弱いshadow、`p-4` / `p-5` を基本にする。
- モバイルでは sidebar は MobileNav、右レールは Sheet/drawer、主要CTAは下部固定、tap target は44px以上。
```

**PHI / 医療情報表示方針**:

業務システム内では、権限内で判断に必要な患者情報・薬剤情報・医療情報は表示してよい。
ただし表示可否は画面単位の blanket redaction ではなく、role / assignment / scope / consent / purpose / raw access によって制御する。

```text
表示してよい:
  権限内の患者名、年齢、性別、住所/施設、次回訪問、薬剤名、残数、リスク、受信要約、報告/請求状態、担当者、次アクション。

制御する:
  raw chat text、電話原文、添付画像、外部共有用raw、通知/OS push、監査ログchanges、export/PDF/CSV、signed URL/storage key。

raw text:
  summary/list/card DTO には持たせない。
  ただし認証済み業務画面内の dedicated detail pane / drawer / detail route では、role / assignment / scope / consent / purpose により認可された raw text、添付、連絡先を表示してよい。
  必要に応じて再認可、purpose、read audit、request_id を持たせる。
  OS notification、SSE payload、audit diff、server log、external sharing、CSV/PDF export、public URL、Oracle/GPT prompt へ operational UI の表示内容を流用しない。
```

**フロントエンド改善タスクの品質基準**:

このUI改善レーンでは、曖昧な「見た目を近づける」タスクを禁止する。
各PRは、必ず以下の項目を実装メモまたはPR本文に持つ。

```text
1. 現行コード読解
   - 読んだ entrypoint
   - 読んだ BFF/API
   - 読んだ shared component
   - 既存の loading / empty / error / forbidden / stale / offline 表示

2. 画面契約
   - first viewport に必ず出す情報
   - 右レールに置く次アクション
   - primary CTA / secondary CTA
   - クリック先の deep link
   - 表示してよい PHI / 再認可が必要な raw 情報

3. データ契約
   - 既存DTOを使うか、新DTOを追加するか
   - list pagination / cursor / hidden_count
   - partial failure / stale / generated_at
   - payload budget
   - client-only派生値と server-side presenter の境界

4. 状態マトリクス
   - loading
   - empty
   - data
   - partial
   - error
   - forbidden
   - stale
   - offline / sync pending
   - conflict

5. レスポンシブ契約
   - desktop: left / main / right の幅
   - tablet: right rail の折りたたみ
   - mobile: drawer / bottom action bar / card list
   - 44px target
   - safe-area

6. A11y契約
   - heading hierarchy
   - landmark / region label
   - filter / tab / chip の keyboard 操作
   - aria-live が必要な件数変化
   - 色だけに依存しない状態表示

7. 性能契約
   - 初期表示で lazy mount する heavy panel
   - search debounce / deferred value
   - tab switch budget
   - render boundary / update isolation
   - API payload budget

8. 検証
   - targeted unit/component test
   - route/API test
   - exact-path eslint
   - prettier
   - typecheck
   - 必要な画面は Playwright / screenshot
```

Definition of Ready:

```text
- 対象画面の entrypoint と既存BFF/APIを読んでいる。
- `docs/ui-ux-design-guidelines.md` を確認している。
- 既存 component で再利用できるものを列挙している。
- 新規DTOが必要な場合、既存API envelope / list contract / permission DTO と整合している。
- PHI表示方針が「権限内で表示」か「raw再認可」かに分類されている。
- 画面の desktop / mobile 両方の構成が決まっている。
```

Definition of Done:

```text
- first viewport で、その画面の「対象」「状態」「次アクション」が分かる。
- 右レールまたは下部固定CTAに、次に押すべき操作がある。
- false-empty がない。取得失敗と0件状態を分離している。
- forbidden は権限不足として説明し、空状態に見せない。
- 主要カード/行には deep link がある。
- raw text / signed URL / storage key / provider raw error を一覧や通知に出していない。
- モバイルで横スクロール前提になっていない。
- keyboard だけで主要フィルタ、タブ、CTAを操作できる。
- 対象画面の focused tests と exact-path lint / prettier / typecheck が通っている。
```

Frontend state matrix:

| 状態      | 必須UI                                       | 禁止                                                |
| --------- | -------------------------------------------- | --------------------------------------------------- |
| loading   | skeleton / progress / `aria-busy`            | 空状態文言を先に出す                                |
| empty     | 0件理由、次アクション、filter reset          | API失敗を0件に見せる                                |
| data      | 件数、generated_at、主要CTA、deep link       | 詳細導線なしのカード                                |
| partial   | 表示できた範囲、失敗segment、retry           | 全体errorにして閲覧可能情報を消す                   |
| error     | recovery action、request_id、retry           | raw backend message / stack / provider error の表示 |
| forbidden | 必要権限、依頼導線、戻る導線                 | empty扱い                                           |
| stale     | 最終更新、再読込、古い可能性の明示           | 古い情報を確定情報として強調                        |
| offline   | 未同期/同期待ち/競合の区別、local draft 状態 | 保存済みと誤認させる                                |
| conflict  | 競合相手ではなく競合理由、再読込/差分確認    | 上書き保存を primary にする                         |

Frontend PR slice template:

```md
## 対象画面

## 既存コード読解

- entrypoints:
- BFF/API:
- shared components:

## 変更するUI契約

- first viewport:
- right rail / bottom CTA:
- filters:
- deep links:

## データ契約

- existing DTO:
- new DTO:
- payload budget:
- partial failure:

## 状態マトリクス

- loading:
- empty:
- partial:
- error:
- forbidden:
- mobile:

## PHI / 権限

- permissioned data shown:
- raw/re-auth data:
- notification/export/audit considerations:

## 検証

- unit/component:
- API:
- eslint:
- prettier:
- typecheck:
- screenshot/e2e:
```

**Frontend Agent Slice Contract / coding-agent 実装契約**:

このレーンは「7画面を一気に作り替える」タスクではない。
coding agent が安全に実装できるよう、各PRは次のいずれか1種類に分類し、原則として混ぜない。

```text
A. Contract / Presenter slice
   - BFF DTO、presenter、view-model、route helper、allowed/forbidden fields、payload budget を固定する。
   - UI layout の大改造、mutation 追加、visual polish は含めない。

B. Layout / Component slice
   - 既存 DTO を使って layout、right rail、cards、table/card toggle、mobile drawer を実装する。
   - API shape、auth/authz、RLS、audit、DB schema、状態遷移は変えない。

C. Interaction / Mutation slice
   - review/apply/reject/link/save/send などの操作を実装する。
   - confirmation、reason、idempotency/OCC、audit、forbidden/error/conflict UI を必須にする。
   - irreversible / high-risk operation は詳細画面へ遷移させ、dashboard/list quick action で確定しない。

D. State / QA slice
   - loading / empty / partial / error / forbidden / stale / offline / conflict fixture、
     mobile snapshot、keyboard/a11y、PHI omission snapshot、payload/perf smoke を追加する。
   - 機能追加や visual redesign と混ぜない。
```

Hard rules:

```text
- 1 PR = 1 route surface または 1 shared foundation。7画面横断の巨大PRは禁止。
- BFF/API contract 変更と visual polish を同じ PR に入れない。
- auth/authz、RLS、no-store、audit、export、push notification、storage URL、signed URL の扱いを visual PR で緩めない。
- client component に Prisma shape / raw backend DTO を直接渡さない。BFF presenter / adapter / view-model を境界にする。
- summary/list/card/dashboard/timeline DTO は raw text、storage key、signed URL、provider raw error、stack、external URL を持たない。
- raw text / 添付 / 連絡先詳細は dedicated operational detail surface で表示する。認証済み業務画面内では、role / assignment / scope / consent / purpose で認可された情報を表示してよい。必要に応じて再認可、purpose、read audit、request_id を持たせる。
- `action_href` / deep link は相対URLのみ。外部URLや storage URL を card/action に直接入れない。
- empty と failed fetch を同じ UI にしない。forbidden を empty に見せない。
- mobile は 390px 幅で主要CTAが見えること。横スクロール前提は禁止。
- 色だけで状態を表現しない。icon + label + text + badge を併用する。
```

Per-slice required contract:

| 項目              | PR本文 / 実装メモに必須で書く内容                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Route surface     | 対象 route / component / tab / rail                                                                                                   |
| Existing code map | 読んだ entrypoint、BFF/API、shared component、既存 state UI                                                                           |
| Slice type        | Contract / Layout / Interaction / State-QA のどれか                                                                                   |
| Data contract     | DTO名、presenter名、allowed fields、forbidden fields、payload budget、pagination/cursor、hidden_count、generated_at、partial_failures |
| PHI boundary      | summary/list に出す情報、detail/raw surface に逃がす情報、export/push/audit/log に出さない情報                                        |
| State matrix      | loading / empty / filtered-empty / data / partial / error / forbidden / stale / offline / conflict の対象有無                         |
| Mobile/a11y       | 390px layout、right rail drawer 化、44px target、heading/landmark、keyboard path、aria-live                                           |
| Performance       | lazy mount 対象、debounce/deferred 対象、initial payload、interaction budget、non-active tab hydration                                |
| Verification      | focused unit/component/API tests、state fixture、mobile/a11y、PHI snapshot、exact-path lint/typecheck、必要な e2e/perf gate           |

**Frontend Slice Readiness Overlay（UI-AGENT-READY-001）**:

この overlay は `UI-REDESIGN-001`、`DASH-OPS`、フロントエンド共通基盤 backlog の実装エージェント用 readiness gate である。各 frontend PR は、既存の `Frontend Agent Slice Contract` に加えて、以下を満たすまで着手しない。

Ready gate:

```text
- Slice type は Contract / Layout / Interaction / State-QA のいずれか 1 つだけ。
  `Contract + Layout`、`Layout + Perf`、`Contract + Interaction` のような混合 slice は禁止し、`001A / 001B / 001C` に分割する。
- 対象 route surface は 1 つ、または shared foundation 1 つに限定する。
- target files / route / component / BFF/API / DTO owner を実装メモに列挙する。
- paired_backend_task と backend_contract_status を明記する。
  backend_contract_status は `existing` / `additive_optional` / `required_before_ui` / `ui_only` のいずれか。
- `can_land_without_backend` を yes/no で明記する。yes の場合は追跡先を `Plans.md` task id または `.agent-loop/FEATURE_QUEUE.md` に残す。
- `dto_owner` は `src/types/*`、presenter、adapter、view-model のいずれかを指す。画面ローカルに response 型を再定義しない。
- UI が呼ぶ API は実在し、DTO / count / state metadata 契約が一致している。未実装 API を前提に production-like mock UI を作らない。
- list / queue / dashboard / timeline で先頭 N 件を出す場合は、`visible_count` / `total_count` / `hidden_count` または同等 metadata を使い、`visible_count` を総件数として文言化しない。
- required states は default / loading / empty / filtered-empty / partial / error / forbidden / stale / offline / conflict / mobile-390 から対象 slice に必要なものを選び、fixture または test 名を列挙する。
- PHI boundary は `summary/list` / `operational detail` / `raw re-auth detail` / `notification/SSE/audit/log/export/public-url` のどれかに分類する。
- authenticated operational detail surface では、role / assignment / scope / consent / support session / purpose で認可された患者名、薬剤名、残数、受信本文、連絡先、添付、訪問、報告、請求、task details を表示してよい。
- summary/list/card DTO には raw text、storage key、signed URL、provider raw error、stack、external URL を入れない。
- raw body / 添付 / 連絡先詳細を表示する場合は、dedicated detail pane / drawer / detail route とし、必要に応じて再認可、purpose、read audit、request_id を持たせる。
- OS notification、SSE payload、audit diff、server log、external sharing、CSV/PDF export、public URL、Oracle/GPT prompt へ operational UI の表示内容を流用しない。
- visual reconstruction を伴う slice は、非 PHI の screenshot / gpt-image-2 reference / state fixture のいずれかで before/target evidence を残す。Contract / State-QA / 軽微修正では省略可だが、`ops/refactor/STATE.md` に省略理由を残す。
```

Backend/UI coupling fields:

| Field                      | Required values / rule                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `paired_backend_task`      | `DASH-OPS` / `MOV-001` / `INB-001` / `RX-002` / `VISIT-SYNC-001` / `REPORT-001` などの既存task id、または `none` |
| `backend_contract_status`  | `existing` / `additive_optional` / `required_before_ui` / `ui_only`                                              |
| `can_land_without_backend` | `yes` の場合は follow-up location 必須。`required_before_ui` の場合は `no`                                       |
| `dto_owner`                | `src/types/*`、presenter、adapter、view-model。画面ローカル response 型は禁止                                    |
| `count_state_contract`     | `total_count` / `visible_count` / `hidden_count` / `generated_at` / `partial_failures` の必要有無                |

Done gate:

```text
- PR 本文または実装メモに Existing-code map、Slice type、Backend/UI coupling、State matrix、PHI boundary、Mobile/a11y、Performance、Verification results がある。
- first viewport で「現在地」「対象」「状態」「次に押す操作」が分かる。
- false-empty がない。empty / filtered-empty / failed fetch / forbidden / partial failure を分ける。
- primary CTA は対象データ・根拠・blocker の近くにある。
- mobile-390 で主要 CTA が見え、右 rail は drawer / sheet / bottom action に変形する。
- 色は `docs/ui-ux-design-guidelines.md` の state role / token に従う。raw `bg-*-100` や画面ローカル色意味を追加しない。
- React Compiler 方針に従い、manual `useMemo` / `useCallback` の追加を acceptance としない。
  性能改善は render boundary、Clock Island、lazy hydration、stable DTO、heavy panel lazy mount、focused perf smoke で証明する。
- focused tests、exact-path lint、prettier、typecheck が通り、対象 slice の追加 gate 結果を記録する。
```

**画面別タスクの品質改善版**:

| ID                | Priority | 画面         | 実装単位                                | 必須成果物                                                                                       | 品質ゲート                                                                                              |
| ----------------- | -------- | ------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| UI-PAT-LIST-001   | P0/P1    | 患者一覧     | 3カラム運用一覧                         | `PatientSummaryRail`、`PatientListTable/Card`、`PatientQuickDetailPanel`、status chip、deep link | selected patient state、filter reset、empty/error分離、mobile drawer、patient list component tests      |
| UI-PAT-DETAIL-001 | P0/P1    | 患者詳細     | Command Center再構成                    | Patient header、Must Check、Safety Board、Next Action、right rail、movement tab link             | PHI表示権限、non-active tab lazy mount、tab keyboard、patient detail tests、payload budget              |
| UI-DISPENSE-001   | P1       | 調剤         | 調剤作業台                              | queue、workflow stepper、prescription line table、audit right rail、next step CTA                | high-risk badge、step transition link、table mobile fallback、dispense/audit tests                      |
| UI-SCHEDULE-001   | P1       | スケジュール | 薬剤師別タイムライン                    | date toolbar、legend、pharmacist rows、visit/travel blocks、proposal rail                        | timezone/JST、empty day、overflow、keyboard nav、schedule board tests                                   |
| UI-VISIT-001      | P0/P1    | 訪問中       | mobile visit mode                       | patient header、goal/stock/observation/inbound/voice cards、bottom action bar                    | mobile viewport、offline/sync states、keystroke budget、visit record section tests                      |
| UI-REPORT-001     | P1       | 報告書       | editor + AI/送付 rail                   | report list rail、editor sections、inbound summary candidates、delivery status rail              | raw text not auto-inserted、draft state、delivery forbidden/error、report workspace tests               |
| UI-INBOUND-001    | P0/P1    | 他職種       | 受信インボックス + signal review        | inbox filters、message detail、structured signal panel、action rail                              | raw/detail separation、review lifecycle, task creation, formal signal tests, inbound UI component tests |
| UI-SHELL-001      | P1       | 共通shell    | sidebar/header/right rail visual polish | active nav、global search placeholder、notification/user area、right rail consistency            | no route regressions、mobile nav parity、a11y landmarks、layout smoke                                   |
| UI-QA-001         | P1/P2    | 横断         | visual/state regression pack            | major screen fixtures、state matrix snapshots、mobile snapshots                                  | non-PHI fixtures only、screenshot diff threshold、focused Playwright or story route                     |

各タスクの実装方針:

```text
- UI-PAT-LIST-001 と UI-PAT-DETAIL-001 は `PATIENT-UI-020` / `MOV-001` / `INB-001` / `RX-002` と直列で進める。
- UI-VISIT-001 は `VISIT-SYNC-001` と直列で進め、訪問記録の入力喪失防止をUI改善より優先する。
- UI-INBOUND-001 は `INB-001` / `INBOUND-002` / `TASK-011` の formal signal lifecycle を壊さない。
- UI-REPORT-001 は raw text を report body に自動挿入しない。summary/signal を候補として薬剤師が選択する。
- UI-SHELL-001 は全画面の見た目だけを変え、navigation config、permission gate、layout auth boundary を変えない。
```

**Agent-ready frontend slice backlog**:

下表は実装 PR の単位であり、混合 slice type を持たない。依存関係上は連続して実装してよいが、stage / commit / review / validation は行単位で分ける。

| Slice ID        | Existing lane                                  | Slice type  | Scope                                                                                                                      | Data / PHI contract                                                                                                          | Required proof                                                                                      |
| --------------- | ---------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| UI-FOUND-001    | `DASH-DESIGN-001`, `UI-SHELL-001`              | Layout      | AppShell / Sidebar / Header / Card / Badge / WorkspaceActionRail の見た目統一。auth boundary は変更しない。                | data 変更なし。raw color 追加禁止。semantic token / icon / label を使う。                                                    | layout smoke、landmark/heading test、mobile nav parity、`colors:check`                              |
| DASH-UI-001A    | `DASH-P0-005`                                  | Done        | Dashboard ViewModel / helper boundary。派生値を pure helper / view-model に寄せる。                                        | 実装済み。API shape 変更なし。manual `useMemo` / `useCallback` 追加を acceptance にしない。                                  | dashboard helper unit、stable DTO snapshot、focused typecheck                                       |
| DASH-UI-001B    | `DASH-P0-004`                                  | Done        | Clock Island / freshness display。30秒更新を clock/freshness component に閉じる。                                          | 実装済み。API shape 変更なし。患者/薬剤/urgent DTO projection は変えない。                                                   | clock-only update test、render boundary smoke、dashboard component test                             |
| DASH-UI-001C    | `DASH-P0-004`, `DASH-P0-005`, `FE-BUDGET-001`  | State-QA    | dashboard stale / partial / clock-only / mobile-390 fixture を固定する。                                                   | non-PHI fixture。hostile fixture は raw text / storage key / provider raw error を含め、DTO omission を検査する。            | state matrix snapshots、mobile-390 smoke、PHI omission snapshot                                     |
| DASH-UI-002     | `DASH-P0-001`                                  | Contract    | Unified Urgent Queue source を 1 PR 1 source で追加する。`stock` / `report` / `billing` / `callback` / `task` を混ぜない。 | `DashboardUrgentItem` allowed fields を snapshot。raw text、signed URL、storage key、external URL は urgent DTO に入れない。 | presenter tests、relative href tests、role/scope tests、partial failure tests                       |
| PAT-LIST-001A   | `PATIENT-UI-020`, `PERF-BFF-001`               | Contract    | patient board presenter / `PatientListItemViewModel` を固定する。layout変更前にDTOを安定化する。                           | list item は status、next_action、badges、summary、deep link まで。raw inbound body、attachment、free text は持たない。      | API snapshot、forbidden tests、false-empty tests、payload budget                                    |
| PAT-LIST-001B   | `UI-PAT-LIST-001`                              | Layout      | 患者一覧3カラム、filter chips、list/card toggle、selected patient right drawer。                                           | 既存presenterのみ使用。bulk mutation は入れない。                                                                            | component tests、filter reset、selected patient state、390px drawer、keyboard navigation            |
| PAT-DETAIL-001A | `FE-PAT-001`, `MOV-001`, `RX-002`, `INB-001`   | Layout      | patient detail island split。Command tab first viewport だけ初期hydrate。非active tabはlazy mount。                        | API shape 変更なし。tab内 raw/detail surface は各laneのcontractに従う。                                                      | non-active tab hook init test、tab keyboard test、patient detail smoke                              |
| PAT-DETAIL-001B | `FE-PAT-001`, `FE-BUDGET-001`                  | State-QA    | patient detail tab loading/error/forbidden/mobile-390 と bundle/payload note を固定する。                                  | non-PHI fixture。権限内で表示すべき患者/薬剤/訪問情報を blanket redaction しない。                                           | tab state fixtures、payload/bundle note、mobile-390 screenshot                                      |
| MOV-UI-001A     | `MOV-001`                                      | Contract    | movement timeline standalone API / DTO / source failure contract を固定する。                                              | occurrence-only。処方明細、訪問本文、SOAP、文書本文、OCR、添付名、raw MCS/電話本文はtimeline list DTOに入れない。            | raw omission snapshot、relative href tests、partial failure tests                                   |
| MOV-UI-001B     | `MOV-001`                                      | Layout      | map-less Google Maps Timeline風 date card UI。処方・訪問・文書登録は発生事実と deep link だけ表示する。                    | 既存 DTO のみ使用。raw/detail は正本 detail route / drawer へ逃がす。                                                        | mobile vertical timeline snapshot、keyboard navigation、empty date range                            |
| INB-UI-001      | `INB-001`, `TASK-011`, `RISK-021`              | Interaction | inbound tri-pane: inbox / raw-detail / structured signal action rail。review lifecycle を明示する。                        | list は controlled summary。raw body / attachment は dedicated detail surface。MedicationStock反映はreview endpoint経由。    | review state tests、task creation tests、raw/detail separation tests、audit/request_id tests        |
| STOCK-UI-001A   | `RX-002`, `MOV-001`, `VISIT-SYNC-001`          | Contract    | MedicationStock panel / observation form / external observation review queue の DTO と presenter を固定する。              | ledger DTO は controlled fields のみ。source raw text は表示元detailへdeep link。                                            | stock DTO snapshot、relative href tests、role/scope tests                                           |
| STOCK-UI-001B   | `RX-002`, `MOV-001`, `VISIT-SYNC-001`          | Interaction | stock observation apply/reject/reconcile。薬剤師 review、reason、audit、idempotency を必須にする。                         | apply/reject は pharmacist review + reason + audit。summary/list から直接確定しない。                                        | idempotency tests、review apply/reject tests、mobile input tests                                    |
| VISIT-UI-001A   | `VISIT-SYNC-001`, `UX-MOB-001`, `FE-VISIT-001` | Layout      | visit record mobile shell split、section-level watch、bottom action bar。                                                  | raw sync error / PHI を toast/log/indicator に出さない。offline draft は暗号化対象のみ。                                     | section watch tests、mobile component smoke、bottom CTA safe-area                                   |
| VISIT-UI-001B   | `VISIT-SYNC-001`, `DEV-MOB-001`                | State-QA    | offline / sync pending / sync failed / conflict / reload recovery state を固定する。                                       | sync error は controlled code / recovery action のみ。raw provider/log text は表示しない。                                   | mobile e2e、offline draft recovery、conflict UI、keystroke budget                                   |
| REPORT-UI-001A  | `REPORT-020`, `INB-001`, `RX-002`              | Layout      | report list rail、editor sections、AI/evidence/delivery rail の構成を整える。                                              | existing DTO only。raw text は自動挿入しない。                                                                               | report workspace component tests、mobile-390、delivery rail state                                   |
| REPORT-UI-001B  | `REPORT-020`, `INB-001`, `RX-002`              | Interaction | inbound/stock を候補として report に採用する導線。薬剤師が選択した summary/signal だけ挿入する。                           | normalized_summary / pharmacist-selected signal のみ report candidate。send/exportは別permission/audit gate。                | candidate insertion tests、raw auto-insert absence、delivery forbidden/error tests、export snapshot |
| SCHED-UI-001    | `VS-AUTO`, `SCHED-UX`, `RX-002`                | Layout      | pharmacist timeline grid、legend、proposal rail。初回は proposal read-only review を優先。                                 | proposal-first維持。confirmed schedule / ready/departed/in_progress/completed を自動再配置しない。JST/timezoneを固定。       | timezone tests、overflow tests、keyboard navigation、mobile layout                                  |
| DISP-UI-001     | `DSP-001`, `RX workflow`, `DASH-DESIGN-001`    | Layout      | dispensing workbench stepper、prescription line table、audit right rail。                                                  | workflow mutation contract は変えない。high-risk / narcotic / audit blocker は badge + text + right rail action。            | workbench component tests、high-risk badge tests、table mobile fallback、keyboard shortcut smoke    |
| UI-QA-001A      | `DEV-UI-001`, `FE-BUDGET-001`, `DEV-PHI-001`   | State-QA    | major screen fixtures and screenshots。default / empty / partial-error / forbidden / mobile-390 / long-text を固定する。   | fixture は non-PHI。hostile patient name、drug name、storage key、provider error を混ぜて leakage を検査する。               | screenshot diff、state matrix snapshots、PHI omission snapshots、a11y smoke                         |

**Required screen fixtures**:

| Surface           | Required states                                                                 | Extra required states                                              |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Dashboard         | default / partial segment failure / stale / forbidden / mobile-390              | hidden urgent count、role focus、clock-only update                 |
| Patients list     | default / empty / filtered-empty / error / forbidden / mobile-390               | selected patient drawer、load more / cursor、long facility/address |
| Patient detail    | default / tab loading / tab error / forbidden / mobile-390                      | non-active lazy tab、movement occurrence-only、right rail overflow |
| Movement timeline | default / empty date range / partial source failure / mobile-390                | raw omission、relative href fallback、long timeline                |
| Inbound           | inbox empty / unprocessed / needs review / raw detail forbidden / conflict      | accepted / record_only / rejected / linked lifecycle               |
| Medication stock  | default / usage unknown / shortage expected / equivalence review / mobile input | external observation pending、apply/reject conflict                |
| Visit mode        | default / offline / sync pending / sync failed / conflict / mobile-390          | reload recovery、bottom CTA safe-area、keystroke budget            |
| Report            | draft / delivery forbidden / delivery error / export blocked / mobile-390       | raw not auto-inserted、selected signal candidate                   |
| Schedule          | empty day / overloaded day / proposal pending / timezone edge / mobile-390      | confirmed schedule lock、travel block overflow                     |
| Dispense          | no selected patient / high-risk / audit blocker / table overflow / mobile-390   | current step preserved、right rail checklist                       |

**Frontend verification gates**:

Base gate for every frontend PR:

```bash
pnpm format:check
git diff --check
pnpm colors:check
pnpm boundaries:check
pnpm api-response-shape:check
pnpm dto-direct-prisma-return:check
pnpm route-auth-wrapper:check
NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck
NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck:no-unused
pnpm lint
pnpm vitest run <focused test files> --reporter=dot --testTimeout=30000
```

BFF/API/presenter slice gate:

```bash
pnpm vitest run <route tests> <presenter tests> --reporter=dot --testTimeout=30000
pnpm perf:smoke
```

Auth/RLS/PHI-sensitive route gate:

```bash
pnpm test:rls-proof
pnpm test:e2e:audit
```

Major medical UI route gate:

```bash
pnpm medical-ui:e2e:preflight
pnpm medical-ui:e2e:targeted
# full gate when route-level UX/auth/data changes are large:
pnpm medical-ui:e2e:gate
```

Gate policy:

```text
- Next.js build は typecheck と並列に走らせない。
- Visual-only PR でも `colors:check` と a11y/mobile smoke は必須。
- API/BFF を触る PR は route tests、payload budget、partial failure、forbidden を必須にする。
- PHI/export/audit/push/storage を触る PR は PHI omission snapshot と audit e2e を必須にする。
- Dashboard/list/timeline/report の DTO は hostile fixture を含め、raw text / storage key / signed URL / provider raw error が出ないことを snapshot する。
```

Gate selection matrix:

| Slice kind                     | 必須gate                                                                                                                        | 追加gate条件                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Visual-only / Layout           | `prettier`、`git diff --check`、focused ESLint、component test、mobile/a11y smoke、`colors:check`                               | visual reconstruction が大きい場合は非PHI screenshot / `gpt-image-2` reference / Playwright screenshot                 |
| Contract / Presenter / BFF API | route tests、presenter tests、response snapshot、relative href tests、forbidden/partial failure tests、payload budget           | `counted list` 変更時は `visible_count` / `hidden_count` / `generated_at` の表示消費テスト                             |
| Interaction / Mutation         | mutation tests、confirmation/reason/audit tests、idempotency/OCC tests、forbidden/conflict/error tests                          | 請求確定、報告送付、外部共有、削除/取消などは dashboard/list quick action で確定せず詳細画面 gate を必須にする         |
| PHI/raw/detail surface         | raw/detail access tests、read audit/request_id tests、PHI omission snapshot、notification/export/log/SSE boundary snapshot      | raw MCS/電話/添付/連絡先を出す場合は `operational detail` として再認可/purpose/read audit の証跡を要求する             |
| Major medical route            | `medical-ui:e2e:preflight`、`medical-ui:e2e:targeted`、mobile-390、keyboard flow、false-empty/forbidden/partial failure fixture | route-level UX/auth/data 変更が大きい場合のみ `medical-ui:e2e:gate`。軽微な Contract / State-QA slice へ一律要求しない |

##### UI-REDESIGN-001A: 患者一覧

目的:

```text
単なる患者カード一覧ではなく、在宅患者の状態と次アクションを高速に確認できるオペレーション一覧にする。
```

既存接続:

```text
src/app/(dashboard)/patients/page.tsx
src/app/(dashboard)/patients/patients-board.tsx
src/components/ui/data-table.tsx
```

目標構成:

```text
患者一覧
  ├─ Header: title / description / 患者追加
  ├─ 検索/フィルタバー: patient search / saved filter / sort / view mode
  ├─ 状態チップ: すべて / 要対応 / 本日訪問 / 処方変更あり / 残数確認 / 他職種受信あり
  ├─ 左サマリー: 総患者数 / 本日訪問 / 未処理受信 / 残数不足見込み / 報告書未提出 / 担当者 / 施設
  ├─ 中央患者リスト: list/card toggle / paging or load more
  └─ 右詳細パネル: selected patient summary / next visit / alerts / recommended actions / detail link
```

患者行:

```text
- checkbox
- avatar
- patient name
- age / sex
- insurance / address / facility
- next visit
- previous visit
- medication / inbound / report status
- next action
- detail link
- overflow menu
```

ステータスバッジ例:

```text
処方変更あり
外用薬 残数: 3日分
他職種受信: 1件
報告書: 未提出
本日訪問
経過観察
```

受入基準:

```text
- 3カラム構成になる。
- 患者を選択すると右側に詳細が出る。
- 患者一覧上で要対応理由が分かる。
- 他職種受信/残数不足/報告未提出が一覧で見える。
- list/card view を切り替えられる。
- モバイルでは右パネルが drawer になる。
```

##### UI-REDESIGN-001B: 患者詳細

目的:

```text
患者詳細を、在宅患者の Command Center として使える画面にする。
```

既存接続:

```text
src/app/(dashboard)/patients/[id]/card-workspace.tsx
src/app/(dashboard)/patients/[id]/patient-movement-timeline.tsx
MOV-001
PATIENT-UI-020
RX-002
INB-001
```

目標構成:

```text
患者詳細
  ├─ Header: patient name / kana / home-care status / avatar / age-sex-id / insurance / address / primary pharmacist / next visit / key risk
  ├─ 上部3カード: Must Check / Safety Board / 次アクション
  ├─ tabs: Command / 概要 / 薬剤・訪問 / 患者の動き / 共有・文書 / 請求・会議 / 履歴・構造化
  ├─ main cards: 薬剤サイクル / 直近訪問 / 外用薬・頓服薬残数 / inbound medical chat / 今後の予定 / care coordination note
  └─ right rail: 重要アラート / 次回までのタスク / 医療チャット / shortcuts
```

Must Check:

```text
- 外用薬 残数不足
- インスリン自己注射フォロー
- 腎機能低下
- 転倒リスク
```

Safety Board:

```text
- 腎機能低下に伴う用量注意
- 転倒リスク薬
- 嚥下機能低下
- ポリファーマシー
```

患者の動き:

```text
- Google Maps Timeline風の上部地図なし。
- 日付カード、時刻、event icon、他職種受信、残数反映、訪問、報告書、処方変更、タスク作成/解決、deep link。
- 処方内容・訪問内容・文書登録は「発生したこと」が分かればよい。詳細は deep link で正本へ遷移する。
```

受入基準:

```text
- 患者の現在状態、次アクション、リスクが first viewport に出る。
- 残数/他職種受信が患者詳細の中心に入っている。
- 右レールで重要アラートと医療チャットが見える。
- 患者の動きタブで時系列が見える。
- 各カードから正本詳細へ遷移できる。
```

##### UI-REDESIGN-001C: 調剤ワークスペース

目的:

```text
処方登録 -> 調剤 -> 調剤監査 -> セット -> セット監査までを一気通貫で操作できる調剤作業台にする。
```

既存接続:

```text
src/components/features/dispense-workbench/dispensing-workbench.tsx
src/components/features/dispense-workbench/dispensing-workbench.adapter.ts
src/app/(dashboard)/dispense/page.tsx
src/app/(dashboard)/audit/page.tsx
src/app/(dashboard)/set/page.tsx
src/app/(dashboard)/set-audit/page.tsx
```

目標構成:

```text
調剤ワークスペース
  ├─ 左キュー: 本日タスク / 状態チップ / patient search / patient task list
  ├─ 中央作業台: patient header / workflow stepper / prescription table / instruction tabs / warnings / next step button
  └─ 右レール: audit checklist / safety-interaction alerts / counseling points / dispensing photos-records / next step
```

工程ステッパー:

```text
処方登録
調剤
調剤監査
セット
セット監査
```

処方テーブル:

```text
Rp / 薬剤名・規格 / 用法・用量 / 日数 / 数量 / 調剤 / 注意
```

薬剤行 badge:

```text
麻薬
同梱注意
高リスク
相互作用
粉砕不可
一包化不可
```

右チェック:

```text
- 処方内容と疑義照会内容の確認
- 薬剤名・規格・数量の確認
- 用法・用量・日数の確認
- 一包化・粉砕指示の確認
- 相互作用・重複投与の確認
- 患者アレルギーの確認
```

受入基準:

```text
- 左キューで対象患者を選択できる。
- 中央で処方と工程が見える。
- 右レールで安全確認と次アクションができる。
- 高リスク薬や麻薬が視覚的に分かる。
- 現在工程が迷わない。
```

##### UI-REDESIGN-001D: スケジュール管理

目的:

```text
薬剤師ごとの訪問ルート、仮予定、確定予定、移動時間、緊急挿入、AI提案を一画面で操作できるスケジュール司令塔にする。
```

既存接続:

```text
src/app/(dashboard)/schedules/page.tsx
src/app/(dashboard)/schedules/schedule-team-board.tsx
src/app/(dashboard)/schedules/proposals/schedule-proposals-content.tsx
src/app/(dashboard)/schedules/proposals/schedule-weekly-optimizer.tsx
```

目標構成:

```text
スケジュール管理
  ├─ Header: date nav / day-week toggle / pharmacist filter / route proposal / emergency replan
  ├─ 状態凡例: 確定 / 仮予定 / ホールド / 移動 / 高中低優先 / 緊急挿入 / 患者希望 / 処方変更 / 残薬不足予測 / 連絡依頼
  ├─ メインタイムライン: pharmacist rows / time columns / visit cards / travel blocks / break / unassigned waiting slots
  └─ 右提案パネル: total travel time / efficiency / auto proposal / front-load candidate / patient contact pending / route efficiency points
```

訪問カード:

```text
patient code
patient name
time
status
priority badge
stock / prescription / contact badge
```

受入基準:

```text
- 薬剤師別の1日スケジュールが横棒で見える。
- 移動時間が見える。
- 仮予定/確定/緊急挿入が区別できる。
- 右パネルで自動提案を確認できる。
- 患者連絡待ちが見える。
- 残数不足/処方変更による前倒し候補が見える。
```

##### UI-REDESIGN-001E: 訪問時機能

目的:

```text
患者宅でスマホ/タブレットでも使える訪問中モードにする。
外用薬・頓服薬の残数入力、バイタル、観察、他職種情報確認、音声入力、写真記録、報告書下書き作成を統合する。
```

既存接続:

```text
src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx
src/app/(dashboard)/visits/visits-today.tsx
VISIT-SYNC-001
RX-002
INB-001
```

目標構成:

```text
訪問実施中
  ├─ patient header: patient name / age-sex / visit time / visitor / detail link
  ├─ 左列: 本日の目標 / 持参物チェック / バイタル・観察記録
  ├─ 中央列: 残数入力 / 服薬状況 / 他職種からの受信確認
  ├─ 右中央: 次回訪問までの不足予測 / teach-back / photo records
  ├─ 右列: voice memo / transcription / manual note
  └─ 下部固定バー: elapsed time / draft save / save record / create report draft / add next check / end visit
```

残数入力:

```text
- 薬剤名
- 前回残数
- 今回残数入力
- 差分
- 次回まで不足予測
```

他職種受信確認:

```text
- 訪問看護記録
- ケアマネ連絡事項
- リハビリ報告
- 未確認/確認済み
```

受入基準:

```text
- 訪問中に必要な項目が1画面で見える。
- 残数入力が大きく使いやすい。
- 他職種情報を確認済みにできる。
- 音声入力と文字起こし欄がある。
- 下部固定バーで保存/終了操作が迷わない。
- モバイルではカードを縦積みし、下部CTAを維持する。
```

##### UI-REDESIGN-001F: 報告書機能

目的:

```text
訪問記録、医療用チャット、残数管理、他職種情報、AI要約を使い、報告書を安全に作成・送付できる画面にする。
```

既存接続:

```text
src/app/(dashboard)/reports/page.tsx
src/app/(dashboard)/reports/report-share-workspace.tsx
src/app/api/care-reports/today-workspace/route.ts
REPORT-020
INB-001
RX-002
```

目標構成:

```text
報告書作成
  ├─ Header: draft save / share / send / PDF export / menu
  ├─ patient information card
  ├─ 左レール: report list / new report / template
  ├─ 中央エディタ: visit summary / SOAP / adherence / stock / prescription change / interprofessional / proposal / attachments
  └─ 右AI/送付レール: AI assist / inbound medical chat / stock extraction / phrase suggestions / delivery status / send button
```

AI assist tabs:

```text
要約・抽出
文例提案
医療チャット
```

医療チャット反映:

```text
- 医師からの返信
- 看護師からの連絡
- ケアマネからの連絡
```

原則:

```text
- raw text は直接挿入しない。
- normalized_summary と pharmacist-selected signal を候補として提示する。
- [報告書に含める] / [申し送りのみ] / [内部記録のみ] を選べるようにする。
```

受入基準:

```text
- 左に報告書一覧、中央にエディタ、右にAI/送付がある。
- 医療チャット内容を選択して報告書候補にできる。
- 残数/残薬の抽出結果を報告書に含められる。
- 送付先ごとのステータスが見える。
- PDF出力/送付/下書き保存が上部にある。
```

##### UI-REDESIGN-001G: 他職種機能

目的:

```text
MCSに限らず、医療用チャット・電話・FAX・メール・施設申し送りなどを受け取り、構造化シグナルへ変換し、薬局業務へ反映する画面にする。
```

既存接続:

```text
src/app/(dashboard)/communications/page.tsx
src/app/(dashboard)/communications/inbound/*
src/server/services/communication-queue.ts
INB-001
TASK-011
RISK-021
SECURITY-030
```

目標構成:

```text
他職種機能
  ├─ tabs: 受信 / 共有 / 医療用チャット / 連携先
  ├─ 左インボックス: search / all / unprocessed / needs review / applied / message list
  ├─ 中央メッセージ詳細: sender / role / patient / received_at / body / attachments / history / reply input
  └─ 右シグナル/アクション: structured signals / recommended actions / processing status / history
```

構造化シグナル:

```text
残薬報告
服薬状況の変化
体調変化の可能性
受診予定
バイタル情報
```

推奨アクション:

```text
残数管理へ反映
タスク化
患者の動きへ追加
記録のみ
却下
```

入力:

```text
- チャット本文
- 発信者
- 職種
- 所属
- 日時
- 患者候補
- 添付
```

受入基準:

```text
- 他職種からの情報をインボックスで処理できる。
- 医療用チャット貼り付けから構造化シグナルが出る。
- 残数管理/タスク/患者の動きへ反映できる。
- 原文、要約、シグナルが分かれている。
- 処理状態を管理できる。
```

**横断実装ルール**:

```text
- 既存コンポーネントを再利用する:
  DataTable, ErrorState, SegmentError, SegmentLoading, WorkspaceActionRail, FilterChipBar, Button, Badge, Card, Tabs, Sheet.

- 画面を巨大化させない:
  patients-board/
    PatientListToolbar
    PatientSummaryRail
    PatientListTable
    PatientQuickDetailPanel

  patient-detail/
    PatientHeader
    PatientMustCheckCards
    PatientMedicationPanel
    PatientMovementTimeline
    PatientRightRail

  dispense-workbench/
    DispenseQueuePanel
    DispensePatientHeader
    DispenseWorkflowStepper
    PrescriptionLineTable
    DispenseInstructionTabs
    DispenseRightRail

  schedules/
    ScheduleToolbar
    ScheduleLegend
    PharmacistTimelineGrid
    ScheduleProposalRail

  visits/
    VisitPatientHeader
    VisitGoalCard
    MedicationStockInputCard
    VisitObservationCard
    VoiceMemoCard
    VisitBottomActionBar

  reports/
    ReportListRail
    ReportEditor
    ReportAiAssistantRail
    ReportDeliveryRail

  interprofessional/
    InboundInbox
    InboundMessageDetail
    StructuredSignalPanel
    InboundActionRail

- 重いパネルは lazy mount / dynamic import に寄せる:
  patient movement full timeline, report AI assist, medical chat attachment preview, schedule proposal, dispensing photo upload.
```

**推奨PR順**:

| PR   | 内容                                                                 | 主な既存レーン                        |
| ---- | -------------------------------------------------------------------- | ------------------------------------- |
| PR-1 | 共通Shell / Sidebar / Header微修正、Card/Badge/RightRailの見た目統一 | `DASH-DESIGN-001`, `UI-REDESIGN-001`  |
| PR-2 | 患者一覧: 左サマリー、中央リスト、右詳細パネル、状態チップ           | `PATIENT-UI-020`, `INB-001`, `RX-002` |
| PR-3 | 患者詳細: Header、Must Check/Safety/Next Action、患者の動き          | `MOV-001`, `RX-002`, `INB-001`        |
| PR-4 | 調剤ワークスペース: 工程ステッパー、処方テーブル、右監査レール       | `RX workflow`, `DASH-DESIGN-001`      |
| PR-5 | スケジュール管理: 薬剤師別タイムライン、状態凡例、AI提案レール       | `SCHED-UX`, `RX-002`                  |
| PR-6 | 訪問時機能: 訪問中モード、残数入力、他職種受信確認、下部固定バー     | `VISIT-SYNC-001`, `RX-002`, `INB-001` |
| PR-7 | 報告書: 左一覧、中央エディタ、右AI/送付レール、医療チャット候補化    | `REPORT-020`, `INB-001`               |
| PR-8 | 他職種機能: 受信インボックス、医療チャット入力、構造化シグナル       | `INB-001`, `TASK-011`, `RISK-021`     |

**最終受入基準**:

```text
- 7画面が参照モックの構成に近づいている。
- 左サイドバー、トップバー、右レールの体験が統一されている。
- 状態バッジ、色、カード、CTAが一貫している。
- 患者一覧で状態と次アクションが分かる。
- 患者詳細でリスク、残数、医療チャット、次回予定が分かる。
- 調剤で工程と安全確認が分かる。
- スケジュールで薬剤師別ルートとAI提案が分かる。
- 訪問中に残数入力、観察、音声入力、保存が迷わない。
- 報告書で医療チャット/残数/訪問記録を反映できる。
- 他職種機能で受信 -> 構造化 -> 反映ができる。
- モバイルでも主要操作が可能。
- PHI表示方針、権限制御、監査ログ方針を壊していない。
```

#### P0/P1: 外用薬・頓服薬残数管理 Medication Stock Ledger（RX-002詳細化） `cc:PARTIAL`

> 2026-07-06 追加。これは `RX-002` / `VS-AUTO-8` / `MED-002` / `DB-JSON-001` / `MOD-VISIT-001` / `MOD-SHARE-001` の詳細化であり、別系統の重複タスクではない。現行コードでは `ResidualMedication` は `VisitRecord` に紐づく派生データで、`replaceVisitRecordResidualMedications()` は visit record 保存時に既存残薬行を削除して再作成する。新機能では、訪問記録入力を残しつつ、患者保有薬剤の正本を append-only な Medication Stock Ledger へ移す。ただし他職種由来情報の正本は `INB-001` の `InboundCommunicationEvent` / `InboundCommunicationSignal` とし、Medication Stock Ledger は `accepted` な残数・使用量 signal の活用先として接続する。
>
> 2026-07-08 整理: schema / RLS / index、domain helper、患者別 summary API、accepted inbound signal -> append-only `MedicationStockEvent` -> snapshot 再計算 -> review task close、処方供給adapter v1（完全一致の既存stock itemだけ自動反映、その他はreview task）は実装済み。再実装しない。
> 2026-07-08 追加整理: `MedicationStockObservationContext` sidecar、visit observation service/API、idempotent replay/409 conflict、snapshot再計算、次回訪問/JST stockout forecast は実装済みとして扱う。ただし migration適用、実DB integration evidence、訪問UI、downstream fan-out は未完了。
> 残: 処方供給follow-up（manual retry API、DrugPackage/GS1数量換算、review taskからのstock item作成/適用導線）、訪問時観測 migration apply / DB integration / UI / downstream、usage-delta / frequency / refill request のUI、equivalence review UI、既存 `ResidualMedication` からの段階移行、VisitBrief/Schedule/Report/External Share 接続、正式 `RiskFindingProvider` の完全統合。
> 2026-07-08 追加レビュー反映済み: PRN/外用薬で重要な `last_used_at` と「未確認理由」は、`MedicationStockEvent` 本体ではなく controlled `MedicationStockObservationContext` sidecar に永続化する設計へ移した。`event_at` を最終使用日や未確認理由の代替にしない。

外部参照:

- NICE SC1 medicines guidance: medication reconciliation では薬剤名、規格、剤形、用量、頻度、投与経路、適応、変更内容、PRN薬の最終使用日時などを引き継ぐべき情報として扱い、PRN/可変用量薬は使用条件、期待効果、最大量、必要量、使用頻度と効果確認まで確認する。
- RxNorm overview: ingredient、strength、dose form、brand/generic、package、source code を概念グラフとして扱う考え方を参照する。ただし日本では RxNorm そのものではなく、`DrugMaster.yj_code` / `hot_code` / 一般名 / 成分 / 規格 / 剤形 / メーカー / `DrugPackage.gtin` / `jan_code` に置き換える。
- PMDA/MHLW prescription drug container code guidance: 医療用医薬品の包装単位に product code、expiry、lot、quantity を表示する考え方を参照し、PH-OS では `DrugPackage.gtin` / `jan_code` を包装・供給量・スキャン照合に使う。

**現行コードとの整合**:

| 現行実装                                                          | 確認できた状態                                                                                               | 新 ledger での扱い                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema/medication.prisma::ResidualMedication`             | `visit_record_id`、`drug_master_id`、`drug_name`、`remaining_quantity`、`excess_days` を持つ訪問記録派生行。 | 当面は互換表示用に維持し、`MedicationStockEvent(source_entity_type='visit_record')` へ backfill / dual write する。最終的な正本は ledger。                        |
| `src/lib/validations/visit-record.ts`                             | `residual_medications[]` は薬剤名、drug_master_id、drug_code、処方量、1日量、残数を受ける。                  | 訪問記録フォームの入力 UI は維持し、保存時に stock observation event を作る。既存 field は移行期間の input adapter。                                              |
| `src/server/services/visit-record-derived-data.ts`                | 既存残薬行を削除して再作成し、`remaining_quantity / prescribed_daily_dose` で `excess_days` を算出。         | event ledger では削除/上書きしない。誤入力は `correction` event、観測値は `visit_observation` event として履歴化する。                                            |
| `prisma/schema/drug.prisma::DrugMaster`                           | `yj_code @unique`、`hot_code`、`jan_code`、`generic_name`、`dosage_form`、`manufacturer` を持つ。            | 医薬品マスター連動の第一候補。YJ/HOT/一般名/規格/剤形/メーカーで臨床上の名寄せ候補を作る。                                                                        |
| `prisma/schema/drug.prisma::DrugPackage`                          | `gtin @unique`、`jan_code`、`package_quantity`、`package_quantity_unit`、`package_level` を持つ。            | ユーザー表現の `GSI` は実装上 `GS1/GTIN/JAN` として扱う。包装スキャン、供給量換算、外箱/調剤包装単位の特定に使う。臨床的同一性はこれ単独で判定しない。            |
| `src/lib/dispensing/outside-med-classification.ts`                | 院外薬/外用/頓服の分類が存在。                                                                               | `source_type=other_institution`、`medication_category=prn/topical/external/other` の初期分類に利用する。                                                          |
| `PatientMcsMessage` / `CommunicationEvent` / `PartnerVisitRecord` | MCS、連絡イベント、協力薬局訪問記録に他職種・外部連携由来の文章/記録が入る。                                 | `ExternalMedicationStockObservation` の staging source として扱い、薬剤師レビュー後に `MedicationStockEvent` へ昇格する。raw本文は ledger public DTO へ出さない。 |

**モジュール配置**:

```text
src/modules/pharmacy/medication-stock/
  domain/
    medication-stock-ledger.ts
    medication-stock-events.ts
    medication-equivalence.ts
    stockout-forecast.ts
    usage-rate.ts
    external-observation.ts
  application/
    record-stock-observation.ts
    apply-prescription-supply.ts
    ingest-external-stock-observation.ts
    reconcile-patient-medication-stock.ts
    generate-stock-risk-findings.ts
    create-stock-tasks.ts
  infrastructure/
    medication-stock-repository.ts
    prescription-stock-adapter.ts
    drug-master-equivalence-repository.ts
    external-observation-source-adapter.ts
  presenters/
    patient-stock-panel-presenter.ts
    visit-record-stock-presenter.ts
    stock-risk-presenter.ts
    external-observation-presenter.ts
  ui/
    MedicationStockPanel.tsx
    MedicationStockObservationForm.tsx
    MedicationStockTimeline.tsx
    MedicationStockRiskBadges.tsx
    MedicationEquivalenceSelector.tsx
    ExternalStockObservationReviewQueue.tsx
```

common-core は `modules/pharmacy/medication-stock` を直接 import しない。接続は `RiskFindingProvider`、`VisitBriefContributor`、`TaskTypeRegistry`、`ShareScopeDefinition`、将来の `PatientWorkspacePanelProvider` 経由にする。

**DB設計 / 現在地（schema/RLS/indexは実装済み。残は連動・UI・移行）**:

| table                                | status   | 目的                                                                                                   | 残作業                                                                                                                                                                                                                                  |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PatientMedicationStockItem`         | 実装済み | 患者が保有する薬剤単位の正本。処方由来、初回残薬、他院処方、OTC、手入力、不明薬を含む。                | prescription supply adapter と visit observation UI/API からの作成・更新導線を追加する。既存 `ResidualMedication` からの backfill / dual write 計画を作る。                                                                             |
| `MedicationStockEvent`               | 実装済み | 残数変動・観測の append-only 台帳。削除ではなく補正 event で訂正する。                                 | `prescription_supply` v1 と visit observation service/API は実装済み。残は manual retry/API化、DrugPackage/GS1数量換算、UIからの `usage_delta` / `usage_frequency_update` / `refill_request` 運用、`disposal/correction` の追加導線。   |
| `MedicationStockObservationContext`  | Partial  | 訪問時観測に必要な `last_used_at`、`unobserved_reason_code`、controlled source context を保持する。    | `MedicationStockEvent` 1:1 sidecar、migration candidate、DB contract test は実装済み。free-text reason は v1 で保存しない。残は migration適用 human gate と実DB integration evidence。                                                  |
| `MedicationStockSnapshot`            | 実装済み | 患者詳細/訪問準備/リスク判定用の再構築可能な集計。                                                     | stockout risk provider と dashboard / Patient Detail / VisitBrief / Schedule への完全接続。usage confidence と stale observation のUI表示。                                                                                             |
| `CanonicalMedicationGroup`           | 実装済み | 在宅管理上の同一管理単位。RxNorm 的な ingredient/strength/form/route の概念を日本マスタで実現する。    | YJ/HOT/GS1/GTIN/JAN/一般名/規格/剤形/メーカーから候補を出す UI と薬剤師承認導線。                                                                                                                                                       |
| `MedicationEquivalentAlias`          | 実装済み | YJ/HOT/GS1/GTIN/JAN/一般名/ブランド名/メーカー名の別名と confidence を保持する。                       | equivalence review UI、統合/分離理由、audit、low confidence の自動統合禁止テスト。                                                                                                                                                      |
| `ExternalMedicationStockObservation` | 実装済み | 他職種・協力薬局・MCS・連絡イベント由来の残薬情報を staging する。薬剤師確認前は ledger 正本にしない。 | 正式 inbound signal apply は初期実装済み。残は source mapping UI、FAX/email/manual source、review queue UI、VisitBrief/Schedule/Report/Share downstream。raw本文は ledger public DTO へ出さず、source screen の権限内detailで確認する。 |

`ExternalMedicationStockObservation` の raw本文は保存/表示最小化する。MCS本文や連絡本文から抽出した場合も、ledger DTO には抽出済みの controlled fields と source reference のみ返し、raw `body/content/record_content` は source screen の権限内で再確認する。

**医薬品マスター / YJ / GS1(=GTIN/JAN) 連動**:

名寄せ・照合は一段階で決めない。confidence と薬剤師レビューを前提にする。

| level | matching axis                                                | 用途                                                                                   | 自動統合                                           |
| ----- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1     | `drug_master_id`                                             | 既存処方行・訪問記録入力からの完全照合。                                               | 可                                                 |
| 2     | `DrugMaster.yj_code`                                         | 日本の医薬品マスター上の製品/規格/剤形寄りの照合。処方明細と患者保有薬剤の主キー候補。 | 原則可。ただし規格違い/剤形違い/配合剤は別 item。  |
| 3     | `DrugMaster.hot_code` / `receipt_code`                       | レセコン/流通/請求系データとの補助照合。                                               | 条件付き                                           |
| 4     | `DrugPackage.gtin` / `jan_code` / package level / quantity   | GS1/GTIN/JAN。包装スキャン、外箱/調剤包装単位、供給量換算、画像/バーコード入力の照合。 | 薬剤同一性ではなく供給量・包装単位照合として使用。 |
| 5     | `generic_name` + ingredient + strength + dosage_form + route | 一般名/同一成分/同一規格/同一剤形の候補提示。                                          | 低 confidence。薬剤師確認必須。                    |
| 6     | manual equivalence                                           | 在宅管理上、別名称を同一残数管理対象にまとめる。                                       | 薬剤師確認・理由・audit 必須。                     |

注意:

- ユーザー表現の `GSIコード` は、実装・DB上は `GS1 product code / GTIN / JAN` として扱う。命名は `gs1_gtin` か既存 `gtin` / `jan_code` に寄せる。
- YJ は「同一成分」そのものよりも製品・規格・剤形を含む照合に強い。別メーカー同一成分をまとめるには、YJだけでなく一般名、成分、規格、剤形、HOT、手動承認を併用する。
- GS1/GTIN/JAN は包装単位を特定できるが、臨床的な同一性や代替可否を単独では決めない。`DrugPackage.package_quantity` と `unit` 変換に使う。
- 同一成分でも規格違い、配合剤、剤形違い、外用量が面積依存する薬は自動統合しない。

**他職種情報の活用**:

他職種から送られてくる残薬・使用頻度・効果・副作用・保管場所の情報を、以下の source から staging する。

| source            | 既存モデル/画面                               | 取り込み例                                                   | ledger 反映                                                                                                                                                                            |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCS               | `PatientMcsMessage`, `PatientMcsSummary`      | 訪看/ケアマネ/医師からの「湿布残り少ない」「頓服使用増」等。 | `ExternalMedicationStockObservation(source_entity_type='patient_mcs_message')` として抽出し、薬剤師確認後 `MedicationStockEvent(event_type='other_professional_observation')` へ昇格。 |
| 連絡イベント      | `CommunicationEvent`, `CommunicationResponse` | 電話/FAX/メール/施設連絡での残数報告、補充依頼。             | `communication_event` / `communication_response` source として staging。counterpart_name/contact は ledger DTO に出さない。                                                            |
| 協力薬局/委託訪問 | `PartnerVisitRecord`                          | 協力訪問記録の残薬欄、写真、申し送り。                       | `partner_visit_record` source として staging。confirmed record のみ自動候補化し、draft/returned は取り込まない。                                                                       |
| 報告書/申し送り   | `CareReport`, structured handoff              | 医師/訪看/施設への報告・返信から残数確認依頼が戻る。         | report delivery/update source として候補化し、重複 dedupe。                                                                                                                            |
| 患者/家族自己申告 | self report / patient portal 相当             | 患者家族からの残薬・使用頻度申告。                           | confidence low として薬剤師確認必須。                                                                                                                                                  |

staging rule:

- source ごとに extractor を作るが、free text を ledger 正本に直接入れない。
- 自動抽出は `review_state='pending_pharmacist_review'` とし、`confidence`、抽出根拠、source link、推奨 stock item を返す。
- 薬剤師が確認すると `MedicationStockEvent` を作成し、`ExternalMedicationStockObservation.applied_stock_event_id` を埋める。
- 同じ source entity / stock item / observed_at / quantity は idempotency key で重複作成しない。
- 既存の SSE / OS通知 redaction policy と `SEC-001` に従い、通知やSSEには患者名・薬剤名・free text を出さず「残数情報の確認候補があります」の controlled wording にする。

**残数計算 / stockout forecast**:

```text
現在推定残数 =
  直近 observed_quantity
  + 直近観測以降の prescription_supply / transfer_in
  - 直近観測以降の disposal / transfer_out
  - 推定使用量
```

- `actual_observed_quantity` と `estimated_quantity` を分ける。
- PRN/外用は使用量ブレが大きいため `usage_confidence=high/medium/low/unknown` を必ず持つ。
- 使用頻度不明、単位換算不能、外用量が面積依存、他職種申告のみで未確認の場合は stockout date を `unknown` にする。
- `estimated_stockout_date` が次回処方/次回訪問より前なら `shortage_expected`、数日以内または既に不足なら `urgent`。

**Risk / Task / VisitBrief / Schedule / Report / Share 連動**:

| 接続先              | 実装方針                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RiskFinding         | `pharmacyMedicationStockRiskProvider` を追加。`medication_stock_shortage_expected`、`urgent_shortage`、`usage_unknown`、`observation_stale`、`equivalence_review_required`、`unlinked_prescription_supply`、`external_observation_review_required` を返す。                                                                                                   |
| OperationalTask     | `pharmacy.medication_stock_shortage_expected`、`pharmacy.medication_stock_usage_unknown`、`pharmacy.medication_stock_equivalence_review_required`、`pharmacy.medication_stock_unlinked_prescription_supply`、`pharmacy.medication_stock_external_observation_review_required` は既存 `task-registry` に接続する。                                             |
| VisitBrief          | `MOD-VISIT-001` contributor として、不足見込み、前回未確認、使用頻度不明、名寄せ確認待ち、他院/OTC、他職種観測レビュー待ちを優先順で表示する。                                                                                                                                                                                                                |
| Schedule            | `VS-AUTO-8` は ledger snapshot を参照し、次回訪問前に不足する外用/頓服/他院薬を前倒し理由・薬剤師確認 gate にする。scheduling 側へ残数ロジックを重複実装しない。                                                                                                                                                                                              |
| Visit Record        | 既存 `residual_medications` 入力を `MedicationStockEvent` へ接続。残数・使用頻度・最終使用日・未確認理由・効果/使用理由を section-level watch / autosave 対象にする。                                                                                                                                                                                         |
| Prescription Intake | v1実装済み: 処方登録後 hook で `prescription_supply` event を作る。ただし自動反映は `DrugMaster` / YJ / HOT / receipt で完全一致し、既存stock itemが1件、単位一致、数量正数のときだけ。`DrugPackage` / GS1-GTIN / JAN、名前のみ、候補なし、曖昧、単位換算不明は `unlinked_prescription_supply` task。残は manual retry API と packaging quantity conversion。 |
| Patient Detail      | `薬剤・訪問` タブに `残数管理` panel を追加し、Command Center に blocking finding / next action を出す。UI実装時は `gpt-image-2` で非PHI mock design を再構築してから実装する。                                                                                                                                                                               |
| Report/Handoff      | 残数全量を自動出力しない。薬剤師が「報告書に含める / 申し送りのみ / 内部記録のみ」を選ぶ。                                                                                                                                                                                                                                                                    |
| External Share      | `medication_stock_summary` / `medication_stock_detail` / `medication_stock_events` scope を `MOD-SHARE-001` 後続に追加する。default は summary のみ。detail/events は consent / permission / audit / masking profile 必須。                                                                                                                                   |

**API案**:

| method/path                                                    | 用途                                                                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/patients/:id/medication-stock`                       | 患者別 stock summary / items / risk を取得。list envelope は `API-LIST-001` に合わせる。                                                                                                |
| `POST /api/patients/:id/medication-stock/items`                | 処方にない薬、初回残薬、他院薬、OTC、不明薬を追加。                                                                                                                                     |
| `POST /api/visit-records/:id/medication-stock-observations`    | 実装済み。訪問記録由来の残数観測、使用量、使用頻度、未確認、補充希望を append-only event として追加する v1 の主endpoint。runtime利用には migration apply / DB integration gate が残る。 |
| `POST /api/patients/:id/medication-stock/items/:itemId/events` | 将来の手動補正、廃棄、transfer、非訪問由来の管理イベント用。訪問観測v1では使わない。                                                                                                    |
| `GET /api/patients/:id/medication-stock/external-observations` | 他職種/MCS/連絡/協力薬局由来の staging queue を取得。                                                                                                                                   |
| `POST /api/medication-stock/external-observations/:id/review`  | 薬剤師が staging 情報を適用/却下/保留する。                                                                                                                                             |
| `POST /api/prescription-intakes/:id/apply-medication-stock`    | 処方登録後の供給イベント適用。通常は内部 service、自動再実行は idempotent。                                                                                                             |
| `POST /api/medication-stock/equivalence/review`                | 同一成分/別メーカー/一般名/ブランド名の統合・分離レビュー。                                                                                                                             |

**Phased PR plan（実装済み phase は再タスク化しない）**:

| phase    | 内容                                                                                                                                                                           | validation                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0  | 既存残薬/stock/DrugMaster/DrugPackage/他職種sourceの棚卸し ADR。`ResidualMedication` から ledger への移行方針を固定。                                                          | 実装済み扱い。残は backfill / dual write の個別計画。                                                                                                           |
| Phase 1  | `modules/pharmacy/medication-stock` domain/application skeleton、計算ロジック、YJ/HOT/GS1 matching helper、unit conversion helper。                                            | 実装済み扱い。既存 unit tests を維持。                                                                                                                          |
| Phase 2  | DB schema / RLS / index。`PatientMedicationStockItem`、`MedicationStockEvent`、`MedicationStockSnapshot`、`ExternalMedicationStockObservation` を追加。                        | 実装済み扱い。migration/RLS/index tests を維持。                                                                                                                |
| Phase 3  | Patient summary API と accepted inbound signal apply。                                                                                                                         | 実装済み扱い。残は UI apply 導線と downstream。                                                                                                                 |
| Phase 4a | Visit observation context contract。`last_used_at`、`unobserved_reason_code`、controlled source context、audit metadata、migration rollback を固定。                           | 実装済み: sidecar schema / migration candidate / DB contract test / Oracle attempt。残: migration適用はhuman gate、実DB integration evidence。                  |
| Phase 4b | VisitRecord observation API。`POST /api/visit-records/:id/medication-stock-observations` で `source_entity_type='visit_record'` の append-only event を作り、snapshot 再計算。 | 実装済み: route/service/idempotency/no-store/RLS tests、same-key replay、different-fingerprint 409、unit mismatch reject。残: migration適用後のDB integration。 |
| Phase 4c | VisitRecord UI adapter。既存 residual input から安全に `visit_observation` / `usage_delta` / `usage_frequency` / `not_observed` を送る。                                       | 未実装。visit form/mobile tests、legacy residual compatibility。migration gate / DB integration evidence が揃うまで write可能UIを出さない。                     |
| Phase 5  | Prescription supply adapter。YJ/HOT/receipt 完全一致、idempotent event、snapshot再計算、unlinked supply task。                                                                 | 一部実装済み。残は manual retry API、DrugPackage/GS1 quantity conversion、review task apply UI/API、prescription intake route integration tests。               |
| Phase 6  | Usage/refill/equivalence review UI。使用頻度、最終使用日、補充希望、名寄せ確認、統合/分離理由。                                                                                | 未実装。review lifecycle tests、audit/reason tests、low confidence auto-merge禁止test。                                                                         |
| Phase 7  | Patient Detail / Visit Record UI。残数管理 panel、訪問中入力、未確認理由、名寄せ確認、mobile CTA。                                                                             | 未実装。`gpt-image-2` mock design、component tests、mobile E2E、a11y。                                                                                          |
| Phase 8  | Risk/Task/VisitBrief/Schedule/Report/Share 連動。                                                                                                                              | 一部実装済み。残は VisitBrief/Schedule/Report/Share。Case Risk Cockpit / Task bridge tests。                                                                    |

**受入基準**:

- 患者詳細で外用薬・頓服薬・処方外薬・他院薬・OTC の残数を一覧できる。
- 訪問ごとに残数、使用頻度、最終使用日、効果/使用理由、未確認理由を記録できる。
- 処方登録後に完全一致の既存 stock item へ供給イベントが自動追加される。候補なし・曖昧・GS1/GTIN/JANのみ・単位不一致は薬剤師review taskへ回る。
- YJ/HOT/GS1(=GTIN/JAN)/一般名/規格/剤形/メーカーを使って医薬品マスターと照合できる。
- GS1/GTIN/JAN は包装・数量換算に使い、臨床的同一性は薬剤師レビュー付きで判断する。
- 他職種から送られてくる残薬情報を staging queue に取り込み、薬剤師確認後に ledger event として活用できる。
- 次回処方/次回訪問までに不足する見込みなら RiskFinding と OperationalTask に連動する。
- 外部共有では medication stock scope、consent、permission、audit、masking profile を必ず通る。
- 既存 `ResidualMedication` は移行期間中も互換維持し、最終的な正本は Medication Stock Ledger へ統一する。

#### 横断基盤・運用・外部境界 追加バックログ（2026-07-06 再レビュー反映） `cc:REFERENCE`

> 既存の患者一覧/ダッシュボード/患者詳細/報告/処方受付/調剤ワークベンチ改善とは別枠で、PHI が外部へ出る・残る・横断される境界を優先する。SSE、Web Push、Webhook、AuditLog、Export、File は「便利な表示」より先に payload policy と snapshot test を固定する。

| ID               | 優先度 | 領域             | タスク                                   | 主な対象                                                                                                                  | 受入条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------ | ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INT-WEBHOOK-001  | P1     | Webhook/外部連携 | Webhook dispatch outbox / payload policy | webhook service、delivery persistence、retry job、masking profile                                                         | in-process dispatch から durable outbox job へ移行する。保存 payload は event id、minimal entity refs、schema version に寄せ、raw JSON 永続化を避ける option を持つ。送信 payload と保存 payload の両方で患者名、住所、電話、薬剤名、free text が出ない snapshot test を追加する。                                                                                                                                                                                                                                                                                        |
| OPS-RATE-001     | P1     | 運用/readiness   | Rate limit readiness gate                | rate limit config、deploy readiness、`/api/admin/pilot-readiness`、CloudWatch                                             | production で `RATE_LIMIT_STORE=dynamodb` の DDB table / region / IAM / TTL / update permission を deploy 前に確認する。DDB unavailable で 503 が増えたら alert し、一時緩和手順を runbook 化する。                                                                                                                                                                                                                                                                                                                                                                       |
| OPS-RECOVERY-001 | P1     | 復旧/BCP         | Live recovery drill                      | RDS snapshot/PITR、AWS Backup recovery point、S3 versioning/Object Lock、audit archive、docs/compliance                   | 済: AWS Backup recovery point 監視、RDS Restore Testing の非公開復旧先metadata、template static validation。残: 復旧専用環境へ RDS snapshot/PITR を実際に復元し、S3 文書過去版、audit archive、患者・訪問・報告・請求・添付リンク整合を確認する。RTO 4時間 / RPO 1時間の実測値、失敗点、改善策を `docs/compliance` に残す。                                                                                                                                                                                                                                               |
| OPS-RECOVERY-002 | P0/P1  | 復旧/BCP         | AWS Backup Assurance Monitor Hardening   | AWS Backup vault、RDS instance backup settings、admin health、docs/compliance、IAM allowlist                              | 済: `DescribeBackupVault`、`ListRecoveryPointsByBackupVault`、RDS `DescribeDBInstances` / backup retention / deletion protection / automated backup を read-only に確認し、health/log/route sanitizer で AWS account id、raw ARN、provider raw error、endpoint、KMS/security group/subnet を出さない。template validator で restore/delete/secret-write/pass-role action を禁止する。残: 本番相当 IAM role で `aws:rds-backup:template:validate -- --live-aws --strict` と `/api/health` を確認し、復元は runbook/live drill で実施する。runtime restore API は作らない。 |
| PERF-DB-001      | P0/P1  | DB速度           | Read-path performance inventory          | dashboard segments、patients board、patient detail、movement timeline、inbound queue、medication-stock、reports           | `findMany` / aggregate / RLS / join / payload を棚卸しし、重複fetch、N+1、unbounded read、過剰include、missing index候補を表にする。改善は既存queryの軽量化を先に行い、index追加は `EXPLAIN` 根拠と migration rollback を伴う。summary/list API は必要最小DTO、detail API は権限内で詳細表示する。                                                                                                                                                                                                                                                                        |
| PERM-DOC-001     | P0/P1  | 権限/SSOT        | Account Role Capability Matrix sync      | `docs/compliance/access-control-policy.md`, `permission-matrix.ts`, route tests, RLS proof                                | 既存 access-control policy を SSOT とし、owner/admin/pharmacist/trainee/clerk/driver/external_viewer、PlatformOperator、フリーランス薬剤師、support session、外部共有scope の機能アクセスを同期する。新機能追加PRは capability表、permission tests、RLS proof、audit要件を同時更新する。                                                                                                                                                                                                                                                                                  |
| DATA-RET-001     | P1     | データ保持       | Retention Policy Matrix                  | Patient、CareCase、Prescription、Visit、Report、Billing、FileAsset、AuditLog、Notification、WebhookDelivery、OfflineDraft | entity ごとに保持期間、削除可否、匿名化可否、legal hold、archive 後の操作可否を定義する。FileAsset / AuditLog / Billing / CareReport は削除ではなく保持・非表示・失効の扱いを明確化し、患者アーカイブ後の write guard と export/download guard をテストする。                                                                                                                                                                                                                                                                                                             |
| CORE-ROUTE-001   | P1     | Route基盤        | Route Handler Wrapper Audit              | route catalog、`withAuthContext`、`requireAuthContext` direct routes、apiKey/public routes                                | 残: `route-auth-wrapper:check` の allowlist を削減し、direct `requireAuthContext` route を `withAuthContext` へ移行する。例外routeは auth type / permission / `withSensitiveNoStore` / `withRoutePerformance` / CSRF-rate-limit / audit-security event の理由を明示する。                                                                                                                                                                                                                                                                                                 |
| SEC-EVENT-001    | P1/P2  | セキュリティ運用 | Security Event Review Board              | `security-events.ts`、AuditLog、admin dashboard                                                                           | auth_failure、csrf_rejected、rate_limit_exceeded、unauthorized_access、org_switch を org / route / event type / user-anonymous / IP hash / trend で集計し、admin が risk tier でレビューできる。同一IP/route の異常増加と forbidden/org switch 増加を検知する。                                                                                                                                                                                                                                                                                                           |
| MOB-CACHE-001    | P1/P2  | Offline/SW cache | Offline cache PHI audit                  | Service Worker runtime caching、CacheStorage、IndexedDB offline drafts、logout                                            | Playwright/browser harness で主要画面を開き、CacheStorage に `/api/*`、`/patients/*`、`/visits/*`、`/reports/*` が残らないことを検査する。offline draft は暗号化領域以外に残らず、logout/端末共有時の端末側 PHI 保護方針を固定する。                                                                                                                                                                                                                                                                                                                                      |

実装順序メモ:

1. `INT-WEBHOOK-001` は外部送信量が増える前に outbox と payload policy を固定する。raw delivery payload 永続化は consent/masking profile が明示された surface に限定する。
2. `OPS-RATE-001`、`OPS-RECOVERY-001`、`OPS-RECOVERY-002` は deploy/readiness gate と runbook evidence を同時に更新する。DDB 設定ミスや復旧未実施を production readiness の blocker として扱う。
3. `PERF-DB-001` は dashboard / patient / inbound / stock / report の各UI改善前に read-path の重複とpayloadを棚卸しし、UI追加でDB負荷を悪化させない。
4. `PERM-DOC-001` は新account種別やsupport modeの実装前に更新し、`docs/compliance/access-control-policy.md` と `permission-matrix.ts` の drift を防ぐ。
5. `DATA-RET-001` は `FILE-LIFE-001` / `FILE-001` / `AUD-001` / `EXP-002` と直列に扱い、archive 後の export/download/write guard を acceptance に含める。
6. `CORE-ROUTE-001` は `/api/files/complete` の wrapper 化済み状態と `route-auth-wrapper:check` を baseline に、残る direct `requireAuthContext` allowlist を burn-down する。

#### 最新 main 再レビュー残タスク（2026-07-06 コード再スキャン反映） `cc:REFERENCE`

> 目的: Dashboard / PatientsBoard / Patient detail / Reports / Prescription intake / DispenseWorkbench の現行成果を前提に、まだ高優先で残る「本格 pagination」「autosave/sync」「本番性能監視」「facet 計測」「監査ログ最小化」を実装しやすい単位へ再分解する。既存 task と重複させず、下表の「既存レーン」へ紐づけて進める。

**コード再スキャン後に残す実装対象**:

- `src/lib/utils/performance.ts`: live AWS drift check を実deploy gateへ接続する。
- `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`: 残すのは attachment draft reload recovery を要求する場合の encrypted evidence draft contract と mobile E2E。
- `src/app/api/prescription-intakes/route.ts`: 検索中 facets の遅延取得または cache summary 化を検討する。

| ID               | 優先度 | 既存レーン                                    | タスク                                           | 実装単位                                                                                                                                                                                 | 受入条件 / validation                                                                                                                                                                   |
| ---------------- | ------ | --------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-RTE-001A    | P0     | `PERF-RTE-001`, `DEV-PERF-001`, `DEV-PAY-001` | Performance metrics productionization            | 残: live AWS drift check を実deploy gateへ接続。                                                                                                                                         | current-process だけを本番根拠にしない。deploy readiness が実AWS上の metrics flush schedule / alarm / dimension drift を検出できる。                                                    |
| VISIT-SYNC-001   | P0/P1  | `UX-MOB-001`, `DEV-MOB-001`, `MOB-001`        | Visit record sync residual hardening             | 残: attachment draft reload recovery を要求する場合の encrypted evidence draft contract、mobile E2E。                                                                                    | 添付を含む訪問記録が通信断/再読込後も復元・再送できる。mobile viewport で訪問開始→記録保存→同期/競合表示→報告連携まで確認できる。raw sync error / PHI は toast/log/indicator に出ない。 |
| RX-REG-FACET-001 | P1/P2  | `RX-REG-UX-002`, `DEV-PERF-001`               | Prescription intake facet cache/delay            | 残: 検索中 facets の遅延取得または cache summary 化。                                                                                                                                    | `facets=1` の counts は検索条件全体で返す。status/source counts は従来互換。facet p95/payload/query-count は route performance で確認できる状態を維持する。                             |
| SEC-AUDIT-001A   | P1     | `SEC-002`, `UX-AUD-001`, `DEV-PHI-001`        | AuditLog allowlist / minifier registry hardening | action taxonomy、risk tier、review state、audit-log-view audit を registry 化。unknown nested string、provider raw error、token、storage key を admin/export response で要約/drop する。 | hostile patient name、住所、電話、薬剤名、処方 text、token、provider raw error、storage key の redaction snapshot。high-risk audit log の risk filter と監査ログ閲覧 audit を追加。     |

**推奨実装順**:

1. `VISIT-SYNC-001`: モバイル現場での入力喪失リスクを減らす。autosave/sync 状態は UI/UX と PHI log 安全を同時に見る。
2. `PERF-RTE-001A`: heavy route 改修と並行して、本番 SLO/CloudWatch/release gate へ接続する。
3. `RX-REG-FACET-001`: 検索中 facets の遅延取得または cache summary 化が必要か、route performance の実測を見て判断する。
4. `SEC-AUDIT-001A`: AuditLog allowlist / minifier registry を固め、監査 UI と export の PHI backstop を広げる。

#### フロントエンド共通基盤 追加バックログ（2026-07-06 コード再スキャン反映） `cc:REFERENCE`

> 目的: 個別画面の見た目改善ではなく、AppShell、Realtime、DataTable、Service Worker、Storage、患者詳細、訪問記録、報告、モバイル導線に共通して効く既定値を締める。既存の `UX-*` / `FE-BUD-001` / `MOB-CACHE-001` / `VISIT-SYNC-001` と重複させず、下表の「既存レーン」へ接続して実装する。UI 配置や画面再構築を伴う slice は `docs/ui-ux-design-guidelines.md` を確認し、`imagegen` / `gpt-image-2` の非 PHI 参照案を作ってから実装する。

**コード再スキャンで確認した現在地**:

- `src/app/(dashboard)/patients/[id]/card-workspace.tsx`: dynamic import と tabs は入っているが、`CardWorkspace` 本体は約 5,800 行の client component で、複数 query/mutation、Command Center、在宅運用、請求、共有、履歴、DataTable を同居させている。非 active tab にも hooks が残りやすい。
- `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx`: `useWatch({ control: form.control })` の全体 watch、音声/添付/CDS/report readiness/location/offline を同一巨大 form に含む。残は section-level watch / lazy mount / encrypted attachment draft recovery / mobile E2E に限定する。
- `src/components/layout/mobile-nav.tsx` / `src/components/layout/navigation-config.ts`: mobile bottom nav はホーム/スケジュール/訪問/患者+メニューに絞られている。工程別の下部 contextual CTA は未実装。active state は `activePrefixes` / `excludePrefixes` / `excludeExact` で細かく制御され、matrix test の拡張余地がある。

| ID             | 優先度 | 既存レーン                                                     | タスク                                        | 実装単位                                                                                                                                                                                                                                                                                                                                        | 受入条件 / validation                                                                                                                                                                                                     |
| -------------- | ------ | -------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-PAT-001     | P1     | `PAT-DETAIL-PERF-001`, `UX-CMD-001`, `FE-BUD-001`              | Patient detail island split                   | `CardWorkspaceShell`、`CommandTab`、`FoundationTab`、`MedicationVisitTab`、`SharingDocumentsTab`、`BillingConferenceTab`、`HistoryStructuredTab` に分割する。active tab だけ query/mutation hooks と heavy panels を lazy initialize。                                                                                                          | 患者詳細初期表示では Command tab の最小 island だけ hydrate。非 active tab の mutation hooks が初期化されない。tab 切替時に必要 island を lazy load。bundle analyzer / route metrics で初期 JS と hydration time を確認。 |
| FE-VISIT-001   | P0/P1  | `VISIT-SYNC-001`, `UX-MOB-001`, `DEV-MOB-001`, `MOB-001`       | Visit record form split / section-level watch | `VisitRecordShell`、`VisitTimingSection`、`MedicationAdherenceSection`、`ResidualMedicationSection`、`SideEffectSection`、`SoapSection`、`AttachmentsSection`、`ReportReadinessSection`、`LocationSection`、`OfflineSyncBar` へ分割する。`useWatch` は section 単位にし、音声/添付/CDS/report readiness/location は必要時 lazy mount へ寄せる。 | keystroke lag が出ない。残テストは section watch、lazy mount、encrypted attachment draft recovery、mobile E2E に限定する。                                                                                                |
| FE-MOB-001     | P1     | `UX-MOB-001`, `DSP-UX-002`, `UX-CMD-001`                       | Mobile contextual bottom action               | bottom nav 4項目+メニューは維持し、画面ごとに contextual CTA を下部に出す。処方受付=新規受付/QR下書き、調剤/監査=現在患者の次操作、報告=下書き/送付確認、患者詳細=Command/訪問/報告。                                                                                                                                                           | 主要作業へ 1 tap で進める。訪問記録 immersive shell の下部固定バーと衝突しない。44px target、focus order、safe-area、screen reader label を mobile tests で確認。UI実装時は `gpt-image-2` 参照案を作る。                  |
| FE-OFFLINE-001 | P1/P2  | `MOB-CACHE-001`, `DEV-PHI-001`, `DEV-MOB-001`                  | Browser storage PHI audit                     | Playwright/browser harness で患者一覧、患者詳細、訪問記録、報告、調剤ワークベンチを開き、CacheStorage/localStorage/sessionStorage/IndexedDB を検査する。                                                                                                                                                                                        | CacheStorage に `/api/*`、`/patients/*`、`/visits/*`、`/reports/*` が残らない。local/sessionStorage に患者名、薬剤名、住所、free text が残らない。offline draft は暗号化対象のみ。logout 時の扱いを固定。                 |
| FE-ERR-001     | P1     | `UX-ERR-001`, `DEV-UI-001`, `PERF-BFF-001`                     | Segment boundary pattern                      | 残: admin screen 群の未移行 segment を段階的に `SegmentLoading` / `SegmentError` / `SegmentStaleBanner` へ置換する。                                                                                                                                                                                                                            | 空状態と取得失敗を分離し、false-empty / false-zero に倒さない。raw backend message、patient name、storage key、token、provider error、API route/query は UI に出さない。                                                  |
| FE-ADMIN-001   | P1     | `FE-TBL-001`, `UX-ERR-001`, `SEC-AUDIT-001A`, `CORE-ROUTE-001` | Admin screen frontend policy audit            | admin screen 群の DataTable/export/error/loading/forbidden/destructive action を棚卸しする。監査ログ、ファイル、Webhook、通知設定は PHI/free text を直接表示しない。                                                                                                                                                                            | admin screen ごとに serverExport または non-PHI client export 明示、状態5分離、mobile overflow、confirmation+reason+audit を matrix 化。危険 surface は `DEV-PHI-001` snapshot へ接続。                                   |
| FE-BUDGET-001  | P1     | `FE-BUD-001`, `DEV-PERF-001`, `DEV-PAY-001`                    | Interaction budget instrumentation            | Playwright trace、browser `performance.mark`、React Profiler、軽量 CI smoke、詳細 `perf:frontend:trace` を整備する。患者一覧、患者詳細、訪問記録、調剤、報告の操作 budget を固定する。                                                                                                                                                          | 患者一覧 search <100ms、患者詳細 tab <200ms、訪問記録 keystroke <80ms、調剤 F-key <100ms、報告 draft button <100ms などを測定できる。CI は軽量 smoke、詳細 trace は任意 script として分離。                               |

**推奨 PR / slice 分割**:

1. `FE-VISIT-001` + `VISIT-SYNC-001`: 訪問記録の autosave/sync hardening と render split は同じ mobile field-loss リスクとして実装する。
2. `FE-PAT-001`: 患者詳細をさらに island split へ進め、Command Center 以外の heavy tab を初期 hydrate しない。
3. `FE-ERR-001` + `FE-ADMIN-001`: admin screen 群の loading/error/export/destructive action policy を shared pattern へ展開する。
4. `FE-MOB-001` + `FE-OFFLINE-001` + `FE-BUDGET-001`: mobile CTA、storage PHI audit、interaction budget を UI state matrix と性能計測に接続する。

#### リリース前 DB/API 契約バックログ（2026-07-06 コード再スキャン反映） `cc:REFERENCE`

> 目的: リリース後に破壊的変更しにくい API envelope、list contract、idempotency/OCC、状態遷移、RLS/tenant 制約、outbox、FileAsset lifecycle、retention/legal hold、DTO/presenter 境界を先に固定する。互換性維持は不要な前提で、古い response shape / legacy action shape は最新 contract に上書きする。

**コード再スキャンで確認した現在地**:

- `src/lib/api/response.ts`: `success(data)` は渡された値をそのまま JSON 化し、`error()` は `{ code, message, details }` を返す。一方で `compatibilityError()` / `validationCompatibilityError()` は `{ error, code, message, details, fieldErrors }` を返すため、public error envelope が二系統残る。
- `src/lib/api/response-schemas.ts`: cursor page helper は `data / hasMore / nextCursor` の camelCase contract を扱う。route 側では `meta.has_more`、`truncated/count_basis`、top-level `hasMore/nextCursor` が混在している。
- `src/app/api/patients/board/route.ts`: `PATIENT_FETCH_LIMIT=80` / `PATIENT_FILTERED_FETCH_LIMIT=500` の bounded fetch と `truncated` が残る。cursor list contract には未統一。
- `src/app/api/prescription-intakes/route.ts`: `facets=1` と cursor list はあるが、response は top-level `hasMore/nextCursor/totalCount/facets`。標準 `meta` envelope と `count_basis` は未統一。
- `prisma/schema/visit.prisma`: `VisitScheduleProposalBatch` と `VisitScheduleContactLog` は `@@unique([org_id, idempotency_key])` を持つ。`VisitScheduleProposal` は `finalized_schedule_id` unique があるが、open proposal の候補重複や status transition contract は DB/API の共通 registry には未固定。
- `prisma/schema/core-task.prisma`: `Task` は `@@unique([org_id, dedupe_key])` を持つが、status を含む partial unique は Prisma schema では表現されていない。closed task の dedupe 再利用可否を業務 contract として決める必要がある。
- `src/tools/rls-policy-contract.test.ts` / `src/tools/rls-known-gaps.ts`: schema 由来 tenant tables と RLS 実体、`org_id` nullable、tenant table の `org_id` を含まない unique 制約を機械検査する ratchet は存在する。例外は reason/plannedAction 付き allowlist に固定済み。次は allowlist burn-down と migration 設計。
- 既存 guardrail: `api-response-shape:check`、`dto-direct-prisma-return:check`、`route-auth-wrapper:check`、`task-types:check`、`rls-policy-contract:check`、module-boundary gate は CI 接続済み。これらを新規実装タスクとして残さず、以後は allowlist burn-down と本体移行だけを各契約タスクで扱う。
- `prisma/schema/admin.prisma`: `FileAsset` は `storage_key @unique`、`original_name`、`status`、`metadata` を持つが、scan lifecycle、safe display name、retention/legal hold、storage key/original name の public DTO 境界は未固定。`WebhookDelivery` は raw `payload Json` を保持し、`@@unique([delivery_id, webhook_registration_id])` で org_id を含まない。
- `src/server/services/file-storage.ts`: patient archive guard や retention task は一部あるが、FileAsset status machine と export/share gate は schema/API contract として未統一。

| ID               | 優先度 | 既存レーン                                                     | タスク                                         | 実装単位                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 受入条件 / validation                                                                                                                                                                                                            |
| ---------------- | ------ | -------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-CONTRACT-001 | P0     | `CORE-ROUTE-001`, `DEV-UI-001`, `UX-ERR-001`                   | API response envelope unification              | 残: `src/lib/api/response.ts` を `ApiSuccess<T>{ data, meta? }` / `ApiError{ error:{ code,message,details?,field_errors?,request_id? } }` に統一し、`compatibilityError` を削除または internal-only へ退避する。`API-CONTRACT-001A/B/C/D/E/F` で guard 誤検出修正、business-holidays mutation、escalation-rules list/delete envelope、admin master delete envelope、facility-standards list envelope、packaging-methods list envelope移行を行い、allowlist debt は 240 → 214 へ削減済み。残routeを新 envelope に更新する。 | public API から legacy `{ code, message }` / `{ error: string }` が出ない。validation details は `field_errors` に寄る。success/error snapshot test と frontend `readApiJson` が同じ型で読める。allowlist expectedCount が減る。 |
| API-CONTRACT-002 | P0/P1  | `UX-ERR-001`, `SEC-EVENT-001`, `AUD-001`                       | request_id / correlation id propagation        | request context で `request_id` を生成/受け取り、success `meta.request_id`、error `error.request_id`、AuditLog、security event、outbox/job に伝播する。UI ErrorState は request_id を任意表示できるようにする。                                                                                                                                                                                                                                                                                                            | UIから報告された request_id で server log / audit / job / outbox を追える。PHIを出さずに調査できる。全 route wrapper/major route tests で request_id が固定される。                                                              |
| API-CONTRACT-003 | P0/P1  | `CORE-ROUTE-001`, `SEC-AUDIT-001A`, `UX-ERR-001`               | API error code registry                        | `src/lib/api/error-codes.ts` を新設し、code / HTTP status / user message label / log level / retryability / recovery action を registry 化する。route は任意 string code を返せないよう helper 経由に寄せる。                                                                                                                                                                                                                                                                                                              | unknown error code が route から返らない。frontend は code で再試行/権限依頼/手動入力などの復旧導線を選べる。registry snapshot と representative route tests を追加。                                                            |
| API-LIST-001     | P0     | `PAT-BOARD-PAGE-001`, `DSP-QUEUE-PAGE-001`, `RX-REG-FACET-001` | Cursor list response contract                  | `CursorListResponse<T,TFacet>` を `data[] + meta{ generated_at, limit, next_cursor, has_more, total_count?, count_basis, facets?, truncated? }` に統一する。camelCase `hasMore/nextCursor` と route-local `meta.has_more` の混在を段階的に廃止する。対象は patients board / prescription-intakes / dispense queue / tasks / care reports / audit logs / notifications / billing。                                                                                                                                          | 全 list API が同じ `limit/cursor/has_more/next_cursor/count_basis` 名で返る。facet は `meta.facets` に入る。`truncated` だけで打ち切りを表さない。frontend は list envelope normalizer 1つで読む。                               |
| API-IDEMP-001    | P0     | `SCHED-UX-003`, `INT-WEBHOOK-001`                              | idempotency / OCC DB constraint hardening      | schedule proposal/contact log/schedule/task/webhook/file の idempotency/OCC を DB constraint と service 409/idempotent replay に固定する。Prismaで表現できない partial unique は SQL migration + contract test に分離する。                                                                                                                                                                                                                                                                                                | 二重POSTは同じ proposal/contact log を返すか標準409になる。`expected_updated_at` mismatch は標準409。mutation は原則 idempotency_key / expected_updated_at / reason の有無を endpoint registry で検査する。                      |
| API-STATE-001    | P0/P1  | `SCHED-UX-003`, `AUD-001`, `REC-001`                           | status enum / transition registry              | VisitScheduleProposal、患者連絡、report delivery、billing candidate、FileAsset、WebhookDelivery、Task などの status 遷移を registry 化する。status change は service 経由、audit 必須、直接 confirmed / exported / deleted への shortcut を限定する。                                                                                                                                                                                                                                                                      | 不正遷移は409。患者承認前に確定 schedule が作られない。rejected は再提案 record を作る。status transition matrix test が全状態を網羅し、audit reason/correlation を持つ。                                                        |
| DB-TENANT-001    | P0/P1  | `SEC-001`, `CORE-ROUTE-001`, `RLS contract`                    | Org/RLS/unique index coverage audit            | 残: `rls-policy-contract:check` の allowlist を削減し、nullable `org_id`、tenant unique without `org_id`、external id 単独 unique を migration/design で解消する。検出 gate の新設は完了済み guardrail として扱い、このタスクでは `org_id NOT NULL` / `@@unique([org_id,...])` / global identity 分離の本体移行を進める。                                                                                                                                                                                                  | allowlist expectedCount が減る。schema diff で RLSなしtable、nullable org_id、org_idを含まないtenant unique、外部IDだけで引ける unique を検出し続ける。例外は reason/plannedAction 必須。                                        |
| DB-EVENT-001     | P0/P1  | `INT-WEBHOOK-001`, `NTF-001`                                   | DomainEventOutbox foundation                   | `DomainEventOutbox` を追加し、mutation transaction 内では event insert まで、realtime/notification/webhook/risk-task/billing re-eval は worker が読む形へ寄せる。payload は event id、aggregate refs、schema version、minimal json、pii_class、idempotency key に限定する。                                                                                                                                                                                                                                                | process終了でも event が消えない。retry/dead-letter/replay が可能。payload に患者名、住所、電話、薬剤名、free text を含めない。代表 mutation が outbox insert と audit correlation を持つ。                                      |
| INT-WEBHOOK-002  | P1     | `INT-WEBHOOK-001`, `DB-EVENT-001`, `DATA-RET-001`              | Webhook delivery payload minimization          | `WebhookDelivery.payload` を raw JSON 保持から `event_id/schema_version/aggregate_type/aggregate_id/masked_payload_snapshot` へ寄せる。必要な raw payload は暗号化 + retention + masking profile で扱う。`@@unique([delivery_id, webhook_registration_id])` の org scope 方針を見直す。                                                                                                                                                                                                                                    | retry job が DB から復元できる。保存payloadにPHIを含まない。送信payloadと保存payloadのsnapshot testを分ける。destination contract/consent/masking profile を通らない送信を拒否する。                                             |
| FILE-LIFE-001    | P0/P1  | `FILE-001`, `DATA-RET-001`, `DEV-PHI-001`                      | FileAsset lifecycle / scan / retention schema  | FileAsset status を `pending_upload/uploaded/scan_pending/scan_passed/scan_failed/attached/detached/expired/deleted/quarantined` に固定し、owner entity、checksum、scan_status、display_name_safe、retention_until、legal_hold、created_by を追加検討する。`original_name` / `storage_key` は public DTO 禁止。                                                                                                                                                                                                            | scan_passed まで external share/report delivery に使えない。public API に original_name/storage_key/signed URL が出ない。retention/legal hold を後付けせずに gate/test できる。                                                  |
| DATA-RET-001A    | P1     | `DATA-001`, `OPS-RECOVERY-001`, `FILE-LIFE-001`                | Retention / Archive / Legal Hold schema policy | Patient/CareCase/Prescription/Visit/Report/Billing/FileAsset/Notification/WebhookDelivery/AuditLog/OfflineDraft/SyncQueue へ retention/archive/legal hold の policy matrix を作り、必要 column と guard を migration plan 化する。                                                                                                                                                                                                                                                                                         | archive後の write guard、legal_hold中の削除/匿名化拒否、AuditLog/Billing/Report/FileAsset の保持/非表示/失効方針がテストできる。retention job が対象を抽出できる。                                                               |
| API-ACTION-001   | P1     | `CORE-ROUTE-001`, `AUD-001`, `SCHED-UX-003`                    | API action endpoint naming convention          | action discriminated union と `/route/:id/action` 形式を棚卸しし、操作名がURLで分かる action endpoint へ寄せる方針を確定する。idempotency_key / expected_updated_at / reason / audit action を操作単位に定義する。                                                                                                                                                                                                                                                                                                         | mutation endpoint と audit action が1対1に近い。新規 mutation は endpoint registry に操作名、権限、idempotency/OCC、reason、audit を登録する。既存互換 action shape はリリース前に削除対象を決める。                             |
| API-DTO-001      | P1     | `SEC-001`, `CORE-ROUTE-001`, `DEV-PHI-001`                     | API DTO / presenter boundary enforcement       | 残: direct Prisma response allowlist を route ごとに削減し、public DTO を presenter/serializer 経由へ移行する。`src/types/api/*`、`src/server/dto/*`、`src/server/presenters/*` を整理し、DTO snapshot test を追加する。検出 gate の新設は完了済み guardrail として扱い、このタスクでは本体移行だけを進める。                                                                                                                                                                                                              | Prisma result の余剰 field が public API に出ない。allowlist expectedCount が減る。DTO snapshot test で storage_key、dedupe_key、idempotency_key、raw payload、free text の露出を検出できる。                                    |
| DB-SEARCH-001    | P1/P2  | `PAT-LIST-PERF-001`, `RX-REG-UX-001`, `FE-BUD-001`             | SearchIndex / denormalized search contract     | command palette、patients board、prescription intake、reports、tasks、facility/external professional/drug master の横断検索を `SearchIndex` または PostgreSQL tsvector/trigram に寄せる設計を作る。permission scope と safe display label を保持する。                                                                                                                                                                                                                                                                     | global search が各 domain API を横断fetchしない。org/role/assignment scope を検索時に適用できる。患者名などの表示は permissioned DTO でのみ返す。                                                                                |
| DB-JSON-001      | P1/P2  | `MED-001`, `FILE-LIFE-001`, `NTF-001`                          | JSON field gate-dependency normalization       | gate に使う値を JSON から column/child table へ寄せる棚卸しを行う。対象は薬剤変更分類、残薬リスク、薬剤師確認状態、報告送付、請求blocker、通知delivery、Webhook retry、File scan、患者不可曜日/定期イベント。                                                                                                                                                                                                                                                                                                              | gate/readiness/billing/report/export が JSON free-form に依存しない。JSON は audit/debug/minimized snapshot/非検索設定に限定される。migration plan と backfill test を用意する。                                                 |

**推奨 PR / slice 分割**:

1. `API-CONTRACT-001` + `API-CONTRACT-003` + `API-CONTRACT-002`: envelope / error code / request_id を先に固定する。影響範囲は広いが、互換性不要のリリース前に最も後悔が少ない。
2. `API-LIST-001`: list envelope を統一し、`PAT-BOARD-PAGE-001` / `DSP-QUEUE-PAGE-001` / `RX-REG-FACET-001` の contract を同じ型へ寄せる。
3. `API-IDEMP-001` + `API-STATE-001`: idempotency/OCC と status transition を DB/API/audit の三層で固定する。
4. `DB-TENANT-001`: `rls-policy-contract:check` の nullable org_id / tenant unique allowlist を burn-down する。
5. `DB-EVENT-001` + `INT-WEBHOOK-002`: DomainEventOutbox を追加し、Webhook/Realtime/Notification を durable/minimal payload へ寄せる。
6. `FILE-LIFE-001` + `DATA-RET-001A`: FileAsset lifecycle と retention/legal hold を schema/API に固定する。
7. `API-ACTION-001` + `API-DTO-001`: action endpoint を整理し、DTO/presenter 移行と allowlist burn-down を進める。
8. `DB-SEARCH-001` + `DB-JSON-001`: 検索と JSON gate 依存の中長期負債を schema-backed design へ寄せる。

#### バックエンド Modular Monolith / Module Registry / Provider Contract（2026-07-06 追加） `cc:REFERENCE`

> 目的: PH-OS を単一 Next.js / Prisma アプリのまま、薬局機能を現在の主対象として完成させつつ、将来の訪問診療・訪問看護・地域在宅支援ネットワークを追加しても common-core を直接編集し続けない backend 境界へ寄せる。これは microservices 化、DB分割、DI container導入ではない。Module Registry は新しい業務SSOTではなく、既存 `RiskFinding`、`TaskTypeRegistry`、`DomainEventOutbox`、DTO/presenter、RLS/API contract への architecture index と static gate として扱う。

**非ゴール / SSOT整理**:

- 新しい module registry は task生成条件、risk severity、dedupe、resolve condition、event durability、tenant enforcement を再定義しない。task semantics は `src/lib/tasks/task-registry.ts`、risk contract は既存 `RiskFinding` / Case Risk Cockpit / risk-task bridge、event durability/payload は `DB-EVENT-001`、tenant enforcement は `DB-TENANT-001` / `TENANT-*` / RLS / route guard が正本。
- 「provider」は曖昧に使わない。外部I/Oは `external IO adapter/provider`、domain拡張は `module port adapter`、React context は `React provider` と呼び分ける。
- home-medical / home-nursing の本体、医師記録、看護記録、診療/看護算定、FHIR全面対応は今は作らない。予約IDと将来拡張の接合面だけを定義する。
- DB migration / production data backfill / bulk update / deploy は本節の計画追加だけでは実行しない。必要時は `MOD-DB-001` から既存 `TENANT-*` / `DB-EVENT-001` / `DATA-RET-001A` の個別承認付きmigrationへ分割する。

**想定依存方向**:

```text
platform -> core -> modules/pharmacy -> app/api

allowed:
  modules/* -> core/platform
  app/api -> core/modules

forbidden:
  core -> modules/pharmacy
  core -> future modules
  modules/pharmacy -> modules/home-medical|home-nursing
  future modules -> modules/pharmacy
```

**技術的負債ID / 返済方向**:

| 負債ID            | 現在の主対象                                                | 返済方向                                                                                                  |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| DEBT-PATIENT-001  | `patient-detail-workspace` が処方/調剤/セット集約を直接持つ | 患者詳細を common workspace + pharmacy panel adapter に分離し、API DTOは presenter 経由にする。           |
| DEBT-VISIT-001    | `visit-brief` が薬局固有情報を直接集約                      | 訪問ブリーフを common section + pharmacy visit contributor へ分け、表示互換を守る。                       |
| DEBT-DEADLINE-001 | `visit-medication-deadline` が薬剤/調剤区分へ密結合         | 服薬期限・残薬・薬剤変更は pharmacy側の visit/medication adapter へ寄せる。                               |
| DEBT-REPORT-001   | `report-templates` が薬局ラベル/薬剤文脈へ癒着              | report core は delivery/masking/approval/attachment policy、pharmacy は薬剤管理報告 renderer を担当する。 |
| DEBT-BILLING-001  | `visit-schedule-billing-preview` が薬局処方分類に依存       | schedule/billing は provider参照にし、薬局処方分類は pharmacy billing adapter に閉じる。                  |

**残す module port work**:

module registry / collaboration / risk provider / task type registry / report template registry / share scope registry の基盤タスクはここに残さない。ここでは未接続・未実装の port と、今後の module 境界維持に必要な実装単位だけを残す。

| contract                            | owner / 接続先    | 残タスク                                                                                                     | fail policy / 注意点                                                                                                                   |
| ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PatientWorkspacePanelProvider`     | `MOD-PATIENT-001` | `workspace` 単一 read model 互換を保ちながら、複数 panel DTO と common / pharmacy 表示境界を明示する。       | 既存患者詳細の情報量と tab / Command Center UX を壊さない。非 active tab の lazy 化は `FE-PAT-001` と整合させる。                      |
| `VisitBriefContributor`             | `MOD-VISIT-001`   | 訪問ブリーフを common brief と pharmacy medication / deadline / residual / dispensing contributor に分ける。 | batch性能を落とさない。contributor failure は該当sectionのfail-softか、患者安全上必要な blocking risk として明示する。                 |
| `DomainEventOutbox` module metadata | `DB-EVENT-001`    | module event type、aggregate refs、minimal payload、pii_class、retry/dead-letter を将来 module と紐づける。  | mutation内は outbox insert まで。realtime / notification / webhook / task sync は worker 側へ寄せ、payload にPHI/free textを入れない。 |

**Strangler implementation rule**:

1. 新しい registry / provider contract を pure module として追加する。
2. 既存 pharmacy 実装を adapter として登録する。
3. 呼び出し元を registry 経由へ切り替える。
4. 既存 direct import を削る。
5. `tools/module-boundary-allowlist.json` は 0 件を維持し、新規 allowlist 追加を通常実装で使わない。
6. 既存 API / UI 出力の互換性を focused test で固定する。

| ID              | 優先度 | 既存レーン / 関連負債                                                     | タスク                             | 実装単位                                                                                                                                                                                                                                                                                    | 受入条件 / validation                                                                                                                                                                          |
| --------------- | ------ | ------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-PATIENT-001 | P1     | `DEBT-PATIENT-001`, `UX-CMD-001`, `FE-PAT-001`, `API-DTO-001`             | Patient Workspace panel boundary   | `getPatientOverview` の `workspace` 互換を保ったまま複数 panel DTO、common header/basic/case/consent/assignment/task/risk/recent activity、pharmacy panel の境界を明示する。non-active tab/client island のさらなるlazy化は `FE-PAT-001` と直列。                                           | 既存患者詳細 `workspace` read model とUI/API互換を維持。common patient service が prescription/dispensing/set を直接 import しない。                                                           |
| MOD-VISIT-001   | P1     | `DEBT-VISIT-001`, `DEBT-DEADLINE-001`, `VISIT-SYNC-001`, `FE-VISIT-001`   | Visit Brief contributor split      | 残: `src/core/visit/visit-brief-core.ts` と contributor registry の追加、common brief と pharmacy section の明示分離、adapter failure policy。                                                                                                                                              | 既存訪問準備/visit brief表示互換を維持。visit-brief core が薬局固有 import を持たない。                                                                                                        |
| MOD-REPORT-001  | P1     | `DEBT-REPORT-001`, `REP-001`, `API-DTO-001`, `DATA-RET-001A`              | Report delivery/masking hardening  | 送付前 gate、masking profile 実 enforcement、delivery audit minimization、`ReportTemplate.module` / `CareReport.discipline` のDB migration plan を詰める。                                                                                                                                  | 既存報告書作成結果は provider parity test で維持。template provider unknown/duplicate/failure は fail-closed。不正な non-object template output はDB write前に例外化する。                     |
| MOD-SHARE-001   | P1     | `SEC-001`, `FILE-LIFE-001`, `EXP-002`, `TENANT-001`                       | External Share payload enforcement | attachments / patient_summary / prescription_summary / residual_medications payload 接続前に file presenter、masking profile、audit snapshot、stored-only boundary 露出防止テストを追加する。                                                                                               | unknown scope は拒否。planned だが未実装の scope は known unsupported として拒否し、public scope/payload から strip する。                                                                     |
| MOD-IO-001      | P1     | `VS-AUTO-9`, `INT-WEBHOOK-001`, `NTF-001`, `SEC-001`                      | External IO adapter contract       | routing/S3/SES/Cognito/MCS/webhook/notification など外部I/O adapter の共通 contract を定義する。timeout、retry/idempotency、tenant context、PHI-free diagnostics、raw provider error redaction、correlation id、no-store/audit linkage を adapter class ごとに固定する。                    | 外部 provider failure が patient name/address/drug/free text/raw provider error/token/storage key を log/response/audit に出さない。AWS関連 adapter 実装時はAWS公式reference確認ルールに従う。 |
| MOD-DATA-001    | P1     | `TENANT-001`, `TENANT-002`, `TENANT-003`, `DB-EVENT-001`, `DATA-RET-001A` | Module data/API crosswalk          | module -> Prisma model / DTO presenter / route prefix / outbox event / audit action / RLS policy / retention policy の対応表を作る。`CareCase.service_line`、visit/report `discipline`、`Task.module`、coverage/support session/outbox は migration plan として既存DB/APIレーンへ接続する。 | Prisma model public response直出し、org_id/RLS未確認、outbox payload PHI混入、module不明 task/report/share scope を module review で検出できる。計画追加だけではDB変更を適用しない。           |

**DB / API crosswalk（migrationは個別承認sliceに分離）**:

| candidate field / table                           | 接続先タスク                                    | 初期値 / 現在の扱い                                                                                         | 受入条件                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CareCase.service_line`                           | `MOD-DATA-001`, `TENANT-001`, `DB-TENANT-001`   | 既存caseは `pharmacy_home_care` として扱う。`home_medical` / `home_nursing` / `shared_home_care` は予約値。 | service line がないことで現行薬局機能を壊さない。将来 module route / panel / report / billing のscope判定に使える。            |
| visit / report `discipline`                       | `MOD-VISIT-001`, `MOD-REPORT-001`, `TENANT-003` | 既存訪問・報告は `pharmacist` として扱う。`physician` / `nurse` は予約値。                                  | 訪問診療・訪問看護を今は実装しないが、将来 discipline 別 contributor / template / assignment を追加できる。                    |
| `Task.module`                                     | `API-LIST-001`, `DB-JSON-001`                   | DB column / canonical storage / backfill は別slice。                                                        | 新規 task は module-prefixed type を registry で検証し、legacy task は読み取り互換を維持する。                                 |
| `ReportTemplate.module` / `CareReport.discipline` | `MOD-REPORT-001`, `REP-001`, `SEC-001`          | 既存 report は pharmacy / pharmacist として扱う。                                                           | report core が pharmacy label を importしない。recipient/masking/approval/audit は既存 report/file/security レーンと整合する。 |
| `CrossTenantAccessGrant`                          | `TENANT-001`, `TENANT-003`, `RLS-USER-001`      | フリーランス薬剤師・外部協力者の期間/scope付き横断許可として設計する。                                      | grantee、target org/patient/case、scope、purpose、start/expiry、approval/revocation が audit と permission check に残る。      |
| `SupportSession`                                  | `TENANT-002`, `AUD-001`, `SEC-EVENT-001`        | PH-OS運営者の support / break-glass mode として設計する。                                                   | target org/case/patient、reason、started/ended、approved_by、support_session_id が全閲覧/操作auditに残る。                     |
| `CoverageAssignment` / `CoverageHandoff`          | `TENANT-003`, `UX-CMD-001`, `VISIT-UX-004`      | 主担当/副担当/backup/on_call/reviewer と休暇代替handoffを case 単位で扱う。                                 | Command Center と Mobile Visit Mode が「誰が次に何をするか」を assignment / handoff から説明できる。                           |
| `DomainEventOutbox`                               | `DB-EVENT-001`, `INT-WEBHOOK-002`, `NTF-001`    | module/event/aggregate/minimal payload/pii_class/retry/dead-letter を持つ durable outbox として設計する。   | process終了でも通知/Webhook/Realtime/Task sync が消えず、保存payloadに患者名・住所・薬剤名・free text を含まない。             |

**各 MOD PR の必須チェック**:

- module化対象の provider / registry / adapter を追加または既存呼び出しへ接続する。
- 対応する `DEBT-*` を1つ以上削減し、削減できない場合は次sliceで削減する理由を `ops/refactor/STATE.md` に残す。
- `tools/module-boundary-allowlist.json` は 0 件を維持する。例外的な追加が必要な場合は通常実装ではなく architecture review と明示的な audit run に分離する。
- API response は presenter / DTO を通し、Prisma model を直接 `success()` へ渡さない。
- 既存薬局機能の focused regression test を追加または更新する。
- provider 未登録、unknown type、adapter exception、権限外 entity、PHI masking を acceptance に含める。
- `Plans.md` と `ops/refactor/STATE.md` に validation evidence を残す。

**PR説明テンプレート**:

```md
## 目的

## 対応する技術的負債

- DEBT-...

## 変更内容

## 削減した依存

- before:
- after:

## module boundary

- allowlist entries:
- boundary check:

## DTO / presenter / PHI境界

## テスト

- unit:
- integration:
- e2e / browser:
- boundary:

## リスク

## ロールバック方法
```

**推奨 PR / slice 分割**:

1. `MOD-PATIENT-001`: patient workspace を複数 panel DTO と common / pharmacy 表示境界へ拡張する。患者詳細 tab/island split と整合。
2. `MOD-VISIT-001`: visit brief を common brief + pharmacy contributor に分ける。
3. `MOD-REPORT-001` + `MOD-SHARE-001`: 出力/masking/audit境界を固定する。
4. `MOD-IO-001`: 外部I/O adapter contract を整え、AWS/通知/Webhook/経路計算の raw error / PHI 境界を揃える。
5. `MOD-DATA-001` + 既存 `TENANT-*` / `DB-EVENT-001`: service_line / discipline / coverage / support session / outbox を migration plan へ接続する。

CI gate の新設タスクはこの module backlog から削除済み。RLS/unique/org_id coverage は `DB-TENANT-001`、response envelope は `API-CONTRACT-001`、DTO返却境界は `API-DTO-001` の allowlist burn-down として扱う。

**残完了条件**:

- patient workspace、visit brief、schedule/billing seam が module adapter 経由で拡張可能。
- report / external share は既存 registry を使い、送付前 gate、masking profile、attachment policy、audit boundary が enforced になる。
- `core -> modules/pharmacy` import が増えず、module-boundary allowlist 0 を維持する。
- 薬局機能（処方取込、調剤、監査、セット、スケジュール、訪問準備/記録、報告、算定、患者詳細、Case Risk Cockpit、タスク/SLA）の既存回帰テストが通る。

#### AWS / テナント横断運用バックログ（2026-07-06 事業モデル・AWS構成レビュー反映） `cc:REFERENCE`

> 目的: PH-OS を「地域在宅薬剤師ネットワークOS」として低コスト実証から本番最小構成へ移行できるように、AWS構成、論理テナント分離、PH-OS運営者のsupport mode、フリーランス薬剤師のcase assignmentをリリース前の設計タスクとして固定する。既存 `DB-TENANT-001`、`OPS-RATE-001`、`OPS-RECOVERY-001`、`FILE-LIFE-001`、`DATA-RET-001A` と整合させる。

**AWS実装リファレンスルール**:

- AWS 関連コード、IaC、運用script、runtime env、IAM/S3/RDS/ECS/DynamoDB/SES/Cognito/CloudWatch/Route 53/ACM/Secrets Manager/EventBridge の設定を変更する場合は、実装前に AWS 公式ドキュメントまたは公式 API reference を確認する。
- 実装メモ、PR説明、`ops/refactor/STATE.md`、または該当 docs に、参照した公式リファレンス名/URL/確認日を残す。非公式記事だけを根拠に AWS 仕様を固定しない。
- AWS 公式仕様と既存 repo 計画が矛盾する場合は、公式仕様を優先し、`Plans.md` に差分と修正方針を追記してから実装する。

**推奨AWSステージ**:

| ステージ     | 推奨構成                                                                                                                                                         | 用途 / 移行条件                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 低コスト実証 | Lightsail App VM + Lightsail PostgreSQL + S3 + Cognito + SES + CloudWatch + DynamoDB(rate limit) + ECR + Route 53/ACM                                            | 薬局1〜3件、患者5〜10人、在宅熟練薬剤師2〜3人、月間訪問20〜40件の90日実証。repo既存見積もりの `$46.6/月` 水準を目安にする。ただしHA本番構成ではない。                      |
| 本番最小     | ECS Express / Fargate + ALB + RDS PostgreSQL + S3 Object Lock + Cognito + SES + DynamoDB + CloudWatch + Route 53 + ACM + Secrets Manager + EventBridge Scheduler | 契約薬局5件以上、患者30人以上、月間訪問50〜70件以上、フリーランス薬剤師5人以上、PHIファイル/報告書の本格蓄積、SLA営業資料化、休日/休暇代替の商品化が見えた時点で移行する。 |
| 拡張         | ECS Fargate複数task + RDS Multi-AZ + SQS/EventBridge + ElastiCache/Valkey or DynamoDB + WAF + GuardDuty/Security Hub + CloudTrail/Config/Backup                  | 複数地域/複数テナントでSLA、監査、外部連携、非同期job量が増えた段階。WAF/OpenSearch/CloudFront/Bedrock/QuickSightは初期導入しない。                                        |

**テナント・横断権限モデル**:

- `Organization` は薬局テナント。患者、訪問、報告、請求、ファイル、タスクは `org_id` で論理分離し、PostgreSQL RLS の基本contextは `app.current_org_id` とする。
- `User` はグローバル。薬局スタッフは `Membership(user_id, org_id, site_id?, role)` を複数持てる。session の `orgId` は「現在選択中テナント」であり、ユーザーに1つだけ固定しない。
- PH-OS運営者は通常薬局roleと混ぜず、platform role + `SupportSession(operator_user_id, target_org_id, reason, started_at, ended_at, approved_by?)` で横断操作する。support mode では reason、audit、`support_session_id` を必須にする。
- フリーランス薬剤師は全テナント横断ではなく、`FreelancePharmacistProfile`、`CrossTenantAccessGrant`、`CaseAssignment(primary/secondary/backup/on_call/reviewer)` で担当case/patientだけを閲覧・記録できる。
- 将来のRLS contextは `app.current_org_id` に加え、`app.current_user_id`、`app.platform_mode`、`app.target_org_id`、`app.support_session_id` を検討する。DB層だけで難しいcase assignment判定はapp-layer guard + auditで補強する。

| ID              | 優先度 | 既存レーン                                        | タスク                                              | 実装単位                                                                                                                                                                                                                                                   | 受入条件 / validation                                                                                                                                                                   |
| --------------- | ------ | ------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS-ECS-001     | P1     | `W3-S1`, `OPS-AWS-001`, `OPS-RECOVERY-001`        | ECS Express / Fargate minimal production stack      | ECS Express/Fargate、ALB、RDS PostgreSQL、Secrets Manager、S3 Object Lock、DynamoDB、SES、CloudWatch、EventBridge Scheduler を本番最小IaC/planへ落とす。App Runner は採用しない。                                                                          | task roleでS3/DynamoDB/SES/Secrets/KMS/CloudWatchを最小権限化できる。migration/job/metrics flush/webhook retry/storage cleanup を scheduler で運用できる。                              |
| IAM-001         | P1     | `SEC-001`, `AWS-ECS-001`, `OPS-RATE-001`          | ECS task-role least privilege                       | `PHOS_APP_TASK_ROLE` のpolicyをS3 bucket/prefix、KMS key、DynamoDB rate limit table、SES verified identities、Secrets Manager app secrets、CloudWatch namespaceに限定する。Lightsail pilot では限定IAM user/secret運用のリスクと移行手順をrunbook化する。  | 長期IAM keyを本番ECSに置かない。S3 storage key、KMS、rate limit、SES、secrets の権限がtask roleに閉じる。IAM policy validation script または review checklist がある。                  |
| TENANT-001      | P0/P1  | `DB-TENANT-001`, `API-DTO-001`, `PERM-001`        | Global User + Membership / Grant / Assignment model | `User` をglobal identity、`Membership` をtenant/site role、`CrossTenantAccessGrant` を期間・scope付き横断許可、`CaseAssignment` をcase単位担当として扱うDB/API policyを設計する。既存 schema との差分、migration、permission matrix、DTO影響を棚卸しする。 | user.org_id だけに依存しない。複数薬局所属、PH-OS運営者、フリーランス薬剤師が同じ認証基盤で扱える。org/case/site scope の forbidden tests が定義される。                                |
| TENANT-002      | P0/P1  | `AUD-001`, `SEC-EVENT-001`, `DB-TENANT-001`       | Platform Support Session / break-glass support mode | `SupportSession` / platform role / reason-required / target_org selection / step-up MFA / high-risk double confirmation を設計する。運営者の閲覧・設定支援・代理操作・監査ログ確認と、削除/請求確定/外部送付/S3添付download/一括開示の制限を分ける。       | PH-OS運営者の横断閲覧・操作に reason、audit、support_session_id が必ず残る。高リスク操作は薬局承認または二重確認を要求する。BYPASSRLSを使わず target org にpinする。                    |
| TENANT-003      | P0/P1  | `PERM-001`, `VISIT-UX-004`, `REPORT-001`          | Freelance pharmacist assignment authorization       | `FreelancePharmacistProfile`、`CaseAssignment`、`CrossTenantAccessGrant` による主担当/副担当/休暇代替/当番/高度症例レビューの権限差をpermission matrixとAPI guardに落とす。                                                                                | フリーランス薬剤師は担当case/patientだけ閲覧可能。訪問記録は担当中の訪問だけ作成可能。報告下書きは可、送付/請求情報は薬局roleまたは明示grantが必要。期間終了後は自動失効する。          |
| RLS-USER-001    | P1     | `DB-TENANT-001`, `TENANT-001`, `TENANT-002`       | RLS context extension for user/platform/target org  | `createScopedTxRunner` / RLS proof に `app.current_user_id`、`app.platform_mode`、`app.target_org_id`、`app.support_session_id` を追加する設計spikeを行う。case assignment をDB policyに入れるかapp-layer guardに置くかを比較する。                        | cross-org SELECT/UPDATE/INSERT は既存proofを維持。platform support mode はtarget1 orgへpinされ、support_sessionなしでは横断不可。assignment policyの限界とapp-layer補強が文書化される。 |
| OPS-AWS-001     | P1     | `PERF-001`, `OPS-RATE-001`, `OPS-RECOVERY-001`    | CloudWatch alarm baseline                           | 5xx、rate limit store unavailable、DB connection error、S3 upload failure、webhook failed delivery、SSE poll failure、storage cleanup failure、RDS/Lightsail CPU/memory/disk/storage をalarm baselineにする。                                              | pilot/prodで最低限のalarmが有効。CloudWatch metrics flush、performance p95/p99、payload budget、rate-limit DDB failure が運用者に通知される。                                           |
| OPS-MIGRATE-001 | P1     | `AWS-ARCH-001`, `AWS-ECS-001`, `OPS-RECOVERY-001` | Lightsail-to-ECS migration trigger checklist        | 契約薬局数、患者数、訪問数、フリーランス数、PHIファイル蓄積、SLA営業資料化、休日/休暇代替商品化を移行triggerとして定義し、DB/S3/Cognito/Secrets/DNS移行runbookを作る。                                                                                     | 移行判断が属人的にならない。Lightsail pilot からECS/RDSへ移る時のdowntime、backup/restore、DNS cutover、rollback、RTO/RPOを事前に確認できる。                                           |

**推奨 PR / slice 分割**:

1. `AWS-ARCH-001` + `AWS-LS-001` + `S3-PHI-001`: 実証構成のPHI投入前gateを先に固定する。
2. `TENANT-001` + `TENANT-003`: user/membership/grant/assignment のDB/API契約を決め、フリーランス薬剤師の横断アクセスをcase単位に閉じる。
3. `TENANT-002` + `RLS-USER-001`: PH-OS運営者のsupport modeをreason/audit/RLS contextへ接続する。
4. `AWS-ECS-001` + `IAM-001` + `OPS-AWS-001`: 本番最小ECS/RDS構成と監視/権限を整える。
5. `OPS-MIGRATE-001`: 実証から本番最小構成への移行判断とrunbookを運用可能にする。

#### UX/PERF/DEV 追加バックログ（2026-07-05 UI/UX・実行速度レビュー反映） `cc:REFERENCE`

> 既存 `UX-001` は Risk UI Accessibility Pass として使用済みのため、この節では衝突回避の内部IDを使う。
> タスク名には提示仕様の `UX-001` などを残し、実装時に既存 RISK / performance lane と結合する。

**UI design generation policy**:

- UI 関連タスクの標準実装手順は「既存コード/SSOT確認 → `imagegen` で `gpt-image-2` 参照案生成 → PH-OS ルールへ翻訳して実装 → 検証/記録」とする。
- UI/UX 実装 slice は、対象画面の既存コードと `docs/ui-ux-design-guidelines.md` を確認したうえで、必要に応じて `imagegen` を使い `gpt-image-2` で再構築した画面デザイン案を先に作る。
- UI/UX の新規・再配置・大幅改善では、原則として `imagegen` の生成モデルを `gpt-image-2` に固定する。既存画面の軽微な文言/状態修正、または既存スクリーンショットだけで十分な場合を除き、実装前に `gpt-image-2` の参照案を作る。
- `imagegen` 実行時の標準モデル指定は `gpt-image-2` とし、生成画像の用途は UI 参照案・情報設計確認・モバイル/失敗状態の検討に限定する。
- 実装者は `imagegen` 実行時にモデル名を明示できる環境では、標準として `model: gpt-image-2` を指定する。指定できない実行環境では、実行ログまたは台帳に `gpt-image-2` 方針で生成したことを記録する。
- `gpt-image-2` の prompt には実在患者名、住所、電話、処方本文、報告書本文、保険情報、外部共有URLなどの PHI/secret を入れない。必要な場合は架空データ・抽象ラベル・safe display id だけで構成する。
- 生成した参照案は、生成画像パス、画面状態、採用/不採用の判断、PH-OS SSOT へ合わせた実装差分を `ops/refactor/STATE.md` に記録する。
- 生成デザインはそのまま模写せず、PH-OS の情報密度、権限/PHI 表示制約、業務導線、モバイル/アクセシビリティ要件に合わせて実装へ落とし込む。
- 患者詳細、患者一覧、訪問中モード、Command Center、通知/監査 dashboard など視覚的判断が重要な UI は、実装前に `gpt-image-2` 生成案または同等のデザイン参照を作り、acceptance に画面状態・失敗状態・モバイル状態を含める。

| ID           | 優先度 | 提示ID   | 領域           | タスク                                    | 主な対象                                                                                         | 受入条件                                                                                                                                                                                                                                                         |
| ------------ | ------ | -------- | -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-CMD-001   | P0     | UX-001   | 患者/ケースUX  | Patient / Case Command Center             | patient detail / case detail、`PatientBoard` adapters、`Case Risk Cockpit`、tasks/report/billing | 患者単位で「今どこで止まっているか」「次に誰が何をするか」「なぜ進めないか」を1画面で確認できる。処方サイクル、調剤、監査、訪問、報告、請求、連絡、未解決 task を1本の timeline にし、各 block が次アクション、担当者、期限、blocker、根拠リンクを持つ。         |
| UX-TBL-001   | P0     | UX-002   | 一覧/出力UX    | DataTable Export / Selection Semantics    | shared DataTable、CSV/export buttons、server export routes、bulk actions                         | client CSV は「読込済みCSV出力」と明示し、`hasMore=true` では未読込行が対象外である警告を出す。全件出力が必要な画面は `serverExportEndpoint` を持ち、表示中/選択中/検索条件全件の対象範囲を一括操作ボタンに表示する。PHI出力は audit と masking profile を通る。 |
| UX-ERR-001   | P1     | UX-003   | 復旧UX         | Error Recovery UX 標準化                  | `ErrorState`、BFF consumers、permission/external API failure UI                                  | error detail に request_id / route / generated_at / retry_count を任意表示できる。権限不足は管理者依頼、外部API失敗は再試行/後で通知/手動入力、重いBFF失敗は部分表示へ誘導する。空状態と取得失敗を全画面で分離する。                                             |
| UX-MOB-001   | P0/P1  | UX-004   | モバイル訪問UX | Mobile Visit Mode 強化                    | today preparation cards、visit record mobile UI、offline drafts/sync                             | 今日の訪問カードから固定「訪問開始」。訪問中は1患者1画面で余計なナビを隠し、服薬状況/副作用/残薬/変更説明/次回方針を分割入力する。オフライン保存状態、未同期/同期済み/競合ありを常時表示し、通知は安全な表示名のみ。片手操作用CTA/下部固定バーを持つ。           |
| UX-NTF-001   | P1     | UX-005   | 通知UX         | Notification Actionability                | notification center、`notifications.ts`、operational task bridge                                 | 通知一覧を task/action 中心に再構成し、primary/secondary action を持つ。解決済み通知は完了表示へ自動遷移し、SMS/LINE/FAX/MCS 失敗は operational task へ昇格する。通知詳細では PHI 表示権限を再確認する。                                                         |
| UX-AUD-001   | P1     | UX-006   | 監査レビューUX | Audit Review Dashboard                    | audit logs UI/API、risk tier registry、admin dashboard                                           | break-glass、外部共有、PDF/CSV出力、患者情報閲覧、請求確定、予定上書き、削除/取消を high risk 操作として分類し、risk filter と未レビュー high-risk 件数を管理画面に出す。監査ログ閲覧も audit し、changes redaction 状態を表示する。                             |
| PERF-RTE-001 | P0     | PERF-001 | 性能監視       | Performance Metrics 永続化・SLO化         | `performance.ts`、admin performance metrics、metrics sink、release gate                          | current-process memory だけでなく、route/method/status/p95/p99/org_scope/deploy_sha を横断集計できる。critical route に SLO を持ち、p95 閾値超過と前回比悪化を admin dashboard と release gate に表示する。                                                      |
| PERF-BFF-001 | P0     | PERF-002 | BFF性能        | Heavy BFF 分割・段階ロード                | `/api/patients/board`、today-preparation、day-board、billing/report BFF                          | above-the-fold summary endpoint と patient_ids batch detail endpoint に分ける。chip count は別 endpoint/cache 化し、foundation_issue filter は可能な範囲でDB側に寄せる。query count、payload size、p95、payload budget をBFFごとに測る。                         |
| PERF-CCH-001 | P1     | PERF-003 | Cache policy   | Cache Policy Registry                     | `server-cache.ts`、drug master cache、operating hours/site cache、cache tests                    | cacheable / non-cacheable / org-scoped-cacheable を registry 化し、PHIあり、org scoped、global master、volatile workflow を分類する。cache hit/miss を performance metrics に出し、org-scoped cache key に org_id が含まれることを lint/test で検出する。        |
| FE-BUD-001   | P1     | FE-001   | frontend性能   | Client Render Budget / Interaction Budget | patients board、today prep、schedule board、billing、reports、drug master                        | search keystroke <100ms、tab switch <200ms、drawer open <300ms を主要画面の interaction budget とする。heavy panel は lazy mount、地図/PDF/添付 preview/履歴 timeline はクリック後ロード、検索は debounce/deferred value を標準化する。                          |
| DEV-PERF-001 | P1     | DEV-001  | 品質/性能      | Critical Route Performance Test Pack      | perf fixtures、`perf:smoke`、critical API routes                                                 | `/api/patients/board`、`/api/visits/today-preparation`、`/api/visit-schedules/day-board`、`/api/visit-schedule-proposals`、`/api/visit-records`、`/api/care-reports`、`/api/billing*` の p50/p95/payload size/query count を固定 fixture で記録する。            |
| DEV-UI-001   | P1     | DEV-002  | UI品質         | UI State Matrix Story/Test                | patient board、visit prep、billing/report/task major surfaces                                    | loading / empty / partial / error / forbidden / stale / offline / conflict の state matrix を主要画面で fixture 化し、false-empty とエラー混同を防ぐ。                                                                                                           |
| DEV-PHI-001  | P0/P1  | DEV-003  | PHI出力品質    | PHI Export Snapshot Test                  | PDF/CSV/export/attachment/report delivery surfaces                                               | patient name、住所、電話、保険番号、薬剤名、free text、storage key、signed URL、raw provider error が forbidden profile の export snapshot に出ないことを自動検査する。                                                                                          |
| DEV-PAY-001  | P1     | DEV-004  | payload品質    | Route Payload Size Budget                 | heavy BFF / export / list APIs                                                                   | critical BFF は payload budget を持ち、CI smoke で閾値超過を検出する。初期表示 summary と遅延 detail の分離を budget で強制する。                                                                                                                                |
| DEV-MOB-001  | P1     | DEV-005  | mobile E2E     | Mobile Interaction E2E Pack               | Mobile Visit Mode、offline draft/sync、notification entry                                        | 訪問開始→記録保存→同期/競合表示→報告連携までを mobile viewport で E2E smoke。通信断でも draft が消えず、未同期/同期済み/競合ありの表示が確認できる。                                                                                                             |

#### 多角レビュー / リファクタリング同時実装プロトコル（2026-07-05 追加） `cc:REFERENCE`

> `RISK-*` / `UX-*` / `PERF-*` / `DEV-*` は機能追加単体で進めない。各実装 slice は、既存コードを読んだうえで近傍の重複・旧 contract・warning-only 表示を同時に整理し、最新 contract に完全上書きする。互換性維持は不要だが、患者安全、PHI、請求、権限、監査、migration/deploy gate は緩和しない。

**多角レビュー結論（2026-07-05 再レビュー）**:

- `patients/board` BFF は患者、ケース、処方サイクル、調剤、訪問、報告、請求、foundation summary を既に集約している。Command Center は別実装を新設せず、既存の患者カード派生ロジックを adapter / selector に剥がして一覧・詳細・Risk Cockpit で共有する。
- `DataTable` は client CSV、server export endpoint、selection、mobile card 表示、error/empty を持つ。次の作業は画面ごとの文言追加ではなく、export scope / masking / audit / full export contract を shared toolbar contract と export helper へ寄せる。
- `ErrorState` は広く導入済みで false-empty 防止の土台がある。UX-ERR は画面ローカル box を増やさず、request_id / route / retry_count / recovery action を受け取れる ErrorState contract に拡張する。
- `withRoutePerformance` と `/api/admin/performance-metrics` は current-process 計測として存在する。PERF-RTE は新規メトリクスを別系統で作らず、この wrapper を sink 対応に拡張し、critical route list と release gate を共有する。
- `serverCache` / drug master detail cache / workflow dashboard cache は用途別キャッシュの実装例として存在する。PERF-CCH は cache を増やす前に registry と org-scoped key test を作り、PHI/volatile workflow を non-cacheable に分類する。
- notification drawer、OS notification redaction、stream payload normalize は既にある。UX-NTF は通知本文の拡張ではなく、通知->task/action->resolve の導線と外部通知失敗 task 化へ寄せる。
- audit log response/export minifier と export audit service は既存の最小化層である。UX-AUD / DEV-PHI は監査ログ UI を増やす前に action taxonomy、risk tier、redaction state、閲覧監査の backstop を固定する。

**既存コード再利用 / refactor 必須マトリクス**:

| Task                        | 既存の足場                                                                                 | 同時に行うリファクタ                                                                                                          | 完全上書きする旧挙動                                                                                          | 必須テスト                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| UX-CMD-001 / PERF-BFF-001   | `patients/board` BFF、`patient-detail-foundation`、`management-plans`、`operational-tasks` | PatientBoard 派生関数を `patient-board-adapters` 相当へ抽出し、Command Center / Risk Cockpit / list summary で共有する。      | 詳細画面が同じ状態語彙を別計算する実装、warning-only next action。                                            | adapter unit、patients board API、case risk cockpit API、payload budget。                          |
| UX-TBL-001 / DEV-PHI-001    | shared `DataTable`、safe CSV、export audit minifier、PDF/file filename hardening           | export scope UI、server export endpoint validation、masking profile、audit metadata を shared contract に収束する。           | loaded rows を「全件」と誤認させる文言、raw filename / raw URL / raw provider error の browser-visible 出力。 | DataTable unit、screen-level export tests、PHI snapshot、audit-log export backstop。               |
| UX-ERR-001 / DEV-UI-001     | shared `ErrorState`、false-empty 防止の土台                                                | ErrorState の recovery metadata と action model を拡張し、画面ローカル error box を置換する。                                 | `{ data: [] }` や空 state で取得失敗を表す UI、再試行不能の汎用エラー表示。                                   | ErrorState unit、主要画面 state matrix、permission/network/server failure tests。                  |
| UX-MOB-001 / DEV-MOB-001    | today preparation、visit record、offline draft/sync queue                                  | 訪問中モードの state machine と offline manifest 表示を共通化し、既存 boolean `offline_synced` 前提の UI を段階的に置換する。 | 患者宅で複数患者/余計なナビが見える導線、未同期と同期失敗の区別がない表示。                                   | mobile viewport E2E、offline draft persistence、sync conflict 表示、PHI-safe notification。        |
| UX-NTF-001 / NTF-001        | `notifications.ts`、notification drawer、OS redaction、stream payload normalize            | notification action registry と operational task bridge を作り、通知表示・外部通知失敗・解決状態を同じ contract へ寄せる。    | 通知を読了にしても業務 task が未解決のまま残る状態、外部通知失敗が log だけで終わる状態。                     | notification API/unit、drawer action tests、external adapter failure task tests、PHI redaction。   |
| UX-AUD-001 / SEC-002        | audit log admin API、redaction/minifier、export audit service                              | audit action taxonomy、risk tier、review state、audit-log-view audit を registry 化する。                                     | high-risk 操作が通常ログと同列で埋もれる UI、changes の raw free text 表示。                                  | audit route/export tests、risk filter tests、free text redaction snapshot、audit-view audit test。 |
| PERF-RTE-001 / DEV-PERF-001 | `withRoutePerformance`、admin performance page、CloudWatch flush skeleton                  | in-memory store を metrics sink に接続し、critical route / SLO / deploy_sha / payload budget を registry 化する。             | current-process だけを本番性能の根拠にする運用、route ごとの閾値が文書外に散る状態。                          | performance util tests、admin API tests、perf smoke fixture、release gate dry-run。                |
| PERF-CCH-001                | `serverCache`、drug-master caches、workflow dashboard cache                                | cache policy registry、org scoped key builder、hit/miss metrics を追加し、個別 cache key 直書きを置換する。                   | PHI/volatile workflow の ad hoc cache、org_id を含まない org-scoped cache key。                               | cache registry unit、org key lint/test、hit/miss metric tests、non-cacheable enforcement。         |
| FE-BUD-001                  | DataTable pagination、major dashboard pages、React Compiler 方針                           | debounce/deferred search と lazy mount 対象を shared pattern 化し、非表示 heavy panel の先読みを削る。                        | 検索ごとの重い再描画、大量カード DOM、初期表示時の地図/PDF/添付 preview 読み込み。                            | React component tests、Playwright trace/smoke、interaction budget measurement。                    |

**タスク実装テンプレート（各 slice の Plan/STATE に残す）**:

```text
Existing-code map:
  - reused helpers/routes/components:
  - duplicate/legacy code found:
Refactor scope:
  - helper/adapter/registry extraction:
  - old code removed or fail-closed:
New behavior:
  - user-visible outcome:
  - API/DB/auth/PHI/billing impact:
Failure modes:
  - permission denied:
  - stale/partial/error/empty:
  - PHI/export/audit:
Validation:
  - unit/API/UI/E2E/perf commands:
  - regression proving old behavior is gone:
```

**PLAN-REV-001: 多角レビュー gate**

| 観点      | レビュー内容                                                                                    | 実装タスクへの落とし込み                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 業務/臨床 | 患者安全、薬剤師判断、waiver/override、訪問/報告/請求の依存順が破綻しないか。                   | `RiskFinding`、ready/blocker、task、audit のどれに接続するかを task ごとに明記する。                          |
| API/DB    | route contract、schema、query、org boundary、case ownership、idempotency、旧 endpoint の残存。  | 新 endpoint 追加時は既存 route/helper を再利用し、旧 route/旧 envelope を残す場合は removal task を同時登録。 |
| Auth/PHI  | role/capability、IDOR、no-store、PDF/CSV/添付/外部通知/監査 response の PHI 最小化。            | forbidden test と export snapshot を同じ slice に含める。                                                     |
| 請求/報告 | report delivery、billing evidence、export lock、除外理由、送付失敗、月次締めへの影響。          | 後段処理が前段データを暗黙変更しない一方向 flow を ASCII 図か acceptance に残す。                             |
| 性能      | heavy BFF、query count、payload size、cache policy、p95/p99、mobile interaction budget。        | summary/detail batch 分割、payload budget、SLO/metrics を acceptance に含める。                               |
| UI/UX     | 次アクション、false-empty、error recovery、selection/export scope、mobile visit flow、A11y。    | ユーザーが「次に押すもの」と「止まっている理由」を3クリック以内に辿れることを受入条件にする。                 |
| 運用/監査 | request_id、audit reason、admin review、notification delivery、backup/restore 後整合。          | 重要操作の audit metadata と recovery path をタスク化する。                                                   |
| テスト    | unit/API/integration/E2E/snapshot、失敗モード、権限 forbidden、PHI redaction、性能 regression。 | 既存テストの追加だけでなく、古い挙動が消えたことを regression test で固定する。                               |

受入条件:

- 各 P0/P1 task は `review_lanes`、`refactor_scope`、`legacy_removed`、`tests`、`auth/PHI/billing impact` を実装メモに持つ。
- 既存 helper/service で表現できる処理を新規 route/component 内へ再実装しない。
- 旧挙動を残す場合は一時的な互換ではなく `deprecation/removal task` として期限・owner・テストを持つ。
- `CHANGES_REQUESTED` の review が出た slice は、コード修正、テスト、Plans/STATE 更新まで同じ group で閉じる。

**DEV-REF-001: Refactor-while-implementing**

- [ ] 新機能実装前に近傍の重複 helper / ad hoc sanitizer / local warning 型 / route-local auth check を棚卸しする。
- [ ] 重複実装は shared helper / registry / adapter に寄せる。ただし抽象化は実際に2箇所以上を置換する場合に限定する。
- [ ] 旧 warning-only、旧 direct export、旧 raw filename、旧 raw provider error response は、新 contract 実装と同じ slice で削除または fail-closed に変える。
- [ ] refactor は「構造変更」と「業務挙動変更」をテストで分けて証明する。pure helper の unit test、route/API test、必要なら UI/E2E を併用する。
- [ ] code path が減った/統合されたことを `git diff` と tests で確認し、`ops/refactor/STATE.md` に残す。

**DEV-REF-002: SSOT convergence / legacy removal**

- [ ] risk severity、task type、PII field class、export surface、cache policy、route performance budget は local enum 乱立ではなく SSOT registry へ寄せる。
- [ ] 同じ業務状態を PatientBoard、Risk Cockpit、TodayPreparation、Billing、Report、Notification で別名表示しない。表示語彙は adapter で統一する。
- [ ] 互換性不要の指示に従い、古い direct generate / direct export / legacy response envelope / classic UI path は最新 flow に完全上書きする。
- [ ] 旧コードを残すと患者安全・請求・PHI の判断が二重化する場合は、新機能追加より先に削除・統合する。

**DEV-VAL-001: Acceptance Evidence Matrix**

| Evidence             | 必須タイミング                             | 内容                                                                             |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| Existing-code map    | 編集前                                     | 既存 service/helper/route/UI が何を既に解いているか。                            |
| Failure-mode map     | 実装計画確定時                             | timeout、permission deny、empty/false-empty、stale data、concurrency、PHI leak。 |
| Test map             | 実装と同じ commit                          | happy、edge、forbidden、error、redaction、performance budget。                   |
| Refactor proof       | helper/adapter/registry 収束を含む slice   | 削除した重複、置換した旧挙動、残した例外と理由。                                 |
| Release/ops evidence | external notification / billing / export時 | audit log、metrics、runbook、rollback/fallback、human review gate。              |

実装順への反映:

1. `UX-CMD-001` / `PERF-BFF-001` は、PatientBoard 派生ロジックを再実装せず adapter 化して Command Center / Risk Cockpit / list summary で共有する。
2. `UX-TBL-001` / `DEV-PHI-001` は、DataTable 文言変更だけでなく export helper、filename、audit minifier、server export endpoint contract を同時に収束する。
3. `REP-001` / `REP-002` / `FILE-*` は、PDF/添付/外部共有の browser-visible surface（filename、Content-Disposition、signed URL payload、email body）をコードリファクタ対象に含める。
4. `PERF-RTE-001` / `PERF-BFF-001` は、計測だけで終えず、heavy BFF の段階ロード化・cache policy registry・payload budget を同じ acceptance にする。

#### RISK 実装順序 / PR 分割 `cc:REFERENCE`

| PR     | 含めるタスク                                          | 目的                                                                         | migration |
| ------ | ----------------------------------------------------- | ---------------------------------------------------------------------------- | --------- |
| R-PR0  | EXP-001, SEC-001, SEC-002, EXP-002, PERM-001 skeleton | 出力/監査/権限 coverage を先に可視化し、後続実装の漏洩面を固定する。         | なし      |
| R-PR1  | 未接続 risk domain adapters                           | 既存 Case Risk Cockpit / risk-task bridge へ未接続 domain を追加する。       | なし      |
| R-PR2  | PAT-001 foundation/consent/task adapters              | 患者/ケース詳細の判断 API に foundation/consent/task 残 adapter を接続する。 | なし〜小  |
| R-PR3  | MED-001, RX-001                                       | 薬剤変更分類と薬剤師 review gate を導入。VS-AUTO-8 はここへ依存。            | なし〜中  |
| R-PR4  | RX-002, MED-002, LAB-001                              | 残薬/頓服/外用・薬剤マスタ未照合・検査値 risk を接続。                       | 中        |
| R-PR5  | REC-001                                               | 訪問記録 quality gate。報告/請求の前段品質を固定。                           | なし〜小  |
| R-PR6  | BIL-001, BIL-002, INS-001                             | 月次締め queue と billing blocker task 化。                                  | 中        |
| R-PR7  | REP-001, FILE-001, FILE-002                           | 報告書送付、添付、PDF/CSV/外部共有 policy。                                  | 中        |
| R-PR8  | DSP-001, DSP-002                                      | 調剤/持参物/SLA と既存 task health board の接続強化。                        | 小〜中    |
| R-PR9  | NTF-001, NOT delivery ledger, REP-002                 | 通知未達・外部通知失敗・recipient 0・外部文面 minimization を監視。          | 中        |
| R-PR10 | UX-001, QA-001                                        | risk UI accessibility と横断 regression pack。                               | なし      |

**直列依存**:

- 既存 Case Risk Cockpit / risk-task bridge / task registry を前提に、各 domain adapter を追加する。
- `EXP-001` / `SEC-001` / `SEC-002` / `PERM-001` skeleton は、report/export/attachment/notification の新規実装前に先行する。
- `RX-001` は VS-AUTO-8 の hard gate と直列。scheduling 側で薬剤変更 diff engine を重複実装しない。
- `BIL-001` は `REP-001` の delivery gate と相互依存するが、先に billing close board skeleton を作り、delivery completion adapter を後続で差し替える。
- 添付 signed URL / external share revoke / notification delivery ledger は DB migration を伴うため、human review を通す。

#### RISK テスト / validation 計画 `cc:REFERENCE`

- Unit:
  - `risk-finding-registry.test.ts`: blocker/warning mapping、severity sort、PHI-free normalization。
  - `risk-task-bridge.test.ts`: dedupe、resolve、waive reason、stale threshold。
  - `medication-change-review.test.ts`: 追加/削除/増量/減量/用法/剤形/unknown/high-risk。
  - `medication-stock-risk.test.ts`: 残量十分/不足/不明/古い、PRN/外用/通常薬混在。
  - `visit-record-quality.test.ts`: outcome 別 required fields と waiver。
  - `audit-log-minifier.test.ts`: hostile patient name、住所、電話、薬剤名、処方 text、token、provider raw error、storage key を export/admin response から除去。
  - `export-surface-matrix.test.ts`: no-store、permission、CSV formula neutralization、row cap、fail-closed audit。
- API:
  - `cases/[id]/risk-cockpit/route.test.ts`: org boundary、forbidden role、no-store、section ordering。
  - `billing/close-board/route.test.ts`: review_state/resolution_state/export lock。
  - `notifications/health-board/route.test.ts`: recipient 0、adapter failure、rule disabled。
  - `tasks/health-board/route.test.ts`: SLA超過、担当未割当、孤児 task。
  - `files/presigned-upload/route.test.ts` / `files/complete`: success/auth/validation/error が no-store、response に `objectKey` / `storage_key` / patient/report/visit id が出ない。
  - `pdf-bulk-export.test.ts`: audit metadata に raw `patient_ids` を保存せず、job output/error/admin API が raw patient ids を露出しない。
- Privacy/security:
  - OS/SMS/LINE/FAX/MCS に患者名・住所・薬剤名・ディープリンク・free text が出ない。
  - audit changes は PII class に従い `present` / `length` / reason code へ縮約される。
  - PDF/CSV/外部共有/添付 metadata は role/output profile で mask される。
  - notification SSE は server-side で payload を normalize し、余剰/hostile field を browser へ送らない。
- UI/E2E:
  - Case Risk Cockpit で blocking section と next action が見える。
  - 訪問 ready / proposal contact / report send / billing export が未解決 P0 risk で止まる。
  - risk severity は色だけに依存せず、keyboard と screen reader で処理できる。
- Gate semantics:
  - pre-visit ready gate は missing consent / management plan / first visit docs / medication readiness / billing blocker を hard-block。
  - emergency or retrospective post-visit record は保存を完全禁止せず、critical exception + task + audit として扱う。
  - dispensing SLA は KPI 表示だけでなく、proposal generation / day-board / planned -> ready のどこで hard gate か warning かを `DispensingSlaPolicy` で定義する。
  - report generation は visit record freshness、structured SOAP、billing context/source provenance、external output allowlist を acceptance criteria に含める。
- 標準 gate:
  - focused vitest → scoped eslint → `pnpm format:check` → `git diff --check`。
  - code path 変更を含む PR は `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` と `typecheck:no-unused`。
  - Next.js build は typecheck と並列に走らせない。

**Definition of Done**:

- 患者/ケース単位で「止まっている理由」が、薬剤、調剤、訪問、報告、請求、基盤情報、通知、PII/監査、連携のいずれかに分類されて表示される。
- P0 risk は readiness/blocker、operational task、audit のいずれかに接続され、表示だけで終わらない。
- 臨床判断を要するものは自動確定せず、薬剤師確認者・確認日時・判断理由を保持する。
- 請求・報告・訪問記録・患者共有・通知・添付・外部出力の重要操作は audit log に構造化記録される。
- 外部通知、OS通知、PDF/CSV、添付、外部共有には PII policy regression test がある。
- 新規 task type は registry に登録され、生成条件・解決条件・期限ルール・担当 domain を持つ。

**停止条件 / human review 必須**:

- DB migration が既存 visit/report/billing/task/attachment の意味を変える場合。
- P0 risk を warning 表示のみで完了扱いにしようとする場合。
- PHI を audit/log/export/OS通知/外部通知へ本文保存する必要が出た場合。
- waiver/override を clerk/trainee/driver が実行できる設計になった場合。
- billing exported 後の通常編集、report external share の無期限 URL、添付 download の監査省略が必要になる場合。
- task bridge が大量重複 task を生成する懸念を解消できない場合。

### 新トラック: 業務ID（display_id）統一プログラム（2026-07-03） `cc:WIP`

<!-- 2026-07-03 ユーザー指示「システム内のidルールを統一。アルファベット+数字のフォーマット」。AskUserQuestion でパラメータ確定済み: 方式=業務ID追加(主キー cuid は不変・非破壊) / 採番=薬局組織ごと1起点 / 範囲=全テーブル(~140モデル) / prefix=英字1-6文字(モデル一意) / 数字=標準10桁・フォーマット上限15桁。本番DB未プロビジョニングのためバックフィルは dev/e2e のみ=低リスク。指揮=fable、実装=codex(BE基盤)/opus/sonnet(FE)、レビュー=opus。 -->

- [ ] ID-2 schema 追加 migration ウェーブ（20-30モデル/波、`display_id` + `@@unique([org_id, display_id])`、グローバル表は global unique）+ 既存行バックフィル — 各波 human 確認
- [ ] ID-3 主要画面の表示・検索対応（患者ヘッダ/一覧/PDF/監査ログ表示 等）

### 外部システム比較から採る方針

- 調剤レセコン系: 在宅スケジュール/介護請求入力まで持つ製品があるが、PH-OSでは請求エンジン全面置換はしない
- 電子薬歴系: タブレット記録、写真、訪問報告書・計画書作成はベースライン機能として扱う
- ふぁむけあ系: 報告書作成、FAX/メール送信予約、トレーシングレポート、店舗間共有は MVP の参照ベンチマークとする
- シジダス系: 一包化委受託/外部委託オペレーションは Phase 2+ の連携拡張テーマとして扱う

## ワークフロー全体像（8工程）

| #   | 工程名         | 英語キー            | 主担当         | 入力                                | 出力                           |
| --- | -------------- | ------------------- | -------------- | ----------------------------------- | ------------------------------ |
| 1   | **処方箋応需** | prescription_intake | 受付/事務      | 処方箋（紙/FAX/電子/施設/リフィル） | 構造化明細、MedicationCycle    |
| 2   | **調剤**       | dispensing          | 調剤担当薬剤師 | 処方明細 + 在庫確認                 | 調剤実績、差異記録、持参候補   |
| 3   | **調剤鑑査**   | dispense_audit      | 鑑査担当薬剤師 | 処方原本 + 調剤実績                 | 承認/差戻し + 処方安全アラート |
| 4   | **薬剤セット** | medication_set      | セット担当     | 鑑査済み薬剤                        | セット構成、持参パック         |
| 5   | **セット鑑査** | set_audit           | 鑑査担当       | セット実績                          | 承認/部分承認/差戻し           |
| 6   | **訪問計画**   | visit_planning      | 事務/薬剤師    | 持参確定品 + 患者スケジュール       | 訪問予定、ルート、準備チェック |
| 7   | **訪問実施**   | visit_execution     | 訪問担当薬剤師 | 訪問予定 + 持参薬 + 前回課題        | SOAP記録、残薬、課題、介入     |
| 8   | **報告・連携** | reporting           | 薬剤師/事務    | 訪問記録                            | 報告書送付、送達追跡、連携ログ |

```mermaid
flowchart LR
  subgraph 受入
    A[紹介依頼] --> B[患者登録] --> C[計画書策定]
  end
  subgraph "① 処方箋応需"
    E[処方箋受領] --> F[構造化・照合]
    F --> G{疑義照会?}
    G -->|なし| H[MedicationCycle]
    G -->|あり| G1[照会→反映] --> H
  end
  subgraph "②③ 調剤・鑑査"
    H --> I[調剤]
    I --> J[調剤鑑査]
    J -->|差戻し| I
  end
  subgraph "④⑤ セット・鑑査"
    J -->|承認| K[薬剤セット]
    K --> L[セット鑑査]
    L -->|差戻し| K
    L -->|承認| M[持参パック]
  end
  subgraph "⑥ 訪問計画"
    C --> N[訪問予定]
    M --> N
    N --> O[ルート最適化] --> P[準備チェック]
  end
  subgraph "⑦ 訪問実施"
    P --> Q[本日の訪問] --> R[SOAP記録]
    R --> S[次回訪問提案]
  end
  subgraph "⑧ 報告・連携"
    R --> T[報告書→送付]
    R --> V[連携ログ]
    R --> W[トレーシングレポート]
  end
  subgraph 月次
    T --> X[請求支援]
  end
  S --> N
```

---

## 設計判断 → [docs/decisions.md](docs/decisions.md)

| ID   | 確定案                                                                            | 状態 |
| ---- | --------------------------------------------------------------------------------- | ---- |
| D-01 | **電子お薬手帳QRコード読取**（JAHIS Ver.2.5）                                     | 確定 |
| D-02 | **初日からマルチテナント**（Prisma + PostgreSQL RLS）                             | 確定 |
| D-03 | Ph1a: 連携ログ+文書送付 → Ph1b: 依頼/照会WF → Ph2: 外部共有                       | 確定 |
| D-04 | Ph1a: 読取専用キャッシュ → Ph2: 下書き+同期                                       | 確定 |
| D-05 | **候補表示+3層バリデーション**（自動算定しない）                                  | 確定 |
| D-06 | **データ移行なし**（新規構築）                                                    | 確定 |
| D-07 | **4層モデル**（標準化/法人/店舗/個人）                                            | 確定 |
| D-08 | **Prisma = メインORM + PostgreSQL RLS**（工程権限はフラグ制御）                   | 確定 |
| D-09 | **AWS 全面採用**（ISMAP準拠、3省2ガイドライン対応）                               | 確定 |
| D-10 | **Google Routes API** でルート最適化（住所→座標はジオコーディングAPI）            | 確定 |
| D-11 | **MVPは現場運用優先**（訪問記録/報告/持参判定を先行、最適化と高度請求は後段）     | 確定 |
| D-12 | **外部システム責任分界を先に固定**（SourceOfTruthMatrix を実装前に整備）          | 確定 |
| D-13 | **PDF生成: React-PDF サーバーサイド実行**（一括出力はキュー+ZIP+S3）              | 確定 |
| D-14 | **楽観的ロック**（version カラム + 409 Conflict）で同時編集競合を制御             | 確定 |
| D-15 | **バックグラウンドジョブ: EventBridge Scheduler**（日次/夕方/翌営業日/月次の4層） | 確定 |
