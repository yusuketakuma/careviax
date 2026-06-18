// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildPatientResult,
  buildPrescriptionResult,
  buildDrugResult,
  buildFacilityResult,
  buildReportResult,
  buildContactResult,
  buildScheduleProposalResult,
  buildMedicationDeadlineResult,
  SEARCH_CATEGORY_BADGE_CLASSES,
} from './search-result-builders';

describe('buildPatientResult', () => {
  it('builds title with 様 suffix', () => {
    const row = buildPatientResult({ id: 'p1', name: '田中 一郎' });
    expect(row.title).toBe('田中 一郎 様');
    expect(row.href).toBe('/patients/p1');
  });

  it('includes conditions (up to 2) joined with ・ in subtitle', () => {
    const row = buildPatientResult({
      id: 'p1',
      name: '田中',
      conditions: [{ name: '心不全', is_primary: true }, { name: '糖尿病' }, { name: '高血圧' }],
    });
    expect(row.subtitle).toContain('心不全・糖尿病');
    expect(row.subtitle).not.toContain('高血圧');
  });

  it('includes next visit date when visit_schedules present', () => {
    const row = buildPatientResult({
      id: 'p1',
      name: '田中',
      visit_schedules: [{ scheduled_date: '2026-06-17' }],
    });
    expect(row.subtitle).toContain('次回訪問 6/17');
  });

  it('joins conditions and next visit with 。', () => {
    const row = buildPatientResult({
      id: 'p1',
      name: '田中',
      conditions: [{ name: '心不全' }],
      visit_schedules: [{ scheduled_date: '2026-06-17' }],
    });
    expect(row.subtitle).toBe('心不全。次回訪問 6/17');
  });

  it('returns null subtitle when no conditions and no schedules', () => {
    const row = buildPatientResult({ id: 'p1', name: '田中' });
    expect(row.subtitle).toBeNull();
  });

  it('badge is patient category', () => {
    const row = buildPatientResult({ id: 'p1', name: '田中' });
    expect(row.badgeClassName).toBe(SEARCH_CATEGORY_BADGE_CLASSES.patient);
    expect(row.badgeLabel).toBe('患者');
  });
});

describe('buildPrescriptionResult', () => {
  it('title is RX number', () => {
    const row = buildPrescriptionResult({
      id: 'rx9999',
      prescribed_date: '2026-05-01',
    });
    expect(row.title).toMatch(/^RX-202605-/);
  });

  it('subtitle includes institution name and prescribed date', () => {
    const row = buildPrescriptionResult({
      id: 'rx001',
      prescribed_date: '2026-05-20',
      prescriber_institution: { name: '○○医院' },
    });
    expect(row.subtitle).toContain('○○医院');
    expect(row.subtitle).toContain('5/20処方');
  });

  it('subtitle is null when no institution and no date', () => {
    const row = buildPrescriptionResult({ id: 'rx001' });
    expect(row.subtitle).toBeNull();
  });

  it('href goes to /prescriptions/:id', () => {
    const row = buildPrescriptionResult({ id: 'rx001' });
    expect(row.href).toBe('/prescriptions/rx001');
  });
});

describe('buildDrugResult', () => {
  it('title is drug_name', () => {
    const row = buildDrugResult({
      id: 'd1',
      drug_name: 'アムロジピン錠',
      yj_code: '2171013F1024',
    });
    expect(row.title).toBe('アムロジピン錠');
  });

  it('subtitle includes generic_name prefixed with 一般名', () => {
    const row = buildDrugResult({
      id: 'd1',
      drug_name: 'アムロジピン',
      generic_name: 'アムロジピンベシル酸塩',
    });
    expect(row.subtitle).toContain('一般名 アムロジピンベシル酸塩');
  });

  it('subtitle includes therapeutic_category and yj_code', () => {
    const row = buildDrugResult({
      id: 'd1',
      drug_name: 'X',
      therapeutic_category: '循環器官用薬',
      yj_code: '2171',
    });
    expect(row.subtitle).toContain('循環器官用薬');
    expect(row.subtitle).toContain('2171');
  });

  it('subtitle is null when all optional fields absent', () => {
    const row = buildDrugResult({ id: 'd1', drug_name: 'X' });
    expect(row.subtitle).toBeNull();
  });
});

describe('buildFacilityResult', () => {
  it('title is name and subtitle is facility_type', () => {
    const row = buildFacilityResult({
      id: 'f1',
      name: '○○施設',
      facility_type: '特別養護老人ホーム',
    });
    expect(row.title).toBe('○○施設');
    expect(row.subtitle).toBe('特別養護老人ホーム');
  });

  it('subtitle is null when facility_type absent', () => {
    const row = buildFacilityResult({ id: 'f1', name: '施設A' });
    expect(row.subtitle).toBeNull();
  });
});

describe('buildReportResult', () => {
  it('title includes date and report type label', () => {
    const row = buildReportResult({
      id: 'r1',
      report_type: 'physician_report',
      status: 'sent',
      created_at: '2026-05-20T00:00:00.000Z',
    });
    expect(row.title).toContain('医師向け報告書');
    expect(row.title).toContain('5/20');
    expect(row.subtitle).toBe('送付済');
  });

  it('prefixes patient name when provided', () => {
    const row = buildReportResult(
      {
        id: 'r1',
        report_type: 'physician_report',
        status: 'draft',
        created_at: '2026-05-20T00:00:00.000Z',
      },
      '田中 一郎',
    );
    expect(row.title).toContain('田中 一郎 様');
  });

  it('uses 報告書 fallback when report_type is unknown', () => {
    const row = buildReportResult({
      id: 'r1',
      report_type: 'unknown_type',
      status: 'draft',
      created_at: '2026-06-01T00:00:00.000Z',
    });
    expect(row.title).toContain('報告書');
  });
});

describe('buildContactResult', () => {
  it('title is name and subtitle is row.subtitle', () => {
    const row = buildContactResult({
      id: 'c1',
      name: '山田 医師',
      subtitle: '○○クリニック / 内科',
    });
    expect(row.title).toBe('山田 医師');
    expect(row.subtitle).toBe('○○クリニック / 内科');
  });

  it('subtitle is null when absent', () => {
    const row = buildContactResult({ id: 'c1', name: '山田' });
    expect(row.subtitle).toBeNull();
  });

  it('href goes to contact-profiles with encoded name', () => {
    const row = buildContactResult({ id: 'c1', name: '山田 医師' });
    expect(row.href).toContain('/admin/contact-profiles');
    expect(row.href).toContain(encodeURIComponent('山田 医師'));
  });
});

describe('buildScheduleProposalResult', () => {
  it('builds a proposal row linked to the existing schedule proposal detail', () => {
    const row = buildScheduleProposalResult({
      id: 'proposal_1',
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'pending',
      proposed_date: '2026-06-18',
      time_window_start: '2026-06-18T09:00:00.000+09:00',
      time_window_end: '2026-06-18T10:00:00.000+09:00',
      proposed_pharmacist: { name: '佐藤 薬剤師' },
      case_: { patient: { id: 'p1', name: '田中 一郎' } },
    });

    expect(row.badgeClassName).toBe(SEARCH_CATEGORY_BADGE_CLASSES.proposal);
    expect(row.badgeLabel).toBe('訪問候補');
    expect(row.title).toBe('田中 一郎 様の訪問候補');
    expect(row.subtitle).toContain('架電待ち');
    expect(row.subtitle).toContain('未架電');
    expect(row.subtitle).toContain('佐藤 薬剤師');
    expect(row.href).toBe('/schedules/proposals?workspace=dashboard&detail=proposal_1');
  });
});

describe('buildMedicationDeadlineResult', () => {
  it('builds a medication deadline row linked to the schedule day', () => {
    const row = buildMedicationDeadlineResult({
      id: 'schedule_1',
      case_id: 'case_1',
      scheduled_date: '2026-06-18T00:00:00.000Z',
      medication_end_date: '2026-06-20T00:00:00.000Z',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      case_: { patient: { id: 'p1', name: '田中 一郎' } },
    });

    expect(row.badgeClassName).toBe(SEARCH_CATEGORY_BADGE_CLASSES.medicationDeadline);
    expect(row.badgeLabel).toBe('薬切れ');
    expect(row.title).toBe('田中 一郎 様の薬切れ予定');
    expect(row.subtitle).toContain('薬切れ 6/20');
    expect(row.subtitle).toContain('訪問予定 6/18');
    expect(row.href).toBe('/schedules?date=2026-06-18');
  });
});
