// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { FirstVisitDocumentsPanel } from './patient-documents-panel';

setupDomTestEnv();

describe('FirstVisitDocumentsPanel', () => {
  it('renders first-visit documents with a semantic section heading', () => {
    render(<FirstVisitDocumentsPanel cases={[]} documents={[]} />);

    expect(screen.getByRole('heading', { level: 2, name: '初回訪問文書・交付記録' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByText('初回訪問文書はまだありません')).toBeTruthy();
    expect(screen.getByRole('button', { name: '初回訪問文書はまだありませんの説明' })).toBeTruthy();
  });
});
