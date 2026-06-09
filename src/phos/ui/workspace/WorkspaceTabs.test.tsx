// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
} from '@/phos/contracts/phos_contracts';
import type { CardDetailResponse } from '@/phos/contracts/phos_contracts';
import { WorkspaceTabs } from './WorkspaceTabs';

function detail(overrides: Partial<CardDetailResponse> = {}): CardDetailResponse {
  return {
    card: {
      card_id: 'card_1',
      card_type: CardType.PRESCRIPTION,
      patient_name: '患者 山田太郎',
      current_step: CurrentStep.DIFF_REVIEW,
      display_status: DisplayStatus.READY,
      server_version: 1,
      tags: [],
    },
    visible_tabs: ['OVERVIEW', 'PRESCRIPTION'],
    permissions: {
      can_read: true,
      can_write: true,
      allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    },
    next_action: {
      code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      kind: ActionKind.STEP_CHANGING,
      label_key: 'action.confirm_prescription_diff',
      enabled: true,
      offline_allowed: false,
      priority: 'PRIMARY',
      required_role: [],
      target_endpoint: '/cards/card_1/actions',
      ui_state: ButtonState.ACTIONABLE,
      can_user_handle: true,
    },
    blockers: [],
    pharmacist_brief: {
      clinical_signals: [],
      decisions_required: [],
      communication_recommendations: [
        {
          intent: 'ASK_PRESCRIBER',
          target_type: 'DOCTOR',
          rationale: '処方医へ共有します。',
          draft_seed_key: 'doctor_seed_1',
        },
      ],
      claim_warnings: [],
      source_refs: [],
    },
    support_brief: {
      support_tasks: [],
      missing_contacts: [],
      delivery_targets: [
        {
          target_id: 'doctor_1',
          target_type: 'DOCTOR',
          label: '青空クリニック',
          delivery_method: 'FAX',
          ready: true,
        },
      ],
      schedule_candidates: [],
      missing_evidences: [],
      waiting_replies: [],
      pharmacist_review_reasons: [],
    },
    source_refs: [
      {
        kind: 'PRESCRIPTION',
        ref_id: 'rx_1',
        label: '処方箋 1',
      },
      {
        kind: 'RULE_DOCUMENT',
        ref_id: 'rule_1',
        label: '算定ルール',
      },
    ],
    server_version: 1,
    ...overrides,
  };
}

describe('WorkspaceTabs', () => {
  it('renders only server-provided visible tabs and does not infer from card type', () => {
    render(<WorkspaceTabs detail={detail({ visible_tabs: ['OVERVIEW'] })} />);

    expect(screen.getByRole('tab', { name: '概要' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '処方' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '算定' })).toBeNull();
  });

  it('switches active tab and filters source refs by tab contract', () => {
    render(<WorkspaceTabs detail={detail({ visible_tabs: ['OVERVIEW', 'CLAIM_HISTORY'] })} />);

    expect(screen.getByText('処方箋 1')).toBeTruthy();
    expect(screen.getByText('処方原文')).toBeTruthy();
    expect(screen.getByText('算定ルール')).toBeTruthy();
    expect(screen.queryByText('PRESCRIPTION / rx_1')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '算定' }));

    expect(screen.queryByText('処方箋 1')).toBeNull();
    expect(screen.getByText('算定ルール')).toBeTruthy();
    expect(screen.getByText('算定・制度資料')).toBeTruthy();
    expect(screen.queryByText('RULE_DOCUMENT / rule_1')).toBeNull();
  });

  it('renders an empty tab state when the server returns no visible tabs', () => {
    render(<WorkspaceTabs detail={detail({ visible_tabs: [] })} />);

    expect(screen.getByText('表示可能なタブはありません。')).toBeTruthy();
  });

  it('renders Report Composer only on the server-visible visit report tab', () => {
    render(<WorkspaceTabs detail={detail({ visible_tabs: ['OVERVIEW', 'VISIT_REPORT'] })} />);

    expect(screen.queryByRole('heading', { name: '報告書作成' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '訪問・報告' }));

    expect(screen.getByRole('heading', { name: '報告書作成' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: '宛先タブ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '医師確認' })).toBeTruthy();
    expect(
      screen.getByText((_, element) => element?.textContent === '医師 / 青空クリニック'),
    ).toBeTruthy();
  });
});
