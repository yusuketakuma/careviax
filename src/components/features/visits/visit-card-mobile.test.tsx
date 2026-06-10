// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VisitCardMobile, type VisitStatus } from './visit-card-mobile';

setupDomTestEnv();

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} onClick={(event) => event.preventDefault()} {...props}>
      {children}
    </a>
  ),
}));

const baseProps = {
  id: 'schedule_1',
  patientName: '山田花子',
  address: '東京都千代田区1-1-1',
  actionContextLabel: '山田花子 4/9 18:00 - 19:00',
};

function swipeRight() {
  const card = screen.getByRole('article', {
    name: '訪問カード: 山田花子 4/9 18:00 - 19:00',
  });
  fireEvent.touchStart(card, {
    changedTouches: [{ clientX: 20, clientY: 80 }],
  });
  fireEvent.touchEnd(card, {
    changedTouches: [{ clientX: 110, clientY: 86 }],
  });
}

describe('VisitCardMobile', () => {
  it.each(['ready', 'departed'] as const)(
    'starts %s visits by tap and right swipe with the schedule id',
    (status) => {
      const handleStart = vi.fn();

      render(<VisitCardMobile {...baseProps} status={status} onStartVisit={handleStart} />);

      fireEvent.click(
        screen.getByRole('button', {
          name: '山田花子 4/9 18:00 - 19:00の訪問開始',
        }),
      );
      expect(handleStart).toHaveBeenCalledWith('schedule_1');

      swipeRight();
      expect(handleStart).toHaveBeenCalledTimes(2);
      expect(screen.getByText('右スワイプで訪問開始')).toBeTruthy();
    },
  );

  it.each(['planned', 'in_preparation', 'completed', 'cancelled'] as VisitStatus[])(
    'does not expose or swipe-start non-departure statuses (%s)',
    (status) => {
      const handleStart = vi.fn();

      render(<VisitCardMobile {...baseProps} status={status} onStartVisit={handleStart} />);

      expect(screen.queryByRole('button', { name: /訪問開始/ })).toBeNull();
      expect(screen.queryByText(/右スワイプ/)).toBeNull();

      swipeRight();
      expect(handleStart).not.toHaveBeenCalled();
    },
  );

  it('labels blocked carry-item starts as warning review actions', () => {
    const handleStart = vi.fn();

    render(
      <VisitCardMobile
        {...baseProps}
        status="ready"
        carryItemsStatus="blocked"
        onStartVisit={handleStart}
      />,
    );

    expect(screen.getByText('持参物 未確定')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: '山田花子 4/9 18:00 - 19:00の持参物未確定を確認',
      }),
    ).toBeTruthy();
    expect(screen.getByText('右スワイプで持参物未確定の警告を確認')).toBeTruthy();

    swipeRight();
    expect(handleStart).toHaveBeenCalledWith('schedule_1');
  });

  it('labels partial carry-item starts as acknowledgement-required actions', () => {
    const handleStart = vi.fn();

    render(
      <VisitCardMobile
        {...baseProps}
        status="ready"
        carryItemsStatus="partial"
        onStartVisit={handleStart}
      />,
    );

    expect(screen.getByText('持参物 一部未確定')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: '山田花子 4/9 18:00 - 19:00の警告を確認して訪問開始',
      }),
    ).toBeTruthy();
    expect(screen.getByText('右スワイプで警告を確認して訪問開始')).toBeTruthy();

    swipeRight();
    expect(handleStart).toHaveBeenCalledWith('schedule_1');
  });

  it('distinguishes generated empty briefs from missing or unavailable briefs', () => {
    const { rerender } = render(
      <VisitCardMobile
        {...baseProps}
        status="ready"
        mustCheckToday={[]}
        visitBriefStatus="available"
      />,
    );

    expect(screen.getByText('本日重要チェックなし（軽量ブリーフ確認済み）')).toBeTruthy();

    rerender(<VisitCardMobile {...baseProps} status="ready" visitBriefStatus="missing" />);

    expect(screen.getByText('ブリーフ未取得 - 患者詳細と処方を確認')).toBeTruthy();

    rerender(<VisitCardMobile {...baseProps} status="ready" visitBriefStatus="unavailable" />);

    expect(screen.getByText('ブリーフ確認不可 - 患者詳細と処方を確認')).toBeTruthy();
  });
});
