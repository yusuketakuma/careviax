// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import PatientsPage from './page';

setupDomTestEnv();

vi.mock('./patients-board', () => ({
  PatientsBoard: () => <div data-testid="patients-board">patients-board</div>,
}));

vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('PatientsPage', () => {
  it('renders the card-first patient board without the legacy table section', () => {
    render(<PatientsPage />);

    expect(screen.getByTestId('patients-board')).toBeTruthy();
    expect(screen.queryByText('patients-table')).toBeNull();
  });
});
