import { beforeEach, describe, expect, it, vi } from 'vitest';

// Actual-backed spies: keep real encode/guard output for the existing exact-output
// + MCS hostile tests, AND let the convergence teeth assert delegation/return-value.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});
vi.mock('@/lib/reports/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/reports/navigation')>();
  return { ...actual, buildReportHref: vi.fn(actual.buildReportHref) };
});

import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import {
  getManagementPlanPrintShortcutLinks,
  getMyDayShortcutLinks,
  getPatientConsentShortcutLinks,
  getPatientEditShortcutLinks,
  getPatientHubShortcutLinks,
  getPatientMcsShortcutLinks,
  getPatientMedicationCalendarShortcutLinks,
  getPatientMedicationPrintShortcutLinks,
  getPatientMedicationShortcutLinks,
  getPatientNewShortcutLinks,
  getPatientPrescriptionShortcutLinks,
  getPatientShareShortcutLinks,
  getPatientVisitRecordPrintShortcutLinks,
  getQrScanShortcutLinks,
  getReferralShortcutLinks,
  getReportDetailShortcutLinks,
  getReportsOverviewShortcutLinks,
  getReportPrintShortcutLinks,
  getScheduleProposalShortcutLinks,
  getSettingsShortcutLinks,
  getVisitDetailShortcutLinks,
} from './page-shortcut-presets';

describe('page shortcut presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds patient context shortcuts around the current patient id', () => {
    expect(getPatientHubShortcutLinks('p1')).toEqual([
      { href: '/patients/p1/edit', label: '患者情報編集', group: '基本情報' },
      { href: '/patients/p1/prescriptions', label: '処方履歴', group: '服薬・経過' },
      { href: '/patients/p1/medications', label: '服薬管理', group: '服薬・経過' },
      { href: '/patients/p1/medication-calendar', label: '服薬カレンダー', group: '服薬・経過' },
      { href: '/patients/p1/consent', label: '同意記録', group: '連携・共有' },
      { href: '/patients/p1/mcs', label: 'MCS連携', group: '連携・共有' },
      { href: '/patients/p1/share', label: '外部共有', group: '連携・共有' },
    ]);

    expect(getPatientMedicationShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/prescriptions', label: '処方履歴' },
      { href: '/patients/p1/mcs', label: 'MCS連携' },
      { href: '/patients/p1/medication-calendar', label: '服薬カレンダー' },
    ]);

    expect(getPatientPrescriptionShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/medications', label: '服薬管理' },
      { href: '/prescriptions/new?patient_id=p1', label: '処方受付' },
    ]);

    expect(getPatientShareShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/mcs', label: 'MCS連携' },
      { href: '/patients/p1/consent', label: '同意記録' },
      { href: '/external', label: '外部連携' },
    ]);

    expect(getPatientMcsShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/medications', label: '服薬管理' },
      { href: '/patients/p1/prescriptions', label: '処方履歴' },
      { href: '/patients/p1/share', label: '外部共有' },
    ]);

    expect(getPatientConsentShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/mcs', label: 'MCS連携' },
      { href: '/patients/p1/share', label: '外部共有' },
      { href: '/patients/p1/medications', label: '服薬管理' },
    ]);

    expect(getPatientMedicationCalendarShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/medications', label: '服薬管理' },
      { href: '/patients/p1/prescriptions', label: '処方履歴' },
    ]);

    expect(getPatientEditShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/prescriptions', label: '処方履歴' },
      { href: '/patients/p1/medications', label: '服薬管理' },
      { href: '/patients/p1/consent', label: '同意記録' },
    ]);
  });

  it('encodes patient path segments for MCS page shortcuts', () => {
    const patientId = '../settings?x=1#frag';
    const encodedPatientId = encodeURIComponent(patientId);

    const shortcuts = getPatientMcsShortcutLinks(patientId);

    expect(shortcuts).toEqual([
      { href: `/patients/${encodedPatientId}`, label: '患者詳細' },
      { href: `/patients/${encodedPatientId}/medications`, label: '服薬管理' },
      { href: `/patients/${encodedPatientId}/prescriptions`, label: '処方履歴' },
      { href: `/patients/${encodedPatientId}/share`, label: '外部共有' },
    ]);
    for (const shortcut of shortcuts) {
      expect(shortcut.href).not.toContain(patientId);
    }
  });

  it('builds visit and referral shortcuts with stable targets', () => {
    expect(getVisitDetailShortcutLinks('visit-1')).toEqual([
      { href: '/reports', label: '報告書' },
      { href: '/handoff', label: '申し送り確認' },
      { href: '/schedules', label: 'スケジュール' },
    ]);

    expect(getReferralShortcutLinks()).toEqual([
      { href: '/patients', label: '患者一覧' },
      { href: '/patients/new', label: '患者新規登録' },
      { href: '/prescriptions/new', label: '新規処方受付' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getPatientNewShortcutLinks()).toEqual([
      { href: '/referrals/new', label: '紹介受付' },
      { href: '/prescriptions/new', label: '新規処方受付' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getScheduleProposalShortcutLinks()).toEqual([
      { href: '/schedules', label: '日次スケジュール' },
      { href: '/communications/requests', label: '依頼・照会' },
      { href: '/visits', label: '訪問記録' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getQrScanShortcutLinks()).toEqual([
      { href: '/prescriptions/qr-drafts', label: 'QR下書き一覧' },
      { href: '/prescriptions/new', label: '処方受付' },
      { href: '/referrals/new', label: '紹介受付' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getMyDayShortcutLinks()).toEqual([
      { href: '/visits', label: '訪問記録' },
      { href: '/tasks', label: 'タスク' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getSettingsShortcutLinks()).toEqual([
      { href: '/dashboard', label: 'ホーム' },
      { href: '/my-day', label: 'My Day' },
      { href: '/qr-scan', label: 'QRスキャン' },
    ]);

    expect(getReportsOverviewShortcutLinks()).toEqual([
      { href: '/reports/print', label: '帳票・印刷' },
      { href: '/communications/requests', label: '依頼・照会' },
      { href: '/external', label: '外部連携' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getReportDetailShortcutLinks('patient_1', 'report_1')).toEqual([
      { href: '/reports', label: '報告書一覧' },
      { href: '/patients/patient_1', label: '患者詳細' },
      {
        href: '/communications/requests?patient_id=patient_1&related_entity_type=care_report&related_entity_id=report_1',
        label: '関連依頼',
      },
      { href: '/external', label: '外部連携' },
    ]);

    expect(getReportDetailShortcutLinks(null)).toEqual([
      { href: '/reports', label: '報告書一覧' },
      { href: '/external', label: '外部連携' },
    ]);

    expect(getReportPrintShortcutLinks('report_1')).toEqual([
      { href: '/reports/report_1', label: '報告書詳細' },
      {
        href: '/communications/requests?related_entity_type=care_report&related_entity_id=report_1',
        label: '関連依頼',
      },
      { href: '/reports', label: '報告書一覧' },
      { href: '/external', label: '外部連携' },
    ]);

    expect(getManagementPlanPrintShortcutLinks('patient_1')).toEqual([
      { href: '/patients/patient_1', label: '患者詳細' },
      { href: '/reports', label: '報告書' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getPatientMedicationPrintShortcutLinks('patient_1')).toEqual([
      { href: '/patients/patient_1/medications', label: '服薬管理' },
      { href: '/patients/patient_1/medication-calendar', label: '服薬カレンダー' },
      { href: '/patients/patient_1', label: '患者詳細' },
    ]);

    expect(getPatientVisitRecordPrintShortcutLinks('patient_1')).toEqual([
      { href: '/patients/patient_1', label: '患者詳細' },
      { href: '/visits', label: '訪問一覧' },
      { href: '/reports', label: '報告書' },
    ]);
  });

  describe('shared href helper convergence (F-039)', () => {
    it('uses the shared helper RETURN VALUE for patient/report shortcut hrefs (not local reconstruction)', () => {
      vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__sentinel_plain__');
      expect(getManagementPlanPrintShortcutLinks('p1')[0].href).toBe(
        '/patients/__sentinel_plain__',
      );
      expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith('p1');

      vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__sentinel_suffix__');
      expect(getPatientHubShortcutLinks('p1')[0].href).toBe('/patients/__sentinel_suffix__');
      expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith('p1', '/edit');

      vi.mocked(buildReportHref).mockReturnValueOnce('/reports/__sentinel_report__');
      expect(getReportPrintShortcutLinks('report_1')[0].href).toBe('/reports/__sentinel_report__');
      expect(vi.mocked(buildReportHref)).toHaveBeenCalledWith('report_1');
    });

    // EVERY patient preset helper must delegate each /patients href to buildPatientHref
    // with the exact (id[, suffix]) - a local reconstruction in any uncovered helper would
    // pass the normal exact-output tests but produce zero/incorrect helper calls here.
    const patientDelegationCases: Array<[string, () => unknown, Array<[string, string?]>]> = [
      [
        'getPatientHubShortcutLinks',
        () => getPatientHubShortcutLinks('p_42'),
        [
          ['p_42', '/edit'],
          ['p_42', '/prescriptions'],
          ['p_42', '/medications'],
          ['p_42', '/medication-calendar'],
          ['p_42', '/consent'],
          ['p_42', '/mcs'],
          ['p_42', '/share'],
        ],
      ],
      [
        'getPatientEditShortcutLinks',
        () => getPatientEditShortcutLinks('p_42'),
        [['p_42'], ['p_42', '/prescriptions'], ['p_42', '/medications'], ['p_42', '/consent']],
      ],
      [
        'getPatientMedicationShortcutLinks',
        () => getPatientMedicationShortcutLinks('p_42'),
        [['p_42'], ['p_42', '/prescriptions'], ['p_42', '/mcs'], ['p_42', '/medication-calendar']],
      ],
      [
        'getPatientPrescriptionShortcutLinks',
        () => getPatientPrescriptionShortcutLinks('p_42'),
        [['p_42'], ['p_42', '/medications']],
      ],
      [
        'getPatientShareShortcutLinks',
        () => getPatientShareShortcutLinks('p_42'),
        [['p_42'], ['p_42', '/mcs'], ['p_42', '/consent']],
      ],
      [
        'getPatientMcsShortcutLinks',
        () => getPatientMcsShortcutLinks('p_42'),
        [['p_42'], ['p_42', '/medications'], ['p_42', '/prescriptions'], ['p_42', '/share']],
      ],
      [
        'getPatientConsentShortcutLinks',
        () => getPatientConsentShortcutLinks('p_42'),
        [['p_42'], ['p_42', '/mcs'], ['p_42', '/share'], ['p_42', '/medications']],
      ],
      [
        'getPatientMedicationCalendarShortcutLinks',
        () => getPatientMedicationCalendarShortcutLinks('p_42'),
        [['p_42'], ['p_42', '/medications'], ['p_42', '/prescriptions']],
      ],
      [
        'getReportDetailShortcutLinks',
        () => getReportDetailShortcutLinks('p_42', 'r_1'),
        [['p_42']],
      ],
      [
        'getManagementPlanPrintShortcutLinks',
        () => getManagementPlanPrintShortcutLinks('p_42'),
        [['p_42']],
      ],
      [
        'getPatientMedicationPrintShortcutLinks',
        () => getPatientMedicationPrintShortcutLinks('p_42'),
        [['p_42', '/medications'], ['p_42', '/medication-calendar'], ['p_42']],
      ],
      [
        'getPatientVisitRecordPrintShortcutLinks',
        () => getPatientVisitRecordPrintShortcutLinks('p_42'),
        [['p_42']],
      ],
    ];

    it.each(patientDelegationCases)(
      '%s delegates every patient href to buildPatientHref (return value used, exact id/suffix)',
      (_name, run, expectedCalls) => {
        // sentinel impl proves the returned href IS the helper's return value (not a
        // local reconstruction that merely calls the helper). Capture+restore the real
        // (actual-backed) impl so this does not leak into other tests.
        const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
        vi.mocked(buildPatientHref).mockImplementation(
          (id: string, suffix = '') => `/patients/__sentinel_${id}__${suffix}`,
        );
        try {
          const links = run() as { href: string }[];
          const expectedHrefs = expectedCalls.map(
            ([id, suffix]) => `/patients/__sentinel_${id}__${suffix ?? ''}`,
          );
          const patientHrefs = links
            .map((link) => link.href)
            .filter((href) => href.startsWith('/patients/__sentinel_'));
          expect(patientHrefs).toEqual(expectedHrefs);
          expect(vi.mocked(buildPatientHref).mock.calls).toEqual(expectedCalls);
        } finally {
          if (realImpl) {
            vi.mocked(buildPatientHref).mockImplementation(realImpl);
          }
        }
      },
    );

    it('encodes hostile patient ids in suffixed hub shortcuts via the shared helper', () => {
      const hostilePatientId = '../settings?x=1#y';
      const links = getPatientHubShortcutLinks(hostilePatientId);
      expect(links[0].href).toBe(`/patients/${encodeURIComponent(hostilePatientId)}/edit`);
      for (const link of links) {
        expect(link.href).not.toContain('/settings');
        expect(link.href).not.toContain('?x=1');
        expect(link.href).not.toContain('#y');
      }
    });

    it('encodes patient ids in the prescription intake query shortcut', () => {
      const hostilePatientId = 'patient/1?tab=x#frag';
      const links = getPatientPrescriptionShortcutLinks(hostilePatientId);
      const intakeHref = links.find((link) => link.label === '処方受付')?.href;

      expect(intakeHref).toBe(
        `/prescriptions/new?${new URLSearchParams({ patient_id: hostilePatientId }).toString()}`,
      );
      expect(intakeHref).toBe('/prescriptions/new?patient_id=patient%2F1%3Ftab%3Dx%23frag');
      expect(intakeHref).not.toContain('?tab=x');
      expect(intakeHref).not.toContain('#frag');
    });

    // preset helpers are consumed by UI; dot-segment ids fail fast via the shared
    // guard (RangeError) rather than degrading - the throw must come THROUGH the helper.
    it.each(['.', '..'])(
      'fails fast via the shared patient helper for a dot-segment patient id (%s)',
      (dotPatientId) => {
        expect(() => getPatientHubShortcutLinks(dotPatientId)).toThrow(RangeError);
        expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith(dotPatientId, '/edit');
      },
    );

    it.each(['.', '..'])(
      'fails fast via the shared report helper for a dot-segment report id (%s)',
      (dotReportId) => {
        expect(() => getReportPrintShortcutLinks(dotReportId)).toThrow(RangeError);
        expect(vi.mocked(buildReportHref)).toHaveBeenCalledWith(dotReportId);
      },
    );
  });
});
