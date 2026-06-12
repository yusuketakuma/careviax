import { describe, expect, it } from 'vitest';
import type { CockpitVisit } from '@/types/dashboard-cockpit';
import {
  buildBottleneckNote,
  buildConditionSummary,
  buildProcessNowTiles,
  buildTeamHandoffSuggestion,
  buildTimelineBlocks,
  formatAgeLabel,
  formatDeadlineCountdown,
  formatTimeOfDay,
  TIMELINE_END_MINUTES,
  TIMELINE_START_MINUTES,
  timelinePercent,
} from './dashboard-cockpit.helpers';

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 12, hours, minutes).toISOString();
}

function buildVisit(overrides: Partial<CockpitVisit> & { id: string }): CockpitVisit {
  return {
    patient_name: '患者',
    visit_type: 'regular',
    schedule_status: 'planned',
    time_start: null,
    time_end: null,
    facility_batch_id: null,
    ...overrides,
  };
}

describe('formatDeadlineCountdown', () => {
  const now = new Date(2026, 5, 12, 9, 42);

  it('formats hours and minutes remaining', () => {
    expect(formatDeadlineCountdown(localIso(12, 0), now)).toEqual({
      label: 'あと 2時間18分',
      overdue: false,
    });
  });

  it('formats minutes-only remaining', () => {
    expect(formatDeadlineCountdown(localIso(10, 0), now)).toEqual({
      label: 'あと 18分',
      overdue: false,
    });
  });

  it('marks past deadlines as overdue', () => {
    expect(formatDeadlineCountdown(localIso(9, 0), now)).toEqual({
      label: '期限超過',
      overdue: true,
    });
  });
});

describe('formatAgeLabel', () => {
  it('uses minutes, hours, then days', () => {
    expect(formatAgeLabel(30)).toBe('30分');
    expect(formatAgeLabel(150)).toBe('2時間');
    expect(formatAgeLabel(24 * 60)).toBe('1日');
  });
});

describe('buildConditionSummary', () => {
  it('builds the conditional sentence with audit counts, deadline, and visit times', () => {
    const summary = buildConditionSummary({
      auditPendingCount: 2,
      narcoticAuditCount: 1,
      earliestAuditDueAt: localIso(12, 0),
      visitTimes: ['10:30', '14:00', '15:30'],
    });

    expect(summary.tone).toBe('conditional');
    expect(summary.pillLabel).toBe('条件つきで回る');
    const text = summary.parts.map((part) => part.text).join('');
    expect(text).toBe(
      '今日は回ります — ただし監査2件(麻薬1件を含む)が12:00までに完了することが条件です。完了すれば訪問3件(10:30 / 14:00 / 15:30)はすべて時間内です。',
    );
    expect(summary.parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      '監査2件',
      '(麻薬1件を含む)',
      '12:00までに',
      '訪問3件',
    ]);
  });

  it('falls back to 本日中 when no deadline is set and omits the narcotic note when zero', () => {
    const summary = buildConditionSummary({
      auditPendingCount: 3,
      narcoticAuditCount: 0,
      earliestAuditDueAt: null,
      visitTimes: [],
    });

    const text = summary.parts.map((part) => part.text).join('');
    expect(text).toBe('今日は回ります — ただし監査3件が本日中に完了することが条件です。');
  });

  it('returns the clear tone when no audits are pending', () => {
    const summary = buildConditionSummary({
      auditPendingCount: 0,
      narcoticAuditCount: 0,
      earliestAuditDueAt: null,
      visitTimes: ['10:30'],
    });

    expect(summary.tone).toBe('clear');
    expect(summary.pillLabel).toBe('今日は回る');
    expect(summary.parts.map((part) => part.text).join('')).toContain('訪問1件');
  });
});

describe('buildProcessNowTiles', () => {
  it('maps status counts onto the 9 process steps with WIP guide tones', () => {
    const tiles = buildProcessNowTiles({
      intake_received: 4,
      structuring: 7,
      inquiry_pending: 18,
      ready_to_dispense: 9,
      dispensed: 10,
      audit_pending: 14,
      setting: 21,
      visit_ready: 6,
      visit_completed: 11,
      reported: 9,
    });

    expect(tiles.map((tile) => `${tile.label}:${tile.count}:${tile.tone}`)).toEqual([
      '取込:4:normal',
      '入力:7:normal',
      '判断:18:over',
      '調剤:9:normal',
      '監査:24:over',
      'セット:21:near',
      '訪問:6:normal',
      '報告:11:normal',
      '算定:9:normal',
    ]);
  });

  it('describes the top bottlenecks in process order', () => {
    const tiles = buildProcessNowTiles({
      inquiry_pending: 18,
      dispensed: 24,
      setting: 30,
    });
    // over: 判断(+6) / 監査(+10) / セット(+10) → 超過幅上位2件を工程順で表示
    expect(buildBottleneckNote(tiles)).toBe(
      '詰まりは監査とセット。上流の工程を今増やしても、今日は速くなりません。',
    );
  });

  it('returns no bottleneck note when nothing exceeds the guides', () => {
    expect(buildBottleneckNote(buildProcessNowTiles({ intake_received: 1 }))).toBeNull();
  });
});

describe('buildTimelineBlocks', () => {
  it('places visits as locked blocks and groups facility batches', () => {
    const blocks = buildTimelineBlocks({
      visits: [
        buildVisit({
          id: 'v1',
          patient_name: '伊藤',
          time_start: localIso(10, 30),
          time_end: localIso(11, 30),
        }),
        buildVisit({
          id: 'v2',
          patient_name: 'A',
          time_start: localIso(15, 0),
          facility_batch_id: 'batch_1',
        }),
        buildVisit({
          id: 'v3',
          patient_name: 'B',
          time_start: localIso(15, 30),
          facility_batch_id: 'batch_1',
        }),
        buildVisit({ id: 'v4', patient_name: '時間未定' }),
      ],
      auditCount: 0,
      narcoticAuditCount: 0,
      reportCount: 0,
    });

    const visitBlocks = blocks.filter((block) => block.kind === 'visit');
    expect(visitBlocks.map((block) => block.label)).toEqual(['伊藤様', '施設訪問 2名']);
    expect(visitBlocks.every((block) => block.locked)).toBe(true);
    const facility = visitBlocks.find((block) => block.id === 'facility:batch_1');
    expect(facility).toMatchObject({ startMinutes: 15 * 60, endMinutes: 16 * 60 + 30 });
  });

  it('clamps the morning audit block to the first visit start', () => {
    const blocks = buildTimelineBlocks({
      visits: [
        buildVisit({
          id: 'v1',
          patient_name: '伊藤',
          time_start: localIso(10, 30),
          time_end: localIso(11, 30),
        }),
      ],
      auditCount: 6,
      narcoticAuditCount: 1,
      reportCount: 0,
    });

    const audit = blocks.find((block) => block.id === 'desk:audit');
    expect(audit).toMatchObject({
      label: '監査 6件(麻薬を先頭)',
      startMinutes: TIMELINE_START_MINUTES,
      endMinutes: 10 * 60 + 30,
      locked: false,
    });
  });

  it('keeps the lunch break unless a visit overlaps it', () => {
    const withLunch = buildTimelineBlocks({
      visits: [],
      auditCount: 0,
      narcoticAuditCount: 0,
      reportCount: 0,
    });
    expect(withLunch.some((block) => block.id === 'break:lunch')).toBe(true);

    const withoutLunch = buildTimelineBlocks({
      visits: [
        buildVisit({
          id: 'v1',
          patient_name: '伊藤',
          time_start: localIso(12, 30),
          time_end: localIso(13, 30),
        }),
      ],
      auditCount: 0,
      narcoticAuditCount: 0,
      reportCount: 0,
    });
    expect(withoutLunch.some((block) => block.id === 'break:lunch')).toBe(false);
  });

  it('adds a report block at the end of the day when reports are pending', () => {
    const blocks = buildTimelineBlocks({
      visits: [
        buildVisit({
          id: 'v1',
          patient_name: '伊藤',
          time_start: localIso(15, 30),
          time_end: localIso(16, 30),
        }),
      ],
      auditCount: 0,
      narcoticAuditCount: 0,
      reportCount: 2,
    });

    const report = blocks.find((block) => block.id === 'desk:report');
    expect(report).toMatchObject({
      label: '報告書 2件',
      startMinutes: 17 * 60,
      endMinutes: TIMELINE_END_MINUTES,
    });
  });
});

describe('timelinePercent', () => {
  it('maps minutes into the 9:00-18:00 range and clamps outliers', () => {
    expect(timelinePercent(TIMELINE_START_MINUTES)).toBe(0);
    expect(timelinePercent(TIMELINE_END_MINUTES)).toBe(100);
    expect(timelinePercent(13 * 60 + 30)).toBe(50);
    expect(timelinePercent(8 * 60)).toBe(0);
    expect(timelinePercent(20 * 60)).toBe(100);
  });
});

describe('formatTimeOfDay', () => {
  it('formats local HH:MM with zero padding', () => {
    expect(formatTimeOfDay(localIso(9, 5))).toBe('09:05');
  });
});

describe('buildTeamHandoffSuggestion', () => {
  const tiles = (over: Array<{ label: string; count: number; guide: number }>) =>
    over.map((tile, index) => ({
      key: `step_${index}` as never,
      label: tile.label,
      count: tile.count,
      guide: tile.guide,
      tone: 'over' as const,
    }));

  it('combines the worst over tile with the most slack working member', () => {
    const suggestion = buildTeamHandoffSuggestion(
      [
        ...tiles([
          { label: '判断', count: 18, guide: 12 },
          { label: '監査', count: 24, guide: 14 },
        ]),
        { key: 'visit' as never, label: '訪問', count: 3, guide: 8, tone: 'normal' },
      ],
      [
        { name: '山田 太郎', status: 'working', slack_minutes: 11 },
        { name: '鈴木 さくら', status: 'working', slack_minutes: 120 },
        { name: '田中 真', status: 'off', slack_minutes: null },
      ],
    );

    expect(suggestion).toBe('監査キュー定型10件を鈴木さんへ回せます');
  });

  it('returns null without an over tile or without a member with 30+ minutes of slack', () => {
    expect(
      buildTeamHandoffSuggestion(
        [{ key: 'visit' as never, label: '訪問', count: 3, guide: 8, tone: 'normal' }],
        [{ name: '鈴木', status: 'working', slack_minutes: 120 }],
      ),
    ).toBeNull();
    expect(
      buildTeamHandoffSuggestion(tiles([{ label: '判断', count: 18, guide: 12 }]), [
        { name: '山田', status: 'working', slack_minutes: 11 },
        { name: '田中', status: 'off', slack_minutes: null },
      ]),
    ).toBeNull();
  });
});
