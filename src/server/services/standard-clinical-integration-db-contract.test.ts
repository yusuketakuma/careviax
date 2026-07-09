import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema/standard-clinical-integration.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20260709170000_rebuild_standard_clinical_integration/migration.sql',
  'utf8',
);
const rlsSsot = readFileSync('prisma/rls-policies.sql', 'utf8');

const displayIdModels = [
  'ClinicalExternalSystem',
  'ClinicalExternalReference',
  'ClinicalFhirResourceCache',
  'ClinicalDisclosureGrant',
  'YreseClinicalEvent',
  'YreseOutboundEvent',
  'ClinicalSyncQueueItem',
  'ClinicalProvenanceRecord',
  'HomeCarePatientProfile',
  'MedicationTimelineItem',
  'ResidualMedicationAssessment',
] as const;

const tenantModels = [...displayIdModels, 'ClinicalFhirRawResourceVault'] as const;
const nonVaultModels = tenantModels.filter((model) => model !== 'ClinicalFhirRawResourceVault');

function readModelBlock(model: string): string {
  const match = new RegExp(`^model ${model} \\{[\\s\\S]*?^\\}`, 'm').exec(schema);
  if (!match) throw new Error(`Missing model ${model}`);
  return match[0];
}

function readScalarFieldNames(model: string): string[] {
  return readModelBlock(model)
    .split('\n')
    .map((line) => line.trim().match(/^(\w+)\s+/)?.[1])
    .filter((field): field is string => typeof field === 'string' && !field.startsWith('@@'));
}

describe('standard clinical integration DB contract', () => {
  it('creates the pre-release yrese / JP Core / FHIR spine tables with tenant display IDs', () => {
    for (const model of displayIdModels) {
      const block = readModelBlock(model);
      expect(block, model).toContain('org_id');
      expect(block, model).toMatch(/\n\s+display_id\s+String\?/);
      expect(block, model).toContain('@@unique([id, org_id])');
      expect(block, model).toContain('@@unique([org_id, display_id])');
      expect(migration, model).toContain(`CREATE TABLE "${model}"`);
      expect(migration, model).toContain(`CREATE UNIQUE INDEX "${model}_org_id_display_id_key"`);
    }
  });

  it('keeps raw FHIR resource storage isolated in the encrypted raw vault', () => {
    const rawVault = readModelBlock('ClinicalFhirRawResourceVault');
    expect(rawVault).toContain('encrypted_payload Bytes');
    expect(rawVault).toContain('expires_at        DateTime');
    expect(rawVault).not.toContain('display_id');
    expect(migration).toContain('"encrypted_payload" BYTEA NOT NULL');
    expect(migration).toContain('"expires_at" TIMESTAMP(3) NOT NULL');

    const disallowedNonVaultFields = new Set([
      'raw_resource',
      'raw_resource_json',
      'payload',
      'request_body',
      'response_body',
      'bundle',
      'resource',
    ]);
    for (const model of nonVaultModels) {
      const fieldNames = readScalarFieldNames(model);
      expect(
        fieldNames.filter((field) => disallowedNonVaultFields.has(field)),
        `${model} must not persist raw FHIR resources or request/response bodies`,
      ).toEqual([]);
    }
  });

  it('uses fail-close RLS in both migration and SSOT for every new tenant table', () => {
    for (const model of tenantModels) {
      for (const source of [migration, rlsSsot]) {
        expect(source, `${model}: enable`).toContain(
          `ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`,
        );
        expect(source, `${model}: policy`).toContain(
          `CREATE POLICY tenant_isolation ON "${model}"`,
        );
        expect(source, `${model}: app_enforced`).toContain(
          `USING ("org_id" = public.app_enforced_org_id())`,
        );
        expect(source, `${model}: force`).toContain(
          `ALTER TABLE "${model}" FORCE ROW LEVEL SECURITY`,
        );
      }
    }
  });

  it('keeps integration ledgers append-only and avoids generic full-row audit triggers', () => {
    expect(migration).toContain('CREATE TRIGGER "YreseClinicalEvent_no_update"');
    expect(migration).toContain('CREATE TRIGGER "YreseClinicalEvent_no_delete"');
    expect(migration).toContain('CREATE TRIGGER "ClinicalProvenanceRecord_no_update"');
    expect(migration).toContain('CREATE TRIGGER "ClinicalProvenanceRecord_no_delete"');

    for (const model of tenantModels) {
      const genericAuditTrigger = new RegExp(
        `CREATE TRIGGER[\\s\\S]*?ON "${model}"[\\s\\S]*?ph_os_write_audit_log\\(\\)`,
      );
      expect(migration, model).not.toMatch(genericAuditTrigger);
    }
  });

  it('enforces external identity, resource version, queue idempotency, and provenance constraints in SQL', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ClinicalExternalReference_org_system_resource_external_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ClinicalFhirResourceCache_org_source_resource_version_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ClinicalFhirResourceCache_org_source_resource_current_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "YreseClinicalEvent_org_idempotency_key_hash_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ClinicalSyncQueueItem_org_target_operation_idem_key"',
    );
    expect(migration).toContain('CONSTRAINT "ClinicalSyncQueueItem_running_lock_chk"');
    expect(migration).toContain('CONSTRAINT "ClinicalProvenanceRecord_hash_presence_chk"');
  });
});
