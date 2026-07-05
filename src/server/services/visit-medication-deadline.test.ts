import { describe, expect, it } from 'vitest';
import type { OperatingCalendar } from '@/lib/calendar/operating-day';

import {
  isPrescriptionLineAsNeeded,
  resolveMedicationDeadlineSummary,
  resolveVisitDeadlinePolicy,
} from './visit-medication-deadline';

function buildWeekdayCalendar(holidayKeys: string[] = []): OperatingCalendar {
  return {
    siteId: 'site_1',
    weekly: [
      { weekday: 0, is_open: false, open_time: null, close_time: null },
      { weekday: 1, is_open: true, open_time: null, close_time: null },
      { weekday: 2, is_open: true, open_time: null, close_time: null },
      { weekday: 3, is_open: true, open_time: null, close_time: null },
      { weekday: 4, is_open: true, open_time: null, close_time: null },
      { weekday: 5, is_open: true, open_time: null, close_time: null },
      { weekday: 6, is_open: false, open_time: null, close_time: null },
    ],
    holidays: new Map(
      holidayKeys.map((dateKey) => [
        dateKey,
        [
          {
            date: dateKey,
            site_id: null,
            is_closed: true,
          },
        ],
      ]),
    ),
  };
}

describe('resolveMedicationDeadlineSummary', () => {
  it('uses the earliest continuing non-PRN line end date inclusively', () => {
    const summary = resolveMedicationDeadlineSummary([
      {
        refill_next_dispense_date: null,
        split_next_dispense_date: null,
        lines: [
          {
            drug_name: '疼痛時薬',
            frequency: '疼痛時',
            end_date: new Date('2026-03-24T00:00:00.000Z'),
          },
          {
            drug_name: '継続薬A',
            frequency: '朝食後',
            end_date: new Date('2026-03-30T00:00:00.000Z'),
          },
          {
            drug_name: '継続薬B',
            frequency: '夕食後',
            start_date: new Date('2026-03-20T00:00:00.000Z'),
            days: 20,
          },
        ],
      },
    ]);

    expect(summary.medicationEndDate).toEqual(new Date('2026-03-30T00:00:00.000Z'));
    expect(summary.visitDeadlineDate).toEqual(new Date('2026-03-30T00:00:00.000Z'));
  });

  it('folds medication, next dispensing, and visit-record suggestion dates by minimum', () => {
    const summary = resolveMedicationDeadlineSummary(
      [
        {
          refill_next_dispense_date: new Date('2026-04-04T00:00:00.000Z'),
          split_next_dispense_date: new Date('2026-04-06T00:00:00.000Z'),
          lines: [
            {
              drug_name: '継続薬',
              frequency: '朝食後',
              start_date: new Date('2026-03-20T00:00:00.000Z'),
              days: 20,
            },
          ],
        },
      ],
      {
        nextVisitSuggestionDate: new Date('2026-04-02T00:00:00.000Z'),
      },
    );

    expect(summary.medicationEndDate).toEqual(new Date('2026-04-08T00:00:00.000Z'));
    expect(summary.nextDispenseDate).toEqual(new Date('2026-04-04T00:00:00.000Z'));
    expect(summary.nextVisitSuggestionDate).toEqual(new Date('2026-04-02T00:00:00.000Z'));
    expect(summary.visitDeadlineDate).toEqual(new Date('2026-04-02T00:00:00.000Z'));
  });

  it('does not treat non-PRN topical continuing medication as as-needed', () => {
    expect(
      isPrescriptionLineAsNeeded({
        drug_name: '貼付剤',
        route: 'external',
        dosage_form: '貼付剤',
        frequency: '1日1回',
      }),
    ).toBe(false);
    expect(
      isPrescriptionLineAsNeeded({
        drug_name: '疼痛時外用薬',
        route: 'external',
        dosage_form: '軟膏',
        frequency: '必要時',
      }),
    ).toBe(true);
  });
});

describe('resolveVisitDeadlinePolicy', () => {
  it('adjusts a Sunday raw deadline to the previous operating day then applies the buffer', () => {
    const policy = resolveVisitDeadlinePolicy(
      [
        {
          id: 'intake_1',
          lines: [
            {
              id: 'line_1',
              drug_master_id: 'drug_1',
              drug_code: 'YJ001',
              drug_name: '継続薬',
              frequency: '朝食後',
              end_date: new Date('2026-04-12T00:00:00.000Z'),
            },
          ],
        },
      ],
      {
        planningStartDateKey: '2026-04-01',
        operatingCalendar: buildWeekdayCalendar(),
        safetyBufferOperatingDays: 1,
      },
    );

    expect(policy.rawDeadlineDateKey).toBe('2026-04-12');
    expect(policy.latestVisitableDateKey).toBe('2026-04-10');
    expect(policy.recommendedDeadlineDateKey).toBe('2026-04-09');
    expect(policy.deadlineCandidates).toEqual([
      expect.objectContaining({
        source_kind: 'regular_medication_end',
        prescription_intake_id: 'intake_1',
        prescription_line_id: 'line_1',
        drug_master_id: 'drug_1',
        drug_code: 'YJ001',
        raw_date_key: '2026-04-12',
        adjusted_date_key: '2026-04-10',
        confidence: 'high',
        requires_pharmacist_review: false,
      }),
    ]);
    expect(policy.diagnostics).toEqual(
      expect.arrayContaining([
        { code: 'deadline_raw', date_key: '2026-04-12' },
        {
          code: 'deadline_adjusted_to_operating_day',
          from_date_key: '2026-04-12',
          to_date_key: '2026-04-10',
        },
        {
          code: 'deadline_buffer_applied',
          from_date_key: '2026-04-10',
          to_date_key: '2026-04-09',
          value: 1,
        },
      ]),
    );
  });

  it('moves a holiday-chain deadline before the closure and then applies the buffer', () => {
    const policy = resolveVisitDeadlinePolicy(
      [
        {
          lines: [
            {
              id: 'line_1',
              drug_master_id: 'drug_1',
              frequency: '朝食後',
              end_date: new Date('2026-05-06T00:00:00.000Z'),
            },
          ],
        },
      ],
      {
        planningStartDateKey: '2026-04-20',
        operatingCalendar: buildWeekdayCalendar(['2026-05-04', '2026-05-05', '2026-05-06']),
        safetyBufferOperatingDays: 1,
      },
    );

    expect(policy.rawDeadlineDateKey).toBe('2026-05-06');
    expect(policy.latestVisitableDateKey).toBe('2026-05-01');
    expect(policy.recommendedDeadlineDateKey).toBe('2026-04-30');
  });

  it('marks overdue deadlines as ASAP at the planning start date', () => {
    const policy = resolveVisitDeadlinePolicy(
      [
        {
          lines: [
            {
              id: 'line_1',
              drug_master_id: 'drug_1',
              frequency: '朝食後',
              end_date: new Date('2026-04-06T00:00:00.000Z'),
            },
          ],
        },
      ],
      {
        planningStartDateKey: '2026-04-10',
        operatingCalendar: buildWeekdayCalendar(),
        safetyBufferOperatingDays: 0,
      },
    );

    expect(policy.latestVisitableDateKey).toBe('2026-04-06');
    expect(policy.recommendedDeadlineDateKey).toBe('2026-04-10');
    expect(policy.diagnostics).toEqual(
      expect.arrayContaining([
        {
          code: 'deadline_overdue_asap',
          from_date_key: '2026-04-06',
          to_date_key: '2026-04-10',
        },
      ]),
    );
  });

  it('returns no deadline when no raw candidates exist', () => {
    const policy = resolveVisitDeadlinePolicy([], {
      planningStartDateKey: '2026-04-01',
      operatingCalendar: buildWeekdayCalendar(),
      safetyBufferOperatingDays: 1,
    });

    expect(policy).toMatchObject({
      rawDeadlineDateKey: null,
      latestVisitableDateKey: null,
      recommendedDeadlineDateKey: null,
      deadlineCandidates: [],
      diagnostics: [{ code: 'deadline_no_candidates' }],
      reviewReasons: [],
    });
  });

  it('does not invent a buffered date when operating-day scanning is exhausted', () => {
    const policy = resolveVisitDeadlinePolicy(
      [
        {
          lines: [
            {
              id: 'line_1',
              drug_master_id: 'drug_1',
              frequency: '朝食後',
              end_date: new Date('2026-04-06T00:00:00.000Z'),
            },
          ],
        },
      ],
      {
        planningStartDateKey: '2026-04-01',
        operatingCalendar: buildWeekdayCalendar(),
        safetyBufferOperatingDays: 1,
        maxScanDays: 0,
      },
    );

    expect(policy.latestVisitableDateKey).toBe('2026-04-06');
    expect(policy.recommendedDeadlineDateKey).toBe('2026-04-06');
    expect(policy.diagnostics).toEqual(
      expect.arrayContaining([
        {
          code: 'deadline_buffer_scan_exhausted',
          date_key: '2026-04-06',
          value: 1,
        },
      ]),
    );
  });

  it('excludes PRN lines from policy candidates and records an informational review reason', () => {
    const policy = resolveVisitDeadlinePolicy(
      [
        {
          id: 'intake_1',
          lines: [
            {
              id: 'line_prn',
              drug_master_id: 'drug_prn',
              drug_name: '疼痛時薬',
              frequency: '疼痛時',
              end_date: new Date('2026-04-01T00:00:00.000Z'),
            },
            {
              id: 'line_regular',
              drug_master_id: 'drug_regular',
              drug_name: '継続薬',
              frequency: '朝食後',
              end_date: new Date('2026-04-10T00:00:00.000Z'),
            },
          ],
        },
      ],
      {
        planningStartDateKey: '2026-04-01',
        operatingCalendar: buildWeekdayCalendar(),
        safetyBufferOperatingDays: 0,
      },
    );

    expect(policy.rawDeadlineDateKey).toBe('2026-04-10');
    expect(policy.deadlineCandidates.map((candidate) => candidate.prescription_line_id)).toEqual([
      'line_regular',
    ]);
    expect(policy.reviewReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'as_needed_excluded_from_regular_deadline',
          source_kind: 'as_needed',
          severity: 'info',
        }),
      ]),
    );
  });

  it('keeps non-PRN topical medication as a candidate but requires pharmacist review', () => {
    const policy = resolveVisitDeadlinePolicy(
      [
        {
          id: 'intake_1',
          lines: [
            {
              id: 'line_external',
              drug_master_id: 'drug_external',
              route: 'external',
              dosage_form: '貼付剤',
              frequency: '1日1回',
              end_date: new Date('2026-04-10T00:00:00.000Z'),
            },
          ],
        },
      ],
      {
        planningStartDateKey: '2026-04-01',
        operatingCalendar: buildWeekdayCalendar(),
        safetyBufferOperatingDays: 0,
      },
    );

    expect(policy.deadlineCandidates[0]).toEqual(
      expect.objectContaining({
        prescription_line_id: 'line_external',
        requires_pharmacist_review: true,
        reason_code: 'external_route_review_required',
      }),
    );
    expect(policy.reviewReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'external_route_review_required',
          severity: 'review_required',
        }),
      ]),
    );
  });

  it('marks name-only medication candidates as low confidence without exposing drug free text', () => {
    const policy = resolveVisitDeadlinePolicy(
      [
        {
          id: 'intake_1',
          lines: [
            {
              id: 'line_name_only',
              drug_name: '同名薬A 10mg free text',
              frequency: '朝食後',
              end_date: new Date('2026-04-10T00:00:00.000Z'),
            },
          ],
        },
      ],
      {
        planningStartDateKey: '2026-04-01',
        operatingCalendar: buildWeekdayCalendar(),
        safetyBufferOperatingDays: 0,
      },
    );

    expect(policy.deadlineCandidates[0]).toEqual(
      expect.objectContaining({
        prescription_intake_id: 'intake_1',
        prescription_line_id: 'line_name_only',
        drug_master_id: null,
        drug_code: null,
        source_drug_code: null,
        confidence: 'low',
        requires_pharmacist_review: true,
        reason_code: 'drug_identity_unresolved',
      }),
    );
    expect(policy.reviewReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'drug_identity_unresolved',
          severity: 'review_required',
        }),
      ]),
    );
    expect(JSON.stringify(policy)).not.toContain('同名薬A');
    expect(JSON.stringify(policy)).not.toContain('free text');
  });

  it('keeps mixed source provenance including stockout estimates without losing candidate identity', () => {
    const policy = resolveVisitDeadlinePolicy(
      [
        {
          id: 'intake_1',
          refill_next_dispense_date: new Date('2026-07-03T00:00:00.000Z'),
          lines: [
            {
              id: 'line_regular',
              drug_master_id: 'drug_1',
              drug_code: 'YJ001',
              source_drug_code: 'HOT001',
              frequency: '朝食後',
              end_date: new Date('2026-07-05T00:00:00.000Z'),
            },
          ],
        },
      ],
      {
        planningStartDateKey: '2026-07-01',
        operatingCalendar: buildWeekdayCalendar(),
        safetyBufferOperatingDays: 0,
        nextVisitSuggestionDate: new Date('2026-07-04T00:00:00.000Z'),
        stockoutCandidates: [
          {
            date_key: '2026-07-02',
            source_kind: 'stockout_estimate',
            prescription_intake_id: 'intake_1',
            prescription_line_id: 'line_regular',
            drug_master_id: 'drug_1',
            drug_code: 'YJ001',
            source_drug_code: 'HOT001',
          },
        ],
      },
    );

    expect(policy.rawDeadlineDateKey).toBe('2026-07-02');
    expect(policy.deadlineCandidates.map((candidate) => candidate.source_kind)).toEqual([
      'regular_medication_end',
      'next_dispense',
      'next_visit_suggestion',
      'stockout_estimate',
    ]);
    expect(
      policy.deadlineCandidates.find((candidate) => candidate.source_kind === 'stockout_estimate'),
    ).toEqual(
      expect.objectContaining({
        prescription_intake_id: 'intake_1',
        prescription_line_id: 'line_regular',
        drug_master_id: 'drug_1',
        drug_code: 'YJ001',
        source_drug_code: 'HOT001',
        requires_pharmacist_review: true,
        reason_code: 'stockout_estimate_review_required',
      }),
    );
    expect(policy.reviewReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'stockout_estimate_review_required',
          severity: 'review_required',
        }),
      ]),
    );
  });

  it('uses Asia/Tokyo date keys for DateTime-like policy inputs', () => {
    const policy = resolveVisitDeadlinePolicy([], {
      planningStartDateKey: '2026-03-01',
      operatingCalendar: buildWeekdayCalendar(),
      safetyBufferOperatingDays: 0,
      nextVisitSuggestionDate: new Date('2026-03-29T15:30:00.000Z'),
    });

    expect(policy.rawDeadlineDateKey).toBe('2026-03-30');
    expect(policy.deadlineCandidates[0]).toEqual(
      expect.objectContaining({
        source_kind: 'next_visit_suggestion',
        raw_date_key: '2026-03-30',
        requires_pharmacist_review: false,
      }),
    );
  });
});
