// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ContactProfilesContent } from './contact-profiles-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const profiles = [
  {
    id: 'contact_1',
    kind: 'external_professional',
    name: '山本ケアプランセンター',
    subtitle: '担当: 佐藤ケアマネ',
    phone: '03-1111-2222',
    email: 'sato@example.test',
    fax: '03-1111-2223',
    preferred_contact_method: 'fax',
    preferred_contact_time: '午前',
    last_contacted_at: '2026-06-12T09:30:00.000Z',
    last_success_channel: 'fax',
    recommended_channels: ['fax', 'phone'],
    contact_reliability: {
      ready: true,
      warnings: [],
      missing_channel_labels: [],
    },
    active_patient_count: 4,
    pending_response_count: 1,
  },
  {
    id: 'contact_2',
    kind: 'prescriber_institution',
    name: '東中央クリニック',
    subtitle: '内科',
    phone: '03-3333-4444',
    email: null,
    fax: '03-3333-4445',
    preferred_contact_method: 'ph_os_share',
    preferred_contact_time: null,
    last_contacted_at: null,
    last_success_channel: null,
    recommended_channels: ['ph_os_share'],
    contact_reliability: {
      ready: false,
      warnings: ['FAX未確認'],
      missing_channel_labels: ['FAX'],
    },
    active_patient_count: 9,
    pending_response_count: 0,
  },
];

function renderContent() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContactProfilesContent />
    </QueryClientProvider>,
  );
}

describe('ContactProfilesContent', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: profiles }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a focused delivery target edit workspace and selects the first profile', async () => {
    renderContent();

    const workspace = await screen.findByTestId('contact-delivery-target-edit');
    expect(within(workspace).getByRole('heading', { name: '送付先一覧' })).toBeTruthy();
    expect(within(workspace).getByRole('heading', { name: '連絡先の編集' })).toBeTruthy();

    await waitFor(() => {
      expect(
        within(workspace).getByRole('button', { name: /山本ケアプランセンター/ }),
      ).toBeTruthy();
    });

    expect((screen.getByLabelText('宛先') as HTMLInputElement).value).toBe(
      '山本ケアプランセンター',
    );
    expect((screen.getByLabelText('FAX') as HTMLInputElement).value).toBe('03-1111-2223');
    expect((screen.getByLabelText('電話') as HTMLInputElement).value).toBe('03-1111-2222');
    expect(screen.getByText('未完了連携 1件')).toBeTruthy();
    expect(screen.getByText('要整備: FAX')).toBeTruthy();
  });

  it('shows delivery target review details in the current workspace', async () => {
    renderContent();

    await screen.findByTestId('contact-delivery-target-edit');
    expect(screen.getByText('検索・フィルタ')).toBeTruthy();
    expect(screen.getByLabelText('種別')).toBeTruthy();
    expect(screen.getByLabelText('検索')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /山本ケアプランセンター/ })).toBeTruthy();
    expect((screen.getByLabelText('宛先') as HTMLInputElement).value).toBe(
      '山本ケアプランセンター',
    );
    expect(screen.getByLabelText('送付方法')).toBeTruthy();
    expect(screen.getByText('表示中')).toBeTruthy();
    expect(screen.getByText('未完了')).toBeTruthy();
    expect(screen.getByText('方法未設定')).toBeTruthy();
    expect(screen.getByRole('region', { name: '保存前チェック' })).toBeTruthy();
    expect(screen.getByText('FAXで送付できます')).toBeTruthy();
    expect(screen.getByText('推奨 FAX → 電話')).toBeTruthy();
    expect(screen.getByRole('button', { name: '送付先を保存する' })).toBeTruthy();
  });

  it('renders the 未完了 KPI as a left-border accent without full state-color fill', async () => {
    renderContent();
    await screen.findByTestId('contact-delivery-target-edit');
    await waitFor(() => expect(screen.getByText('未完了')).toBeTruthy());

    // 未完了あり(fixture contact_1=1件)→左ボーダー+文字色で示し、全面塗りは使わない。
    const pendingTile = screen.getByText('未完了').closest('div');
    expect(pendingTile?.className).toContain('border-l-state-confirm');
    expect(pendingTile?.className).not.toContain('bg-state-confirm');
    expect(screen.getByText('未完了').className).toContain('text-state-confirm');
  });

  it('keeps the 未完了 KPI neutral (no state color) when there is no pending work', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: profiles.map((p) => ({ ...p, pending_response_count: 0 })) }),
    } as Response);

    renderContent();
    await screen.findByTestId('contact-delivery-target-edit');
    await waitFor(() => expect(screen.getByText('未完了')).toBeTruthy());

    // 0件は偽シグナル回避のため中立(状態色なし)。
    const pendingTile = screen.getByText('未完了').closest('div');
    expect(pendingTile?.className).not.toContain('border-l-state-confirm');
    expect(screen.getByText('未完了').className).not.toContain('text-state-confirm');
  });

  it('debounces search so a keystroke does not immediately issue a filtered fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: profiles }),
    } as Response);

    renderContent();
    await screen.findByTestId('contact-delivery-target-edit');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('検索'), { target: { value: '東' } });
    // 入力値は即時反映する。
    expect((screen.getByLabelText('検索') as HTMLInputElement).value).toBe('東');

    // マイクロタスクを流しても debounce 未経過のため q= 付き fetch は発火しない
    // (検索語が queryKey に直結していた旧実装ならここで q= fetch が走る)。
    // 300ms 経過後の発火自体は useDebouncedValue の単体テストで担保。
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchSpy.mock.calls.map((call) => String(call[0])).some((u) => u.includes('q='))).toBe(
      false,
    );
  });
});
