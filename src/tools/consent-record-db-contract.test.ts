import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = join(
  process.cwd(),
  'prisma/migrations/20260619153500_redact_consent_record_audit_document_url/migration.sql',
);

describe('ConsentRecord DB audit contract', () => {
  it('redacts consent document URLs from trigger audit rows', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('ph_os_redact_consent_record_audit_row');
    expect(sql).toContain("- 'document_url'");
    expect(sql).toContain("- 'obtained_date'");
    expect(sql).toContain("- 'expiry_date'");
    expect(sql).toContain("- 'revoked_date'");

    for (const summaryKey of [
      'has_document_url',
      'document_url_audited',
      'document_url_redacted',
      'document_source',
      'has_obtained_date',
      'has_expiry_date',
      'has_revoked_date',
    ]) {
      expect(sql).toContain(`'${summaryKey}'`);
    }

    expect(sql).toContain('ph_os_write_consent_record_audit_log');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION ph_os_write_consent_record_audit_log()');
    expect(sql).not.toContain(
      'CREATE TRIGGER audit_log_consent_record\nAFTER INSERT OR UPDATE OR DELETE ON "ConsentRecord"\nFOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log()',
    );
  });
});
