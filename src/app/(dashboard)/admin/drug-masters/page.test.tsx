// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

// Mock the real content component with a sentinel that records the variant prop, so
// this test proves the page wires the live-data DrugMasterContent (variant='master')
// rather than the fabricated MasterEditorView stub (固定 '薬剤マスター1〜8' / 保存無効).
const drugMasterContentMock = vi.hoisted(() => vi.fn());
vi.mock('./drug-master-content', () => ({
  DrugMasterContent: (props: { variant?: string }) => {
    drugMasterContentMock(props);
    return <div data-testid="drug-master-content">variant:{props.variant}</div>;
  },
}));

// Guard: if the page ever regresses to the stub, this mock makes the stub render a
// detectable marker so the assertions below fail loudly.
vi.mock('../master-editor-view', () => ({
  MasterEditorView: () => <div data-testid="master-editor-stub">STUB</div>,
}));

import DrugMastersPage from './page';

setupDomTestEnv();

describe('DrugMastersPage', () => {
  it('renders the live-data DrugMasterContent in master variant, not the placeholder stub', () => {
    render(<DrugMastersPage />);

    expect(screen.getByTestId('drug-master-content')).toBeTruthy();
    expect(screen.queryByTestId('master-editor-stub')).toBeNull();
    expect(drugMasterContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'master' }),
    );
  });
});
