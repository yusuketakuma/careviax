# Tools Directory

運用系の資産を GitHub root からまとめるためのディレクトリです。

- `tools/infra/` : AWS / 監査 / セキュリティ設定テンプレート
- `tools/scripts/` : 運用チェック、レポート生成、補助 CLI
- `tools/tests/` : Playwright ベースの E2E / UI 監査
- `tools/infra/README.md` : infra template index
- `tools/scripts/README.md` : operational script index
- `tools/tests/README.md` : テストスイートと artifact 配置の index

アプリ本体のコードは `src/` に置き、運用用の補助資産だけをここに寄せます。
