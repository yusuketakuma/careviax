---
evaluator:
  command: PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3012 npx playwright test --config playwright.local.config.ts --ignore-snapshots
  format: json
  keep_policy: pass_only
---
