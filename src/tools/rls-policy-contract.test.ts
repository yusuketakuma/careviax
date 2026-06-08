import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const hardenedRlsMigration = readFileSync(
  'prisma/migrations/20260608091000_harden_pca_patient_insurance_rls/migration.sql',
  'utf8',
);
const rlsPolicySsot = readFileSync('prisma/rls-policies.sql', 'utf8');

describe('RLS policy contract for billing and PCA rental domains', () => {
  it.each(['PatientInsurance', 'PcaPump', 'PcaPumpRental'])(
    'enforces app RLS context for %s in the hardening migration',
    (tableName) => {
      expect(hardenedRlsMigration).toContain(`ON "${tableName}"`);
      expect(hardenedRlsMigration).toContain(`ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY`);
      expect(hardenedRlsMigration).toContain('public.app_enforced_org_id()');
    },
  );

  it.each(['PatientInsurance', 'PcaPump', 'PcaPumpRental'])(
    'keeps %s in the RLS SSOT file',
    (tableName) => {
      expect(rlsPolicySsot).toContain(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`);
      expect(rlsPolicySsot).toContain(`DROP POLICY IF EXISTS tenant_isolation ON "${tableName}"`);
      expect(rlsPolicySsot).toContain(`CREATE POLICY tenant_isolation ON "${tableName}"`);
      expect(rlsPolicySsot).toContain(`ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY`);
    },
  );
});
