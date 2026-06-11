import { describe, expect, it } from 'vitest';
import { countMyHandoffItems, toBadgeCount } from './use-nav-badges';

describe('countMyHandoffItems', () => {
  const me = 'user_me';
  const other = 'user_other';

  it('counts items I handed off and items I have not confirmed yet', () => {
    const items = [
      // 自分が渡した(既読有無は問わない)
      { created_by: me, read_by: [] },
      { created_by: me, read_by: [other] },
      // 来た・未確認
      { created_by: other, read_by: [] },
      // 来た・確認済み → 数えない
      { created_by: other, read_by: [me] },
    ];

    expect(countMyHandoffItems(items, me)).toBe(3);
  });

  it('returns 0 when the user is unknown', () => {
    expect(countMyHandoffItems([{ created_by: other, read_by: [] }], null)).toBe(0);
  });

  it('tolerates missing read_by arrays', () => {
    expect(countMyHandoffItems([{ created_by: other }], me)).toBe(1);
  });
});

describe('toBadgeCount', () => {
  it('hides zero and missing counts', () => {
    expect(toBadgeCount(0)).toBeUndefined();
    expect(toBadgeCount(undefined)).toBeUndefined();
  });

  it('passes through positive counts', () => {
    expect(toBadgeCount(6)).toBe(6);
  });
});
