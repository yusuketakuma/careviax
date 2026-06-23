// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Actual-backed spies on the shared helpers: keep real encode/guard behavior for
// the hostile-id integration tests AND assert the builders DELEGATE to the shared
// helpers (regression teeth against a reintroduced local encodeURIComponent builder).
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});
vi.mock('@/lib/prescriptions/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/prescriptions/navigation')>();
  return { ...actual, buildPrescriptionHref: vi.fn(actual.buildPrescriptionHref) };
});
vi.mock('@/lib/reports/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/reports/navigation')>();
  return { ...actual, buildReportHref: vi.fn(actual.buildReportHref) };
});

import { buildPatientHref } from '@/lib/patient/navigation';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
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

  it('encodes a malicious id so it cannot escape the /patients/ path segment', () => {
    const row = buildPatientResult({ id: '../settings?x=1#y', name: '田中' });
    expect(row.href).toBe(`/patients/${encodeURIComponent('../settings?x=1#y')}`);
    // raw slash/query/hash がそのまま出ず、別 route へ抜けない。
    expect(row.href).not.toContain('/settings');
    expect(row.href).not.toContain('?x=1');
    expect(row.href).not.toContain('#y');
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

  it('encodes a malicious id so it cannot escape the /prescriptions/ path segment', () => {
    const row = buildPrescriptionResult({ id: '../settings?x=1#y' });
    expect(row.href).toBe(`/prescriptions/${encodeURIComponent('../settings?x=1#y')}`);
    expect(row.href).not.toContain('/settings');
    expect(row.href).not.toContain('?x=1');
    expect(row.href).not.toContain('#y');
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

  it('encodes a malicious id so it cannot escape the /reports/ path segment', () => {
    const row = buildReportResult({
      id: '../settings?x=1#y',
      report_type: 'physician_report',
      status: 'draft',
      created_at: '2026-06-01T00:00:00.000Z',
    });
    expect(row.href).toBe(`/reports/${encodeURIComponent('../settings?x=1#y')}`);
    expect(row.href).not.toContain('/settings');
    expect(row.href).not.toContain('?x=1');
    expect(row.href).not.toContain('#y');
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

  it('encodes a malicious id in the detail query param so it cannot inject extra params/path', () => {
    const row = buildScheduleProposalResult({
      id: '../settings?x=1#y',
      proposal_status: 'patient_contact_pending',
      proposed_date: '2026-06-18',
    });
    expect(row.href).toBe(
      `/schedules/proposals?workspace=dashboard&detail=${encodeURIComponent('../settings?x=1#y')}`,
    );
    // 生の追加パラメータ/パスが detail 値から漏れない。
    expect(row.href).not.toContain('/settings');
    expect(row.href).not.toContain('x=1');
    expect(row.href).not.toContain('#y');
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

describe('search result href helper convergence (F-037)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 各 builder の href が共有 helper の「戻り値」をそのまま使うことを sentinel で証明
  // (helper を validation/副作用だけ呼んで href をローカル再構築する退行を弾く)。
  it('uses each shared helper RETURN VALUE for the row href (not a local reconstruction)', () => {
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__sentinel_patient__');
    expect(buildPatientResult({ id: 'p_42', name: '田中' }).href).toBe(
      '/patients/__sentinel_patient__',
    );
    expect(vi.mocked(buildPatientHref)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith('p_42');

    vi.mocked(buildPrescriptionHref).mockReturnValueOnce('/prescriptions/__sentinel_rx__');
    expect(buildPrescriptionResult({ id: 'rx_42' }).href).toBe('/prescriptions/__sentinel_rx__');
    expect(vi.mocked(buildPrescriptionHref)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildPrescriptionHref)).toHaveBeenCalledWith('rx_42');

    vi.mocked(buildReportHref).mockReturnValueOnce('/reports/__sentinel_report__');
    expect(
      buildReportResult({
        id: 'r_42',
        report_type: 'physician_report',
        status: 'draft',
        created_at: '2026-06-01T00:00:00.000Z',
      }).href,
    ).toBe('/reports/__sentinel_report__');
    expect(vi.mocked(buildReportHref)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildReportHref)).toHaveBeenCalledWith('r_42');
  });

  // 検索結果は API 由来。不正な dot-segment id は null 縮退せず fail-fast(RangeError)。
  // throw が共有 helper 経由であることも spy 呼び出しで証明(local if-throw 退行を弾く)。
  it.each(['.', '..'])(
    'fails fast via the shared patient helper for a dot-segment id (%s)',
    (dotEntityId) => {
      expect(() => buildPatientResult({ id: dotEntityId, name: '田中' })).toThrow(RangeError);
      expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith(dotEntityId);
    },
  );

  it.each(['.', '..'])(
    'fails fast via the shared prescription helper for a dot-segment id (%s)',
    (dotEntityId) => {
      expect(() => buildPrescriptionResult({ id: dotEntityId })).toThrow(RangeError);
      expect(vi.mocked(buildPrescriptionHref)).toHaveBeenCalledWith(dotEntityId);
    },
  );

  it.each(['.', '..'])(
    'fails fast via the shared report helper for a dot-segment id (%s)',
    (dotEntityId) => {
      expect(() =>
        buildReportResult({
          id: dotEntityId,
          report_type: 'physician_report',
          status: 'draft',
          created_at: '2026-06-01T00:00:00.000Z',
        }),
      ).toThrow(RangeError);
      expect(vi.mocked(buildReportHref)).toHaveBeenCalledWith(dotEntityId);
    },
  );
});
