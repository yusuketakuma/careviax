# CareViaX Testing Guide

## File Location

Place test files next to the source file they test:

```
src/app/api/patients/route.ts
src/app/api/patients/route.test.ts
```

For shared test utilities, use `src/__tests__/helpers/`.

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
```

## Coverage

Coverage is configured for API routes and server code:

- **Included**: `src/app/api/**/*.ts`, `src/server/**/*.ts`
- **Threshold**: 80% statement coverage
