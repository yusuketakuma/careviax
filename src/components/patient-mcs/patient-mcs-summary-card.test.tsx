// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientMcsSummaryCard } from './patient-mcs-summary-card';

setupDomTestEnv();

const summary = {
  id: 'summary_1',
  generationId: 'gen_1',
  provider: 'rule',
  requestedProvider: 'disabled',
  isFallback: true,
  model: null,
  fallbackReason: 'provider_unavailable',
  headline: '看護師から共有があります。',
  bullets: ['食欲低下が続いています。'],
  mustCheckToday: [],
  suggestedActions: [],
  sourceRefs: [],
  messageCount: 1,
  otherProfessionalMessageCount: 1,
  latestPostedAt: '2026-04-02T08:00:00.000Z',
  generatedAt: '2026-04-02T08:05:00.000Z',
  durationMs: null,
};

describe('PatientMcsSummaryCard', () => {
  it('shows a single fallback line instead of empty sections in compact mode', () => {
    render(<PatientMcsSummaryCard summary={summary} compact />);

    expect(screen.getByText('看護師から共有があります。')).toBeTruthy();
    expect(screen.getAllByText('共有要点')).toHaveLength(1);
    expect(screen.queryByText('本日確認')).toBeNull();
    expect(screen.queryByText('業務アクション')).toBeNull();
  });

  it('renders a compact fallback message when no extracted section has items', () => {
    render(
      <PatientMcsSummaryCard
        summary={{
          ...summary,
          bullets: [],
        }}
        compact
      />
    );

    expect(screen.getByText('要点抽出はまだありません。次回同期後に更新します。')).toBeTruthy();
  });
});
