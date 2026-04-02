# Playwright Test Suite

- `ui-major-screens.spec.ts` : 主要画面の smoke / representative data 検証
- `ui-audit-extensions.spec.ts` : a11y, keyboard, motion, offline 監査
- `ui-browser-matrix-smoke.spec.ts` : browser matrix smoke
- `ui-data-explorer.spec.ts` : backend-only seed coverage の UI 確認
- `ui-visual-regression.spec.ts` : 限定 visual regression

## Supporting Files

- `helpers/local-auth.ts` : local session と instrumented page helper
- `helpers/artifacts.ts` : `tools/tests/.artifacts/` 配下の共通出力先
- ガイド入口: [`../../docs/testing/README.md`](../../docs/testing/README.md)

## Commands

- `pnpm test:e2e`
- `pnpm test:e2e:list`
- `pnpm test:e2e:audit`
- `pnpm test:e2e:audit:list`
