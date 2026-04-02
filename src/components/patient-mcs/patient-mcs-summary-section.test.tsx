// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

import { PatientMcsSummarySection } from './patient-mcs-summary-section';

setupDomTestEnv();

describe('PatientMcsSummarySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the compact summary card when summary data exists', () => {
    useQueryMock.mockReturnValue({
      data: {
        link: {
          lastSyncError: null,
        },
        summary: {
          id: 'summary_1',
          generationId: 'gen_1',
          provider: 'rule',
          requestedProvider: 'disabled',
          isFallback: true,
          model: null,
          fallbackReason: 'provider_unavailable',
          headline: '看護師から共有があります。',
          bullets: ['共有要点があります。'],
          mustCheckToday: ['本日確認してください。'],
          suggestedActions: ['折返し連絡してください。'],
          sourceRefs: [],
          messageCount: 2,
          otherProfessionalMessageCount: 1,
          latestPostedAt: null,
          generatedAt: '2026-04-02T08:05:00.000Z',
          durationMs: null,
        },
      },
      isLoading: false,
      error: null,
    });

    render(
      <PatientMcsSummarySection
        patientId="patient_1"
        title="MCS共有要点"
        description="test"
        compact
      />
    );

    expect(screen.getByText('看護師から共有があります。')).not.toBeNull();
    expect(screen.getByText('折返し連絡してください。')).not.toBeNull();
  });

  it('renders a stale warning when the latest sync failed', () => {
    useQueryMock.mockReturnValue({
      data: {
        link: {
          lastSyncError: 'MCS からデータを取得できませんでした。',
        },
        summary: {
          id: 'summary_1',
          generationId: 'gen_1',
          provider: 'rule',
          requestedProvider: 'disabled',
          isFallback: true,
          model: null,
          fallbackReason: 'provider_unavailable',
          headline: '看護師から共有があります。',
          bullets: ['共有要点があります。'],
          mustCheckToday: [],
          suggestedActions: [],
          sourceRefs: [],
          messageCount: 2,
          otherProfessionalMessageCount: 1,
          latestPostedAt: null,
          generatedAt: '2026-04-02T08:05:00.000Z',
          durationMs: null,
        },
      },
      isLoading: false,
      error: null,
    });

    render(
      <PatientMcsSummarySection
        patientId="patient_1"
        title="MCS共有要点"
        description="test"
        compact
      />
    );

    expect(screen.getByText('同期エラー中のため、以下は前回成功時点の MCS 要約です。')).not.toBeNull();
  });

  it('renders an explanatory state when summary data is missing', () => {
    useQueryMock.mockReturnValue({
      data: {
        link: null,
        summary: null,
      },
      isLoading: false,
      error: null,
    });

    render(
      <PatientMcsSummarySection
        patientId="patient_1"
        title="MCS共有要点"
        description="test"
        compact
      />
    );

    expect(screen.getByText('MCS の要点サマリーはまだありません。患者詳細の MCS 連携ページで同期するとここに表示されます。')).not.toBeNull();
  });

  it('renders a restricted-role explanation instead of disappearing', () => {
    useQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    render(
      <PatientMcsSummarySection
        patientId="patient_1"
        title="MCS共有要点"
        description="test"
        compact
      />
    );

    expect(screen.getByText('このロールでは MCS 要点を表示しません。必要時は権限のある担当者から確認してください。')).not.toBeNull();
  });
});
