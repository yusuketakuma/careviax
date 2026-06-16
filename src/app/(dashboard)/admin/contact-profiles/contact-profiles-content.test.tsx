// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    expect(await screen.findByRole('button', { name: /山本ケアプランセンター/ })).toBeTruthy();
    expect((screen.getByLabelText('宛先') as HTMLInputElement).value).toBe(
      '山本ケアプランセンター',
    );
    expect(screen.getByText('表示中')).toBeTruthy();
    expect(screen.getByText('未完了')).toBeTruthy();
    expect(screen.getByText('方法未設定')).toBeTruthy();
    expect(screen.getByRole('region', { name: '保存前チェック' })).toBeTruthy();
    expect(screen.getByText('FAXで送付できます')).toBeTruthy();
    expect(screen.getByText('推奨 FAX → 電話')).toBeTruthy();
    expect(screen.getByRole('button', { name: '送付先を保存する' })).toBeTruthy();
  });
});
