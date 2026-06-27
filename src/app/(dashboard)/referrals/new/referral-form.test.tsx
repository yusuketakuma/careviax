// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientHref } from '@/lib/patient/navigation';
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

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

// Higher-fidelity ConfirmDialog mock: renders an `alertdialog` with an
// accessible name (title) + description, a confirm button (calling onConfirm)
// and a cancel button (calling onOpenChange(false)) ONLY when `open` is true.
// This lets a11y tests assert via role + accessible name/description without a
// portal, and lets the dup-flow assert the description copy / count.
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    confirmDisabled,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmDisabled?: boolean;
    onConfirm: () => void;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby="confirm-dialog-description"
        data-testid="confirm-dialog"
      >
        <p data-testid="confirm-dialog-title">{title}</p>
        {description !== undefined ? (
          <p id="confirm-dialog-description" data-testid="confirm-dialog-description">
            {description}
          </p>
        ) : null}
        <button type="button" onClick={() => onOpenChange?.(false)}>
          {cancelLabel ?? 'キャンセル'}
        </button>
        <button type="button" onClick={onConfirm} disabled={confirmDisabled}>
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

// Fill every field required for a valid atomic submit (referral_type + patient
// fields + gender) plus a couple of optional referral fields so the body
// assertions have content to verify.
function fillValidReferralForm() {
  fireEvent.change(document.getElementById('referral_type') as HTMLSelectElement, {
    target: { value: 'physician' },
  });
  fireEvent.change(screen.getByLabelText('依頼元名称'), { target: { value: '〇〇クリニック' } });
  fireEvent.change(screen.getByLabelText('紹介日'), { target: { value: '2026-06-20' } });
  fireEvent.change(screen.getByLabelText('備考'), { target: { value: '退院後フォロー' } });
  fillRequiredPatientFields();
  fireEvent.click(screen.getByLabelText('指示書を受領済み'));
  fireEvent.change(document.getElementById('ref-gender') as HTMLSelectElement, {
    target: { value: 'male' },
  });
}

function submitForm() {
  return act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: '紹介受付を完了する' }).closest('form')!);
  });
}

// Split a className into exact whitespace-delimited tokens so touch-target
// assertions reject substring false-matches like `not-min-h-[44px]` or
// `min-h-[44px]-typo` that a bare `.toContain(...)` on the string would allow.
const classTokens = (cn?: string) => (cn ?? '').split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------
// FAIL-CLOSED fetch harness. The form must make EXACTLY ONE atomic POST to
// /api/referrals. The mock returns the queued responses for that URL and
// THROWS for any other URL — so a stray /api/patients or /api/cases call (the
// old two-step flow) fails the test loudly. Every called URL is recorded so a
// test can assert the exact sequence.
// ---------------------------------------------------------------------------
const calledUrls: string[] = [];
let referralResponses: Array<() => Response | Promise<Response>> = [];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

// A 2xx-but-unparseable response: json() rejects, so the form must fail closed.
function malformedResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
  } as Response;
}

function queueReferralResponses(...responses: Array<() => Response | Promise<Response>>) {
  referralResponses = responses;
}

function lastReferralPostBody(): Record<string, unknown> | null {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  const calls = fetchMock.mock.calls.filter((c) => c[0] === '/api/referrals');
  const call = calls.at(-1);
  if (!call) return null;
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string);
}

function referralPostInit(index = 0): RequestInit | null {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  const calls = fetchMock.mock.calls.filter((c) => c[0] === '/api/referrals');
  const call = calls[index];
  return call ? (call[1] as RequestInit) : null;
}

beforeEach(() => {
  pushMock.mockClear();
  backMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  allowNavigationMock.mockClear();
  useUnsavedChangesGuardMock.mockClear();
  vi.mocked(buildPatientHref).mockClear();
  useOrgIdMock.mockReturnValue('org_test');
  capturedSelectItems.length = 0;
  capturedTriggers.length = 0;
  calledUrls.length = 0;
  // Default: a single clean 201 success.
  queueReferralResponses(() =>
    jsonResponse(201, {
      patient: { id: 'patient_123' },
      case: { id: 'case_1' },
      warnings: [],
      metadata: {},
    }),
  );

  let referralCallIndex = 0;
  global.fetch = vi.fn((url: string) => {
    calledUrls.push(url);
    if (url === '/api/referrals') {
      const factory = referralResponses[referralCallIndex] ?? referralResponses.at(-1);
      referralCallIndex += 1;
      if (!factory) {
        throw new Error('No queued /api/referrals response');
      }
      return Promise.resolve(factory());
    }
    // FAIL CLOSED: any other endpoint (e.g. the removed /api/patients,
    // /api/cases two-step) is a regression.
    throw new Error(`Unexpected fetch to ${url} — only /api/referrals is allowed`);
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

  it('gender round-trips through the referral POST body on submit', async () => {
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
      expect(lastReferralPostBody()).not.toBeNull();
    });
    expect(lastReferralPostBody()?.gender).toBe('female');
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
    // No referral POST when validation fails.
    expect(lastReferralPostBody()).toBeNull();
    expect(calledUrls).toEqual([]);
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
      expect(lastReferralPostBody()).not.toBeNull();
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

    // gender required error + aria-invalid + NO referral POST.
    await waitFor(() => {
      expect(genderTrigger.getAttribute('aria-invalid')).toBe('true');
    });
    expect(lastReferralPostBody()).toBeNull();
    expect(calledUrls).toEqual([]);
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

  it('keeps the guard enabled while the atomic submit is pending (P1-2)', async () => {
    // Deferred referral POST: never resolves until we release it, so the form
    // stays in the isSubmitting window throughout the assertion. The fail-closed
    // harness is preserved: any non-/api/referrals call still throws.
    let releaseReferral: (value: Response) => void = () => {};
    const referralPromise = new Promise<Response>((resolve) => {
      releaseReferral = resolve;
    });
    queueReferralResponses(() => referralPromise);

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

    // Release the referral POST → submit completes → nav is now allowed.
    await act(async () => {
      releaseReferral(
        jsonResponse(201, {
          patient: { id: 'patient_123' },
          case: { id: 'case_1' },
          warnings: [],
          metadata: {},
        }),
      );
      await referralPromise;
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

describe('ReferralForm atomic single POST', () => {
  it('submits EXACTLY ONE POST /api/referrals with the right headers + body, then navigates', async () => {
    render(<ReferralForm />);
    fillValidReferralForm();
    await submitForm();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalled();
    });

    // Exactly one fetch, only to /api/referrals.
    expect(calledUrls).toEqual(['/api/referrals']);

    // Headers: Content-Type + org id.
    const init = referralPostInit(0)!;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-org-id']).toBe('org_test');
    expect(init.method).toBe('POST');

    // Body: referral_type, the 4 doc_* booleans, referral_source/date/notes,
    // patient fields.
    const body = lastReferralPostBody()!;
    expect(body.referral_type).toBe('physician');
    expect(body.doc_physician_order).toBe(true);
    expect(body.doc_consent).toBe(false);
    expect(body.doc_health_insurance).toBe(false);
    expect(body.doc_care_insurance).toBe(false);
    expect(body.referral_source).toBe('〇〇クリニック');
    expect(body.referral_date).toBe('2026-06-20');
    expect(body.referral_notes).toBe('退院後フォロー');
    expect(body.name).toBe('山田 太郎');
    expect(body.name_kana).toBe('ヤマダ タロウ');
    expect(body.birth_date).toBe('1950-01-01');
    expect(body.gender).toBe('male');
    // First call never acknowledges a duplicate.
    expect('duplicate_acknowledged' in body).toBe(false);

    // Navigation: encoded patient id, allowNavigation BEFORE push.
    expect(pushMock).toHaveBeenCalledWith('/patients/patient_123');
    expect(toastMock.success).toHaveBeenCalledWith('紹介受付が完了しました');
    expect(allowNavigationMock).toHaveBeenCalled();
    expect(allowNavigationMock.mock.invocationCallOrder[0]).toBeLessThan(
      pushMock.mock.invocationCallOrder[0],
    );

    // The removed two-step endpoints were NEVER hit.
    expect(calledUrls).not.toContain('/api/patients');
    expect(calledUrls).not.toContain('/api/cases');
  });

  it('uses the shared buildPatientHref return value for successful navigation', async () => {
    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation((id: string) => `/patients/__sentinel_${id}__`);
    try {
      render(<ReferralForm />);
      fillValidReferralForm();
      await submitForm();

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith('/patients/__sentinel_patient_123__');
      });
      expect(vi.mocked(buildPatientHref).mock.calls).toEqual([['patient_123']]);
      expect(allowNavigationMock.mock.invocationCallOrder[0]).toBeLessThan(
        pushMock.mock.invocationCallOrder[0],
      );
    } finally {
      if (realImpl) {
        vi.mocked(buildPatientHref).mockImplementation(realImpl);
      }
    }
  });
});

describe('ReferralForm duplicate-acknowledgement flow', () => {
  it('409 opens a count-only dialog (no nav, no dup ids), confirm resubmits with duplicate_acknowledged', async () => {
    // Count-only 409 envelope: matches the production conflict() shape after
    // F-011 (details = { duplicate_type, duplicate_count }, NO duplicates array).
    queueReferralResponses(
      () =>
        jsonResponse(409, {
          code: 'WORKFLOW_CONFLICT',
          message: '重複している可能性がある患者が存在します',
          details: {
            duplicate_type: 'patient_identity',
            duplicate_count: 2,
          },
        }),
      () =>
        jsonResponse(201, {
          patient: { id: 'patient_123' },
          case: { id: 'case_1' },
          warnings: [],
          metadata: {},
        }),
    );

    render(<ReferralForm />);
    fillValidReferralForm();
    await submitForm();

    // Dialog shown with the count; NO navigation; still only ONE fetch.
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    });
    expect(screen.getByTestId('confirm-dialog-description').textContent).toContain('2 件');
    expect(calledUrls).toEqual(['/api/referrals']);
    expect(pushMock).not.toHaveBeenCalled();

    // GUARD (now trivially satisfied — the count-only mock carries no id): no
    // duplicate id may ever leak into the DOM or any toast.
    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog.textContent).not.toContain('patient_existing');
    expect(document.body.textContent).not.toContain('patient_existing');
    const toastArgs = [
      ...toastMock.error.mock.calls.flat(),
      ...toastMock.success.mock.calls.flat(),
    ];
    expect(toastArgs.some((a) => String(a).includes('patient_existing'))).toBe(false);

    // Capture the EXACT first POST body (parsed) before confirming, so the
    // second body can be proven to equal it plus the ack flag.
    const firstBody = lastReferralPostBody()!;

    // Confirm → second POST with duplicate_acknowledged:true and NO dup keys.
    fireEvent.click(screen.getByRole('button', { name: '新規作成して続ける' }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/patients/patient_123');
    });
    expect(calledUrls).toEqual(['/api/referrals', '/api/referrals']);

    const secondBody = lastReferralPostBody()!;
    // FINDING 2: the full payload snapshot is resent UNCHANGED plus the ack
    // flag — not a partial rebuild via getValues. Deep-equal locks every field
    // (referral_type, all 4 doc_* booleans, referral_source/date/notes, gender,
    // and all patient fields).
    expect(secondBody).toEqual({ ...firstBody, duplicate_acknowledged: true });
    expect(secondBody.duplicate_acknowledged).toBe(true);
    expect('duplicates' in secondBody).toBe(false);
    expect('duplicate_ids' in secondBody).toBe(false);
    expect('duplicate_count' in secondBody).toBe(false);
    // Same identity as the first submit.
    expect(secondBody.name).toBe('山田 太郎');

    // Old two-step endpoints NEVER called.
    expect(calledUrls).not.toContain('/api/patients');
    expect(calledUrls).not.toContain('/api/cases');
  });

  it('STALE-ACK: editing a field while the dialog is open dismisses it and sends no acknowledgement', async () => {
    queueReferralResponses(() =>
      jsonResponse(409, {
        code: 'WORKFLOW_CONFLICT',
        message: '重複している可能性がある患者が存在します',
        details: {
          duplicate_type: 'patient_identity',
          duplicate_count: 1,
        },
      }),
    );

    render(<ReferralForm />);
    fillValidReferralForm();
    await submitForm();

    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    });

    // Mutate the identity → dialog must be invalidated/closed.
    await act(async () => {
      fireEvent.change(screen.getByLabelText('氏名 *'), { target: { value: '佐藤 花子' } });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    });

    // No second POST, no acknowledgement was ever sent.
    expect(calledUrls).toEqual(['/api/referrals']);
    const onlyBody = lastReferralPostBody()!;
    expect('duplicate_acknowledged' in onlyBody).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('ReferralForm PHI-safe error handling', () => {
  it('400 with a PHI-like message/details shows a FIXED non-PHI toast, no navigation', async () => {
    queueReferralResponses(() =>
      jsonResponse(400, {
        code: 'VALIDATION_ERROR',
        message: '患者 山田太郎 の生年月日が不正です', // PHI-like free text
        details: { name: ['山田太郎は重複です'] },
      }),
    );

    render(<ReferralForm />);
    fillValidReferralForm();
    await submitForm();

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    const message = String(toastMock.error.mock.calls.at(-1)?.[0] ?? '');
    expect(message).toBe('紹介受付に失敗しました');
    expect(message).not.toContain('山田');
    expect(pushMock).not.toHaveBeenCalled();
    expect(calledUrls).toEqual(['/api/referrals']);
  });

  it('500 with a PHI-like body shows a FIXED non-PHI toast, no navigation', async () => {
    queueReferralResponses(() =>
      jsonResponse(500, {
        code: 'INTERNAL_ERROR',
        message: 'stacktrace at /Users/yusuke patient=山田太郎',
        details: { stack: '山田太郎' },
      }),
    );

    render(<ReferralForm />);
    fillValidReferralForm();
    await submitForm();

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    const message = String(toastMock.error.mock.calls.at(-1)?.[0] ?? '');
    expect(message).toBe('紹介受付に失敗しました');
    expect(message).not.toContain('山田');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('uses the trusted fixed backend copy when present, still PHI-safe', async () => {
    queueReferralResponses(() =>
      jsonResponse(500, {
        code: 'INTERNAL_ERROR',
        message: '紹介受付の登録に失敗しました',
        details: { stack: '山田太郎' },
      }),
    );

    render(<ReferralForm />);
    fillValidReferralForm();
    await submitForm();

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    const message = String(toastMock.error.mock.calls.at(-1)?.[0] ?? '');
    // The trusted fixed copy may be surfaced; the PHI in details must NOT.
    expect(message).toBe('紹介受付の登録に失敗しました');
    expect(message).not.toContain('山田');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('malformed 2xx (json throws) fails closed: fixed toast, NO navigation', async () => {
    queueReferralResponses(() => malformedResponse(201));

    render(<ReferralForm />);
    fillValidReferralForm();
    await submitForm();

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    const message = String(toastMock.error.mock.calls.at(-1)?.[0] ?? '');
    expect(message).toBe('紹介受付に失敗しました');
    expect(pushMock).not.toHaveBeenCalled();
    expect(allowNavigationMock).not.toHaveBeenCalled();
  });
});

describe('ReferralForm duplicate dialog a11y', () => {
  it('exposes role=alertdialog with an accessible name + description', async () => {
    queueReferralResponses(() =>
      jsonResponse(409, {
        code: 'WORKFLOW_CONFLICT',
        message: '重複している可能性がある患者が存在します',
        details: {
          duplicate_type: 'patient_identity',
          duplicate_count: 3,
        },
      }),
    );

    render(<ReferralForm />);
    fillValidReferralForm();
    await submitForm();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.getAttribute('aria-label')).toBe('重複の可能性がある患者があります');
    const describedById = dialog.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const description = document.getElementById(describedById!);
    expect(description?.textContent).toContain('3 件');
    expect(description?.textContent).toContain('既存への統合ではありません');
    // The accessible-name dialog must carry the count-only copy, never dup ids.
    expect(dialog.textContent).not.toContain('patient_existing');
  });
});
