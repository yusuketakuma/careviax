import { describe, expect, it } from 'vitest';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import {
  buildDailyOpsBlockedReasons,
  buildDailyOpsNextAction,
  familyNameOf,
  formatDailyOpsAgeLabel,
  formatDailyOpsTime,
} from './daily-ops-rail';

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 11, hours, minutes).toISOString();
}

function buildCockpitFixture(): DashboardCockpitResponse {
  return {
    generated_at: localIso(9, 42),
    cycle_status_counts: {},
    audit_pending_count: 1,
    narcotic_audit_count: 1,
    audit_queue: [
      {
        task_id: 'task_1',
        cycle_id: 'cycle_1',
        patient_name: '田中 一郎',
        priority: 'urgent',
        due_at: localIso(12, 0),
        intake_id: 'intake_0500',
        prescribed_date: '2024-05-01',
        handling_tags: ['narcotic'],
        has_narcotic: true,
        waiting_since: localIso(8, 0),
      },
    ],
    today_visits: [
      {
        id: 'visit_1',
        patient_name: '田中 一郎',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_start: localIso(14, 0),
        time_end: localIso(15, 0),
        facility_batch_id: null,
      },
    ],
    blocked_reasons: [
      {
        id: 'exception_1',
        label: 'ご家族の同意待ち(新規契約)',
        severity: 'warning',
        category: '患者',
        age_minutes: 24 * 60,
        action_label: '再連絡する →',
        action_href: '/patients',
      },
      {
        id: 'exception_2',
        label: '送付先の確認(やまもと内科)',
        severity: 'warning',
        category: '事務',
        age_minutes: 30,
        action_label: '状況を見る →',
        action_href: '/workflow',
      },
    ],
    carryover_count: 0,
    team_capacity: [],
  };
}

describe('buildDailyOpsNextAction', () => {
  it('麻薬監査の期限つき主操作と訪問時刻入りの説明文を組み立てる', () => {
    const nextAction = buildDailyOpsNextAction(buildCockpitFixture(), {
      actionLabel: 'fallback',
      actionHref: '/x',
      description: 'fallback description',
    });

    expect(nextAction.actionLabel).toBe('麻薬監査を開始 — 12:00期限');
    expect(nextAction.actionHref).toBe('/audit');
    expect(nextAction.description).toBe(
      '14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。',
    );
  });

  it('監査キューが空ならフォールバックを返す', () => {
    const fixture = buildCockpitFixture();
    fixture.audit_queue = [];

    const nextAction = buildDailyOpsNextAction(fixture, {
      actionLabel: 'セット監査を始める',
      actionHref: '/set',
      description: 'いま期限で止まっている監査はありません。',
    });

    expect(nextAction.actionLabel).toBe('セット監査を始める');
    expect(nextAction.actionHref).toBe('/set');
  });

  it('当日訪問が無い患者は患者名ベースの説明文になる', () => {
    const fixture = buildCockpitFixture();
    fixture.today_visits = [];

    const nextAction = buildDailyOpsNextAction(fixture, {
      actionLabel: 'fallback',
      actionHref: '/x',
      description: 'fallback',
    });

    expect(nextAction.description).toContain('田中 一郎 様の監査待ち');
  });
});

describe('buildDailyOpsBlockedReasons', () => {
  it('カテゴリ・経過時間・個別アクションつきの BlockedReason に変換する', () => {
    const reasons = buildDailyOpsBlockedReasons(buildCockpitFixture());

    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toMatchObject({
      label: 'ご家族の同意待ち(新規契約)',
      categoryLabel: '患者',
      ageLabel: '1日',
      actionLabel: '再連絡する →',
      actionHref: '/patients',
    });
    expect(reasons[1]).toMatchObject({
      categoryLabel: '事務',
      ageLabel: '30分',
      actionLabel: '状況を見る →',
    });
  });

  it('null データでは空配列を返す', () => {
    expect(buildDailyOpsBlockedReasons(null)).toEqual([]);
  });
});

describe('formatDailyOpsAgeLabel / familyNameOf', () => {
  it('shared time formatter keeps HH:mm padding and invalid timestamp fallback', () => {
    expect(formatDailyOpsTime(localIso(9, 5))).toBe('09:05');
    expect(formatDailyOpsTime('not-a-date')).toBe('—');
  });

  it('分・時間・日の単位に丸める', () => {
    expect(formatDailyOpsAgeLabel(30)).toBe('30分');
    expect(formatDailyOpsAgeLabel(150)).toBe('2時間');
    expect(formatDailyOpsAgeLabel(60 * 24 * 3)).toBe('3日');
    expect(formatDailyOpsAgeLabel(-5)).toBe('0分');
  });

  it('姓だけを取り出す(全角スペース対応)', () => {
    expect(familyNameOf('田中 一郎')).toBe('田中');
    expect(familyNameOf('田中　一郎')).toBe('田中');
    expect(familyNameOf('田中')).toBe('田中');
  });
});
