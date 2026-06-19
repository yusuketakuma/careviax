// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PharmacistCredentialsContent } from './pharmacist-credentials-content';

setupDomTestEnv();

const mutationMutateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: mutationMutateMock,
    isPending: false,
  }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0];

    if (key === 'pharmacist-credentials') {
      return { data: { data: [] }, isLoading: false };
    }

    if (key === 'pharmacist-options') {
      return {
        data: {
          data: [{ id: 'user_1', name: '山田 太郎', site_name: '本店', role: 'pharmacist' }],
        },
        isLoading: false,
      };
    }

    return { data: { data: [] }, isLoading: false };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: () => <div data-testid="credentials-table" />,
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  function collectItems(children: React.ReactNode): Array<{ value: string; label: string }> {
    const items: Array<{ value: string; label: string }> = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: string; children?: React.ReactNode };
      if (props.value) {
        items.push({
          value: props.value,
          label: React.Children.toArray(props.children).join(''),
        });
      }
      items.push(...collectItems(props.children));
    });
    return items;
  }

  function findTriggerId(children: React.ReactNode): string | undefined {
    let triggerId: string | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { id?: string; children?: React.ReactNode };
      if (props.id) triggerId = props.id;
      if (!triggerId) triggerId = findTriggerId(props.children);
    });
    return triggerId;
  }

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <select
        id={findTriggerId(children)}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {collectItems(children).map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder ?? null}</>,
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('PharmacistCredentialsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('associates credential dialog fields with visible labels', () => {
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '資格を登録' }));

    expect(screen.getByLabelText('対象スタッフ')).toBeTruthy();
    expect(screen.getByLabelText('認定種別')).toBeTruthy();
    expect(screen.getByLabelText('認定番号')).toBeTruthy();
    expect(screen.getByLabelText('交付日')).toBeTruthy();
    expect(screen.getByLabelText('有効期限')).toBeTruthy();
    expect(screen.getByLabelText('在籍年数')).toBeTruthy();
    expect(screen.getByLabelText('週勤務時間')).toBeTruthy();
  });

  it('surfaces reversed credential dates and invalid numeric fields inline', () => {
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '資格を登録' }));

    fireEvent.change(screen.getByLabelText('対象スタッフ'), { target: { value: 'user_1' } });
    fireEvent.change(screen.getByLabelText('認定種別'), { target: { value: '研修認定' } });

    const issuedDate = screen.getByLabelText('交付日') as HTMLInputElement;
    const expiryDate = screen.getByLabelText('有効期限') as HTMLInputElement;
    const tenureYears = screen.getByLabelText('在籍年数') as HTMLInputElement;
    const weeklyWorkHours = screen.getByLabelText('週勤務時間') as HTMLInputElement;

    expect(tenureYears.min).toBe('0');
    expect(tenureYears.max).toBe('80');
    expect(tenureYears.step).toBe('0.1');
    expect(tenureYears.inputMode).toBe('decimal');
    expect(weeklyWorkHours.min).toBe('0');
    expect(weeklyWorkHours.max).toBe('168');
    expect(weeklyWorkHours.step).toBe('0.5');

    fireEvent.change(issuedDate, { target: { value: '2027-04-01' } });
    fireEvent.change(expiryDate, { target: { value: '2025-04-01' } });
    fireEvent.change(tenureYears, { target: { value: '81' } });
    fireEvent.change(weeklyWorkHours, { target: { value: '169' } });

    expect(screen.getAllByText('有効期限は交付日以降の日付を指定してください。')).toHaveLength(2);
    expect(screen.getByText('在籍年数は0〜80の数値で入力してください。')).toBeTruthy();
    expect(screen.getByText('週勤務時間は0〜168の数値で入力してください。')).toBeTruthy();
    expect(expiryDate.getAttribute('aria-invalid')).toBe('true');
    expect(tenureYears.getAttribute('aria-describedby')).toContain('credential-tenure-years-error');

    const saveButton = screen.getByRole('button', { name: '保存' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect(saveButton.getAttribute('aria-describedby')).toBe('credential-save-blocker');

    fireEvent.click(saveButton);
    expect(mutationMutateMock).not.toHaveBeenCalled();
  });
});
