# PMDA メディナビ / マイ医薬品集 Onboarding Runbook

## 目的
PMDA 添付文書 XML の全量 / 差分 ZIP を安定運用に載せるための登録・設定・初回疎通手順を定義する。

## 前提
- PMDA 添付文書 importer 自体は実装済み
- 配布 URL は `PMDA_PACKAGE_INSERT_FULL_URL` / `PMDA_PACKAGE_INSERT_DELTA_URL` で管理する
- URL は Secrets Manager か環境変数に保存し、平文でリポジトリへ入れない

## 実施手順
1. PMDA メディナビへ運用担当の共通メールアドレスで登録する
2. マイ医薬品集サービスに同じアカウントでログインし、全医療用医薬品 XML の利用申請を完了する
3. 全量 ZIP と指定期間更新 ZIP の取得 URL を確認する
4. `PMDA_PACKAGE_INSERT_FULL_URL` / `PMDA_PACKAGE_INSERT_DELTA_URL` を Secrets Manager または環境変数へ設定する
5. `corepack pnpm pmda:onboarding:check` を実行し、登録状態とドキュメント前提を確認する
6. 管理画面の PMDA 取込ボタン、または `POST /api/drug-master-imports/pmda` に `mode=full` / `mode=delta` を送って初回疎通を確認する
7. `DrugMasterImportLog` に成功件数が残ることを確認する

## 失敗時の確認
- 配布 URL が期限切れまたはセッション依存 URL になっていないか
- ZIP が XML 以外の添付物を含んでいないか
- 取得 URL を Secrets Manager に保存したあとでアプリへ反映されているか
- PMDA 側でアカウント権限が有効化されているか

## 補助コマンド
- `corepack pnpm pmda:onboarding:check`
- `corepack pnpm pmda:onboarding:check -- --format=json`

## 完了条件
- 全量 URL / 差分 URL が設定済み
- 初回取込の成功ログが残っている
- EventBridge または定期ジョブから差分更新を再実行できる
