// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionPhase,
  VisitArrivalOutcome,
  VisitStatus,
  VisitStep,
} from '@/phos/contracts/phos_contracts';
import type { VisitModeView } from '@/phos/contracts/phos_contracts';
import { VisitMode } from './VisitMode';

const allIncomplete = Object.fromEntries(
  Object.values(VisitStep).map((step) => [step, false]),
) as Record<VisitStep, boolean>;

function visit(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    server_version: 1,
    patient_name: '患者 山田太郎',
    facility: '青空ホーム',
    room: '101',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [
      VisitStep.ARRIVAL_CONFIRM,
      VisitStep.EVIDENCE_UPLOAD,
      VisitStep.COMPLETE_CHECK,
    ],
    required_steps: [
      VisitStep.ARRIVAL_CONFIRM,
      VisitStep.EVIDENCE_UPLOAD,
      VisitStep.COMPLETE_CHECK,
    ],
    step_completed: allIncomplete,
    last_opened_step: VisitStep.ARRIVAL_CONFIRM,
    evidence_sync: {
      blocking_unsynced_count: 0,
      non_blocking_unsynced_count: 0,
    },
    online: true,
    ...overrides,
  };
}

describe('VisitMode', () => {
  it('renders only server-returned applicable steps', () => {
    render(
      <VisitMode
        visit={visit({ applicable_steps: [VisitStep.ARRIVAL_CONFIRM] })}
        onArrivalOutcome={vi.fn()}
        onOpenStep={vi.fn()}
        onCompleteVisit={vi.fn()}
      />,
    );

    expect(screen.getAllByText('到着確認').length).toBeGreaterThan(0);
    expect(screen.queryByText('残薬確認')).toBeNull();
    expect(screen.queryByText('証跡添付')).toBeNull();
  });

  it('handles non-cancel arrival branches and holds CANCELED for reason flow', () => {
    const onArrivalOutcome = vi.fn();
    render(
      <VisitMode
        visit={visit()}
        onArrivalOutcome={onArrivalOutcome}
        onOpenStep={vi.fn()}
        onCompleteVisit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '在宅' }));
    fireEvent.click(screen.getByRole('button', { name: '不在' }));
    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(onArrivalOutcome.mock.calls.map((call) => call[0])).toEqual([
      VisitArrivalOutcome.PRESENT,
      VisitArrivalOutcome.ABSENT,
      VisitArrivalOutcome.POSTPONED,
    ]);
  });

  it('does not render arrival branches when ARRIVAL_CONFIRM is not server-applicable', () => {
    const onArrivalOutcome = vi.fn();
    render(
      <VisitMode
        visit={visit({ applicable_steps: [VisitStep.EVIDENCE_UPLOAD] })}
        onArrivalOutcome={onArrivalOutcome}
        onOpenStep={vi.fn()}
        onCompleteVisit={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '在宅' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'キャンセル' })).toBeNull();
  });

  it('requires a cancel reason before emitting the CANCELED branch', () => {
    const onArrivalOutcome = vi.fn();
    render(
      <VisitMode
        visit={visit()}
        onArrivalOutcome={onArrivalOutcome}
        onOpenStep={vi.fn()}
        onCompleteVisit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByText('キャンセル理由を入力してください。')).toBeTruthy();
    expect(onArrivalOutcome).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('キャンセル理由'), {
      target: { value: '訪問予定を取り消す必要があるため' },
    });
    fireEvent.click(screen.getByRole('button', { name: '理由を付けてキャンセル' }));

    expect(onArrivalOutcome).toHaveBeenCalledWith(
      VisitArrivalOutcome.CANCELED,
      '訪問予定を取り消す必要があるため',
    );
  });

  it('blocks complete execution until required steps and mandatory sync are clear', () => {
    const onCompleteVisit = vi.fn();
    render(
      <VisitMode
        visit={visit({
          step_completed: {
            ...allIncomplete,
            [VisitStep.ARRIVAL_CONFIRM]: true,
            [VisitStep.EVIDENCE_UPLOAD]: true,
            [VisitStep.COMPLETE_CHECK]: true,
          },
          evidence_sync: {
            blocking_unsynced_count: 1,
            non_blocking_unsynced_count: 0,
          },
        })}
        onArrivalOutcome={vi.fn()}
        onOpenStep={vi.fn()}
        onCompleteVisit={onCompleteVisit}
      />,
    );

    const complete = screen.getByRole('button', { name: '訪問を完了する（未完了）' });
    fireEvent.click(complete);

    expect(complete.getAttribute('data-enabled')).toBe('false');
    expect(screen.getByText('必須未同期 1件')).toBeTruthy();
    expect(onCompleteVisit).not.toHaveBeenCalled();
  });

  it('allows complete execution when required steps are complete and optional sync remains', () => {
    const onCompleteVisit = vi.fn();
    render(
      <VisitMode
        visit={visit({
          step_completed: {
            ...allIncomplete,
            [VisitStep.ARRIVAL_CONFIRM]: true,
            [VisitStep.EVIDENCE_UPLOAD]: true,
            [VisitStep.COMPLETE_CHECK]: true,
          },
          evidence_sync: {
            blocking_unsynced_count: 0,
            non_blocking_unsynced_count: 1,
          },
        })}
        onArrivalOutcome={vi.fn()}
        onOpenStep={vi.fn()}
        onCompleteVisit={onCompleteVisit}
      />,
    );

    const complete = screen.getByRole('button', { name: '訪問を完了する' });
    fireEvent.click(complete);

    expect(complete.getAttribute('data-enabled')).toBe('true');
    expect(screen.getByText('任意未同期 1件')).toBeTruthy();
    expect(onCompleteVisit).toHaveBeenCalledWith();
  });

  it('blocks complete execution when mandatory local evidence is pending sync', () => {
    const onCompleteVisit = vi.fn();
    render(
      <VisitMode
        visit={visit({
          step_completed: {
            ...allIncomplete,
            [VisitStep.ARRIVAL_CONFIRM]: true,
            [VisitStep.EVIDENCE_UPLOAD]: true,
            [VisitStep.COMPLETE_CHECK]: true,
          },
        })}
        pendingEvidence={[
          {
            evidence_key: 'mandatory_photo',
            label: '必須写真',
            offline_op_class: 'BLOCKING',
            created_at: '2026-06-09T00:00:00.000Z',
            retry_count: 0,
          },
        ]}
        onArrivalOutcome={vi.fn()}
        onOpenStep={vi.fn()}
        onCompleteVisit={onCompleteVisit}
      />,
    );

    const complete = screen.getByRole('button', { name: '訪問を完了する（未完了）' });
    fireEvent.click(complete);

    expect(screen.getByRole('region', { name: '同期待ち証跡' })).toBeTruthy();
    expect(screen.getByText('必須写真')).toBeTruthy();
    expect(screen.getByText('必須未同期 1件')).toBeTruthy();
    expect(onCompleteVisit).not.toHaveBeenCalled();
  });

  it('allows complete execution when only optional local evidence is pending sync', () => {
    const onCompleteVisit = vi.fn();
    render(
      <VisitMode
        visit={visit({
          step_completed: {
            ...allIncomplete,
            [VisitStep.ARRIVAL_CONFIRM]: true,
            [VisitStep.EVIDENCE_UPLOAD]: true,
            [VisitStep.COMPLETE_CHECK]: true,
          },
        })}
        pendingEvidence={[
          {
            evidence_key: 'optional_photo',
            label: '任意写真',
            offline_op_class: 'NON_BLOCKING',
            created_at: '2026-06-09T00:00:00.000Z',
            retry_count: 0,
          },
        ]}
        onArrivalOutcome={vi.fn()}
        onOpenStep={vi.fn()}
        onCompleteVisit={onCompleteVisit}
      />,
    );

    const complete = screen.getByRole('button', { name: '訪問を完了する' });
    fireEvent.click(complete);

    expect(screen.getByText('任意写真')).toBeTruthy();
    expect(screen.getByText('任意未同期 1件')).toBeTruthy();
    expect(onCompleteVisit).toHaveBeenCalledWith();
  });

  it('blocks completion when server visit_status is not in progress', () => {
    const onCompleteVisit = vi.fn();
    render(
      <VisitMode
        visit={visit({
          visit_status: VisitStatus.SCHEDULED,
          step_completed: {
            ...allIncomplete,
            [VisitStep.ARRIVAL_CONFIRM]: true,
            [VisitStep.EVIDENCE_UPLOAD]: true,
            [VisitStep.COMPLETE_CHECK]: true,
          },
        })}
        onArrivalOutcome={vi.fn()}
        onOpenStep={vi.fn()}
        onCompleteVisit={onCompleteVisit}
      />,
    );

    const complete = screen.getByRole('button', { name: '訪問を完了する（未完了）' });
    fireEvent.click(complete);

    expect(onCompleteVisit).not.toHaveBeenCalled();
  });

  it('locks only the completion action while submitting', () => {
    const onCompleteVisit = vi.fn();
    render(
      <VisitMode
        visit={visit({
          step_completed: {
            ...allIncomplete,
            [VisitStep.ARRIVAL_CONFIRM]: true,
            [VisitStep.EVIDENCE_UPLOAD]: true,
            [VisitStep.COMPLETE_CHECK]: true,
          },
        })}
        actionPhase={ActionPhase.SUBMITTING}
        onArrivalOutcome={vi.fn()}
        onOpenStep={vi.fn()}
        onCompleteVisit={onCompleteVisit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '訪問を完了する（未完了）' }));

    expect(onCompleteVisit).not.toHaveBeenCalled();
  });
});
