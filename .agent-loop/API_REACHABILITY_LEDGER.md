# API 到達性台帳（FEBRUSH E1、2026-07-02 監査）

**目的**: 「バックエンド機能はあるのに FE にアクセスポイントがない」状態の解消（ユーザー指示）。
**手法**: `src/app/api/**/route.ts` 363 本を全列挙し、①フルパス一致 ②動的セグメント接頭辞+suffix ③`api-paths.ts` ビルダー呼出 の3戦略で FE 参照を突合。ORPHAN はテスト・route 定義・`rate-limit.ts` を除外した実ソース生 grep で 0 件を個別確認。
**集計**: ORPHAN 39 パス（うち 4 本は再エクスポートエイリアス）/ INTERNAL ~10 / E3 重複 4 組 / 残りは REACHABLE。

処置区分: `wire`=UI 導線追加（E2、該当 C wave に相乗り）/ `merge`=統合（E3）/ `retire?`=廃止提案（**要ユーザー承認**）/ `hard-stop?`=auth/security 隣接で着手前承認必須。

## ORPHAN 台帳

| #     | route                                           | method                | 機能                               | 処置                       | 備考                                                                   |
| ----- | ----------------------------------------------- | --------------------- | ---------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| 1     | /api/me/logout-all                              | POST                  | 全デバイス強制ログアウト           | wire **hard-stop?**        | セキュリティ設定に導線。auth 隣接                                      |
| 2     | /api/me/mfa/disable                             | DELETE                | MFA 無効化                         | wire **hard-stop?**        | setup/verify は UI 有。auth 隣接                                       |
| 3     | /api/me/activity-summary                        | GET                   | 自分の操作集計                     | wire / retire?             | マイページ表示 or 廃止                                                 |
| 4     | /api/patients/[id]/timeline                     | GET                   | 患者タイムライン                   | retire?                    | RSC 直読み（patient-detail-timeline-registry）で表示済 = 二重実装      |
| 5     | /api/patients/[id]/conditions                   | GET/PUT               | 病名取得・更新                     | wire                       | 病名編集 UI（現状 overview 埋込表示のみ）                              |
| 6     | /api/patients/[id]/archive · /restore           | PATCH                 | 患者アーカイブ/復元                | wire                       | 患者ヘッダ管理メニュー（C1）                                           |
| 7     | /api/patients/[id]/visit-records/pdf            | GET                   | 訪問記録 PDF                       | wire                       | 患者詳細の印刷メニュー（C1）                                           |
| 8     | /api/patients/[id]/prescriptions/e-prescription | POST                  | 電子処方箋発行                     | wire **hard-stop?**        | 規制隣接、着手前承認                                                   |
| 9     | /api/patients/medications/bulk-export           | POST                  | 服薬情報一括エクスポート           | wire                       | 管理画面（C3）                                                         |
| 10    | /api/cases/[id]/transition                      | PATCH                 | ケース状態遷移                     | wire                       | ケース画面（C1/C2）                                                    |
| 11    | /api/medication-cycles/[id]/transition          | PATCH                 | サイクル状態遷移                   | wire                       | サイクル管理 UI（C2）                                                  |
| 12    | /api/visit-schedules/generate                   | POST                  | スケジュール自動生成               | wire                       | スケジュール画面（C1）                                                 |
| 13    | /api/visit-schedules/[id]/reopen                | POST                  | 確定スケジュール再オープン         | wire                       | C1                                                                     |
| 14    | /api/visit-schedules/[id]/reschedule/approve    | POST                  | リスケ承認                         | wire                       | reschedule 本体は UI 有                                                |
| 15    | /api/visit-preparations/[scheduleId]/brief      | GET                   | 単一訪問ブリーフ                   | merge / retire?            | brief-batch は UI 有 → 統合                                            |
| 16    | /api/visit-records/[id]/handoff/extract         | POST                  | 記録→申し送り抽出                  | wire                       | 申し送り画面（C2）                                                     |
| 17    | /api/communication-events                       | GET/POST              | コミュニケーションイベント         | wire / retire?             | 要用途確認                                                             |
| 18    | /api/communication-requests/[id]/responses      | GET/POST              | 連絡依頼への回答                   | wire                       | 依頼自体は UI 有（C2）                                                 |
| 19    | /api/conference-notes/participant-suggestions   | GET                   | 会議参加者サジェスト               | wire                       | 入力補完に接続                                                         |
| 20    | /api/drug-masters/[id]/package-insert           | GET                   | 添付文書取得                       | wire                       | 薬剤詳細リンク（C2/C3）                                                |
| 21    | /api/dashboard/monthly-stats                    | GET                   | 月次統計                           | merge                      | cockpit/metrics へ統合（E3-4）                                         |
| 22    | /api/dashboard/overdue                          | GET                   | 期限超過一覧                       | merge                      | 同上                                                                   |
| 23    | /api/billing-evidence/stats                     | GET                   | 請求エビデンス統計                 | wire                       | 請求画面（C2）                                                         |
| 24    | /api/admin/organizations                        | POST                  | 組織作成                           | retire? / 明示 INTERNAL 化 | スーパー管理者専用の明文化でも可                                       |
| 25    | /api/admin/webhooks                             | GET/POST              | 送信 Webhook 設定                  | wire                       | 管理設定（C3）                                                         |
| 26    | /api/admin/facilities/[id]/visit-batches        | GET                   | 施設の訪問バッチ一覧               | wire / retire?             | 施設詳細（C3）                                                         |
| 27    | /api/drug-master-imports/manual-clinical        | POST                  | 手動臨床データ取込                 | wire                       | 取込 UI（C3）                                                          |
| 28    | /api/pharmacists/import                         | POST                  | 薬剤師一括インポート               | wire                       | 管理画面（C3）                                                         |
| 29    | /api/pharmacist-shifts/available                | GET                   | 対応可能シフト取得                 | wire                       | シフト/配車 UI（C2）                                                   |
| 30    | /api/pharmacy-contracts/[id]/versions           | POST                  | 契約バージョン作成                 | wire                       | 契約画面（C4）                                                         |
| 31    | /api/set-batches · /set-batches/[id]            | GET/POST/PATCH/DELETE | セットバッチ CRUD                  | retire?                    | set-plans 側が UI 正本。誤検出注意点は監査で除外済                     |
| 32    | /api/workflow-exceptions/[id]                   | GET/PATCH             | ワークフロー例外の解決             | wire                       | ワークフロー画面（C2）                                                 |
| 33    | /api/push-subscription                          | POST/DELETE           | Web Push 購読登録/解除             | **wire（機能未完成）**     | sw.ts は push 受信のみ実装、購読フロー未接続。PWA 通知の実機能ギャップ |
| 34-37 | /api/external-professionals/\* （4 route）      | 各種                  | admin 版の再エクスポートエイリアス | retire?（E3-1）            | FE は admin 版のみ使用                                                 |

## E3 重複候補

| #    | 組                                                                  | 判定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E3-1 | /api/external-professionals/_ ↔ /api/admin/external-professionals/_ | 非 admin 側は薄い再エクスポートで死蔵 → **廃止推奨（要承認）**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| E3-2 | /api/facilities* ↔ /api/admin/facilities/*（再エクスポート）        | **解決（2026-07-02 Codex 精査・明文化）**: 二重公開は意図的に維持。GET=canVisit / mutations=canAdmin の権限差あり。[id]/patients は非 admin 側が archive/limit/assignment スコープ+count metadata を持つ別実装（admin 側は helper 形状）で真の重複でない。運用: FE/admin ヘルパは /api/admin/facilities へ正準化、/api/facilities は検索（グローバル検索が使用）+臨床 patients 面として維持。締める場合は公開側 mutations をテスト移行後に 405 ラッパ化。search / protected-route / rate-limit テストの移行なしに /api/facilities を削除しない |
| E3-3 | /api/admin/flush-metrics ↔ /api/jobs/flush-metrics                  | 同機能・認証方式差のみ → 1 本化候補                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| E3-4 | dashboard/monthly-stats・overdue ↔ cockpit・admin/metrics           | 新 UI より既存ダッシュボード API へ統合                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## INTERNAL（UI 不要が妥当）

/api/health · /api/auth/[...nextauth] · /api/jobs* · /api/admin/flush-metrics · /api/phos/[...path] · /api/meta/route-catalog · /api/external-access/[token]*（外部利用者向け）

## 制約

- 閲覧系 ORPHAN の一部（timeline / conditions）は RSC 直読みで**機能自体は UI に存在** → API 側が二重実装。廃止判断はデータ取得方式の方針（RSC vs API）と合わせて。
- PARTIAL（到達 route のメソッド単位未使用）は網羅トレース未実施。ORPHAN 側の多メソッド route は全メソッド未使用を確認済み。

## 進行状態

- [ ] 廃止提案（retire?）群のユーザー承認取得 → 承認後に削除スライス
- [ ] hard-stop? 3 件（logout-all / mfa-disable / e-prescription）の着手承認
- [ ] wire 群を C wave へ割付（備考欄の wave 記載が初期案）
- [x] E3-2 facilities の権限差意図の確認（Codex 精査済み → 上表に明文化、二重公開維持で決着）
