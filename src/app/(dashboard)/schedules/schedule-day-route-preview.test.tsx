// @vitest-environment jsdom

import React, { type PropsWithChildren } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { VisitRoutePlan } from '@/server/services/visit-route-engine';
import {
  ScheduleDayRoutePreview,
  type ScheduleDayRoutePreviewProps,
} from './schedule-day-route-preview';

vi.mock('@/components/features/visits/visit-route-map', () => ({
  VisitRouteMap: () => <div data-testid="visit-route-map" />,
}));

vi.mock('@/components/ui/select', () => {
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void;
    value?: string;
  }>({});

  function Select({
    value,
    onValueChange,
    children,
  }: PropsWithChildren<{ value?: string; onValueChange?: (value: string) => void }>) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    );
  }

  function SelectTrigger({ id, children }: PropsWithChildren<{ id?: string }>) {
    return (
      <button id={id} type="button">
        {children}
      </button>
    );
  }

  function SelectValue({ placeholder }: { placeholder?: string }) {
    const context = React.useContext(SelectContext);
    return <span>{context.value ?? placeholder}</span>;
  }

  function SelectContent({ children }: PropsWithChildren) {
    return <div>{children}</div>;
  }

  function SelectItem({ value, children }: PropsWithChildren<{ value: string }>) {
    const context = React.useContext(SelectContext);
    return (
      <button type="button" onClick={() => context.onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

setupDomTestEnv();

const routePlan: VisitRoutePlan = {
  status: 'ok',
  note: null,
  travelMode: 'DRIVE',
  origin: { lat: 35, lng: 139, label: '本店' },
  encodedPath: 'encoded',
  orderedScheduleIds: ['schedule_1', 'schedule_2'],
  totalDistanceMeters: 3200,
  totalDurationSeconds: 1200,
  stopSummaries: [
    {
      scheduleId: 'schedule_1',
      optimizedOrder: 1,
      arrivalOffsetSeconds: 300,
      distanceFromPreviousMeters: 1200,
      durationFromPreviousSeconds: 300,
    },
    {
      scheduleId: 'schedule_2',
      optimizedOrder: 2,
      arrivalOffsetSeconds: 900,
      distanceFromPreviousMeters: 2000,
      durationFromPreviousSeconds: 600,
    },
  ],
};

function routePreviewProps(
  overrides: Partial<ScheduleDayRoutePreviewProps> = {},
): ScheduleDayRoutePreviewProps {
  return {
    controlId: 'day-desktop-route',
    routePharmacistControlId: 'desktop-route-pharmacist',
    className: 'hidden md:block',
    routeSelectionLabel: '薬剤師A / 2026-04-09',
    routeTravelMode: 'DRIVE',
    onRouteTravelModeChange: vi.fn(),
    routePlan,
    routeMapPoints: [
      {
        scheduleId: 'schedule_1',
        patientName: '患者A',
        address: '東京都千代田区1-1-1',
        lat: 35.1,
        lng: 139.1,
        orderLabel: '1',
        status: 'planned',
        priority: 'normal',
        pointKind: 'schedule',
        timeLabel: '09:00 - 10:00',
        etaLabel: '09:05',
      },
      {
        scheduleId: 'schedule_2',
        patientName: '患者B',
        address: '東京都千代田区1-1-2',
        lat: 35.2,
        lng: 139.2,
        orderLabel: '2',
        status: 'planned',
        priority: 'urgent',
        pointKind: 'schedule',
        timeLabel: '10:30 - 11:30',
        etaLabel: '09:15',
      },
    ],
    routeMapSite: { name: '本店', lat: 35, lng: 139 },
    routeOrderDraft: {
      currentIds: ['schedule_2', 'schedule_1'],
      draftIds: ['schedule_1', 'schedule_2'],
      diffCount: 2,
      manualDirty: true,
      moveItem: vi.fn(),
      resetToOptimized: vi.fn(),
    },
    routePharmacistOptions: [
      { id: 'pharmacist_1', name: '薬剤師A', siteName: '本店' },
      { id: 'pharmacist_2', name: '薬剤師B', siteName: '支店' },
    ],
    resolvedRoutePharmacistId: 'pharmacist_1',
    onRoutePharmacistChange: vi.fn(),
    routePlanLoading: false,
    routeOptimizationDirty: true,
    applyPending: false,
    onApplyOptimizedRoute: vi.fn(),
    actionLabel: '最適順を反映',
    showRouteMapScheduleCount: true,
    routeMapScheduleCount: 2,
    ...overrides,
  };
}

describe('ScheduleDayRoutePreview', () => {
  it('wires pharmacist, travel mode, reset, move, and apply actions', () => {
    const props = routePreviewProps();

    render(<ScheduleDayRoutePreview {...props} />);

    expect(screen.getByText('薬剤師A / 2026-04-09')).toBeTruthy();
    expect(screen.getByText('起点 本店')).toBeTruthy();
    expect(screen.getAllByText('対象 2 件').length).toBe(2);
    expect(screen.getByText('差分 2 件')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '薬剤師B / 支店' }));
    expect(props.onRoutePharmacistChange).toHaveBeenCalledWith('pharmacist_2');

    fireEvent.click(screen.getByRole('button', { name: '徒歩' }));
    expect(props.onRouteTravelModeChange).toHaveBeenCalledWith('WALK');

    fireEvent.click(screen.getByRole('button', { name: '最適順へ戻す' }));
    expect(props.routeOrderDraft.resetToOptimized).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('button', { name: '後ろへ' })[0]);
    expect(props.routeOrderDraft.moveItem).toHaveBeenCalledWith('schedule_1', 'down');

    fireEvent.click(screen.getByRole('button', { name: '最適順を反映' }));
    expect(props.onApplyOptimizedRoute).toHaveBeenCalledTimes(1);
  });

  it('keeps mobile and desktop action-label differences explicit', () => {
    const { rerender } = render(
      <ScheduleDayRoutePreview
        {...routePreviewProps({
          controlId: 'day-mobile-route',
          routePharmacistControlId: 'mobile-route-pharmacist',
          className: undefined,
          actionLabel: '最適順を route_order に反映',
          showRouteMapScheduleCount: false,
        })}
      />,
    );

    expect(screen.getByRole('button', { name: '最適順を route_order に反映' })).toBeTruthy();
    expect(screen.getAllByText('対象 2 件').length).toBe(1);

    rerender(<ScheduleDayRoutePreview {...routePreviewProps()} />);

    expect(screen.getByRole('button', { name: '最適順を反映' })).toBeTruthy();
    expect(screen.getAllByText('対象 2 件').length).toBe(2);
  });

  it('disables route-order apply while loading, pending, or unchanged', () => {
    const onApplyOptimizedRoute = vi.fn();
    const { rerender } = render(
      <ScheduleDayRoutePreview
        {...routePreviewProps({ routePlanLoading: true, onApplyOptimizedRoute })}
      />,
    );

    expect(
      (screen.getByRole('button', { name: '最適順を反映' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '最適順を反映' }));
    expect(onApplyOptimizedRoute).not.toHaveBeenCalled();

    rerender(
      <ScheduleDayRoutePreview
        {...routePreviewProps({ applyPending: true, onApplyOptimizedRoute })}
      />,
    );
    expect((screen.getByRole('button', { name: '反映中...' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    rerender(
      <ScheduleDayRoutePreview
        {...routePreviewProps({ routeOptimizationDirty: false, onApplyOptimizedRoute })}
      />,
    );
    expect(
      (screen.getByRole('button', { name: '最適順を反映' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
