// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { HelpPopover } from './help-popover';

setupDomTestEnv();

describe('HelpPopover', () => {
  it('opens the help window on click for touch/mobile use', () => {
    render(<HelpPopover title="処方登録" description="受付済み処方を登録します。" />);

    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '処方登録の説明' }));

    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.getByText('受付済み処方を登録します。')).toBeTruthy();
  });
});
