// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { FacilityPatientSwipeRail } from './facility-patient-swipe-rail';

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

const groups = [
  {
    key: 'facility-a',
    label: '青空ホーム',
    siteName: '中央薬局',
    patientNames: ['田中太郎', '佐藤花子'],
    preparedCount: 1,
    carryPendingCount: 1,
    incompleteCount: 2,
    patients: [
      { scheduleId: 'schedule_2', patientName: '佐藤花子', unitName: '203', routeOrder: 2 },
      { scheduleId: 'schedule_1', patientName: '田中太郎', unitName: '201', routeOrder: 1 },
    ],
  },
  {
    key: 'facility-b',
    label: '緑ケア',
    siteName: null,
    patientNames: ['鈴木一郎', '高橋二郎'],
    preparedCount: 2,
    carryPendingCount: 0,
    incompleteCount: 1,
    patients: [
      { scheduleId: 'schedule_3', patientName: '鈴木一郎', unitName: null, routeOrder: null },
      { scheduleId: 'schedule_4', patientName: '高橋二郎', unitName: null, routeOrder: null },
    ],
  },
];

describe('FacilityPatientSwipeRail', () => {
  it('renders swipe cards for facility grouped patients in route order', () => {
    render(<FacilityPatientSwipeRail groups={groups} />);

    expect(screen.getByText('同一訪問先の患者をスワイプで切替')).toBeTruthy();
    const recordLinks = screen.getAllByRole('link', { name: /この患者を記録/ });
    expect(recordLinks).toHaveLength(4);
    expect(recordLinks[0]?.getAttribute('href')).toBe('/visits/schedule_1/record');
    expect(screen.getByRole('button', { name: '全グループ' })).toBeTruthy();
    expect(screen.getByText('田中太郎')).toBeTruthy();
    expect(screen.getByText('佐藤花子')).toBeTruthy();
  });

  it('lets users narrow the rail to one facility group', () => {
    const onSelectGroup = vi.fn();

    render(
      <FacilityPatientSwipeRail
        groups={groups}
        activeGroupKey={null}
        onSelectGroup={onSelectGroup}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '青空ホーム 2名' }));

    expect(onSelectGroup).toHaveBeenCalledWith('facility-a');
  });
});
