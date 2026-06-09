// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardSortKey } from '@/phos/contracts/phos_contracts';
import { SortSelect } from './SortSelect';

describe('SortSelect', () => {
  it('renders all P0 sort options and emits the selected value', () => {
    const onSortChange = vi.fn();
    render(<SortSelect sortKey={BoardSortKey.VISIT_TIME} onSortChange={onSortChange} />);

    expect(screen.getByRole('option', { name: '訪問時間順' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '緊急度順' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '滞留時間順' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '現在工程順' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '担当者順' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '施設順' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '更新順' })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: BoardSortKey.STALE_TIME } });

    expect(onSortChange).toHaveBeenCalledWith(BoardSortKey.STALE_TIME);
  });
});
