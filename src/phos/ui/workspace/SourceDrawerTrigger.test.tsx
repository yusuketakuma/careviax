// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceDrawerTrigger } from './SourceDrawerTrigger';

describe('SourceDrawerTrigger', () => {
  it('opens and closes source refs from the right pane trigger', () => {
    render(
      <SourceDrawerTrigger
        sources={[
          {
            kind: 'PRESCRIPTION',
            ref_id: 'rx_1',
            label: '処方箋 1',
          },
        ]}
      />,
    );

    expect(screen.queryByText('処方箋 1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '参照情報を開く' }));
    expect(screen.getByText('処方箋 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '参照情報を閉じる' }));
    expect(screen.queryByText('処方箋 1')).toBeNull();
  });
});
