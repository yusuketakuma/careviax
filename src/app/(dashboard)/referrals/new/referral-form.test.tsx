// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ReferralForm } from './referral-form';

setupDomTestEnv();

// ---------------------------------------------------------------------------
// Hoisted spies. next/navigation, useOrgId, sonner and the unsaved-changes
// guard are all mocked so the form's submit/cancel flows are observable.
// ---------------------------------------------------------------------------
const {
  pushMock,
  backMock,
  useOrgIdMock,
  toastMock,
  allowNavigationMock,
  useUnsavedChangesGuardMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  backMock: vi.fn(),
  useOrgIdMock: vi.fn(() => 'org_test'),
  toastMock: { success: vi.fn(), error: vi.fn() },
  allowNavigationMock: vi.fn(),
  useUnsavedChangesGuardMock: vi.fn((_options: { enabled: boolean; message?: string }) => {
    void _options;
    return allowNavigationMock;
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

vi.mock('@/lib/hooks/use-unsaved-changes-guard', () => ({
  useUnsavedChangesGuard: useUnsavedChangesGuardMock,
}));

// Lightweight ConfirmDialog mock: renders title + a confirm button (calling
// onConfirm) ONLY when `open` is true, so tests can assert "dialog open" via the
// title and trigger the discard confirmation deterministically (no portal).
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <p data-testid="confirm-dialog-title">{title}</p>
        <button type="button" onClick={onConfirm}>
          {confirmLabel ?? '確認'}
        </button>
      </div>
    ) : null,
}));

// ---------------------------------------------------------------------------
// Select mock (mirrors drug-master-content.test.tsx slices 4a/4b/4c): replaces
// the portaled Base UI Select with a native <select> that forwards the
// trigger's id/className/aria-* and renders a `${selectKey}-display` span from
// the SelectValue children. CAPTURES the original SelectItem className so the
// >=44px touch-target contract is asserted on the SOURCE value — the mock never
// injects min-h itself.
// ---------------------------------------------------------------------------
const capturedSelectItems: Array<{
  selectKey: string;
  value: unknown;
  children: ReactNode;
  className?: string;
}> = [];
const capturedTriggers: Array<{ selectKey: string; className?: string }> = [];

function flattenLabel(node: ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenLabel).join('');
  const element = node as { props?: { children?: ReactNode } };
  if (element.props && 'children' in element.props) return flattenLabel(element.props.children);
  return '';
}

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  type ItemProps = { value?: unknown; children?: ReactNode; className?: string };
  type TriggerProps = {
    id?: string;
    className?: string;
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    children?: ReactNode;
  };

  // Marker components matched by identity while traversing the JSX tree.
  const SelectContent = ({ children }: { children: ReactNode }) => <>{children}</>;
  const SelectItem = ({ children }: ItemProps) => <>{children}</>;
  const SelectTrigger = ({ children }: TriggerProps) => <>{children}</>;
  const SelectValue = ({
    placeholder,
    children,
  }: {
    placeholder?: string;
    children?: ReactNode;
  }) => <>{children ?? placeholder ?? null}</>;

  function collectItems(children: ReactNode, selectKey: string): ItemProps[] {
    const items: ItemProps[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as ItemProps;
      if (child.type === SelectItem) {
        const item = {
          value: props.value,
          children: props.children,
          className: props.className,
        };
        items.push(item);
        const key = `${selectKey}::${String(item.value)}::${flattenLabel(item.children)}`;
        if (
          !capturedSelectItems.some(
            (c) => `${c.selectKey}::${String(c.value)}::${flattenLabel(c.children)}` === key,
          )
        ) {
          capturedSelectItems.push({ selectKey, ...item });
        }
      }
      items.push(...collectItems(props.children, selectKey));
    });
    return items;
  }

  function findTriggerProps(children: ReactNode): TriggerProps | undefined {
    let triggerProps: TriggerProps | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as TriggerProps;
      if (child.type === SelectTrigger) triggerProps = props;
      if (!triggerProps) triggerProps = findTriggerProps(props.children);
    });
    return triggerProps;
  }

  // Faithfully model Base UI's closed-trigger label contract: SelectValue
  // children (production label) win over placeholder; a BARE SelectValue falls
  // back to the raw value — the regression we must catch.
  function findSelectValue(
    children: ReactNode,
  ): { children?: ReactNode; placeholder?: string } | undefined {
    let found: { children?: ReactNode; placeholder?: string } | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { placeholder?: string; children?: ReactNode };
      if (child.type === SelectValue && found === undefined) {
        found = { children: props.children, placeholder: props.placeholder };
      }
      if (found === undefined) found = findSelectValue(props.children);
    });
    return found;
  }

  function MockSelect({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) {
    const triggerProps = findTriggerProps(children);
    const selectValueProps = findSelectValue(children);
    const selectKey =
      triggerProps?.id ??
      triggerProps?.['aria-label'] ??
      triggerProps?.['aria-labelledby'] ??
      'unknown-select';

    // Capture the trigger className (deduped per selectKey) so the min-h
    // touch-target contract can be asserted on the SOURCE trigger className.
    if (!capturedTriggers.some((t) => t.selectKey === selectKey)) {
      capturedTriggers.push({ selectKey, className: triggerProps?.className });
    }

    const selectValueChildrenText = flattenLabel(selectValueProps?.children);
    const displayLabel =
      selectValueChildrenText !== ''
        ? selectValueChildrenText
        : (selectValueProps?.placeholder ?? (value === '' ? '' : String(value ?? '')));
    const items = collectItems(children, selectKey);
    return (
      <>
        <span data-testid={`${selectKey}-display`}>{displayLabel}</span>
        <select
          id={triggerProps?.id}
          className={triggerProps?.className}
          aria-label={triggerProps?.['aria-label']}
          aria-labelledby={triggerProps?.['aria-labelledby']}
          aria-describedby={triggerProps?.['aria-describedby']}
          aria-invalid={triggerProps?.['aria-invalid']}
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {items.map((item) => (
            <option key={String(item.value)} value={String(item.value)}>
              {React.Children.toArray(item.children).join('')}
            </option>
          ))}
        </select>
      </>
    );
  }

  return {
    Select: MockSelect,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fillRequiredPatientFields() {
  fireEvent.change(screen.getByLabelText('氏名 *'), { target: { value: '山田 太郎' } });
  fireEvent.change(screen.getByLabelText('フリガナ *'), { target: { value: 'ヤマダ タロウ' } });
  fireEvent.change(screen.getByLabelText('生年月日 *'), { target: { value: '1950-01-01' } });
}

// Split a className into exact whitespace-delimited tokens so touch-target
// assertions reject substring false-matches like `not-min-h-[44px]` or
// `min-h-[44px]-typo` that a bare `.toContain(...)` on the string would allow.
const classTokens = (cn?: string) => (cn ?? '').split(/\s+/).filter(Boolean);

function lastPatientPostBody(): Record<string, unknown> | null {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/patients');
  if (!call) return null;
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  pushMock.mockClear();
  backMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  allowNavigationMock.mockClear();
  useUnsavedChangesGuardMock.mockClear();
  useOrgIdMock.mockReturnValue('org_test');
  capturedSelectItems.length = 0;
  capturedTriggers.length = 0;

  // Patient POST returns {id}; case POST returns {} ok. ordered by URL.
  global.fetch = vi.fn((url: string) => {
    if (url === '/api/patients') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'patient_123' }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReferralForm Select migration', () => {
  it('shows the placeholder on a pristine render for both selects', () => {
    render(<ReferralForm />);
    expect(screen.getByTestId('referral_type-display').textContent).toBe('選択してください');
    expect(screen.getByTestId('ref-gender-display').textContent).toBe('選択してください');
  });

  it('renders a reversible value="" item for BOTH selects', () => {
    render(<ReferralForm />);
    const referralEmpty = capturedSelectItems.filter(
      (i) => i.selectKey === 'referral_type' && i.value === '',
    );
    const genderEmpty = capturedSelectItems.filter(
      (i) => i.selectKey === 'ref-gender' && i.value === '',
    );
    expect(referralEmpty).toHaveLength(1);
    expect(genderEmpty).toHaveLength(1);
    // No __none__ sentinel — value="" is the reversible empty option.
    expect(capturedSelectItems.some((i) => i.value === '__none__')).toBe(false);
  });

  it('keeps min-h-[44px] on EVERY captured SelectItem (incl. the empty one)', () => {
    render(<ReferralForm />);
    expect(capturedSelectItems.length).toBeGreaterThan(0);
    for (const item of capturedSelectItems) {
      expect(classTokens(item.className)).toContain('min-h-[44px]');
    }
  });

  it('keeps BOTH min-h-[44px] and sm:min-h-[44px] on BOTH SelectTriggers', () => {
    render(<ReferralForm />);
    const referralTrigger = capturedTriggers.find((t) => t.selectKey === 'referral_type');
    const genderTrigger = capturedTriggers.find((t) => t.selectKey === 'ref-gender');
    for (const trigger of [referralTrigger, genderTrigger]) {
      expect(classTokens(trigger?.className)).toContain('min-h-[44px]');
      expect(classTokens(trigger?.className)).toContain('sm:min-h-[44px]');
    }
  });

  it('preserves the trigger accessible name wiring (id matches Label htmlFor)', () => {
    render(<ReferralForm />);
    // The Label htmlFor points at the trigger id; the combobox resolves by id.
    expect(screen.getByLabelText('依頼種別 *')).toBe(document.getElementById('referral_type'));
    expect(screen.getByLabelText('性別 *')).toBe(document.getElementById('ref-gender'));
  });

  it('referral_type closed-trigger shows the selected option label, not the raw value', () => {
    render(<ReferralForm />);
    fireEvent.change(document.getElementById('referral_type') as HTMLSelectElement, {
      target: { value: 'care_manager' },
    });
    expect(screen.getByTestId('referral_type-display').textContent).toBe('ケアマネ依頼');
  });

  it('gender round-trips through the patient POST body on submit', async () => {
    render(<ReferralForm />);

    fireEvent.change(document.getElementById('referral_type') as HTMLSelectElement, {
      target: { value: 'physician' },
    });
    fillRequiredPatientFields();
    fireEvent.change(document.getElementById('ref-gender') as HTMLSelectElement, {
      target: { value: 'female' },
    });
    // closed trigger shows the label, not "female"
    expect(screen.getByTestId('ref-gender-display').textContent).toBe('女性');

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: '紹介受付を完了する' }).closest('form')!);
    });

    await waitFor(() => {
      expect(lastPatientPostBody()).not.toBeNull();
    });
    expect(lastPatientPostBody()?.gender).toBe('female');
  });
});

describe('ReferralForm validation', () => {
  it('shows inline errors + aria-invalid when required fields are empty', async () => {
    render(<ReferralForm />);
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: '紹介受付を完了する' }).closest('form')!);
    });

    // referral_type error surfaces inline...
    await waitFor(() => {
      expect(screen.getByText('依頼種別を選択してください')).toBeTruthy();
    });
    const referralTrigger = document.getElementById('referral_type') as HTMLSelectElement;
    expect(referralTrigger.getAttribute('aria-invalid')).toBe('true');
    // No patient POST when validation fails.
    expect(lastPatientPostBody()).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('referral_type error clears after selecting a value and re-submitting (value="" reversible)', async () => {
    render(<ReferralForm />);
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: '紹介受付を完了する' }).closest('form')!);
    });
    await waitFor(() => {
      expect(screen.getByText('依頼種別を選択してください')).toBeTruthy();
    });

    // Select a value, then back to '' to confirm the empty option is reachable.
    const referralTrigger = document.getElementById('referral_type') as HTMLSelectElement;
    fireEvent.change(referralTrigger, { target: { value: 'family' } });
    expect(screen.getByTestId('referral_type-display').textContent).toBe('家族相談');
    fireEvent.change(referralTrigger, { target: { value: '' } });
    expect(screen.getByTestId('referral_type-display').textContent).toBe('選択してください');

    // Re-select + fill required fields → validation passes, submit progresses.
    fireEvent.change(referralTrigger, { target: { value: 'family' } });
    fillRequiredPatientFields();
    fireEvent.change(document.getElementById('ref-gender') as HTMLSelectElement, {
      target: { value: 'male' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: '紹介受付を完了する' }).closest('form')!);
    });
    await waitFor(() => {
      expect(lastPatientPostBody()).not.toBeNull();
    });
    expect(screen.queryByText('依頼種別を選択してください')).toBeNull();
  });

  it('gender is required: selecting then clearing to "" blocks submit with no patient POST', async () => {
    render(<ReferralForm />);
    fireEvent.change(document.getElementById('referral_type') as HTMLSelectElement, {
      target: { value: 'physician' },
    });
    fillRequiredPatientFields();

    // Select female, then clear back to '' (reversible empty option).
    const genderTrigger = document.getElementById('ref-gender') as HTMLSelectElement;
    fireEvent.change(genderTrigger, { target: { value: 'female' } });
    fireEvent.change(genderTrigger, { target: { value: '' } });
    expect(screen.getByTestId('ref-gender-display').textContent).toBe('選択してください');

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: '紹介受付を完了する' }).closest('form')!);
    });

    // gender required error + aria-invalid + NO patient POST.
    await waitFor(() => {
      expect(genderTrigger.getAttribute('aria-invalid')).toBe('true');
    });
    expect(lastPatientPostBody()).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('ReferralForm unsaved-changes guard', () => {
  it('is disabled (enabled:false) on a pristine form', () => {
    render(<ReferralForm />);
    const calls = useUnsavedChangesGuardMock.mock.calls.map((c) => c[0]);
    expect(calls.every((arg) => arg.enabled === false)).toBe(true);
  });

  it('becomes enabled after a field change', () => {
    render(<ReferralForm />);
    fireEvent.change(screen.getByLabelText('氏名 *'), { target: { value: '山田 太郎' } });
    const calls = useUnsavedChangesGuardMock.mock.calls.map((c) => c[0]);
    expect(calls.some((arg) => arg.enabled === true)).toBe(true);
  });

  it('becomes enabled after a checklist toggle (shouldDirty)', () => {
    render(<ReferralForm />);
    useUnsavedChangesGuardMock.mockClear();
    fireEvent.click(screen.getByLabelText('指示書を受領済み'));
    const calls = useUnsavedChangesGuardMock.mock.calls.map((c) => c[0]);
    expect(calls.some((arg) => arg.enabled === true)).toBe(true);
  });

  it('dirty cancel opens the discard ConfirmDialog WITHOUT navigating (P1-1)', () => {
    render(<ReferralForm />);
    fireEvent.change(screen.getByLabelText('氏名 *'), { target: { value: '山田 太郎' } });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    // The discard confirmation must appear and nothing must navigate yet.
    expect(screen.getByTestId('confirm-dialog-title').textContent).toBe('入力内容を破棄しますか？');
    expect(backMock).not.toHaveBeenCalled();
    expect(allowNavigationMock).not.toHaveBeenCalled();
  });

  it('confirming the discard dialog calls allowNavigation before router.back', () => {
    render(<ReferralForm />);
    fireEvent.change(screen.getByLabelText('氏名 *'), { target: { value: '山田 太郎' } });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    fireEvent.click(screen.getByRole('button', { name: '破棄して戻る' }));

    expect(allowNavigationMock).toHaveBeenCalled();
    expect(backMock).toHaveBeenCalled();
    // allowNavigation must fire before router.back
    expect(allowNavigationMock.mock.invocationCallOrder[0]).toBeLessThan(
      backMock.mock.invocationCallOrder[0],
    );
  });

  it('pristine cancel navigates back directly with NO dialog and NO bypass', () => {
    render(<ReferralForm />);
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(backMock).toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    // Pristine: the guard is not armed, so allowNavigation must NOT be called.
    expect(allowNavigationMock).not.toHaveBeenCalled();
  });

  it('keeps the guard enabled while the two-step submit is pending (P1-2)', async () => {
    // Deferred patient POST: never resolves until we release it, so the form
    // stays in the isSubmitting window throughout the assertion.
    let releasePatient: (value: Response) => void = () => {};
    const patientPromise = new Promise<Response>((resolve) => {
      releasePatient = resolve;
    });
    global.fetch = vi.fn((url: string) => {
      if (url === '/api/patients') return patientPromise;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }) as unknown as typeof fetch;

    render(<ReferralForm />);
    fireEvent.change(document.getElementById('referral_type') as HTMLSelectElement, {
      target: { value: 'physician' },
    });
    fillRequiredPatientFields();
    fireEvent.change(document.getElementById('ref-gender') as HTMLSelectElement, {
      target: { value: 'male' },
    });

    // Clear the guard call log immediately BEFORE submit. With the log cleared,
    // the only recorded calls during the pending window are the submit-time
    // re-renders (isSubmitting === true). If production regressed to
    // `enabled: isDirty && !isSubmitting`, the LATEST call would be
    // enabled:false and the assertion below would FAIL — pre-submit dirty
    // renders can no longer mask the regression.
    useUnsavedChangesGuardMock.mockClear();

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: '紹介受付を完了する' }).closest('form')!);
    });

    // Submit is in flight (patient POST pending). The guard must remain armed
    // (enabled:true) and allowNavigation must NOT have fired yet.
    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
    const latestGuardCall = useUnsavedChangesGuardMock.mock.calls.at(-1)?.[0];
    expect(latestGuardCall?.enabled).toBe(true);
    expect(allowNavigationMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();

    // Release the patient POST → submit completes → nav is now allowed.
    await act(async () => {
      releasePatient({
        ok: true,
        json: () => Promise.resolve({ id: 'patient_123' }),
      } as Response);
      await patientPromise;
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/patients/patient_123');
    });
    expect(allowNavigationMock).toHaveBeenCalled();
    expect(allowNavigationMock.mock.invocationCallOrder[0]).toBeLessThan(
      pushMock.mock.invocationCallOrder[0],
    );
  });

  it('changing referral_type alone marks the form dirty (enabled:true)', () => {
    render(<ReferralForm />);
    useUnsavedChangesGuardMock.mockClear();
    fireEvent.change(document.getElementById('referral_type') as HTMLSelectElement, {
      target: { value: 'physician' },
    });
    const calls = useUnsavedChangesGuardMock.mock.calls.map((c) => c[0]);
    expect(calls.some((arg) => arg.enabled === true)).toBe(true);
  });

  it('changing gender alone marks the form dirty (enabled:true)', () => {
    render(<ReferralForm />);
    useUnsavedChangesGuardMock.mockClear();
    fireEvent.change(document.getElementById('ref-gender') as HTMLSelectElement, {
      target: { value: 'female' },
    });
    const calls = useUnsavedChangesGuardMock.mock.calls.map((c) => c[0]);
    expect(calls.some((arg) => arg.enabled === true)).toBe(true);
  });

  it('calls allowNavigation before router.push on successful submit', async () => {
    render(<ReferralForm />);
    fireEvent.change(document.getElementById('referral_type') as HTMLSelectElement, {
      target: { value: 'physician' },
    });
    fillRequiredPatientFields();
    fireEvent.change(document.getElementById('ref-gender') as HTMLSelectElement, {
      target: { value: 'male' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: '紹介受付を完了する' }).closest('form')!);
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/patients/patient_123');
    });
    expect(allowNavigationMock).toHaveBeenCalled();
    expect(allowNavigationMock.mock.invocationCallOrder[0]).toBeLessThan(
      pushMock.mock.invocationCallOrder[0],
    );
  });
});
