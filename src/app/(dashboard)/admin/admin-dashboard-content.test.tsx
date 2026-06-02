// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { MasterReadinessSection } from './admin-dashboard-content';
import type { AdminMasterReadinessSnapshot } from '@/lib/admin/master-readiness';

setupDomTestEnv();

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

describe('MasterReadinessSection', () => {
  it('falls back to static readiness links while the summary is unavailable', () => {
    render(<MasterReadinessSection />);

    expect(screen.getAllByText('整備状況を読み込み中、または未集計です。').length).toBeGreaterThan(
      0,
    );
    fireEvent.click(screen.getByRole('tab', { name: /訪問先・同時訪問マスター/ }));
    expect(
      screen.getByRole('link', { name: /施設・ユニット・同時訪問の母艦/ }).getAttribute('href'),
    ).toBe('/admin/facilities');
  });

  it('shows settings and master links required for home-visit operations', () => {
    render(<MasterReadinessSection />);

    expect(screen.getByText('設定・マスター整備')).toBeTruthy();
    expect(screen.getByText('訪問先・同時訪問マスター')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /訪問先・同時訪問マスター/ }));
    expect(screen.getByText(/施設・ユニット、個人宅同居グループ/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /施設・ユニット・同時訪問の母艦/ }).getAttribute('href'),
    ).toBe('/admin/facilities');
    fireEvent.click(screen.getByRole('tab', { name: /他職種連携マスター/ }));
    expect(screen.getByRole('link', { name: /職種別の連携先マスター/ }).getAttribute('href')).toBe(
      '/admin/external-professionals',
    );
    fireEvent.click(screen.getByRole('tab', { name: /薬剤・調剤マスター/ }));
    expect(
      screen
        .getByRole('link', { name: /調剤・監査・セットへ渡す薬剤基本情報/ })
        .getAttribute('href'),
    ).toBe('/admin/drug-masters');
    expect(
      screen.getByRole('link', { name: /セット・患者設定で使う配薬方法/ }).getAttribute('href'),
    ).toBe('/admin/packaging-methods');
    fireEvent.click(screen.getByRole('tab', { name: /スタッフ・請求・監査/ }));
    expect(screen.getByRole('link', { name: /算定要件とルールSSOT/ }).getAttribute('href')).toBe(
      '/admin/billing-rules',
    );
  });

  it('shows counted readiness statuses from the admin summary API', () => {
    const snapshot: AdminMasterReadinessSnapshot = {
      generated_at: '2026-04-21T00:00:00.000Z',
      summary: { ready_count: 1, warning_count: 0, missing_count: 1 },
      groups: [
        {
          key: 'visit-place',
          title: '訪問先・同時訪問マスター',
          description:
            '施設・ユニット、個人宅同居グループ、訪問エリア、施設基準をまとめて整備します。',
          status: 'missing',
          ready_count: 1,
          warning_count: 0,
          missing_count: 1,
          items: [
            {
              label: '施設',
              href: '/admin/facilities',
              purpose: '施設・ユニット・同時訪問の母艦',
              status: 'ready',
              count: 3,
              detail: '3件登録済み',
              issues: [],
            },
            {
              label: '訪問エリア',
              href: '/admin/service-areas',
              purpose: '訪問範囲と移動前提',
              status: 'missing',
              count: 0,
              detail: '未登録です。運用前に登録してください。',
              issues: ['訪問エリアが未登録です。'],
            },
            {
              label: '医薬品マスター',
              href: '/admin/drug-masters',
              purpose: '調剤・監査・セットへ渡す薬剤基本情報',
              status: 'warning',
              count: 10,
              detail: '添付文書情報が未取込です。監査・訪問前確認に影響します。',
              issues: [
                '添付文書情報が未取込です。監査・訪問前確認に影響します。',
                '相互作用マスターが未取込です。処方監査に影響します。',
              ],
            },
          ],
        },
      ],
    };

    render(<MasterReadinessSection snapshot={snapshot} />);

    expect(screen.getByText('整備済み 1')).toBeTruthy();
    expect(screen.getByText('不足 1')).toBeTruthy();
    expect(screen.getByText('3件登録済み')).toBeTruthy();
    expect(screen.getByText('訪問エリアが未登録です。')).toBeTruthy();
    expect(
      screen.getByText('添付文書情報が未取込です。監査・訪問前確認に影響します。'),
    ).toBeTruthy();
    expect(screen.getByText('相互作用マスターが未取込です。処方監査に影響します。')).toBeTruthy();
  });
});
