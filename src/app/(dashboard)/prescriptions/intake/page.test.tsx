// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const intakeTriageContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./intake-triage-content', () => ({
  IntakeTriageContent: () => {
    if (intakeTriageContentMockState.suspend) {
      throw intakeTriageContentMockState.promise;
    }
    return <section data-testid="intake-triage-content" />;
  },
}));

import PrescriptionIntakeTriagePage from './page';

setupDomTestEnv();

describe('PrescriptionIntakeTriagePage', () => {
  beforeEach(() => {
    intakeTriageContentMockState.suspend = false;
  });

  it('renders the intake triage content', () => {
    render(<PrescriptionIntakeTriagePage />);

    expect(screen.getByTestId('intake-triage-content')).toBeTruthy();
  });

  it('uses a screen-specific loading status for the route shell fallback', () => {
    intakeTriageContentMockState.suspend = true;

    render(<PrescriptionIntakeTriagePage />);

    expect(screen.getByRole('status', { name: '処方取込を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('intake-triage-content')).toBeNull();
  });
});
