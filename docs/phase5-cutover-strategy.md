# Phase 5 一括 Cutover 戦略 (PRE-01)

## 概要

Phase 5 では患者モデルの複数フィールドを構造化・正規化する。Feature flag を使わず、schema migration → backfill → アプリ同時デプロイの単一カットオーバーで切替する。

---

## 前提条件

- Phase 5 全スキーマ変更（P-01/P-04/P-06/P-07/P-08）を単一ブランチで直列管理（PRE-02 参照）
- 全マイグレーションが `pnpm db:migrate` で冪等に実行可能であること
- バックフィル SQL が事前検証済みであること（PRE-03 参照）
- ロールバック SQL が PRE-05 に定義済みであること
- カットオーバー作業は業務時間外（例: 土曜深夜）に実施

---

## デプロイ順序

### Step 1 — Schema Migration（DB のみ）

```bash
pnpm db:migrate
```

- 追加カラム・テーブルはすべて `NULL` 許容または `DEFAULT` 付きで追加
- 旧カラム（`allergy_info Json?`, `gender String` 等）はこの時点では削除しない
- RLS ポリシーを新テーブルに適用（migration SQL に含める）
- **所要時間目安**: 5 分以内（テーブルロックなし構成で実行）

### Step 2 — Backfill（データ移行）

```bash
pnpm tsx tools/scripts/migration-verify-template.ts --phase p01-allergy
pnpm tsx tools/scripts/migration-verify-template.ts --phase p04-insurance
pnpm tsx tools/scripts/migration-verify-template.ts --phase p06-gender
pnpm tsx tools/scripts/migration-verify-template.ts --phase p07-packaging
pnpm tsx tools/scripts/migration-verify-template.ts --phase p08-archive
```

- 各スクリプトは pre-count → backfill SQL → post-integrity check の順で実行
- エラーが発生した時点で中断し、該当フェーズのロールバック SQL を実行（PRE-05）
- **所要時間目安**: 患者数に依存（1,000 件で 2〜5 分）

### Step 3 — アプリ同時デプロイ

以下を単一の Amplify デプロイで同時リリース：

| 対象レイヤー | 変更内容 |
|---|---|
| API Route Handlers | Patient レスポンス形式変更（新フィールド対応） |
| UI コンポーネント | 患者詳細・編集・一覧・スケジュール画面（PRE-06 参照） |
| Server jobs | バックグラウンド処理（packaging/notification 等） |
| PDF 生成 | 管理指導計画書・報告書の患者情報フォーマット |
| Shared utilities | 性別表示ヘルパー・アレルギー表示コンポーネント |

```bash
pnpm build && pnpm deploy
```

- SW キャッシュ無効化戦略は PRE-04 参照
- デプロイ後 5 分間、エラーレートを CloudWatch で監視

### Step 4 — 旧カラム削除（1 週間後）

旧フィールド（`allergy_info`, `gender` String 型等）の削除は切替成功確認後に別マイグレーションで実施。
カットオーバー当日は削除しない（ロールバック経路の確保のため）。

---

## 切替失敗の判断基準

以下のいずれかが発生した場合、即座にロールバックを開始する：

| 条件 | 閾値 | 対応 |
|---|---|---|
| API 5xx エラーレート | デプロイ後 5 分で > 1% | 即時ロールバック |
| Backfill integrity check 失敗 | 患者数不一致 or NOT NULL 違反 | 該当フェーズ停止・ロールバック |
| 請求関連 API エラー | 任意の 5xx | 即時ロールバック（請求データ優先） |
| Build 失敗 | `pnpm build` 非ゼロ終了 | デプロイ中止 |
| Prisma migration 失敗 | 非ゼロ終了 | migration ロールバック実行 |

---

## ロールバック手順

1. Amplify コンソールで直前の安定リリースに "Redeploy" を実行
2. 旧アプリが起動したことを確認（ヘルスチェック API）
3. PRE-05 のロールバック SQL を該当フェーズ分だけ実行
4. バックフィルによる新テーブルデータを truncate（外部キー順に逆順）
5. CloudWatch でエラーレート正常化を確認
6. インシデントログに判断根拠・実行時刻を記録

**目標完了時間**: 30 分以内（PRE-05 参照）

---

## カットオーバー チェックリスト

- [ ] 全 migration SQL がステージング環境でテスト済み
- [ ] backfill スクリプトがステージングで完走済み
- [ ] ロールバック SQL をステージングで動作確認済み
- [ ] CloudWatch アラーム（5xx > 1%）設定済み
- [ ] Amplify の前バージョンが redeployable な状態であることを確認
- [ ] カットオーバー作業者・承認者が決定済み
- [ ] 患者データバックアップ（RDS スナップショット）取得済み
