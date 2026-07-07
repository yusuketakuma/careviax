import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema/medication.prisma'), 'utf8');
const MIGRATION = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260707090000_add_medication_stock_ledger/migration.sql'),
  'utf8',
);
const RLS_POLICIES = readFileSync(join(process.cwd(), 'prisma/rls-policies.sql'), 'utf8');

const STOCK_MODELS = [
  'PatientMedicationStockItem',
  'MedicationStockEvent',
  'MedicationStockSnapshot',
  'ExternalMedicationStockObservation',
] as const;

const REQUIRED_INDEXES = [
  'PatientMedicationStockItem_org_patient_active_idx',
  'MedicationStockEvent_org_patient_event_at_idx',
  'MedicationStockEvent_org_stock_item_event_at_idx',
  'MedicationStockSnapshot_org_stock_risk_stockout_idx',
  'MedicationStockSnapshot_org_patient_stock_risk_idx',
  'ExternalMedicationStockObservation_org_review_created_idx',
  'ExtMedicationStockObs_org_patient_review_created_idx',
] as const;

function readModelBlock(model: string): string {
  const match = new RegExp(`^model ${model} \\{[\\s\\S]*?^\\}`, 'm').exec(SCHEMA);
  if (!match) throw new Error(`Missing model ${model}`);
  return match[0];
}

describe('Medication Stock Ledger DB contract', () => {
  it('keeps the additive ledger models tenant scoped and display-id ready', () => {
    for (const model of STOCK_MODELS) {
      const block = readModelBlock(model);

      expect(block, model).toMatch(/\n\s+org_id\s+String(?:\s|$)/);
      expect(block, model).toMatch(/\n\s+display_id\s+String\?(?:\s|$)/);
      expect(block, model).toContain('@@unique([org_id, display_id])');
      expect(block, model).toContain('@@unique([id, org_id])');

      expect(MIGRATION, model).toContain(`CREATE TABLE "${model}"`);
      expect(MIGRATION, model).toContain(`"${model}_org_id_display_id_key"`);
      expect(MIGRATION, model).toContain(`ON "${model}"("org_id", "display_id")`);
    }
  });

  it('pins read-optimized indexes for patient timelines, stock cards, and review queues', () => {
    for (const indexName of REQUIRED_INDEXES) {
      expect(SCHEMA, indexName).toContain(indexName);
      expect(MIGRATION, indexName).toContain(`"${indexName}"`);
    }

    expect(MIGRATION).toContain(
      'ON "MedicationStockEvent"("org_id", "patient_id", "event_at" DESC)',
    );
    expect(MIGRATION).toContain(
      'ON "MedicationStockEvent"("org_id", "stock_item_id", "event_at" DESC)',
    );
    expect(MIGRATION).toContain(
      'ON "ExternalMedicationStockObservation"("org_id", "review_state", "created_at" DESC)',
    );
  });

  it('keeps MedicationStockEvent append-only so corrections remain auditable', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION reject_medication_stock_event_mutation',
    );
    expect(MIGRATION).toContain('CREATE TRIGGER "MedicationStockEvent_no_update"');
    expect(MIGRATION).toContain('CREATE TRIGGER "MedicationStockEvent_no_delete"');
    expect(MIGRATION).toContain('MedicationStockEvent is append-only');
  });

  it('protects every stock table with migration and SSOT RLS policies', () => {
    for (const model of STOCK_MODELS) {
      expect(MIGRATION, model).toContain(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`);
      expect(MIGRATION, model).toContain(`DROP POLICY IF EXISTS tenant_isolation ON "${model}"`);
      expect(MIGRATION, model).toContain(`CREATE POLICY tenant_isolation ON "${model}"`);
      expect(MIGRATION, model).toContain(`ALTER TABLE "${model}" FORCE ROW LEVEL SECURITY`);

      expect(RLS_POLICIES, model).toContain(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`);
      expect(RLS_POLICIES, model).toContain(`CREATE POLICY tenant_isolation ON "${model}"`);
      expect(RLS_POLICIES, model).toContain(`ALTER TABLE "${model}" FORCE ROW LEVEL SECURITY`);
    }
  });

  it('does not store inbound raw text or contact payloads inside stock tables', () => {
    const forbiddenColumns = [
      'raw_text',
      'message_body',
      'message_text',
      'external_url',
      'sender_name',
      'sender_contact',
      'phone_number',
      'email_address',
    ];

    for (const model of STOCK_MODELS) {
      const block = readModelBlock(model);
      for (const column of forbiddenColumns) {
        expect(block, `${model}:${column}`).not.toContain(column);
      }
    }
  });
});
