# Browser Harness Local E2E

`browser-use/browser-harness` is used here as an optional local harness for real-Chrome exploratory E2E checks. It complements the deterministic Playwright suite; it does not replace CI Playwright tests.

## Setup

Install the harness once:

```bash
git clone https://github.com/browser-use/browser-harness ~/Developer/browser-harness
cd ~/Developer/browser-harness
uv tool install -e .
browser-harness --setup
```

PH-OS scripts also work directly from the checkout through `tools/browser-harness/run.sh`.
Set `BROWSER_HARNESS_REPO` if the harness is cloned outside `~/Developer/browser-harness`.

The harness attaches to the user's running Chrome via CDP. If Chrome asks for remote debugging permission, choose the normal profile and allow it once.

## PH-OS Smoke

Start the local app and make sure the target browser profile is authenticated:

```bash
pnpm dev:e2e:local
```

Then run:

```bash
pnpm test:e2e:harness:patient-detail
```

The default base URL is `http://localhost:3012`. Override it for another environment:

```bash
BROWSER_HARNESS_BASE_URL=https://example-ph-os.example.com pnpm test:e2e:harness:patient-detail
```

The current smoke opens the patient list, follows the first patient detail link, checks the patient-detail tab surface, and verifies related patient screens without horizontal overflow.
