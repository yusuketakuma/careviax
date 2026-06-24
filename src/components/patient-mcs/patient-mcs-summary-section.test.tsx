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

// Actual-backed spy: real encode/guard output for the hostile test, plus
// return-value delegation teeth for the MCS fallback link.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

import { buildPatientHref } from '@/lib/patient/navigation';
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
      />,
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
      />,
    );

    expect(
      screen.getByText('同期エラー中のため、以下は前回成功時点の MCS 要約です。'),
    ).not.toBeNull();
  });

  it('renders an explanatory state when summary data is missing', () => {
    const patientId = '../settings?x=1#frag';
    const encodedPatientId = encodeURIComponent(patientId);

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
        patientId={patientId}
        title="MCS共有要点"
        description="test"
        compact
      />,
    );

    expect(
      screen.getByText(
        'MCS の要点サマリーはまだありません。患者詳細の MCS 連携ページで同期するとここに表示されます。',
      ),
    ).not.toBeNull();
    const link = screen.getByRole('link', { name: 'MCS 連携ページ' });
    expect(link.getAttribute('href')).toBe(`/patients/${encodedPatientId}/mcs`);
    expect(link.getAttribute('href')).not.toContain(patientId);
    // raw id passed to the helper (not pre-encoded) -> no double-encode
    expect(link.getAttribute('href')).not.toContain('%25');
  });

  it('the MCS fallback link consumes the shared buildPatientHref return value (raw id, no double-encode)', () => {
    useQueryMock.mockReturnValue({
      data: { link: null, summary: null },
      isLoading: false,
      error: null,
    });
    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/patients/__sentinel_${id}__${suffix}`,
    );
    try {
      render(
        <PatientMcsSummarySection
          patientId="patient_1"
          title="MCS共有要点"
          description="test"
          compact
        />,
      );
      expect(screen.getByRole('link', { name: 'MCS 連携ページ' }).getAttribute('href')).toBe(
        '/patients/__sentinel_patient_1__/mcs',
      );
      expect(vi.mocked(buildPatientHref).mock.calls).toEqual([['patient_1', '/mcs']]);
    } finally {
      if (realImpl) {
        vi.mocked(buildPatientHref).mockImplementation(realImpl);
      }
    }
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
      />,
    );

    expect(
      screen.getByText(
        'このロールでは MCS 要点を表示しません。必要時は権限のある担当者から確認してください。',
      ),
    ).not.toBeNull();
  });
});
