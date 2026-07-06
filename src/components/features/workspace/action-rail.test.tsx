// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import {
  BlockedReasonsPanel,
  EvidencePanel,
  GuardedWorkspaceActionRail,
  NextActionPanel,
  WorkspaceActionRail,
} from './action-rail';

setupDomTestEnv();

beforeEach(() => {
  useUIStore.setState({ workspaceRailOpen: true, workspaceRailAvailable: false });
});

describe('NextActionPanel', () => {
  it('shows the heading, description and a single primary action', () => {
    const onAction = vi.fn();
    render(
      <NextActionPanel
        description="セット監査まで進めます。"
        actionLabel="セット監査を始める"
        onAction={onAction}
      />,
    );

    expect(screen.getByRole('heading', { name: '次にやること' })).toBeTruthy();
    expect(screen.getByText('セット監査まで進めます。')).toBeTruthy();

    const button = screen.getByRole('button', { name: 'セット監査を始める' });
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders a link when actionHref is provided', () => {
    render(<NextActionPanel actionLabel="訪問準備へ" actionHref="/visits" />);

    const link = screen.getByRole('link', { name: '訪問準備へ' });
    expect(link.getAttribute('href')).toBe('/visits');
  });

  it('renders an outline secondary action when provided (P0-32)', () => {
    const onAction = vi.fn();
    const onSecondaryAction = vi.fn();
    render(
      <NextActionPanel
        actionLabel="医師への確認を記録"
        onAction={onAction}
        secondaryActionLabel="問題なしにする"
        onSecondaryAction={onSecondaryAction}
      />,
    );

    const secondary = screen.getByRole('button', { name: '問題なしにする' });
    fireEvent.click(secondary);
    expect(onSecondaryAction).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('disables the secondary action via secondaryActionDisabled', () => {
    render(
      <NextActionPanel
        actionLabel="医師への確認を記録"
        secondaryActionLabel="問題なしにする"
        secondaryActionDisabled
      />,
    );

    const secondary = screen.getByRole('button', { name: '問題なしにする' });
    expect(secondary.hasAttribute('disabled')).toBe(true);
  });
});

describe('BlockedReasonsPanel', () => {
  it('lists critical and warning reasons', () => {
    render(
      <BlockedReasonsPanel
        reasons={[
          { id: 'r1', label: '中止薬の回収袋が未確認です', severity: 'critical' },
          { id: 'r2', label: 'セット後写真がまだありません', severity: 'warning' },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: '止まっている理由' })).toBeTruthy();
    expect(screen.getByText('中止薬の回収袋が未確認です')).toBeTruthy();
    expect(screen.getByText('セット後写真がまだありません')).toBeTruthy();
  });

  it('renders nothing when there are no reasons and no empty label', () => {
    const { container } = render(<BlockedReasonsPanel reasons={[]} />);
    expect(container.childElementCount).toBe(0);
  });

  it('shows the empty label when provided', () => {
    render(<BlockedReasonsPanel reasons={[]} emptyLabel="止まっている作業はありません" />);
    expect(screen.getByText('止まっている作業はありません')).toBeTruthy();
  });

  it('keeps the legacy severity row (no link) when rich fields are absent', () => {
    render(
      <BlockedReasonsPanel
        reasons={[{ id: 'r1', label: '中止薬の回収袋が未確認です', severity: 'critical' }]}
      />,
    );

    expect(screen.getByText('中止薬の回収袋が未確認です')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders rich reasons with category chip, age label and action link (new design)', () => {
    render(
      <BlockedReasonsPanel
        reasons={[
          {
            id: 'r1',
            label: 'ご家族の同意待ち(新規契約)',
            severity: 'warning',
            categoryLabel: '患者',
            ageLabel: '1日',
            actionLabel: '再連絡する →',
            actionHref: '/communications/requests',
          },
          {
            id: 'r2',
            label: '送付先の確認(やまもと内科)',
            severity: 'warning',
            categoryLabel: '事務',
            ageLabel: '30分',
            actionLabel: '状況を見る →',
            actionHref: '/handoff',
          },
        ]}
      />,
    );

    expect(screen.getByText('患者')).toBeTruthy();
    expect(screen.getByText('事務')).toBeTruthy();
    expect(screen.getByText('1日')).toBeTruthy();
    expect(screen.getByText('30分')).toBeTruthy();
    expect(screen.getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();

    const recontact = screen.getByRole('link', { name: '再連絡する →' });
    expect(recontact.getAttribute('href')).toBe('/communications/requests');
    const status = screen.getByRole('link', { name: '状況を見る →' });
    expect(status.getAttribute('href')).toBe('/handoff');
  });

  it('renders rich reasons without category chip when only ageLabel is provided', () => {
    render(
      <BlockedReasonsPanel
        reasons={[{ id: 'r1', label: '医師回答待ち', severity: 'warning', ageLabel: '2日' }]}
      />,
    );

    expect(screen.getByText('医師回答待ち')).toBeTruthy();
    expect(screen.getByText('2日')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('EvidencePanel', () => {
  it('lists evidence items under the 根拠・記録 heading with a 見る action each', () => {
    const onView = vi.fn();
    render(
      <EvidencePanel
        items={[
          { id: 'e1', label: '処方せん画像', onView },
          { id: 'e2', label: '前回訪問メモ', href: '/visits/v1' },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: '根拠・記録' })).toBeTruthy();
    expect(screen.getByText('処方せん画像')).toBeTruthy();

    const buttons = screen.getAllByRole('button', { name: '見る' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onView).toHaveBeenCalledTimes(1);

    const link = screen.getByRole('link', { name: '見る' });
    expect(link.getAttribute('href')).toBe('/visits/v1');
  });

  it('shows row meta and replaces the action label via openLabel (new design)', () => {
    render(
      <EvidencePanel
        openLabel="開く"
        items={[
          { id: 'e1', label: 'お薬手帳(最新撮影)', meta: '6/12', href: '/documents/notebook' },
          { id: 'e2', label: '照会回答', meta: '09:31', onView: vi.fn() },
          { id: 'e3', label: '検査値の推移', meta: 'eGFR', onView: vi.fn() },
        ]}
      />,
    );

    expect(screen.getByText('6/12')).toBeTruthy();
    expect(screen.getByText('09:31')).toBeTruthy();
    expect(screen.getByText('eGFR')).toBeTruthy();

    const link = screen.getByRole('link', { name: '開く' });
    expect(link.getAttribute('href')).toBe('/documents/notebook');
    expect(screen.getAllByRole('button', { name: '開く' })).toHaveLength(2);
    expect(screen.queryByText('見る')).toBeNull();
  });

  it('renders nothing when items are empty', () => {
    const { container } = render(<EvidencePanel items={[]} />);
    expect(container.childElementCount).toBe(0);
  });
});

describe('WorkspaceActionRail', () => {
  it('registers the auxiliary panel as available only while mounted', () => {
    const { unmount } = render(
      <WorkspaceActionRail nextAction={{ actionLabel: '確認する', description: '確認します。' }} />,
    );

    expect(useUIStore.getState().workspaceRailAvailable).toBe(true);

    unmount();
    expect(useUIStore.getState().workspaceRailAvailable).toBe(false);
    expect(useUIStore.getState().workspaceRailOpen).toBe(false);
  });

  it('composes the three panels in order with extra children', () => {
    render(
      <WorkspaceActionRail
        nextAction={{ actionLabel: 'セット監査を始める' }}
        blockedReasons={[{ id: 'r1', label: '中止薬の回収袋が未確認です', severity: 'critical' }]}
        evidence={[{ id: 'e1', label: 'お薬手帳画像' }]}
      >
        <p>補助情報</p>
      </WorkspaceActionRail>,
    );

    const rail = screen.getByTestId('workspace-action-rail');
    const headings = within(rail).getAllByRole('heading');
    expect(headings.map((heading) => heading.textContent)).toEqual([
      '次にやること',
      '止まっている理由',
      '根拠・記録',
    ]);
    expect(within(rail).getByText('補助情報')).toBeTruthy();
  });

  it('passes evidenceOpenLabel through to the evidence panel', () => {
    render(
      <WorkspaceActionRail
        evidence={[{ id: 'e1', label: '照会回答', meta: '09:31' }]}
        evidenceOpenLabel="開く"
      />,
    );

    expect(screen.getByRole('button', { name: '開く' })).toBeTruthy();
  });

  it('uses a Japanese accessible name for the drawer close button', () => {
    render(
      <WorkspaceActionRail nextAction={{ actionLabel: '確認する', description: '確認します。' }} />,
    );

    expect(screen.getByRole('button', { name: '補助パネルを閉じる' })).toBeTruthy();
  });

  it('closes the auxiliary panel on Escape', () => {
    render(
      <WorkspaceActionRail
        nextAction={{ description: '医師への確認を記録します。', actionLabel: '確認する' }}
      />,
    );

    expect(screen.getByTestId('workspace-action-rail')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useUIStore.getState().workspaceRailOpen).toBe(false);
  });
});

describe('GuardedWorkspaceActionRail', () => {
  it('renders loading through the shared segment loading state', () => {
    render(
      <GuardedWorkspaceActionRail
        isLoading
        isError={false}
        onRetry={vi.fn()}
        loadingTestId="workspace-action-rail-loading"
        loadingAriaLabel="稼働状況を読み込み中"
      />,
    );

    expect(screen.getByTestId('workspace-action-rail-loading')).toBeTruthy();
    const status = screen.getByRole('status', { name: '稼働状況を読み込み中' });
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(within(status).getByText('補助パネルの状態を取得しています。')).toBeTruthy();
  });

  it('renders a retryable segment error without raw backend detail', () => {
    const onRetry = vi.fn();
    const unsafeLegacyProps = {
      errorDetail:
        '患者: 山田 太郎 storage_key=s3://secret/report.pdf token=secret /api/dashboard/cockpit?debug=raw',
    } as { errorDetail: string };
    render(
      <GuardedWorkspaceActionRail
        isLoading={false}
        isError
        onRetry={onRetry}
        loadingTestId="workspace-action-rail-loading"
        loadingAriaLabel="稼働状況を読み込み中"
        errorTitle="稼働状況を取得できませんでした"
        errorDescription="次にやることと止まっている理由の取得に失敗しました。再試行してください。"
        {...unsafeLegacyProps}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: '稼働状況を取得できませんでした' }),
    ).toBeTruthy();
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(
      '次にやることと止まっている理由の取得に失敗しました。再試行してください。',
    );
    expect(status.textContent).toContain(
      '取得失敗は問題なしではありません。通信状態を確認して再試行してください。',
    );
    expect(screen.queryByText(/storage_key/)).toBeNull();
    expect(screen.queryByText(/山田 太郎/)).toBeNull();
    expect(screen.queryByText(/token=secret/)).toBeNull();
    expect(screen.queryByText(/patient_name/)).toBeNull();
    expect(screen.queryByText(/\/api\/dashboard\/cockpit/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
