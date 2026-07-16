import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema/pharmacy-partnership.prisma', 'utf8');
const foundationMigration = readFileSync(
  'prisma/migrations/20260716113000_add_pharmacy_invoice_transition_idempotency/migration.sql',
  'utf8',
);
const routeScopeMigration = readFileSync(
  'prisma/migrations/20260716114500_scope_pharmacy_invoice_transition_intent_by_route/migration.sql',
  'utf8',
);
const rlsSsot = readFileSync('prisma/rls-policies.sql', 'utf8');

describe('pharmacy invoice transition DB contract', () => {
  it('persists versioned transition results under an org, route, invoice, and hashed key', () => {
    expect(schema).toContain('version               Int                         @default(1)');
    expect(schema).toContain('model PharmacyInvoiceTransitionIntent');
    expect(schema).toContain('route_key                String');
    expect(schema).toContain('idempotency_key_hash     String');
    expect(schema).toContain('request_fingerprint_hash String');
    expect(schema).toContain('result_snapshot          Json?');
    expect(schema).toContain('@@unique([org_id, route_key, invoice_id, idempotency_key_hash]');

    expect(foundationMigration).toContain('ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1');
    expect(foundationMigration).toContain(
      'CONSTRAINT "PharmacyInvoiceTransitionIntent_idempotency_key_hash_chk"',
    );
    expect(routeScopeMigration).toContain('ADD COLUMN "route_key" TEXT NOT NULL');
    expect(routeScopeMigration).toContain(
      'ON "PharmacyInvoiceTransitionIntent"("org_id", "route_key", "invoice_id", "idempotency_key_hash")',
    );
    expect(`${foundationMigration}\n${routeScopeMigration}`).not.toMatch(
      /"idempotency_key"\s+TEXT/,
    );
  });

  it('keeps the transition intent fail-closed under forced tenant RLS', () => {
    for (const source of [foundationMigration, rlsSsot]) {
      expect(source).toContain(
        'ALTER TABLE "PharmacyInvoiceTransitionIntent" ENABLE ROW LEVEL SECURITY',
      );
      expect(source).toContain(
        'CREATE POLICY tenant_isolation ON "PharmacyInvoiceTransitionIntent"',
      );
      expect(source).toContain('USING ("org_id" = public.app_enforced_org_id())');
      expect(source).toContain(
        'ALTER TABLE "PharmacyInvoiceTransitionIntent" FORCE ROW LEVEL SECURITY',
      );
    }
  });
});
