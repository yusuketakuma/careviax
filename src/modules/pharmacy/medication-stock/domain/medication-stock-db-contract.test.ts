import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema/medication.prisma'), 'utf8');
const MIGRATION = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260707090000_add_medication_stock_ledger/migration.sql'),
  'utf8',
);
const VISIT_CONTEXT_MIGRATION = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260708093000_add_medication_stock_visit_observation_context/migration.sql',
  ),
  'utf8',
);
const ALL_MIGRATIONS = `${MIGRATION}\n${VISIT_CONTEXT_MIGRATION}`;
const RLS_POLICIES = readFileSync(join(process.cwd(), 'prisma/rls-policies.sql'), 'utf8');

const STOCK_MODELS = [
  'PatientMedicationStockItem',
  'MedicationStockEvent',
  'MedicationStockObservationContext',
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

const REQUIRED_VISIT_CONTEXT_INDEXES = [
  'MedicationStockObservationContext_org_visit_idx',
  'MedicationStockObservationContext_org_kind_created_idx',
  'MedicationStockObservationContext_org_reason_idx',
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

      expect(ALL_MIGRATIONS, model).toContain(`CREATE TABLE "${model}"`);
      expect(ALL_MIGRATIONS, model).toContain(`"${model}_org_id_display_id_key"`);
      expect(ALL_MIGRATIONS, model).toContain(`ON "${model}"("org_id", "display_id")`);
    }
  });

  it('pins read-optimized indexes for patient timelines, stock cards, and review queues', () => {
    for (const indexName of REQUIRED_INDEXES) {
      expect(SCHEMA, indexName).toContain(indexName);
      expect(MIGRATION, indexName).toContain(`"${indexName}"`);
    }
    for (const indexName of REQUIRED_VISIT_CONTEXT_INDEXES) {
      expect(SCHEMA, indexName).toContain(indexName);
      expect(ALL_MIGRATIONS, indexName).toContain(`"${indexName}"`);
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
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'ON "MedicationStockObservationContext"("org_id", "visit_record_id")',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'ON "MedicationStockObservationContext"("org_id", "context_kind", "created_at" DESC)',
    );
  });

  it('keeps MedicationStockEvent and visit context append-only so corrections remain auditable', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION reject_medication_stock_event_mutation',
    );
    expect(MIGRATION).toContain('CREATE TRIGGER "MedicationStockEvent_no_update"');
    expect(MIGRATION).toContain('CREATE TRIGGER "MedicationStockEvent_no_delete"');
    expect(MIGRATION).toContain('MedicationStockEvent is append-only');

    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION reject_medication_stock_observation_context_mutation',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CREATE TRIGGER "MedicationStockObservationContext_no_update"',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CREATE TRIGGER "MedicationStockObservationContext_no_delete"',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain('MedicationStockObservationContext is append-only');
  });

  it('stores controlled visit observation context in a 1:1 sidecar without overloading event_at', () => {
    const eventBlock = readModelBlock('MedicationStockEvent');
    const contextBlock = readModelBlock('MedicationStockObservationContext');

    for (const eventOnlyForbiddenField of [
      'source_visit_record_id',
      'visit_observation_kind',
      'observed_date_key_jst',
      'last_used_at',
      'last_used_date_key_jst',
      'last_used_precision',
      'unobserved_reason_code',
      'source_context_code',
      'confirmation_level',
    ]) {
      expect(eventBlock, eventOnlyForbiddenField).not.toContain(eventOnlyForbiddenField);
    }

    for (const field of [
      'stock_event_id',
      'context_kind',
      'visit_record_id',
      'observed_date_key_jst',
      'last_used_at',
      'last_used_date_key_jst',
      'last_used_precision',
      'unobserved_reason_code',
      'source_confidence',
      'source_context_code',
      'confirmation_level',
      'idempotency_key_hash',
      'request_fingerprint_hash',
    ]) {
      expect(contextBlock, field).toContain(field);
      expect(VISIT_CONTEXT_MIGRATION, field).toContain(`"${field}"`);
    }

    expect(SCHEMA).toContain('enum MedicationStockObservationContextKind');
    expect(SCHEMA).toContain('enum MedicationStockUnobservedReasonCode');
    expect(contextBlock).toContain('@@unique([org_id, stock_event_id])');
    expect(contextBlock).toContain('@@unique([org_id, idempotency_key_hash])');
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CREATE TYPE "MedicationStockObservationContextKind" AS ENUM',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CREATE TYPE "MedicationStockUnobservedReasonCode" AS ENUM',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CONSTRAINT "MedicationStockObservationContext_stock_event_fkey"',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain('FOREIGN KEY ("stock_event_id", "org_id")');
    expect(VISIT_CONTEXT_MIGRATION).toContain('REFERENCES "MedicationStockEvent"("id", "org_id")');
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CONSTRAINT "MedicationStockObservationContext_visit_record_fkey"',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain('FOREIGN KEY ("visit_record_id", "org_id")');
    expect(VISIT_CONTEXT_MIGRATION).toContain('REFERENCES "VisitRecord"("id", "org_id")');
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CONSTRAINT "MedicationStockObservationContext_visit_record_required_chk"',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CONSTRAINT "MedicationStockObservationContext_observed_date_required_chk"',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain(
      'CONSTRAINT "MedicationStockObservationContext_last_used_context_chk"',
    );
    expect(VISIT_CONTEXT_MIGRATION).toContain("'patient_refused'");
    expect(VISIT_CONTEXT_MIGRATION).toContain("'medication_not_present'");
  });

  it('protects every stock table with migration and SSOT RLS policies', () => {
    for (const model of STOCK_MODELS) {
      expect(ALL_MIGRATIONS, model).toContain(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`);
      expect(ALL_MIGRATIONS, model).toContain(
        `DROP POLICY IF EXISTS tenant_isolation ON "${model}"`,
      );
      expect(ALL_MIGRATIONS, model).toContain(`CREATE POLICY tenant_isolation ON "${model}"`);
      expect(ALL_MIGRATIONS, model).toContain(`ALTER TABLE "${model}" FORCE ROW LEVEL SECURITY`);

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
      'reason_text',
      'free_text',
      'free_text_reason',
      'unobserved_reason_text',
      'raw_reason',
      'note',
    ];

    for (const model of STOCK_MODELS) {
      const block = readModelBlock(model);
      for (const column of forbiddenColumns) {
        expect(block, `${model}:${column}`).not.toContain(column);
      }
    }
  });
});
