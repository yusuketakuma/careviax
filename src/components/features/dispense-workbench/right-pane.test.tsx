// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWorkbenchStore } from './dispensing-workbench.store';
import { RightPane } from './right-pane';
import type { WorkbenchView } from './dispensing-workbench.types';
import type { WorkbenchWriteHandlers } from './use-workbench-write-handlers';

function setAuditView(ngValue: string): WorkbenchView {
  return {
    rightTitle: 'セット監査',
    isGrid: false,
    isSet: false,
    isSeta: true,
    target: {
      date: '2026年4月1日（水）',
      timing: '朝食後',
      packetText: '1包',
      ptpText: 'PTP 1錠',
      hasPtp: true,
      drugs: ['アムロジピン錠5mg'],
      note: '',
      hasNote: false,
    },
    checkItems: [{ index: 0, label: '日付が正しい', checked: false }],
    ngValue,
    ngOptions: ['数量不足'],
    rejectList: [{ di: 0, tk: '朝', label: '2026年4月1日（水） 朝食後', ng: '数量不足' }],
    rejectEmpty: false,
    riskList: [{ rank: 1, label: 'ハイリスク薬を先に照合', color: '#b42318' }],
  } as unknown as WorkbenchView;
}

function setWorkView(): WorkbenchView {
  return {
    rightTitle: 'セット作業',
    isGrid: false,
    isSet: true,
    isSeta: false,
    target: {
      date: '2026年4月1日（水）',
      timing: '朝食後',
      packetText: '1包',
      ptpText: 'PTP 1錠',
      hasPtp: true,
      drugs: ['アムロジピン錠5mg'],
      note: '冷所薬は別袋で確認',
      hasNote: true,
    },
    setMethod: 'お薬カレンダーの該当ポケットへ投入',
    setSteps: [{ n: '1', label: '薬剤を取り出す', sub: '棚番 A-12' }],
    outsideMeds: [{ name: '外用薬を同梱', kind: '外用', kindColor: '#155eef', checked: false }],
    outsideEmpty: false,
    packetItems: [{ key: 'doc', label: '連絡票を同梱', checked: false }],
  } as unknown as WorkbenchView;
}

function gridView(): WorkbenchView {
  return {
    rightTitle: '調剤',
    isGrid: true,
    isSet: false,
    isSeta: false,
    cur: {
      avatarBg: '#155eef',
      initial: '田',
      name: '田中花子患者識別用の非常に長い氏名',
      kana: 'タナカハナコカンジャシキベツヨウノナガイカナ',
      chips: [{ label: '要確認', color: '#b42318', bg: '#fef3f2', border: '#fecdca' }],
      biko: ['服薬時に声かけをお願いします。'],
    },
    infoItems: [{ label: '生年月日', value: '1940/01/01' }],
  } as unknown as WorkbenchView;
}

function expectInlineFontSizesAtLeast12(container: HTMLElement) {
  const fontSizedElements = [...container.querySelectorAll<HTMLElement>('[style]')].filter(
    (element) => element.style.fontSize,
  );

  expect(fontSizedElements).not.toHaveLength(0);
  for (const element of fontSizedElements) {
    expect(Number.parseFloat(element.style.fontSize)).toBeGreaterThanOrEqual(12);
  }
}

function expectClinicalBodyText(text: string | RegExp) {
  const element = screen.getByText(text);
  let fontSizedElement: HTMLElement | null = element;

  while (fontSizedElement && !fontSizedElement.style.fontSize) {
    fontSizedElement = fontSizedElement.parentElement;
  }

  expect(fontSizedElement).not.toBeNull();
  expect(fontSizedElement?.style.fontSize).toBe('14px');
  expect(fontSizedElement?.style.lineHeight).toBe('1.6');
}

function expectInteractiveTargetsAtLeast44(container: HTMLElement, expectedCount: number) {
  const interactiveElements = [
    ...container.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select'),
  ];

  expect(interactiveElements).toHaveLength(expectedCount);
  for (const element of interactiveElements) {
    expect(element.style.minWidth).toBe('44px');
    expect(element.style.minHeight).toBe('44px');
    expect(element.style.boxSizing).toBe('border-box');
  }
}

const handlers = {
  onSetCell: vi.fn(),
  onAuditOk: vi.fn(),
  onAuditNg: vi.fn(),
  onOpenHold: vi.fn(),
  onToggleCheck: vi.fn(),
  onSetNg: vi.fn(),
  onReturnToSet: vi.fn(),
} as unknown as WorkbenchWriteHandlers;

describe('RightPane set work cell controls', () => {
  afterEach(() => {
    act(() => {
      useWorkbenchStore.setState({ target: null });
    });
  });

  it('requires a selected calendar cell before enabling set and hold actions', () => {
    render(<RightPane view={setWorkView()} phase="setp" handlers={handlers} />);

    expect(
      (screen.getByRole('button', { name: 'このセルへセット' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: '保留…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enables set and hold actions after a calendar cell is selected', () => {
    act(() => {
      useWorkbenchStore.setState({ target: { di: 0, tk: '朝' } });
    });

    render(<RightPane view={setWorkView()} phase="setp" handlers={handlers} />);

    expect(
      (screen.getByRole('button', { name: 'このセルへセット' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole('button', { name: '保留…' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('RightPane typography floor', () => {
  afterEach(() => {
    act(() => {
      useWorkbenchStore.setState({ target: null });
    });
  });

  it('keeps populated grid, set, and audit pane text at 12px or larger', () => {
    const views = [
      { phase: 'dispense' as const, view: gridView() },
      { phase: 'setp' as const, view: setWorkView() },
      { phase: 'seta' as const, view: setAuditView('数量不足') },
    ];

    for (const { phase, view } of views) {
      const { container, unmount } = render(
        <RightPane view={view} phase={phase} handlers={handlers} />,
      );

      expectInlineFontSizesAtLeast12(container);
      if (phase === 'dispense') {
        const patientName = screen.getByText('田中花子患者識別用の非常に長い氏名');
        const patientKana = screen.getByText('タナカハナコカンジャシキベツヨウノナガイカナ');

        expect(patientName.style.overflowWrap).toBe('anywhere');
        expect(patientName.parentElement?.style.minWidth).toBe('0px');
        expect(patientKana.style.overflowWrap).toBe('anywhere');
        expectClinicalBodyText('1940/01/01');
        expectClinicalBodyText('服薬時に声かけをお願いします。');
      }
      if (phase === 'setp') {
        expectClinicalBodyText('アムロジピン錠5mg');
        expectClinicalBodyText(/冷所薬は別袋で確認/);
        expectClinicalBodyText('お薬カレンダーの該当ポケットへ投入');
        expectClinicalBodyText('外用薬を同梱');

        const stepSub = screen.getByText('棚番 A-12');
        expect(stepSub.style.whiteSpace).toBe('normal');
        expect(stepSub.style.overflowWrap).toBe('anywhere');
      }
      if (phase === 'seta') {
        expectClinicalBodyText('アムロジピン錠5mg');
        expectClinicalBodyText('2026年4月1日（水） 朝食後');
        expectClinicalBodyText('NG：数量不足');
        expectClinicalBodyText('ハイリスク薬を先に照合');
      }
      unmount();
    }
  });
});

describe('RightPane pointer target contract', () => {
  afterEach(() => {
    act(() => {
      useWorkbenchStore.setState({ target: null });
    });
  });

  it('declares 44px targets on all set and set-audit controls without relying on parent CSS', () => {
    const setWork = render(<RightPane view={setWorkView()} phase="setp" handlers={handlers} />);
    expectInteractiveTargetsAtLeast44(setWork.container, 4);
    setWork.unmount();

    const setAudit = render(
      <RightPane view={setAuditView('数量不足')} phase="seta" handlers={handlers} />,
    );
    expectInteractiveTargetsAtLeast44(setAudit.container, 6);
  });
});

describe('RightPane scroll-region keyboard contract', () => {
  afterEach(() => {
    act(() => {
      useWorkbenchStore.setState({ target: null });
    });
  });

  it('names every overflow region and lets keyboard users focus it', () => {
    const grid = render(<RightPane view={gridView()} phase="dispense" handlers={handlers} />);
    const patientNotes = screen.getByRole('region', { name: '患者の備考・申し送り' });
    expect(patientNotes.tabIndex).toBe(0);
    expect(patientNotes.style.overflowY).toBe('auto');
    patientNotes.focus();
    expect(document.activeElement).toBe(patientNotes);
    grid.unmount();

    const setWork = render(<RightPane view={setWorkView()} phase="setp" handlers={handlers} />);
    for (const name of ['次にセットする薬剤一覧', 'カレンダーその他薬の同梱確認']) {
      const region = screen.getByRole('region', { name });
      expect(region.tabIndex).toBe(0);
      expect(region.style.overflowY).toBe('auto');
      region.focus();
      expect(document.activeElement).toBe(region);
    }
    setWork.unmount();

    render(<RightPane view={setAuditView('数量不足')} phase="seta" handlers={handlers} />);
    for (const name of ['セット監査の期待薬剤一覧', 'リスク確認順一覧']) {
      const region = screen.getByRole('region', { name });
      expect(region.tabIndex).toBe(0);
      expect(region.style.overflowY).toBe('auto');
      region.focus();
      expect(document.activeElement).toBe(region);
    }
  });
});

describe('RightPane set audit NG controls', () => {
  afterEach(() => {
    act(() => {
      useWorkbenchStore.setState({ target: null });
    });
  });

  it('requires an NG classification before enabling rejected audit submission', () => {
    act(() => {
      useWorkbenchStore.setState({ target: { di: 0, tk: '朝' } });
    });
    render(<RightPane view={setAuditView('')} phase="seta" handlers={handlers} />);

    expect((screen.getByRole('button', { name: 'NG・差戻し' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('requires a selected calendar cell before allowing NG classification', () => {
    render(<RightPane view={setAuditView('数量不足')} phase="seta" handlers={handlers} />);

    expect((screen.getByLabelText('NG分類') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'NG・差戻し' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: '監査OK' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: '日付が正しい' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: '保留…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enables rejected audit submission after an NG classification is selected', () => {
    act(() => {
      useWorkbenchStore.setState({ target: { di: 0, tk: '朝' } });
    });
    render(<RightPane view={setAuditView('数量不足')} phase="seta" handlers={handlers} />);

    expect((screen.getByRole('button', { name: 'NG・差戻し' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: '監査OK' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      (screen.getByRole('button', { name: '日付が正しい' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole('button', { name: '保留…' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
