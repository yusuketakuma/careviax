import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = join(
  process.cwd(),
  'prisma/migrations/20260619110800_add_pharmacy_partnership_foundation/migration.sql',
);
const PATIENT_SHARE_CONSENT_AUDIT_MIGRATION_PATH = join(
  process.cwd(),
  'prisma/migrations/20260619173403_redact_patient_share_consent_audit/migration.sql',
);

describe('pharmacy partnership DB audit contract', () => {
  it('redacts patient-link snapshots and correction free text from trigger audit rows', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('ph_os_write_patient_link_audit_log');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION ph_os_write_patient_link_audit_log()');
    expect(sql).toContain("- 'base_patient_snapshot'");
    expect(sql).toContain("- 'partner_patient_snapshot'");
    expect(sql).toContain("- 'decline_reason'");

    expect(sql).toContain('ph_os_write_patient_share_correction_request_audit_log');
    expect(sql).toContain(
      'FOR EACH ROW EXECUTE FUNCTION ph_os_write_patient_share_correction_request_audit_log()',
    );
    expect(sql).toContain("- 'reason'");
    expect(sql).toContain("- 'proposed_value'");
    expect(sql).toContain("- 'response_note'");
    expect(sql).toContain("'reason_length'");
    expect(sql).toContain("'has_proposed_value'");
    expect(sql).toContain("'response_note_length'");
  });

  it('redacts patient-share consent person, scope, file, consent ids, and dates from trigger audit rows', () => {
    const sql = readFileSync(PATIENT_SHARE_CONSENT_AUDIT_MIGRATION_PATH, 'utf8');

    expect(sql).toContain('ph_os_redact_patient_share_consent_audit_row');
    expect(sql).toContain('ph_os_write_patient_share_consent_audit_log');
    expect(sql).toContain(
      'FOR EACH ROW EXECUTE FUNCTION ph_os_write_patient_share_consent_audit_log()',
    );

    for (const column of [
      'consent_person',
      'consent_date',
      'scope',
      'file_asset_id',
      'consent_record_id',
      'valid_until',
      'revoked_at',
    ]) {
      expect(sql).toContain(`- '${column}'`);
    }

    for (const summaryKey of [
      'consent_person_length',
      'has_consent_date',
      'scope_key_count',
      'scope_keys',
      'has_file_asset',
      'has_consent_record',
      'has_valid_until',
      'has_revoked_at',
    ]) {
      expect(sql).toContain(`'${summaryKey}'`);
    }

    expect(sql).not.toContain(
      'CREATE TRIGGER audit_log_patient_share_consent\nAFTER INSERT OR UPDATE OR DELETE ON "PatientShareConsent"\nFOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log()',
    );
  });

  it('redacts clinical visit request, partner visit record, and claim note trigger audit rows', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('ph_os_write_pharmacy_partnership_clinical_audit_log');
    expect(sql).toContain(
      'FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_partnership_clinical_audit_log()',
    );

    for (const column of [
      'request_reason',
      'physician_instruction',
      'patient_home_notes',
      'decline_reason',
      'record_content',
      'attachments',
      'returned_reason',
      'base_confirmation_snapshot',
      'prescription_received_by',
      'claim_note_text',
    ]) {
      expect(sql).toContain(`- '${column}'`);
    }

    for (const summaryKey of [
      'request_reason_length',
      'physician_instruction_length',
      'patient_home_notes_length',
      'decline_reason_length',
      'has_record_content',
      'has_attachments',
      'returned_reason_length',
      'has_base_confirmation_snapshot',
      'prescription_received_by_length',
      'claim_note_text_length',
    ]) {
      expect(sql).toContain(`'${summaryKey}'`);
    }
  });

  it('keeps pharmacy invoice document kind and active document uniqueness in the migration', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain(
      "CREATE TYPE \"PharmacyInvoiceDocumentKind\" AS ENUM ('invoice', 'free_cooperation_report')",
    );
    expect(sql).toContain(
      '"document_kind" "PharmacyInvoiceDocumentKind" NOT NULL DEFAULT \'invoice\'',
    );
    expect(sql).toContain('CREATE UNIQUE INDEX "PharmacyInvoice_active_document_unique_idx"');
    expect(sql).toContain('"org_id", "contract_id", "billing_month", "document_kind"');
    expect(sql).toContain(
      "WHERE \"status\" IN ('draft', 'issued', 'sent', 'received', 'payment_scheduled', 'paid')",
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "PharmacyInvoiceItem_org_id_visit_billing_candidate_id_key"',
    );
    expect(sql).toContain('"org_id", "visit_billing_candidate_id"');
  });

  it('links physician reports back to partner visit records with DB uniqueness', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('ALTER TABLE "CareReport" ADD COLUMN "partner_visit_record_id" TEXT');
    expect(sql).toContain('CREATE UNIQUE INDEX "CareReport_org_partner_visit_report_type_key"');
    expect(sql).toContain('"org_id", "partner_visit_record_id", "report_type"');
    expect(sql).toContain(
      'ALTER TABLE "CareReport" ADD CONSTRAINT "CareReport_partner_visit_record_id_org_id_fkey"',
    );
    expect(sql).toContain('REFERENCES "PartnerVisitRecord"("id", "org_id")');
  });

  it('redacts invoice and billing candidate snapshots from trigger audit rows', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('ph_os_write_pharmacy_billing_audit_log');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION ph_os_write_pharmacy_billing_audit_log()');

    for (const column of [
      'partner_visit_record_id',
      'amount_snapshot',
      'issuer_snapshot',
      'recipient_snapshot',
      'description',
      'snapshot',
      'visit_billing_candidate_id',
    ]) {
      expect(sql).toContain(`- '${column}'`);
    }

    for (const summaryKey of [
      'amount_snapshot_billing_model',
      'amount_snapshot_blocker_count',
      'snapshot_candidate_count',
      'snapshot_patient_display_mode',
      'description_length',
      'has_visit_billing_candidate_id',
    ]) {
      expect(sql).toContain(`'${summaryKey}'`);
    }
  });
});
