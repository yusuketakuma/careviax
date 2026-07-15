// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ExpiryBadge, classifyExpiry } from '@/components/ui/expiry-badge';

setupDomTestEnv();

const NOW = new Date('2026-06-26T00:00:00Z');

describe('classifyExpiry', () => {
  it('classifies a past date as expired', () => {
    expect(classifyExpiry('2026-06-20', {}, NOW)).toEqual({ status: 'expired', days: -6 });
  });

  // SSOT 7.3 の 2 段閾値: 期限切れ/30日以内=blocked、90日以内=confirm、以遠=中立。
  it('classifies within 30 days as due-critical (blocked tier)', () => {
    expect(classifyExpiry('2026-07-10', {}, NOW).status).toBe('due-critical');
    expect(classifyExpiry('2026-07-26', {}, NOW).status).toBe('due-critical');
  });

  it('classifies today as due-critical (0 days)', () => {
    expect(classifyExpiry('2026-06-26', {}, NOW)).toEqual({ status: 'due-critical', days: 0 });
  });

  it('classifies 31-90 days out as due-soon (confirm tier) — no silent 31-90 day gap', () => {
    expect(classifyExpiry('2026-07-27', {}, NOW).status).toBe('due-soon');
    expect(classifyExpiry('2026-09-24', {}, NOW).status).toBe('due-soon');
  });

  it('classifies beyond 90 days as ok', () => {
    expect(classifyExpiry('2026-12-31', {}, NOW).status).toBe('ok');
  });

  it('classifies null / empty as unset (truly absent)', () => {
    expect(classifyExpiry(null, {}, NOW).status).toBe('unset');
    expect(classifyExpiry(undefined, {}, NOW).status).toBe('unset');
    expect(classifyExpiry('', {}, NOW).status).toBe('unset');
  });

  it('classifies an unparseable date as invalid, separate from unset (no false-empty)', () => {
    expect(classifyExpiry('not-a-date', {}, NOW).status).toBe('invalid');
    expect(classifyExpiry(new Date('garbage'), {}, NOW).status).toBe('invalid');
  });

  it('allows custom thresholds only to widen the warning windows', () => {
    // critical を 45 日へ拡大 → 40日先(既定なら confirm 帯)が blocked 帯に入る。
    expect(classifyExpiry('2026-08-05', { criticalWithinDays: 45 }, NOW).status).toBe(
      'due-critical',
    );
    // warn を 120 日へ拡大 → 100日先(既定なら ok)が confirm 帯に入る。
    expect(classifyExpiry('2026-10-04', { warnWithinDays: 120 }, NOW).status).toBe('due-soon');
  });

  it('enforces the SSOT floors — thresholds can never be relaxed below 30/90 (rev discipline 1.3)', () => {
    // critical=7/warn=10 のような弱設定は floor(30/90) へ引き上げ。14日先は blocked のまま。
    expect(
      classifyExpiry('2026-07-10', { criticalWithinDays: 7, warnWithinDays: 10 }, NOW),
    ).toEqual({ status: 'due-critical', days: 14 });
    // 31-90 日帯も消えない。
    expect(
      classifyExpiry('2026-08-31', { criticalWithinDays: 1, warnWithinDays: 1 }, NOW).status,
    ).toBe('due-soon');
    // 非有限・負値は既定(=floor)へフォールバック。
    expect(
      classifyExpiry('2026-07-10', { criticalWithinDays: -5, warnWithinDays: Number.NaN }, NOW)
        .status,
    ).toBe('due-critical');
    // warn は常に critical 以上(confirm 帯の消失防止)。critical=100 なら warn も 100 まで追随。
    expect(
      classifyExpiry('2026-09-30', { criticalWithinDays: 100, warnWithinDays: 10 }, NOW).status,
    ).toBe('due-critical');
  });

  it('computes days on the Japan business date (Asia/Tokyo), not the runtime timezone', () => {
    // JST 2026-06-27 00:30 (= UTC 2026-06-26 15:30)。UTC 暦日ではまだ 6/26 だが
    // 日本業務日では 6/27 なので、6/27 期限は「残0日」になる(SSOT 2.8 Japan date basis)。
    const jstMidnightCross = new Date('2026-06-26T15:30:00Z');
    expect(classifyExpiry('2026-06-27', {}, jstMidnightCross)).toEqual({
      status: 'due-critical',
      days: 0,
    });
    expect(classifyExpiry('2026-06-26', {}, jstMidnightCross).status).toBe('expired');
  });

  it.each(['Asia/Tokyo', 'America/New_York'])(
    'keeps exact 30/31/90/91-day boundaries under the %s runtime timezone',
    (runtimeTimezone) => {
      const originalTimezone = process.env.TZ;
      process.env.TZ = runtimeTimezone;
      try {
        const now = new Date('2026-06-26T15:30:00Z'); // JST 2026-06-27 00:30
        expect(now.getDate()).toBe(runtimeTimezone === 'Asia/Tokyo' ? 27 : 26);
        expect(classifyExpiry('2026-06-26', {}, now)).toEqual({
          status: 'expired',
          days: -1,
        });
        expect(classifyExpiry('2026-06-27', {}, now)).toEqual({
          status: 'due-critical',
          days: 0,
        });
        expect(classifyExpiry('2026-07-27', {}, now)).toEqual({
          status: 'due-critical',
          days: 30,
        });
        expect(classifyExpiry('2026-07-28', {}, now)).toEqual({
          status: 'due-soon',
          days: 31,
        });
        expect(classifyExpiry('2026-09-25', {}, now)).toEqual({
          status: 'due-soon',
          days: 90,
        });
        expect(classifyExpiry('2026-09-26', {}, now)).toEqual({ status: 'ok', days: 91 });
        expect(classifyExpiry('not-a-date', {}, now)).toEqual({
          status: 'invalid',
          days: null,
        });
      } finally {
        if (originalTimezone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTimezone;
        }
      }
    },
  );
});

describe('ExpiryBadge', () => {
  it('shows an expired label with red (blocked) role', () => {
    const { container } = render(<ExpiryBadge date="2026-06-20" now={NOW} />);
    expect(screen.getByText(/期限切れ/)).toBeTruthy();
    expect(container.querySelector('[data-role="blocked"]')).toBeTruthy();
  });

  it('shows a within-30-days countdown with red (blocked) role — SSOT 7.3 critical tier', () => {
    const { container } = render(<ExpiryBadge date="2026-07-10" now={NOW} />);
    expect(screen.getByText(/あと\d+日/)).toBeTruthy();
    expect(container.querySelector('[data-role="blocked"]')).toBeTruthy();
  });

  it('shows a 31-90 day countdown with amber (confirm) role', () => {
    const { container } = render(<ExpiryBadge date="2026-08-31" now={NOW} />);
    expect(screen.getByText(/あと\d+日/)).toBeTruthy();
    expect(container.querySelector('[data-role="confirm"]')).toBeTruthy();
  });

  it('shows "期限未設定" with neutral (readonly) role when no date', () => {
    const { container } = render(<ExpiryBadge date={null} now={NOW} />);
    expect(screen.getByText('期限未設定')).toBeTruthy();
    expect(container.querySelector('[data-role="readonly"]')).toBeTruthy();
  });

  it('shows "期限日を確認" with amber (confirm) role for an invalid date — not as 未設定', () => {
    const { container } = render(<ExpiryBadge date="not-a-date" now={NOW} />);
    expect(screen.getByText('期限日を確認')).toBeTruthy();
    expect(container.querySelector('[data-role="confirm"]')).toBeTruthy();
    expect(screen.queryByText('期限未設定')).toBeNull();
  });

  // admin 一覧セル互換の日付主体表記(showDate)。
  it('renders date-first labels in showDate mode', () => {
    const { container } = render(<ExpiryBadge date="2026-06-20" now={NOW} showDate />);
    expect(screen.getByText('2026/06/20（期限切れ）')).toBeTruthy();
    expect(container.querySelector('[data-role="blocked"]')).toBeTruthy();
  });

  it('renders remaining days with the date in showDate mode (critical tier)', () => {
    const { container } = render(<ExpiryBadge date="2026-07-10" now={NOW} showDate />);
    expect(screen.getByText('2026/07/10（残14日）')).toBeTruthy();
    expect(container.querySelector('[data-role="blocked"]')).toBeTruthy();
  });

  it('renders a plain date with neutral role for ok in showDate mode', () => {
    const { container } = render(<ExpiryBadge date="2026-12-31" now={NOW} showDate />);
    expect(screen.getByText('2026/12/31')).toBeTruthy();
    expect(container.querySelector('[data-role="readonly"]')).toBeTruthy();
  });

  it('renders muted "—" for unset in showDate mode (admin table convention)', () => {
    const { container } = render(<ExpiryBadge date={null} now={NOW} showDate />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(container.querySelector('[data-role]')).toBeNull();
  });

  it('formats the shown date on the Japan business date, matching classification (TZ-independent)', () => {
    // UTC 2026-06-26T16:00Z = JST 6/27 01:00。分類(残0日)と同じ日本業務日 6/27 を表示する。
    // ランタイム TZ の date-fns format だと UTC 環境で 6/26 と表示されてしまう回帰の防止。
    const { container } = render(
      <ExpiryBadge date="2026-06-26T16:00:00Z" now={new Date('2026-06-26T15:30:00Z')} showDate />,
    );
    expect(screen.getByText('2026/06/27（残0日）')).toBeTruthy();
    expect(container.querySelector('[data-role="blocked"]')).toBeTruthy();
  });
});
