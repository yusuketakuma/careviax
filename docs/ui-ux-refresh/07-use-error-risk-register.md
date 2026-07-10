# Use-error Risk Register — 使用ミス・患者安全リスク（Phase 5 統合）

更新: 2026-07-11
状態: **DONE（リスク同定・設計入力）**。リスク低減策は未実装であり、専門家レビューおよび Phase 8/9 の実装・検証を経るまでリスクが解消されたとは扱わない。

## 1. 方法と限界

- Phase 3 の17ジャーニー、Phase 4 の状態所有権、UI/UX SSOT、route/source の静的根拠から、予見可能な使用ミスを分析した。
- 各行の Hazard、Use scenario、Foreseeable use error、Cause、Potential harm、Severity、Probability、Detectability、Existing control、Required UI/system control、Verification method、Residual risk、Review owner は、入力・確定系の [A台帳](phase5/risk-a-input-confirm.md) と保存・同期・システム系の [B台帳](phase5/risk-b-save-sync-system.md) に個別記録する。本書は全件の横断索引と実装ゲートである。
- severity は危害の大きさ、probability は現行設計での発生しやすさ、detectability は問題が利用者に発見できる度合いであり、規制上の残余リスク受容判断ではない。臨床安全・法務・セキュリティの専門レビューは未実施である。

## 2. 全リスク索引

| ID     | Hazard                                         | Severity | Probability | Detectability | 詳細                                                                                   |
| ------ | ---------------------------------------------- | -------- | ----------- | ------------- | -------------------------------------------------------------------------------------- |
| R-A-01 | 別患者への入力・確定                           | 高       | 中          | 中            | [A](phase5/risk-a-input-confirm.md#r-a-01-別患者への入力確定)                          |
| R-A-02 | 患者切替後の旧文脈残存                         | 高       | 中          | 低            | [A](phase5/risk-a-input-confirm.md#r-a-02-患者切替後の旧文脈残存)                      |
| R-A-03 | 前回処方との取り違え                           | 高       | 低          | 中            | [A](phase5/risk-a-input-confirm.md#r-a-03-前回処方との取り違え)                        |
| R-A-04 | 新規・増量・減量・中止の見落とし               | 高       | 中          | 中            | [A](phase5/risk-a-input-confirm.md#r-a-04-新規増量減量中止の見落とし)                  |
| R-A-05 | 剤形・規格・用法・用量・単位・桁・小数点の誤認 | 高       | 中          | 中            | [A](phase5/risk-a-input-confirm.md#r-a-05-剤形規格用法用量単位桁小数点の誤認)          |
| R-A-06 | 薬剤名の切り詰め誤認                           | 中       | 低          | 中            | [A](phase5/risk-a-input-confirm.md#r-a-06-薬剤名の切り詰め誤認)                        |
| R-A-07 | 禁忌・相互作用・重複・アレルギーの見落とし     | 高       | 中          | 低            | [A](phase5/risk-a-input-confirm.md#r-a-07-禁忌相互作用重複アレルギーの見落とし)        |
| R-A-08 | 軽微通知と重大警告の混同                       | 中       | 中          | 中            | [A](phase5/risk-a-input-confirm.md#r-a-08-軽微通知と重大警告の混同)                    |
| R-A-09 | alert fatigue                                  | 中       | 中          | 低            | [A](phase5/risk-a-input-confirm.md#r-a-09-alert-fatigue)                               |
| R-A-10 | 下書きを確定済みと誤認                         | 中       | 中          | 中            | [A](phase5/risk-a-input-confirm.md#r-a-10-下書きを確定済みと誤認)                      |
| R-A-11 | 代理入力と本人入力の混同                       | 低       | 低          | 高            | [A](phase5/risk-a-input-confirm.md#r-a-11-代理入力と本人入力の混同)                    |
| R-A-12 | 修正済みと原記録の混同                         | 中       | 低          | 中            | [A](phase5/risk-a-input-confirm.md#r-a-12-修正済みと原記録の混同)                      |
| R-A-13 | 旧版と最新版の混同                             | 中       | 中          | 低            | [A](phase5/risk-a-input-confirm.md#r-a-13-旧版と最新版の混同)                          |
| RB-01  | 端末自動保存をサーバー保存と誤認               | 中       | 高          | 中            | [B](phase5/risk-b-save-sync-system.md#rb-01-自動保存端末-dexieをサーバー保存と誤認)    |
| RB-02  | ローカル保存を同期済みと誤認                   | 中       | 中          | 中            | [B](phase5/risk-b-save-sync-system.md#rb-02-ローカル保存を同期済みと誤認)              |
| RB-03  | stale data を最新と誤認                        | 高       | 高          | 低            | [B](phase5/risk-b-save-sync-system.md#rb-03-stale-data-を最新と誤認--severity-高)      |
| RB-04  | セッション切れで入力消失                       | 中       | 中          | 中            | [B](phase5/risk-b-save-sync-system.md#rb-04-セッション切れによる入力消失)              |
| RB-05  | 同期競合による静かな上書き                     | 高       | 中          | 低            | [B](phase5/risk-b-save-sync-system.md#rb-05-同期競合による静かな上書き--severity-高)   |
| RB-06  | 二重送信                                       | 中       | 中          | 中            | [B](phase5/risk-b-save-sync-system.md#rb-06-二重送信)                                  |
| RB-07  | upload 完了前の保存誤認                        | 中       | 中          | 低            | [B](phase5/risk-b-save-sync-system.md#rb-07-upload-完了前の保存誤認)                   |
| RB-08  | rate limit 時の連打                            | 低       | 低          | 中            | [B](phase5/risk-b-save-sync-system.md#rb-08-レート制限時の連打)                        |
| RB-09  | 権限不足でも操作可能に見える                   | 中       | 高          | 高            | [B](phase5/risk-b-save-sync-system.md#rb-09-権限不足なのに操作可能に見える)            |
| RB-10  | 閲覧専用でも編集可能に見える                   | 低       | 低          | 高            | [B](phase5/risk-b-save-sync-system.md#rb-10-閲覧専用なのに編集可能に見える)            |
| RB-11  | break-glass の通常利用・終了忘れ               | 中       | 低          | 中            | [B](phase5/risk-b-save-sync-system.md#rb-11-break-glass非常時モードの通常利用終了忘れ) |

## 3. 実装前に閉じる設計ゲート

以下は静的調査で severity 高、または detectability 低とされたため、個別画面の装飾変更ではなく、制御の設計・専門家レビュー・明示的な検証計画を先に必要とする。

| Gate                  | 対象                         | 必要な設計判断                                                                | 必須レビュー / 検証                                                                           |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| G-01 患者・処方文脈   | R-A-01〜05, R-A-07, DV-07/08 | patient context、差分、CDS、用量表示、能動確認をどの画面・API契約で強制するか | clinical safety + design。類似氏名、処方差分、禁忌ペアのE2E/契約テスト                        |
| G-02 保存・鮮度・競合 | RB-01〜05, RB-07, R-A-10/13  | local/server/sync/conflict/freshness の状態機械、OCC対象、画面鮮度の意味      | clinical safety + security + design。offline restore、two-session 409、upload partial failure |
| G-03 権限・緊急権限   | RB-09〜11, RB-04             | permissions envelope、403/401 recovery、read-write break-glass の摩擦と監査   | security + legal + design。role E2E、expiry、audit-log review rehearsal                       |
| G-04 重複実行・回復   | RB-06, RB-08, NF-07/08       | idempotency、429/Retry-After、画面内の持続的失敗表示                          | design + API owner。連打/遅延/429/再試行 tests                                                |

## 4. 横断対策の設計原則

1. 説明文だけで緩和せず、患者文脈、状態分類、位置、操作フロー、サーバー側制御、監査を対にする。
2. local draft、server persisted、pending sync、sync failed、conflict、fresh/stale、confirmed/read-only を同じ成功表現に混ぜない。
3. critical clinical alert と一般通知を、色だけでなく固定位置、ラベル、形状、操作制約で分離する。
4. クライアント権限推測を安全保証にせず、サーバー付与の permissions envelope と API 強制を維持する。
5. 実装後も residual risk はゼロと推定しない。各台帳の Verification method を Phase 9 の証跡へ接続し、実施していない専門家レビュー・ユーザーテストを `NOT_EXECUTED` と明記する。

## 5. 未実装の機能と残存リスク

次は実装済みではないため、UI があるものとしてテストや完了判定に含めない: 代理入力、報告書の版管理UI、報告書finalize UI、CSR中の401再認証モーダル、429待機UI、訪問記録添付の明示的再試行UI、薬局スタッフ向け非常時モード。詳細な根拠・一時緩和・review owner は A/B 台帳を参照する。
