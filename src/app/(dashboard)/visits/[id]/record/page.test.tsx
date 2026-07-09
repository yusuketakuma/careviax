// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isVisitMedicationStockObservationWriteEnabledMock, visitRecordFormCalls } = vi.hoisted(
  () => ({
    isVisitMedicationStockObservationWriteEnabledMock: vi.fn(),
    visitRecordFormCalls: [] as Array<{
      id: string;
      facilityVisitContext: unknown;
      medicationStockObservationWriteEnabled: boolean;
    }>,
  }),
);

vi.mock('@/lib/visits/medication-stock-observation-gate.server', () => ({
  isVisitMedicationStockObservationWriteEnabled: isVisitMedicationStockObservationWriteEnabledMock,
}));

vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: ({ title }: { title: string }) => <header>{title}</header>,
}));

vi.mock('./visit-record-form', () => ({
  VisitRecordForm: (props: {
    id: string;
    facilityVisitContext: unknown;
    medicationStockObservationWriteEnabled: boolean;
  }) => {
    visitRecordFormCalls.push(props);
    return (
      <div
        data-testid="visit-record-form"
        data-id={props.id}
        data-medication-stock-enabled={String(props.medicationStockObservationWriteEnabled)}
      />
    );
  },
}));

import VisitRecordPage from './page';

describe('VisitRecordPage medication stock capability gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitRecordFormCalls.length = 0;
    isVisitMedicationStockObservationWriteEnabledMock.mockReturnValue(false);
  });

  it('passes a fail-closed medication stock write flag from the server boundary', async () => {
    render(await VisitRecordPage({ params: Promise.resolve({ id: 'schedule_1' }) }));

    expect(isVisitMedicationStockObservationWriteEnabledMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('visit-record-form').dataset.id).toBe('schedule_1');
    expect(screen.getByTestId('visit-record-form').dataset.medicationStockEnabled).toBe('false');
    expect(visitRecordFormCalls).toContainEqual(
      expect.objectContaining({
        id: 'schedule_1',
        facilityVisitContext: null,
        medicationStockObservationWriteEnabled: false,
      }),
    );
  });

  it('passes true only after the server resolver explicitly enables the capability', async () => {
    isVisitMedicationStockObservationWriteEnabledMock.mockReturnValueOnce(true);

    render(await VisitRecordPage({ params: Promise.resolve({ id: 'schedule_2' }) }));

    expect(screen.getByTestId('visit-record-form').dataset.medicationStockEnabled).toBe('true');
    expect(visitRecordFormCalls).toContainEqual(
      expect.objectContaining({
        id: 'schedule_2',
        medicationStockObservationWriteEnabled: true,
      }),
    );
  });
});
