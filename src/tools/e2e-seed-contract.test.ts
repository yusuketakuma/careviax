import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('E2E seed domain coverage contract', () => {
  const seed = readFileSync('prisma/seed.ts', 'utf8');

  it('keeps representative outpatient injection eligibility records for prescription intake', () => {
    expect(seed).toContain('E2E自己注射対象確認済み注射液');
    expect(seed).toContain('E2E院外不可確認用注射液');
    expect(seed).toContain('outpatient_injection_eligible: true');
    expect(seed).toContain('outpatient_injection_eligible: false');
  });

  it('keeps representative pending care and public subsidy records for billing blockers', () => {
    expect(seed).toContain('介護保険申請中を想定したE2Eデータ');
    expect(seed).toContain("application_status: 'change_pending'");
    expect(seed).toContain("public_program_code: '54'");
    expect(seed).toContain("application_status: 'applying'");
    expect(seed).toContain('自立支援医療公費21の申請中を想定したE2Eデータ');
    expect(seed).toContain("public_program_code: '21'");
    expect(seed).toContain("application_status: 'confirmed'");
  });

  it('keeps representative PCA pump rental records for UI and API verification', () => {
    expect(seed).toContain('PCA-SEED-001');
    expect(seed).toContain('PCA-SEED-002');
    expect(seed).toContain("status: 'available'");
    expect(seed).toContain("status: 'rented'");
    expect(seed).toContain("status: 'active'");
  });
});
