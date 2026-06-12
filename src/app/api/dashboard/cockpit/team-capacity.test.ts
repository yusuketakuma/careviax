import { describe, expect, it } from 'vitest';
import { buildTeamCapacity } from './team-capacity';

// ローカル 2026-06-12 09:00
const NOW = new Date(2026, 5, 12, 9, 0);

describe('buildTeamCapacity', () => {
  it('computes slack from default work hours minus remaining visit windows', () => {
    const result = buildTeamCapacity(
      [
        { user_id: 'u1', role: 'pharmacist', user: { name: '山田 太郎' } },
        { user_id: 'u2', role: 'clerk', user: { name: '鈴木 さくら' } },
      ],
      [],
      [
        {
          pharmacist_id: 'u1',
          time_window_start: new Date(2026, 5, 12, 10, 0),
          time_window_end: new Date(2026, 5, 12, 12, 0),
        },
        // now より前に始まった訪問は残り拘束に数えない
        {
          pharmacist_id: 'u1',
          time_window_start: new Date(2026, 5, 12, 8, 0),
          time_window_end: new Date(2026, 5, 12, 8, 30),
        },
        // 終了未設定は既定 60 分とみなす
        {
          pharmacist_id: 'u1',
          time_window_start: new Date(2026, 5, 12, 14, 0),
          time_window_end: null,
        },
      ],
      NOW,
    );

    // 9:00-18:00 = 540 分。拘束 = 120 + 60 = 180 分 → 余白 360 分
    expect(result[0]).toMatchObject({
      user_id: 'u1',
      role_label: '薬',
      status: 'working',
      slack_minutes: 360,
    });
    expect(result[0].busy_ratio).toBeCloseTo(180 / 540, 2);
    expect(result[1]).toMatchObject({
      user_id: 'u2',
      role_label: '事務',
      slack_minutes: 540,
      busy_ratio: 0,
    });
  });

  it('marks shift-unavailable members as off and lists pharmacists before clerks', () => {
    const result = buildTeamCapacity(
      [
        { user_id: 'c1', role: 'clerk', user: { name: '田中 真' } },
        { user_id: 'p1', role: 'pharmacist', user: { name: '佐藤 恵' } },
      ],
      [{ user_id: 'c1', available: false, available_from: null, available_to: null }],
      [],
      NOW,
    );

    expect(result.map((member) => member.user_id)).toEqual(['p1', 'c1']);
    expect(result[1]).toMatchObject({
      status: 'off',
      slack_minutes: null,
      busy_ratio: null,
    });
  });

  it('respects shift work windows projected from @db.Time values', () => {
    const result = buildTeamCapacity(
      [{ user_id: 'p1', role: 'pharmacist', user: { name: '山田 太郎' } }],
      [
        {
          user_id: 'p1',
          available: true,
          available_from: new Date(Date.UTC(1970, 0, 1, 10, 0)),
          available_to: new Date(Date.UTC(1970, 0, 1, 13, 0)),
        },
      ],
      [],
      NOW,
    );

    // 勤務 10:00-13:00、now=9:00 → 残り 180 分
    expect(result[0].slack_minutes).toBe(180);
  });

  it('limits the card to four members', () => {
    const members = Array.from({ length: 6 }, (_, index) => ({
      user_id: `u${index}`,
      role: 'pharmacist',
      user: { name: `薬剤師 ${index}` },
    }));

    expect(buildTeamCapacity(members, [], [], NOW)).toHaveLength(4);
  });
});
