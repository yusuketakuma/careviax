// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { IntakeTriageLoading } from './intake-triage-loading';

setupDomTestEnv();

describe('IntakeTriageLoading', () => {
  it('reserves the intake header, queue, process strip, and action rail layout', () => {
    const { container } = render(<IntakeTriageLoading />);

    expect(screen.getByRole('status', { name: '処方取込トリアージを読み込み中' })).toBeTruthy();
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.rounded-lg.border').length).toBeGreaterThanOrEqual(5);
  });
});
