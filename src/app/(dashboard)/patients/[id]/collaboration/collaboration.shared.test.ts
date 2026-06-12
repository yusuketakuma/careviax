import { describe, expect, it } from 'vitest';
import type { PresenceUser } from '@/components/features/collaboration/presence-avatars';
import type { PatientWorkspaceActivity } from '../patient-detail.types';
import {
  buildCollaborationComments,
  buildCollaborationDemoData,
  buildPresenceViews,
  COLLABORATION_COMMENT_LIMIT,
  presenceLocationLabel,
} from './collaboration.shared';

function presenceUser(overrides: Partial<PresenceUser>): PresenceUser {
  return {
    user_id: 'user_1',
    display_name: '佐藤薬剤師',
    active_field: null,
    updated_at: '2026-06-13T09:00:00.000Z',
    ...overrides,
  };
}

function activity(overrides: Partial<PatientWorkspaceActivity>): PatientWorkspaceActivity {
  return {
    id: 'act_1',
    type: 'transition',
    label: '鑑査を開始しました',
    actor: '佐藤',
    at: '2026-06-13T09:00:00.000Z',
    href: '/patients/pt_1',
    ...overrides,
  };
}

describe('presenceLocationLabel', () => {
  it('滞在場所キーを日本語ラベルへ変換する', () => {
    expect(presenceLocationLabel('prescriptions')).toBe('処方タブ');
    expect(presenceLocationLabel('delivery')).toBe('送付先確認');
    expect(presenceLocationLabel('report')).toBe('報告書');
    expect(presenceLocationLabel('card')).toBe('カード');
    expect(presenceLocationLabel('collaboration')).toBe('連携ビュー');
  });

  it('未知のキーと null は「閲覧中」に丸める', () => {
    expect(presenceLocationLabel(null)).toBe('閲覧中');
    expect(presenceLocationLabel('unknown_field')).toBe('閲覧中');
  });
});

describe('buildPresenceViews', () => {
  it('自分自身を除外し、先に開いていた人から順に並べる', () => {
    const views = buildPresenceViews(
      [
        presenceUser({
          user_id: 'user_self',
          display_name: '山田 花子',
          updated_at: '2026-06-13T08:00:00.000Z',
        }),
        presenceUser({
          user_id: 'user_takahashi',
          display_name: '高橋薬剤師',
          active_field: 'report',
          updated_at: '2026-06-13T09:30:00.000Z',
        }),
        presenceUser({
          user_id: 'user_sato',
          display_name: '佐藤薬剤師',
          active_field: 'prescriptions',
          updated_at: '2026-06-13T09:00:00.000Z',
        }),
      ],
      'user_self',
    );

    expect(views).toEqual([
      { userId: 'user_sato', displayName: '佐藤薬剤師', locationLabel: '処方タブ' },
      { userId: 'user_takahashi', displayName: '高橋薬剤師', locationLabel: '報告書' },
    ]);
  });

  it('同時刻は名前順で安定化し、selfUserId が無いときは除外しない', () => {
    const sameTime = '2026-06-13T09:00:00.000Z';
    const views = buildPresenceViews([
      presenceUser({ user_id: 'u2', display_name: '鈴木事務', updated_at: sameTime }),
      presenceUser({ user_id: 'u1', display_name: '佐藤薬剤師', updated_at: sameTime }),
    ]);

    expect(views.map((view) => view.displayName)).toEqual(['佐藤薬剤師', '鈴木事務']);
  });
});

describe('buildCollaborationComments', () => {
  it('新しい順に「名前:文」形式へ射影する', () => {
    const comments = buildCollaborationComments([
      activity({
        id: 'act_old',
        actor: '鈴木',
        label: 'ケアマネFAXを登録しました',
        at: '2026-06-13T08:00:00.000Z',
      }),
      activity({
        id: 'act_new',
        actor: '佐藤',
        label: '粉砕可否を確認中です',
        at: '2026-06-13T10:00:00.000Z',
      }),
    ]);

    expect(comments).toEqual([
      { id: 'act_new', author: '佐藤', text: '粉砕可否を確認中です' },
      { id: 'act_old', author: '鈴木', text: 'ケアマネFAXを登録しました' },
    ]);
  });

  it('actor の無い動きは種別ラベルへフォールバックする', () => {
    const comments = buildCollaborationComments([
      activity({ id: 'a1', type: 'transition', actor: null }),
      activity({ id: 'a2', type: 'inquiry', actor: '  ' }),
      activity({ id: 'a3', type: 'intake', actor: undefined as unknown as null }),
    ]);

    expect(comments.map((comment) => comment.author)).toEqual(['工程', '照会', '取込']);
  });

  it('最大件数で打ち切り、入力配列は破壊しない', () => {
    const activities = Array.from({ length: COLLABORATION_COMMENT_LIMIT + 3 }, (_, index) =>
      activity({ id: `act_${index}`, at: `2026-06-0${(index % 9) + 1}T09:00:00.000Z` }),
    );
    const original = [...activities];

    const comments = buildCollaborationComments(activities);

    expect(comments).toHaveLength(COLLABORATION_COMMENT_LIMIT);
    expect(activities).toEqual(original);
  });
});

describe('buildCollaborationDemoData', () => {
  it('target デザイン p1_13 の presence 3 人とコメント 3 件を返す', () => {
    const demo = buildCollaborationDemoData();

    expect(demo.presence).toEqual([
      { userId: 'demo-presence-sato', displayName: '佐藤薬剤師', locationLabel: '処方タブ' },
      { userId: 'demo-presence-suzuki', displayName: '鈴木事務', locationLabel: '送付先確認' },
      { userId: 'demo-presence-takahashi', displayName: '高橋薬剤師', locationLabel: '報告書' },
    ]);
    expect(demo.comments).toEqual([
      { id: 'demo-comment-1', author: '佐藤', text: '粉砕可否を確認中です' },
      { id: 'demo-comment-2', author: '鈴木', text: 'ケアマネFAXを登録しました' },
      { id: 'demo-comment-3', author: '高橋', text: '報告書は下書き保存済みです' },
    ]);
  });
});
