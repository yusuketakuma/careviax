// @vitest-environment jsdom

import { useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ConfirmDialog } from './confirm-dialog';

setupDomTestEnv();

describe('ConfirmDialog', () => {
  it('uses unique ids for required confirmation inputs', () => {
    const noop = vi.fn();
    render(
      <>
        <ConfirmDialog
          open
          onOpenChange={noop}
          title="1件目を削除"
          description="この操作は取り消せません。"
          requiredConfirmText="削除1"
          onConfirm={noop}
        />
        <ConfirmDialog
          open
          onOpenChange={noop}
          title="2件目を削除"
          description="この操作は取り消せません。"
          requiredConfirmText="削除2"
          onConfirm={noop}
        />
      </>,
    );

    const firstInput = screen.getByLabelText(/削除1/);
    const secondInput = screen.getByLabelText(/削除2/);

    expect(firstInput.id).toBeTruthy();
    expect(secondInput.id).toBeTruthy();
    expect(firstInput.id).not.toBe(secondInput.id);
  });

  it('renders custom content and honors external confirm disabled state', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="取消確認"
        description="理由を入力してから確定してください。"
        confirmDisabled
        confirmLabel="取消する"
        onConfirm={onConfirm}
      >
        <p>取消理由は監査ログに記録されます。</p>
      </ConfirmDialog>,
    );

    expect(screen.getByText('取消理由は監査ログに記録されます。')).toBeTruthy();
    const confirmButton = screen.getByRole('button', { name: '取消する' });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps alert dialog content within the mobile viewport', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="長い確認内容"
        description="確認内容が多い場合でも、操作ボタンに到達できる必要があります。"
        onConfirm={vi.fn()}
      >
        <div>
          {Array.from({ length: 12 }, (_, index) => (
            <p key={index}>確認項目 {index + 1}</p>
          ))}
        </div>
      </ConfirmDialog>,
    );

    const content = document.body.querySelector('[data-slot="alert-dialog-content"]');
    expect(content?.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(content?.className).toContain('w-[calc(100%-2rem)]');
    expect(content?.className).toContain('overflow-y-auto');
  });

  it('can keep the dialog open until the parent closes it', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="送達ルールを削除"
        description="削除が完了するまで確認を閉じません。"
        confirmLabel="削除する"
        closeOnConfirm={false}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('alertdialog', { name: '送達ルールを削除' })).toBeTruthy();
  });

  // ── 不可逆 sign-off の autoFocusConfirm 契約（S0 / test 計画 §5-6）──
  // F12 → Enter の 2 キー操作を固定し、将来の非麻薬への requiredConfirmText 拡大を回帰検出する。

  it('autoFocusConfirm focuses the confirm button and confirms on Enter when no required text', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        variant="destructive"
        title="調剤を完了します"
        description="調剤内容を確定し、監査工程へ進みます。確定後は取り消せません。"
        confirmLabel="調剤完了"
        autoFocusConfirm
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: '調剤完了' });
    await waitFor(() => {
      expect(document.activeElement).toBe(confirmButton);
    });

    // F12 で開封 → Enter（フォーカス済みボタン上）で確定の 2 キー操作。
    fireEvent.keyDown(confirmButton, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('autoFocusConfirm with requiredConfirmText focuses the input and confirms on Enter only when it matches (IME-safe)', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        variant="destructive"
        title="監査を承認します（麻薬を含む）"
        description="麻薬 1 件の二重計数を確認のうえ承認します。確定後は取り消せません。"
        confirmLabel="監査承認"
        requiredConfirmText="麻薬"
        autoFocusConfirm
        onConfirm={onConfirm}
      >
        <p>モルヒネ徐放錠</p>
      </ConfirmDialog>,
    );

    // 麻薬名（children）が再確認のため列挙される。
    expect(screen.getByText('モルヒネ徐放錠')).toBeTruthy();

    const input = screen.getByPlaceholderText('麻薬') as HTMLInputElement;
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    // 確定ボタンは一致まで無効。
    expect((screen.getByRole('button', { name: '監査承認' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    // 未一致では Enter で確定しない。
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '麻薬' } });

    // IME 変換確定中（isComposing）の Enter では確定しない。
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onConfirm).not.toHaveBeenCalled();

    // 一致 + 非変換の Enter で確定。
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('without autoFocusConfirm keeps default behavior: Enter does not confirm, click does (batch-regen regression guard)', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="セットバッチを再生成します"
        description="既存のセットバッチを破棄して作り直します。"
        confirmLabel="再生成"
        requiredConfirmText="再生成"
        onConfirm={onConfirm}
      />,
    );

    const input = screen.getByPlaceholderText('再生成') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '再生成' } });

    // autoFocusConfirm 未指定では Enter 確定の結線が無い（既存挙動・DOM 不変）。
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();

    // 確定はボタンクリックでのみ発火する（従来どおり）。
    fireEvent.click(screen.getByRole('button', { name: '再生成' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // ── #5 二重確定ラッチ ──
  // dispensing-workbench.tsx は commit handler を useRef ラッチで包み、state 反映前の
  // double Enter/click でも commit を 1 回に固定する。ここでは ConfirmDialog を開いたまま
  // （closeOnConfirm=false）2 連続発火させ、ラッチが二重 commit を抑止することを固定する。
  it('a commit latch around onConfirm fires the commit exactly once on double confirm (#5)', () => {
    const commit = vi.fn();

    function LatchedConfirm() {
      const latch = useRef(false);
      return (
        <ConfirmDialog
          open
          onOpenChange={vi.fn()}
          variant="destructive"
          title="調剤を完了します"
          description="調剤内容を確定し、監査工程へ進みます。確定後は取り消せません。"
          confirmLabel="調剤完了"
          autoFocusConfirm
          closeOnConfirm={false}
          onConfirm={() => {
            if (latch.current) return;
            latch.current = true;
            commit();
          }}
        />
      );
    }

    render(<LatchedConfirm />);
    const button = screen.getByRole('button', { name: '調剤完了' });

    // double click + Enter（state 反映前の連打相当）。
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });

    expect(commit).toHaveBeenCalledTimes(1);
  });
});
