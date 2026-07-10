# UI/UX Refresh — 全画面監査・競合研究・SSOT再構築・実装・検証

医療システム（PH-OS Pharmacy）の全画面・全状態・全ジャーニーを対象とした
UI/UX 監査 → 競合研究 → SSOT 再構築 → 実装 → 検証の作業領域。

## 位置づけ

- **規範 SSOT は `docs/ui-ux-design-guidelines.md` のまま**。本ディレクトリは監査・研究・計画・証跡の作業領域であり、SSOT 更新（Phase 6-7）は既存 SSOT 構造へ統合する。重複 SSOT は作らない。
- 既存の画面監査台帳 `.agent-loop/UI_AUDIT_MATRIX.md`、状態色移行台帳 `docs/state-color-migration-map.md` と整合させる。
- 運用体制の SSOT は `ops/refactor/STATE.md`。

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `PROGRESS.md` | フェーズ・タスク進捗台帳 |
| `00-repository-baseline.md` | リポジトリ・ランタイム実態（Phase 0） |
| `01-scope-and-users.md` | 利用者・業務・医療コンテキスト（Phase 1） |
| `02-compliance-applicability.md` | ガイドライン適用性 + Traceability Matrix（Phase 1） |
| `03-external-benchmark.md` | レセコン・電子薬歴の競合研究（Phase 2） |
| `04-screen-and-state-inventory.md` | 全画面・全状態・全ジャーニー棚卸し（Phase 3） |
| `05-state-ownership.md` | UI 状態所有権マップ（Phase 4） |
| `06-ui-ux-audit.md` | UI/UX 監査結果（Phase 5） |
| `07-use-error-risk-register.md` | 使用ミスリスク台帳（Phase 5） |
| `08-target-design-direction.md` | 目標デザイン方針・視覚的状態言語（Phase 6） |
| `09-implementation-plan.md` | 実装計画（Phase 7-8） |
| `10-verification-evidence.md` | 検証証跡（Phase 9） |
| `11-remaining-risks.md` | 残存リスク・要専門家レビュー事項 |
| `phase0/` ほか | フェーズ別の詳細調査ノート（各ファイルの根拠） |

## 不変ルール

- Phase 0〜5 ではプロダクトコード・Token・共通コンポーネントを変更しない（文書のみ）。
- 既存の未コミット変更（他セッション/ユーザー作業の可能性）は破棄・上書きしない。
- 実患者情報・認証情報・秘密情報を外部サービス・ログ・スクリーンショット・テスト成果物へ出さない。
- 「完全準拠」「問題なし」を専門家レビュー・検証根拠なしに断定しない。
- maker/checker 分離と objective gate（lint / typecheck / test / build）は careviax 恒常規律として維持。
