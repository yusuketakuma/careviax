// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientPinnedHeader } from '@/components/ui/patient-pinned-header';

setupDomTestEnv();

// ローカル暦日で構築する（UTC文字列だと負オフセットTZで前日にずれてテストが不安定になる）。
const NOW = new Date(2026, 5, 26);

describe('PatientPinnedHeader', () => {
  it('renders identity: name, kana, formatted birth, computed age, facility', () => {
    render(
      <PatientPinnedHeader
        name="山田 太郎"
        kana="ヤマダ タロウ"
        birthDate="1950-06-26"
        facility="さくら苑"
        now={NOW}
      />,
    );
    expect(screen.getByText('山田 太郎')).toBeTruthy();
    expect(screen.getByText('ヤマダ タロウ')).toBeTruthy();
    expect(screen.getByText('1950/06/26')).toBeTruthy();
    expect(screen.getByText('76歳')).toBeTruthy();
    expect(screen.getByText('さくら苑')).toBeTruthy();
  });

  it('does not truncate long patient identifiers and places them before secondary header content on mobile', () => {
    const longName = '山田太郎山田太郎山田太郎山田太郎山田太郎';
    const longKana = 'ヤマダタロウヤマダタロウヤマダタロウヤマダタロウ';
    const { container } = render(
      <PatientPinnedHeader
        name={longName}
        kana={longKana}
        facility="さくら苑"
        safetyTags={[{ label: 'ペニシリンアレルギー', role: 'blocked' }]}
        now={NOW}
      />,
    );

    const name = screen.getByText(longName);
    const kana = screen.getByText(longKana);
    expect(name.className).toContain('break-words');
    expect(name.className).not.toContain('truncate');
    expect(kana.className).toContain('break-all');
    expect(kana.className).not.toContain('truncate');
    expect(name.parentElement?.parentElement?.className).toContain('basis-full');
    expect(container.querySelector('[data-sticky]')?.textContent).toContain(longName);
    expect(container.querySelector('[data-sticky]')?.textContent).toContain(longKana);
  });

  it('prefers an explicit age over computing from birthDate', () => {
    render(<PatientPinnedHeader name="A" age={80} birthDate="1950-06-26" now={NOW} />);
    expect(screen.getByText('80歳')).toBeTruthy();
  });

  it('treats a YYYY-MM-DD birthDate as a calendar date (stable across timezones)', () => {
    // 日付のみ文字列は UTC ではなくローカル暦日として解釈し、TZ で前日にずれないこと。
    render(<PatientPinnedHeader name="A" birthDate="2000-01-01" now={new Date(2026, 0, 1)} />);
    expect(screen.getByText('2000/01/01')).toBeTruthy();
    expect(screen.getByText('26歳')).toBeTruthy();
  });

  it('does not count the birthday until it is reached in the year', () => {
    render(<PatientPinnedHeader name="A" birthDate="1950-12-31" now={new Date(2026, 5, 26)} />);
    expect(screen.getByText('75歳')).toBeTruthy();
  });

  it('shows ALL safety tags (no +N collapse) and defaults to the hazard role', () => {
    render(
      <PatientPinnedHeader
        name="A"
        safetyTags={[
          { label: 'ペニシリンアレルギー', role: 'blocked' },
          { label: '麻薬' },
          { label: '抗凝固' },
          { label: '腎機能低下' },
        ]}
        now={NOW}
      />,
    );
    const tags = screen.getByRole('list', { name: '安全情報' });
    expect(tags.querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByText('ペニシリンアレルギー').closest('[data-role="blocked"]')).toBeTruthy();
    expect(screen.getByText('麻薬').closest('[data-role="hazard"]')).toBeTruthy();
  });

  it('is sticky by default and can opt out', () => {
    const { container, rerender } = render(<PatientPinnedHeader name="A" now={NOW} />);
    let root = container.querySelector('[data-sticky]') as HTMLElement;
    expect(root.dataset.sticky).toBe('true');
    expect(root.className).toContain('sticky');
    expect(root.className).toContain('top-[var(--app-header-height)]');
    rerender(<PatientPinnedHeader name="A" sticky={false} now={NOW} />);
    root = container.querySelector('[data-sticky]') as HTMLElement;
    expect(root.dataset.sticky).toBe('false');
    expect(root.className).not.toContain('top-[var(--app-header-height)]');
  });

  it('exposes a labelled region for assistive tech', () => {
    render(<PatientPinnedHeader name="A" now={NOW} />);
    expect(screen.getByRole('region', { name: '患者情報' })).toBeTruthy();
  });
});
