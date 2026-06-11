# PH-OS Testing Guide

## File Location

Place test files next to the source file they test:

```
src/app/api/patients/route.ts
src/app/api/patients/route.test.ts
```

For shared test utilities, use `src/__tests__/helpers/`.

Playwright E2E / UI audit specs live under `tools/tests/`, and generated artifacts are written under `tools/tests/.artifacts/`.

## Test Naming Conventions

### `describe` block

Use the HTTP method and API path:

```typescript
describe('GET /api/patients', () => { ... });
describe('POST /api/prescription-intakes', () => { ... });
```

### `it` block

Start with the expected outcome:

```typescript
it('returns 200 with list of patients', async () => { ... });
it('returns 400 when required fields are missing', async () => { ... });
it('returns 401 when not authenticated', async () => { ... });
```

## Mock Pattern

Use `vi.hoisted()` + `vi.mock()` to set up mocks before module evaluation:

```typescript
const { withAuthMock, findManyMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler) => {
    withAuthMock.mockImplementation(handler);
    return handler;
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    someModel: { findMany: findManyMock },
  },
}));
```

### Auth Mock Helper

Import from `src/__tests__/helpers/mock-auth.ts`:

```typescript
import { createAuthMock, callWithAuth } from '@/__tests__/helpers';

const { handlerMock, withAuthFactory } = createAuthMock();

vi.mock('@/lib/auth/middleware', () => withAuthFactory());

// In tests:
const res = await callWithAuth(handlerMock, '/api/patients', {
  method: 'GET',
  orgId: 'org_1',
});
```

## Required Error Cases

Every API route test must cover at minimum:

1. **400 — Validation error**: invalid or missing required fields
2. **401 — Auth required**: unauthenticated access (covered by `withAuth` middleware)
3. **Happy path**: the expected success response

## Data Factories

Use factory functions from `src/__tests__/helpers/data-factories.ts` for consistent test data:

```typescript
import { buildPatient, buildCase, resetFactoryCounter } from '@/__tests__/helpers';

beforeEach(() => {
  resetFactoryCounter();
});

it('returns patient data', async () => {
  const patient = buildPatient({ name: 'カスタム名' });
  findManyMock.mockResolvedValue([patient]);
  // ...
});
```

Available factories: `buildPatient`, `buildCase`, `buildPrescriptionIntake`, `buildVisitSchedule`, `buildCareReport`.

## Running Tests

```bash
pnpm test              # Run all tests once
pnpm test:watch        # Watch mode
pnpm test:coverage     # Run with coverage report
pnpm test:e2e          # Run Playwright suite
pnpm dev:e2e:local     # Start local app server for URL-based Playwright runs
pnpm build:e2e:local   # Build the app for stable URL-based Playwright runs
pnpm start:e2e:local   # Start the built app at http://localhost:3012
pnpm test:e2e:local    # Run Playwright against http://localhost:3012
pnpm test:e2e:list     # List Playwright tests without executing
pnpm test:e2e:audit    # Run the audit-focused Playwright config
pnpm test:e2e:audit:list
pnpm db:e2e:prepare    # Sync and seed the dedicated local ph_os_e2e database
pnpm db:e2e:check-care-report-duplicates
pnpm db:e2e:check-visit-route-order-conflicts
pnpm medical-ui:e2e:preflight
pnpm medical-ui:e2e:targeted
pnpm medical-ui:e2e:gate
pnpm medical-ui:e2e:gate:prod
```

For medical UI/UX release evidence, prepare the local `ph_os_e2e` database
on `localhost:5433` with `pnpm --config.verify-deps-before-run=false
db:e2e:prepare`, then prefer `pnpm --config.verify-deps-before-run=false
medical-ui:e2e:gate:prod`. The production gate builds the E2E bundle, starts
`next start` on `localhost:3012`, runs preflight, runs the local E2E CareReport
duplicate precheck, runs the local E2E visit route_order conflict precheck,
executes the targeted Playwright/axe specs, and shuts the server down.

Use `pnpm --config.verify-deps-before-run=false
db:e2e:check-care-report-duplicates` and `pnpm --config.verify-deps-before-run=false
db:e2e:check-visit-route-order-conflicts` for local E2E evidence. Use the generic
`pnpm --config.verify-deps-before-run=false db:check-care-report-duplicates`
or `pnpm --config.verify-deps-before-run=false db:check-visit-route-order-conflicts`
only when intentionally following the active target database before applying
the related database invariants.

## Coverage

Coverage is configured for API routes and server code:

- **Included**: `src/app/api/**/*.ts`, `src/server/**/*.ts`
- **Threshold**: 80% statement coverage
