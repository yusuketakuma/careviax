import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('care report database contract', () => {
  it('keeps the visit/report-type uniqueness contract documented and migrated', () => {
    const schema = readFileSync('prisma/schema/communication.prisma', 'utf8');
    const migration = readFileSync(
      'prisma/migrations/20260512021000_add_care_report_visit_type_unique_index/migration.sql',
      'utf8',
    );

    expect(schema).toContain('CareReport_org_visit_record_report_type_unique_idx');
    expect(migration).toContain('CareReport_org_visit_record_report_type_unique_idx');
    expect(migration).toContain('("org_id", "visit_record_id", "report_type")');
    expect(migration).toContain('WHERE "visit_record_id" IS NOT NULL');
  });
});
