// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SourceDrawerTrigger } from './SourceDrawerTrigger';

describe('SourceDrawerTrigger', () => {
  it('opens source refs in a right-side sheet, keeps focus inside the source drawer, and returns focus on close', async () => {
    render(
      <>
        <SourceDrawerTrigger
          sources={[
            {
              kind: 'PRESCRIPTION',
              ref_id: 'rx_1',
              label: '処方箋 1',
              uri: 'https://example.test/rx_1',
            },
          ]}
        />
        <button type="button">Drawer外の操作</button>
      </>,
    );

    expect(screen.queryByText('処方箋 1')).toBeNull();

    const trigger = screen.getByRole('button', { name: '参照情報を開く' });
    const outsideButton = screen.getByRole('button', { name: 'Drawer外の操作' });
    fireEvent.click(trigger);
    const drawer = screen.getByRole('dialog', { name: '参照情報' });
    expect(within(drawer).getByText('処方箋 1')).toBeTruthy();
    expect(within(drawer).getByText('処方原文')).toBeTruthy();
    expect(within(drawer).queryByText('rx_1')).toBeNull();
    expect(within(drawer).queryByText('PRESCRIPTION')).toBeNull();
    expect(within(drawer).getByRole('link', { name: /原文/ }).getAttribute('href')).toBe(
      'https://example.test/rx_1',
    );

    const closeButton = within(drawer).getByRole('button', { name: '閉じる' });
    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(outsideButton);

    fireEvent.click(closeButton);
    expect(screen.queryByText('処方箋 1')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('renders only same-path and http source links while rejecting unsafe URI schemes', () => {
    render(
      <SourceDrawerTrigger
        sources={[
          {
            kind: 'PRESCRIPTION',
            ref_id: 'rx_safe',
            label: '相対パスの処方',
            uri: '/source/rx_safe',
          },
          {
            kind: 'CARE_PLAN',
            ref_id: 'care_safe',
            label: 'httpsケアプラン',
            uri: ' https://example.test/care_safe ',
          },
          {
            kind: 'EVIDENCE_FILE',
            ref_id: 'photo_1',
            label: '残薬写真',
            uri: 'javascript:alert(1)',
          },
          {
            kind: 'OTHER_PRO_MESSAGE',
            ref_id: 'message_1',
            label: '外部プロトコル相対',
            uri: '//evil.example/source',
          },
          {
            kind: 'RULE_DOCUMENT',
            ref_id: 'rule_1',
            label: 'ftp資料',
            uri: 'ftp://example.test/rule_1',
          },
          {
            kind: 'MEDICATION_HISTORY',
            ref_id: 'history_1',
            label: 'data資料',
            uri: 'data:text/html,<b>x</b>',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '参照情報を開く' }));

    const drawer = screen.getByRole('dialog', { name: '参照情報' });
    expect(within(drawer).getByText('相対パスの処方')).toBeTruthy();
    expect(within(drawer).getByText('httpsケアプラン')).toBeTruthy();
    expect(within(drawer).getByText('残薬写真')).toBeTruthy();
    expect(within(drawer).getByText('写真・証跡')).toBeTruthy();
    expect(within(drawer).getByText('外部プロトコル相対')).toBeTruthy();
    expect(within(drawer).getByText('ftp資料')).toBeTruthy();
    expect(within(drawer).getByText('data資料')).toBeTruthy();
    expect(
      within(drawer)
        .getAllByRole('link', { name: /原文/ })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/source/rx_safe', 'https://example.test/care_safe']);
  });

  it('keeps empty source state inside the sheet instead of the right pane only', () => {
    render(<SourceDrawerTrigger sources={[]} />);

    fireEvent.click(screen.getByRole('button', { name: '参照情報を開く' }));

    expect(
      within(screen.getByRole('dialog', { name: '参照情報' })).getByText('参照情報はありません。'),
    ).toBeTruthy();
  });
});
