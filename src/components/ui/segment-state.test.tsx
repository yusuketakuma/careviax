// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  sanitizeSegmentRoute,
  SegmentEmptyButNotError,
  SegmentError,
  SegmentLoading,
  SegmentRetryButton,
  SegmentStaleBanner,
} from './segment-state';

setupDomTestEnv();

describe('segment-state components', () => {
  it('renders a segment loading status without exposing decorative skeletons', () => {
    render(<SegmentLoading label="監査キューを読み込み中" description="部分取得中です" />);

    const status = screen.getByRole('status', { name: '監査キューを読み込み中' });
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(within(status).getByText('部分取得中です')).toBeTruthy();
    expect(status.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('renders a retryable segment error with safe metadata only', () => {
    const onRetry = vi.fn();
    render(
      <SegmentError
        title="チーム負荷を表示できません"
        cause="チーム負荷の取得に失敗しました。"
        onRetry={onRetry}
        metadata={{
          requestId: 'req_123',
          route: '/api/patients/patient_123/overview?debug=raw',
          generatedAt: '2026-07-07T00:00:00.000Z',
          retryCount: 2,
        }}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'チーム負荷を表示できません' }),
    ).toBeTruthy();
    expect(screen.getByText('request_id')).toBeTruthy();
    expect(screen.getByText('req_123')).toBeTruthy();
    expect(screen.getByText('route')).toBeTruthy();
    expect(screen.getByText('/api/patients/:id/overview')).toBeTruthy();
    expect(screen.queryByText(/debug=raw/)).toBeNull();
    expect(screen.queryByText(/patient_123/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders a stale banner with retry without treating it as an empty state', () => {
    const onRetry = vi.fn();
    render(
      <SegmentStaleBanner
        title="前回取得時点を表示中"
        description="コメントだけ再取得に失敗しました。"
        metadata={{ requestId: 'req_stale', route: '/api/dashboard/cockpit/details' }}
        onRetry={onRetry}
      />,
    );

    const status = screen.getByRole('status');
    expect(within(status).getByText('前回取得時点を表示中')).toBeTruthy();
    expect(within(status).getByText('コメントだけ再取得に失敗しました。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an empty-but-not-error state with guidance', () => {
    render(
      <SegmentEmptyButNotError
        title="対象データはありません"
        description="条件に一致する候補はありません。"
      />,
    );

    const status = screen.getByRole('status');
    expect(
      within(status).getByRole('heading', { level: 3, name: '対象データはありません' }),
    ).toBeTruthy();
    expect(within(status).getByText('条件に一致する候補はありません。')).toBeTruthy();
    expect(
      within(status).getByText(
        '取得は完了しています。条件を変更するか、次の入力を追加してください。',
      ),
    ).toBeTruthy();
  });

  it('keeps the standalone retry button accessible', () => {
    const onRetry = vi.fn();
    render(<SegmentRetryButton onRetry={onRetry} label="詳細を再取得" />);

    fireEvent.click(screen.getByRole('button', { name: '詳細を再取得' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('sanitizes route metadata by stripping query strings and ID-like path segments', () => {
    expect(sanitizeSegmentRoute('/api/tasks/task_abc123?patient_name=山田')).toBe('/api/tasks/:id');
    expect(sanitizeSegmentRoute('/api/cases/019f37bf-8748-76c1-8be0-ee80552d5667/risk')).toBe(
      '/api/cases/:id/risk',
    );
  });
});
