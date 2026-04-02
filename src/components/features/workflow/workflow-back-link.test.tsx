// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { WorkflowBackLink } from './workflow-back-link';

setupDomTestEnv();

describe('WorkflowBackLink', () => {
  it('renders a compact back link for page-level navigation', () => {
    render(<WorkflowBackLink href="/patients" label="患者一覧へ戻る" />);

    const link = screen.getByRole('link', { name: '患者一覧へ戻る' });
    expect(link.getAttribute('href')).toEqual('/patients');
  });
});
