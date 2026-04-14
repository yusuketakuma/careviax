# Testing Docs

- [`./TESTING.md`](./TESTING.md) : テスト配置、命名規約、mock パターン、coverage 方針
- [`./PROMPT_PLAYWRIGHT_AUDIT_MASTER.md`](./PROMPT_PLAYWRIGHT_AUDIT_MASTER.md) : Playwright CLI 監査と改善実装の標準プロンプト

Playwright 実行物は `tools/tests/`、関連ドキュメントは `docs/testing/` に集約します。

- 実体テストスイート index: [`../../tools/tests/README.md`](../../tools/tests/README.md)

## Common Commands

- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:e2e:local`
- `pnpm build:e2e:local`
- `pnpm start:e2e:local`
- `pnpm test:e2e:list`
- `pnpm test:e2e:audit`
- `pnpm test:e2e:audit:list`
