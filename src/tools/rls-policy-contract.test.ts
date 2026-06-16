import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const hardenedRlsMigration = readFileSync(
  'prisma/migrations/20260608091000_harden_pca_patient_insurance_rls/migration.sql',
  'utf8',
);
const maintenanceEventMigration = readFileSync(
  'prisma/migrations/20260608193000_add_pca_pump_maintenance_events/migration.sql',
  'utf8',
);
const patientFieldRevisionMigration = readFileSync(
  'prisma/migrations/20260616120000_add_patient_field_revision/migration.sql',
  'utf8',
);
const patientStructuredCareMigration = readFileSync(
  'prisma/migrations/20260616140000_add_patient_structured_care/migration.sql',
  'utf8',
);
const rlsPolicySsot = readFileSync('prisma/rls-policies.sql', 'utf8');

describe('RLS policy contract for billing and PCA rental domains', () => {
  it.each([
    'PatientInsurance',
    'PcaPump',
    'PcaPumpRental',
    'PcaPumpMaintenanceEvent',
    'PatientFieldRevision',
    'PatientMedicalProcedure',
    'PatientNarcoticUse',
  ])('enforces app RLS context for %s in the hardening migration', (tableName) => {
    const source =
      tableName === 'PcaPumpMaintenanceEvent'
        ? maintenanceEventMigration
        : tableName === 'PatientFieldRevision'
          ? patientFieldRevisionMigration
          : tableName === 'PatientMedicalProcedure' || tableName === 'PatientNarcoticUse'
            ? patientStructuredCareMigration
            : hardenedRlsMigration;
    expect(source).toContain(`ON "${tableName}"`);
    expect(source).toContain(`ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY`);
    expect(source).toContain('public.app_enforced_org_id()');
  });

  it.each([
    'PatientInsurance',
    'PcaPump',
    'PcaPumpRental',
    'PcaPumpMaintenanceEvent',
    'PatientFieldRevision',
    'PatientMedicalProcedure',
    'PatientNarcoticUse',
  ])('keeps %s in the RLS SSOT file', (tableName) => {
    expect(rlsPolicySsot).toContain(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`);
    expect(rlsPolicySsot).toContain(`DROP POLICY IF EXISTS tenant_isolation ON "${tableName}"`);
    expect(rlsPolicySsot).toContain(`CREATE POLICY tenant_isolation ON "${tableName}"`);
    expect(rlsPolicySsot).toContain(`ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY`);
  });
});
