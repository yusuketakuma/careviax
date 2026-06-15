# Design Fidelity Mapping — design/ 画像セット v1.9 実装対応表

> 最終更新: 2026-06-11
> 目的: `design/images/{P0,P1}` の 62 画面を既存実装と対応付け、忠実実装の進捗と検証ループを管理する SSOT。
> 検証ループ: **実装 → Playwright 撮影 → ターゲット PNG と比較 → 差分指摘 → 修正** を画面単位で回す。

## 参照ドキュメント

- `design/manifest.json` — 画面 ID・ファイルパスの正
- `design/README_Codex.md` — 文言ルール(v1.9)
- `docs/ui-ux-design-guidelines.md` — UI/UX SSOT(本対応表より優先)

## 文言ルール(design/README_Codex.md より)

- 「ブロッカー」ではなく「止まっている理由」
- 「Next Action」ではなく「次にやること」
- 「Handoff」ではなく「薬剤師に相談 / 事務へ戻す」
- 「Claim」ではなく「算定チェック」
- 「ActionPhase」ではなく「押したあとの状態」
- ボタンは画面ごとに主操作を 1 つだけ強く見せる
- 危険タグ(麻薬、冷所、インスリン、抗凝固など)は隠さない

## 共通パターン(全画面共通で実装するもの)

1. **右パネル 3 点セット**(P0-08 が基準):
   - 「次にやること」— 主操作ボタン 1 つ(青、強調)
   - 「止まっている理由」— 赤/橙の警告リスト
   - 「根拠・資料」— 処方せん画像・前回訪問メモ・お薬手帳画像・検査値メモ等への「見る」リンク
2. **シェル**: ダークネイビーのサイドバー(PH-OS ロゴ + 「在宅薬局オペレーション」、下部にユーザー)+ 上部バー(モードバッジ・通知・ヘルプ・ユーザー名)
3. **デザイントークン**: 白背景 + ブルー primary、バッジは 緑/橙/青/赤/灰 の状態色(既存ガイドライン準拠)

## 横断完了事項(2026-06-11)

- シェル: サイドバーをデザインのフラット 14 項目へ刷新(`navigation-config.ts`)。上部バーはモードバッジ+「通知 N」+ヘルプ+ユーザー2行(`app-header.tsx` / `notification-bell.tsx`)
- 共通部品: `filter-chip-bar.tsx` / `list-open-card.tsx`(p0_04/05 共用)、`action-rail.tsx`(右レール3点セット)、`cycle-workspace.ts`(工程→状態表示+次アクション)
- デモ seed: `prisma/seed-design-demo.ts`(田中一郎シナリオ+通知6件。@db.Date は UTC midnight で渡す)
- 画面別詳細ギャップ: `docs/design-gap-analysis.md`(60 画面+バックエンド7領域、2026-06-11 並列調査)

## 検証ループの使い方

```bash
# 1. 撮影(対象 screen_id を絞る場合は DESIGN_SCREEN_IDS)
pnpm test:e2e:local -- ui-design-fidelity
# 2. tools/tests/.artifacts/design-fidelity/{screen_id}.actual.png と
#    design/images/{P0,P1}/{screen_id}.png を並べて比較
# 3. 差分を指摘 → 修正 → 再撮影
```

- 撮影スペック: viewport 1600x1000(デザイン PNG と同寸)、chromium、animations disabled
- 画面→ルート対応は `tools/tests/helpers/design-screen-map.ts` が正

### 比較の判断基準(静止画原則)

- ターゲット PNG は「画面の一瞬の静止画」。スクロール・カンバン横移動・タブ切替で見える範囲が変わる UI は、**移動できることを前提に**構築する(静止画に写る範囲だけを固定レイアウトに押し込まない)
- 比較で一致させるのは「写っている範囲」の: グルーピング/区切り、見出し階層、文言(文言ルール準拠)、状態色、主操作の強調(1 画面 1 つ)、右パネル構成
- ビューポート外にコンテンツが続くこと(スクロールバー、カードの折返し、カンバンの続き)は差分として扱わない
- 実装方針に迷いが生じた場合(静止画の解釈が複数ある・ガイドラインと矛盾する等)は、サブエージェントを多角的に展開して比較検討し、ベストアンサーを採用する

## P0 マッピング表(48 画面)

状態: `未着手` / `WIP` / `撮影比較中` / `完了` 。種別: `改修`(既存ページをデザインへ寄せる)/ `新規`(ページ自体が無い)/ `部品`(モーダル・共通部品)

| #   | screen_id                           | 対応ルート / 部品                    | 種別 | 状態   | メモ                                                              |
| --- | ----------------------------------- | ------------------------------------ | ---- | ------ | ----------------------------------------------------------------- |
| 01  | p0_01_login_mfa                     | `/(auth)/login` + `/mfa`             | 改修 | 未着手 | 中央カード+確認コード案内                                         |
| 02  | p0_02_tenant_pharmacy_select        | なし(新規 `/select-site` 相当)       | 新規 | 未着手 | ログイン後の薬局選択。API: `/api/me` 拡張 or sites 一覧           |
| 03  | p0_03_mode_role_select              | なし(新規。在宅/外来モード+ロール)   | 新規 | 未着手 | UI ストアにモード保持。シェルのモードバッジと連動                 |
| 04  | p0_04_notification_center           | `/notifications`                     | 改修 | 完了   | 2026-06-11。お知らせ化+5分類チップ+ListOpenCard                   |
| 05  | p0_05_global_search                 | `/search`(新設)                      | 改修 | WIP    | ページ化決定。workflow d23 で実装中                               |
| 06  | p0_06_advanced_search_modal         | `/search` 上のモーダル               | 部品 | WIP    | workflow d23 で実装中                                             |
| 07  | p0_07_dashboard_cardgrid            | `/dashboard`                         | 改修 | 完了   | 2026-06-11(D-2-1)                                                 |
| 08  | p0_08_card_detail_workspace         | `/patients/[id]`                     | 改修 | 完了   | 2026-06-11。タブ再編+左ミニカード+workspace 集約+右レール工程駆動 |
| 09  | p0_09_prescription_import           | `/prescriptions/new`                 | 改修 | 未着手 |                                                                   |
| 10  | p0_10_prescription_entry_period     | `/prescriptions/new`(期間入力)       | 改修 | 未着手 |                                                                   |
| 11  | p0_11_prescription_diff_review      | `/patients/[id]/prescriptions`(差分) | 改修 | 未着手 |                                                                   |
| 12  | p0_12_dispensing_workbench          | `/dispensing`                        | 改修 | 未着手 |                                                                   |
| 13  | p0_13_dispensing_audit              | `/auditing`                          | 改修 | 未着手 |                                                                   |
| 14  | p0_14_set_preparation               | `/medication-sets`                   | 改修 | 未着手 |                                                                   |
| 15  | p0_15_set_audit                     | `/medication-sets`(鑑査)             | 改修 | 未着手 |                                                                   |
| 16  | p0_16_schedule_gantt_all_staff      | `/schedules`                         | 改修 | 未着手 | 全スタッフ横断ガント                                              |
| 17  | p0_17_schedule_confirmation_flow    | `/schedules/proposals`               | 改修 | 未着手 |                                                                   |
| 18  | p0_18_schedule_create_edit_drawer   | `/schedules`(作成/編集ドロワー)      | 部品 | 未着手 |                                                                   |
| 19  | p0_19_schedule_conflict_resolution  | `/schedules`(重複解消)               | 改修 | 未着手 |                                                                   |
| 20  | p0_20_emergency_route_recalculation | `/schedules`(緊急差込→再計算)        | 改修 | 未着手 | visit-routes API 連携                                             |
| 21  | p0_21_route_optimization_detail     | `/schedules`(ルート詳細)             | 改修 | 未着手 |                                                                   |
| 22  | p0_22_visit_mode_tablet             | `/visits/[id]/record`                | 改修 | 未着手 | タブレット幅                                                      |
| 23  | p0_23_visit_mode_smartphone         | 同上(スマホ幅)                       | 改修 | 未着手 | viewport 390 で別撮影                                             |
| 24  | p0_24_facility_visit_packet         | facility-visit-batches 系画面        | 改修 | 未着手 |                                                                   |
| 25  | p0_25_clerk_support_dashboard       | `/my-day` or `/today`(事務向け)      | 改修 | 未着手 | 要精査                                                            |
| 26  | p0_26_contact_delivery_target_edit  | `/admin/contact-profiles`            | 改修 | 未着手 |                                                                   |
| 27  | p0_27_handoff_bidirectional         | `/handoff`                           | 改修 | 未着手 | 「薬剤師に相談 / 事務へ戻す」                                     |
| 28  | p0_28_report_composer_share         | `/reports`                           | 改修 | 未着手 |                                                                   |
| 29  | p0_29_reply_followup_management     | `/communications/requests`           | 改修 | 未着手 |                                                                   |
| 30  | p0_30_claim_billing_review          | `/billing`(算定チェック)             | 改修 | 未着手 |                                                                   |
| 31  | p0_31_residual_adjustment_flow      | residual-medications 系              | 改修 | 未着手 |                                                                   |
| 32  | p0_32_adverse_event_prevention_flow | `/issues` + CDS                      | 新規 | 未着手 | /issues は空ディレクトリ(404)。ルート新設要                       |
| 33  | p0_33_evidence_photo_management     | files / 訪問記録の写真管理           | 改修 | 未着手 | 要精査                                                            |
| 34  | p0_34_offline_sync_center           | なし(新規 `/sync` 相当)              | 新規 | 未着手 | dexie キュー可視化+手動同期。API 拡張要                           |
| 35  | p0_35_data_conflict_resolution      | なし(同期競合の解消 UI)              | 新規 | 未着手 | サーバ版との突合 UI                                               |
| 36  | p0_36_reject_reason_modal           | 差戻し理由モーダル(workflow 共通)    | 部品 | 未着手 |                                                                   |
| 37  | p0_37_cancel_reopen_reason_modal    | 取消/再開理由モーダル(共通)          | 部品 | 未着手 |                                                                   |
| 38  | p0_38_patient_profile               | `/patients/[id]`                     | 改修 | 未着手 |                                                                   |
| 39  | p0_39_medication_master             | `/admin/drug-masters`                | 改修 | 未着手 |                                                                   |
| 40  | p0_40_medical_professional_master   | `/admin/external-professionals`      | 改修 | 未着手 |                                                                   |
| 41  | p0_41_facility_master               | `/admin/facilities`                  | 改修 | 未着手 |                                                                   |
| 42  | p0_42_staff_role_management         | `/admin/staff` + `/admin/users`      | 改修 | 未着手 |                                                                   |
| 43  | p0_43_vehicle_master                | 車両マスタ(visit-vehicle-resources)  | 改修 | 未着手 | 管理画面の有無要精査                                              |
| 44  | p0_44_settings                      | `/settings`                          | 改修 | 未着手 |                                                                   |
| 45  | p0_45_capacity_bottleneck_dashboard | `/admin/capacity`                    | 改修 | 実装済 | 現行 dashboard BFF で撮影                                         |
| 46  | p0_46_ui_state_reference            | (UI 状態リファレンス)                | 参照 | —      | 実装対象外。状態色の正として参照                                  |
| 47  | p0_47_print_preview                 | 印刷プレビュー画面                   | 改修 | 未着手 |                                                                   |
| 48  | p0_48_mobile_evidence_capture       | モバイル証跡撮影                     | 改修 | 未着手 | p0_33 と連動                                                      |

## P1 マッピング表(14 画面)

| #   | screen_id                             | 対応ルート / 部品                   | 種別 | 状態     | メモ                                                               |
| --- | ------------------------------------- | ----------------------------------- | ---- | -------- | ------------------------------------------------------------------ |
| 01  | p1_01_saved_views_advanced_filter     | 一覧画面共通(保存ビュー)            | 部品 | 未着手   | バックエンド: 保存ビュー API 要                                    |
| 02  | p1_02_multi_card_split_workspace      | `/patients/compare`(複数カード並列) | 改修 | 実装済   | 既存 board/overview BFF 再利用。?patients=id1,id2,id3              |
| 03  | p1_03_ai_visit_summary_review         | visit-brief(訪問前まとめ)           | 改修 | 未着手   | 既存 visit-brief 接続                                              |
| 04  | p1_04_ai_report_draft                 | `/reports`(AI 下書き)               | 改修 | 未着手   |                                                                    |
| 05  | p1_05_interprofessional_portal        | `/shared/[token]`(外部共有)         | 改修 | 未着手   |                                                                    |
| 06  | p1_06_management_analytics_detail     | `/admin/operations-insights`        | 改修 | 実装済   | 在宅業務の動きを見る(月次訪問+工程所要+改善ヒント)。nav=分析・監視 |
| 07  | p1_07_inventory_linkage_prediction    | `/admin/inventory-forecast`         | 改修 | 実装済   | 在庫と定期処方の予測(来週必要薬+影響患者)。nav=分析・監視          |
| 08  | p1_08_facility_criteria_dashboard     | `/admin/facility-standards`         | 改修 | 未着手   |                                                                    |
| 09  | p1_09_incident_hiyarihatto            | `/admin/incidents`                  | 新規 | 実装済み | IncidentReport モデル+API 新設                                     |
| 10  | p1_10_report_template_editor          | `/admin/document-templates`         | 改修 | 未着手   |                                                                    |
| 11  | p1_11_voice_memo_transcription        | 音声メモ・文字起こし                | 新規 | 未着手   | バックエンド要(録音保存+転写ジョブ)                                |
| 12  | p1_12_advanced_route_scenario_compare | ルート案比較                        | 改修 | 未着手   |                                                                    |
| 13  | p1_13_realtime_collaboration_presence | presence(既存 realtime)             | 改修 | 未着手   |                                                                    |
| 14  | p1_14_ai_signal_tuning                | `/admin/alert-rules`(表示設定)      | 改修 | 未着手   |                                                                    |

## ギャップ分析(バックエンド)

既存: 80+ API ルート、Cognito+NextAuth+MFA、`src/lib/audit-logs/`、dexie オフライン(`src/lib/stores/offline-db.ts`、暗号化済み)、presence/realtime、visit-brief AI。

不足(新規実装が必要):

1. **薬局(サイト)選択フロー** — p0_02。セッションへの site 切替 API + 監査ログ
2. **モード/ロール選択** — p0_03。UI ストア + サーバー側の表示モード保持(設定 API)
3. **オフライン同期センター** — p0_34/35。同期キューの一覧化・手動再送・競合検出/解消 API(`If-Match`/version 比較は既存実装の有無を精査)
4. **保存ビュー(saved views)** — p1_01。ユーザー別フィルタ保存 API
5. **ヒヤリハット** — p1_09。実装済み: IncidentReport モデル+ `/api/incident-reports` + `/admin/incidents`(MedicationIssue/Task は patient 必須・タスク一覧混入のため不採用)
6. **音声メモ転写** — p1_11。S3 保存+転写ジョブ(外部依存の場合は cc:blocked 候補)
7. 各画面の右パネル「止まっている理由」— workflow-exceptions 集約 API の画面別 projection(既存 API の再利用を優先)

## 実装フェーズ(Plans.md「Phase 15」と同期)

- **15-1 基盤**: シェル/テーマ(ダークネイビーサイドバー)+ 右パネル共通部品 + 検証ループ基盤
- **15-2 中核**: ダッシュボード(07)+ カード詳細(08)+ 通知(04)+ 検索(05/06)
- **15-3 調剤フロー**: 処方(09-11)→ 調剤/監査(12-13)→ セット(14-15)
- **15-4 訪問フロー**: スケジュール(16-21)→ 訪問モード(22-24)
- **15-5 連携・請求**: 25-31
- **15-6 安全・オフライン**: 32-35 + モーダル(36-37)+ 認証(01-03)
- **15-7 マスタ・設定**: 38-45, 47-48
- **15-8 P1**: p1_01〜p1_14
- 各フェーズ完了条件: 対象画面の撮影→比較→差分解消(忠実度 OK)+ lint/test green
