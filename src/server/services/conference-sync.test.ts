import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConferenceSyncService } from './conference-sync';

type EvidenceDetails = {
  claimableHint: boolean;
  missingConditions: string[];
  evidenceNotes: string[];
};

type ConferenceSyncInternals = {
  buildBillingEvidenceDetails: (...args: unknown[]) => Promise<EvidenceDetails>;
  registerBillingCandidate: (...args: unknown[]) => Promise<{ id: string } | null>;
  generateReportDraft: (...args: unknown[]) => Promise<string[]>;
  proposeVisitSchedule: (...args: unknown[]) => Promise<{ id: string } | null>;
};

const internals = ConferenceSyncService as unknown as ConferenceSyncInternals;
const originalBuildBillingEvidenceDetails = internals.buildBillingEvidenceDetails;

describe('ConferenceSyncService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    internals.buildBillingEvidenceDetails = originalBuildBillingEvidenceDetails;
  });

  it('uses the canonical UTC Japan billing month for conference billing candidates', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ id: 'candidate_1' });
    const tx = {
      billingCandidate: {
        upsert: upsertMock,
      },
    };
    internals.buildBillingEvidenceDetails = vi.fn(async () => ({
      claimableHint: true,
      missingConditions: [],
      evidenceNotes: [],
    }));

    const candidate = await internals.registerBillingCandidate(
      tx,
      'org_1',
      {
        id: 'note_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        note_type: 'service_manager',
        title: 'サービス担当者会議',
        conference_date: new Date('2026-02-28T15:30:00.000Z'),
        participants: [],
        structured_content: { sections: [] },
        metadata: {},
        action_items: [],
      },
      'patient_1',
    );

    expect(candidate).toEqual({ id: 'candidate_1' });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_dedupe_key: {
            org_id: 'org_1',
            dedupe_key:
              'conference-billing:org_1:patient_1:MED_INFO_PROVISION_2_HA:2026-03-01:note_1',
          },
        },
        create: expect.objectContaining({
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
          dedupe_key:
            'conference-billing:org_1:patient_1:MED_INFO_PROVISION_2_HA:2026-03-01:note_1',
        }),
        update: expect.objectContaining({
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('resolves conference billing points from the billing-rules registry (regression: no hardcoded drift)', async () => {
    internals.buildBillingEvidenceDetails = vi.fn(async () => ({
      claimableHint: true,
      missingConditions: [],
      evidenceNotes: [],
    }));

    // note_type → 現行レジストリ点数 (2026-03 billing 月 = MEDICAL_2024 有効期間)
    const cases: Array<{ noteType: string; expectedPoints: number }> = [
      { noteType: 'pre_discharge', expectedPoints: 600 },
      { noteType: 'service_manager', expectedPoints: 20 },
      { noteType: 'death_conference', expectedPoints: 2500 },
    ];

    for (const { noteType, expectedPoints } of cases) {
      const upsertMock = vi.fn().mockResolvedValue({ id: 'candidate_1' });
      const tx = { billingCandidate: { upsert: upsertMock } };

      await internals.registerBillingCandidate(
        tx,
        'org_1',
        {
          id: 'note_1',
          case_id: 'case_1',
          patient_id: 'patient_1',
          note_type: noteType,
          title: 'カンファレンス',
          conference_date: new Date('2026-02-28T15:30:00.000Z'),
          participants: [],
          structured_content: { sections: [] },
          metadata: {},
          action_items: [],
        },
        'patient_1',
      );

      const upsertArg = upsertMock.mock.calls[0][0] as {
        create: { points: number; calculation_breakdown: { points: number } };
        update: { points: number };
      };
      expect(upsertArg.create.points).toBe(expectedPoints);
      expect(upsertArg.update.points).toBe(expectedPoints);
      expect(upsertArg.create.calculation_breakdown.points).toBe(expectedPoints);
    }
  });

  it('normalizes generated report draft content in bulk create path', async () => {
    const createManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const findManyMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'report_1', report_type: 'care_manager_report' }]);
    const tx = {
      careReport: {
        findMany: findManyMock,
        createMany: createManyMock,
      },
    };

    const reportIds = await internals.generateReportDraft(
      tx,
      'org_1',
      'user_1',
      {
        id: 'note_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        note_type: 'service_manager',
        title: 'サービス担当者会議',
        content: '会議本文',
        participants: [],
        structured_content: {
          sections: [{ key: 'care_plan_update', label: 'ケアプラン更新', body: '服薬支援を追加' }],
        },
        metadata: {},
        action_items: [],
      },
      'patient_1',
      { reportTypes: ['care_manager_report'] },
    );

    expect(reportIds).toEqual(['report_1']);
    expect(createManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            id: 'crpt_5bd5141b875ed51774f1dd2b7f8dabb2',
            content: expect.objectContaining({
              conference_note_id: 'note_1',
              note_type: 'service_manager',
            }),
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('skips malformed structured sections when generating report drafts', async () => {
    const createManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const findManyMock = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'report_1', report_type: 'care_manager_report' }]);
    const tx = {
      careReport: {
        findMany: findManyMock,
        createMany: createManyMock,
      },
    };

    const reportIds = await internals.generateReportDraft(
      tx,
      'org_1',
      'user_1',
      {
        id: 'note_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        note_type: 'service_manager',
        title: 'サービス担当者会議',
        content: '会議本文',
        participants: [],
        structured_content: {
          sections: [
            ['unexpected'],
            { key: 'care_plan_update', label: 'ケアプラン更新', body: '服薬支援を追加' },
            { key: 'service_adjustments', label: 123, body: 'invalid label' },
          ],
        },
        metadata: {},
        action_items: [],
      },
      'patient_1',
      { reportTypes: ['care_manager_report'] },
    );

    expect(reportIds).toEqual(['report_1']);
    expect(createManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            id: 'crpt_5bd5141b875ed51774f1dd2b7f8dabb2',
            content: expect.objectContaining({
              body: expect.stringContaining('服薬支援を追加'),
              disclosure_scope: expect.objectContaining({
                included_section_keys: ['care_plan_update'],
              }),
            }),
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('normalizes generated report draft content in single create fallback path', async () => {
    const createMock = vi.fn().mockResolvedValue({ id: 'report_1' });
    const tx = {
      careReport: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: createMock,
      },
    };

    const reportIds = await internals.generateReportDraft(
      tx,
      'org_1',
      'user_1',
      {
        id: 'note_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        note_type: 'pre_discharge',
        title: '退院前会議',
        content: '退院前会議本文',
        participants: [],
        structured_content: {
          sections: [{ key: 'medication_summary', label: '薬剤要約', body: '残薬調整あり' }],
        },
        metadata: {},
        action_items: [],
      },
      'patient_1',
      { reportTypes: ['physician_report'] },
    );

    expect(reportIds).toEqual(['report_1']);
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'crpt_7deb6ff5bbe2d6457acec050a74601fb',
        content: expect.objectContaining({
          conference_note_id: 'note_1',
          note_type: 'pre_discharge',
        }),
      }),
    });
  });

  it('derives the no-discharge +7 visit proposal date from the JST civil day on a UTC runtime (N26)', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    vi.useFakeTimers();
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)。new Date()+getUTCDate ベースだと
      // 06-11 起点で +7 が 06-18 になる。JST 民間日 06-12 起点なら 06-19 が正しい。
      vi.setSystemTime(new Date('2026-06-11T23:00:00Z'));

      const createMock = vi.fn().mockResolvedValue({ id: 'proposal_1' });
      const tx = {
        visitScheduleProposal: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: createMock,
        },
      };

      const proposal = await internals.proposeVisitSchedule(
        tx,
        'org_1',
        {
          id: 'note_1',
          case_id: 'case_1',
          patient_id: 'patient_1',
          note_type: 'pre_discharge',
          title: '退院前会議',
          participants: [],
          structured_content: {
            sections: [{ key: 'next_visit_plan', label: '次回訪問予定', body: '週1回で継続' }],
          },
          metadata: {},
          action_items: [],
        },
        'pharmacist_1',
      );

      expect(proposal).toEqual({ id: 'proposal_1' });
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proposed_date: new Date('2026-06-19T00:00:00.000Z'),
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
