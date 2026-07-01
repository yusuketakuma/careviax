// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

// Mock the real content component with a sentinel that records the variant prop, so
// this test proves the page wires the live-data DrugMasterContent (variant='master').
const drugMasterContentMock = vi.hoisted(() => vi.fn());
vi.mock('./drug-master-content', () => ({
  DrugMasterContent: (props: { variant?: string }) => {
    drugMasterContentMock(props);
    return <div data-testid="drug-master-content">variant:{props.variant}</div>;
  },
}));

import DrugMastersPage from './page';

setupDomTestEnv();

describe('DrugMastersPage', () => {
  it('renders the live-data DrugMasterContent in master variant, not the placeholder stub', () => {
    render(<DrugMastersPage />);

    expect(screen.getByTestId('drug-master-content')).toBeTruthy();
    expect(drugMasterContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'master' }),
    );
  });
});
