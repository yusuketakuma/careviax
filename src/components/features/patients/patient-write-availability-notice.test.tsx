// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PatientWriteAvailabilityNotice } from './patient-write-availability-notice';

describe('PatientWriteAvailabilityNotice', () => {
  it('renders nothing for an explicit active patient', () => {
    render(
      <PatientWriteAvailabilityNotice
        archive={{ status: 'active', archived: false, archived_at: null }}
        patientName="佐藤 花子"
      />,
    );

    expect(screen.queryByTestId('patient-write-availability-notice')).toBeNull();
  });

  it('labels an archived patient and explains the read-only boundary', () => {
    render(
      <PatientWriteAvailabilityNotice
        archive={{
          status: 'archived',
          archived: true,
          archived_at: '2026-06-30T09:00:00.000Z',
        }}
        patientName="佐藤 花子"
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('アーカイブ中');
    expect(screen.getByRole('status').textContent).toContain(
      '佐藤 花子 様は閲覧専用の患者正本です。',
    );
    expect(screen.getByRole('status').textContent).toContain(
      '既存の共有・返信・履歴は閲覧できます',
    );
  });

  it('fails closed when the patient archive state is unavailable', () => {
    const onRetry = vi.fn();
    render(<PatientWriteAvailabilityNotice archive={null} onRetry={onRetry} />);

    expect(screen.getByRole('status').textContent).toContain('状態未確認');
    expect(screen.getByRole('status').textContent).toContain(
      '患者が利用中であることを再取得できるまで',
    );
    fireEvent.click(screen.getByRole('button', { name: '患者状態を再取得' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('labels retained data as stale and shows its last successful update time', () => {
    render(
      <PatientWriteAvailabilityNotice
        archive={null}
        isShowingCachedData
        cachedDataUpdatedAt={Date.UTC(2026, 6, 13, 1, 30)}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('前回取得データを表示中です');
    expect(screen.getByRole('status').textContent).toContain('最終更新:');
  });

  it('uses an accurate recovery condition when archive state is hidden by permission', () => {
    render(<PatientWriteAvailabilityNotice archive={null} unavailableReason="permission_denied" />);

    expect(screen.getByRole('status').textContent).toContain('状態確認権限なし');
    expect(screen.getByRole('status').textContent).toContain('権限を持つ担当者へ確認してください');
    expect(screen.getByRole('status').textContent).not.toContain('再取得できるまで');
    expect(screen.queryByRole('button', { name: '患者状態を再取得' })).toBeNull();
  });
});
