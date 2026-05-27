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
- `pnpm db:e2e:prepare`
- `pnpm db:e2e:check-care-report-duplicates`
- `pnpm medical-ui:e2e:preflight`
- `pnpm medical-ui:e2e:targeted`
- `pnpm medical-ui:e2e:gate`
- `pnpm medical-ui:e2e:gate:prod`
- `pnpm test:e2e:harness:doctor`
- `pnpm test:e2e:harness:patient-detail`

## Medical UI/UX Goal Gate

Run `pnpm medical-ui:e2e:preflight` before the medical UI/UX completion gate. It checks
that the local `ph_os_e2e` database target, app port, DB port, required Playwright
specs, and CareReport duplicate precheck script are available before running the final
authenticated Playwright/axe pass.

After the app and local database are ready, use `pnpm medical-ui:e2e:gate` to run the
preflight, CareReport duplicate precheck, and targeted authenticated Playwright/axe
coverage in sequence. The gate pins `DATABASE_URL` and `DIRECT_URL` to the local
`ph_os_e2e` database so it does not accidentally use the default development DB.

For release-grade local evidence, prefer `pnpm medical-ui:e2e:gate:prod` after the
local database has been prepared. It builds the E2E production bundle, starts
`next start` on `localhost:3012`, runs the same medical UI/UX gate, and stops the app
server when the gate finishes or fails. This avoids `next dev` compilation and hot
reload noise during the final Playwright/axe pass.

When the local PostgreSQL service is running but the E2E database has not been prepared,
run `pnpm db:e2e:prepare` first. It syncs the Prisma schema and seeds the dedicated
`ph_os_e2e` database using the same pinned connection string.

Use `pnpm db:e2e:check-care-report-duplicates` for local E2E release evidence. The
generic `pnpm db:check-care-report-duplicates` command intentionally follows the active
environment so it can be used against staging or production-like targets before applying
the CareReport unique-index migration.

## Browser Harness

`tools/browser-harness/` contains optional real-Chrome E2E checks powered by `browser-use/browser-harness`.
Use these for local exploratory verification and self-healing browser diagnosis; keep Playwright as the deterministic CI suite.
