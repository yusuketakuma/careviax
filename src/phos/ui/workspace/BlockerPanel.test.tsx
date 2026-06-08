// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionCode, BlockerSeverity, UserRole } from '@/phos/contracts/phos_contracts';
import type { BlockerView } from '@/phos/contracts/phos_contracts';
import { BlockerPanel } from './BlockerPanel';

const activeBlocker = {
  blocker_code: 'MISSING_EVIDENCE',
  severity: BlockerSeverity.ERROR,
  owner_role: UserRole.PHARMACY_CLERK,
  message_key: 'blocker.missing_evidence',
  required_action_code: ActionCode.UPLOAD_EVIDENCE,
  active: true,
} satisfies BlockerView;

describe('BlockerPanel', () => {
  it('renders active blockers without hiding safety-critical details', () => {
    render(
      <BlockerPanel
        blockers={[
          activeBlocker,
          {
            ...activeBlocker,
            blocker_code: 'RESOLVED',
            message_key: 'blocker.resolved',
            active: false,
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: '不足・確認事項' })).toBeTruthy();
    expect(screen.getByText('1件')).toBeTruthy();
    expect(screen.getByText('証跡が不足しています。')).toBeTruthy();
    expect(screen.getByText('担当: 事務 / MISSING_EVIDENCE')).toBeTruthy();
    expect(screen.getByText('必要操作: 証跡を添付する')).toBeTruthy();
    expect(screen.queryByText('blocker.resolved')).toBeNull();
  });

  it('renders a safe fallback for unknown blocker message keys', () => {
    render(<BlockerPanel blockers={[{ ...activeBlocker, message_key: 'blocker.unknown' }]} />);

    expect(screen.getByText('確認が必要な項目です。')).toBeTruthy();
    expect(screen.queryByText('blocker.unknown')).toBeNull();
  });

  it('renders a stable empty state when there are no active blockers', () => {
    render(<BlockerPanel blockers={[]} />);

    expect(screen.getByText('未解消の不足はありません。')).toBeTruthy();
  });
});
