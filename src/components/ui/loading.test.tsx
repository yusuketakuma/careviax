// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { Loading, SkeletonRows, Spinner } from './loading';
import { LoadingButton } from './loading-button';

setupDomTestEnv();

describe('Loading primitives', () => {
  it('keeps the page loading announcement to one concrete status', () => {
    render(<Loading label="患者一覧を読み込み中..." />);

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].getAttribute('aria-label')).toBe('患者一覧を読み込み中...');
  });

  it('can render nested skeleton rows as decorative placeholders', () => {
    render(<SkeletonRows rows={2} cols={1} status={false} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('読み込み中...').closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('allows a spinner to be decorative when a parent owns the status text', () => {
    render(<Spinner label={null} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('marks skeleton and spinner motion as reduced-motion safe (SSOT 3.5)', () => {
    const { container } = render(<SkeletonRows rows={1} cols={1} />);
    render(<Spinner />);

    // prefers-reduced-motion 環境で pulse / spin が止まる Tailwind variant を欠かさない。
    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton?.className).toContain('motion-reduce:animate-none');
    const spinner = document.querySelector('.animate-spin');
    expect(spinner?.className).toContain('motion-reduce:animate-none');
  });

  it('keeps loading button spinners decorative under the busy button label', () => {
    render(
      <LoadingButton loading loadingLabel="保存中">
        保存
      </LoadingButton>,
    );

    const button = screen.getByRole('button', { name: '保存中' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
