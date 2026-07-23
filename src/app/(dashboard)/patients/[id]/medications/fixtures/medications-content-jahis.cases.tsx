import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMedicationsContentTestSupport } from './medications-content.test-support';

const {
  MedicationsContent,
  qrModuleLoadMock,
  qrToDataUrlMock,
  toast,
  useMutationMock,
  useOrgIdMock,
  useQueryClientMock,
  useQueryMock,
} = getMedicationsContentTestSupport();

describe('MedicationsContent JAHIS QR patient identity', () => {
  const profile = {
    id: 'profile_1',
    patient_id: 'patient_1',
    drug_name: 'アムロジピン錠5mg',
    dose: '1錠',
    frequency: '朝食後',
    start_date: '2026-06-01T00:00:00.000Z',
    end_date: null,
    prescriber: '佐藤医師',
    is_current: true,
    source: 'manual',
    created_at: '2026-06-01T00:00:00.000Z',
  };
  const jahisExportContext = {
    dispensingInstitution: {
      name: 'PH-OS薬局',
      prefCode: '13',
      scoreTableCode: '4' as const,
      institutionCode: '7654321',
    },
    prescribingInstitution: {
      name: 'PH-OS Clinic',
      prefCode: '13',
      scoreTableCode: '1' as const,
      institutionCode: '1234567',
    },
    prescribingDoctor: '田中 医師',
    prescribingDepartment: '内科',
    dispensingDate: '2026-06-01',
    medications: [
      {
        drugCodeType: 1 as const,
        drugName: 'アムロジピン錠5mg',
        dose: '1',
        unit: '錠',
        usageName: '朝食後',
        dispensingQuantity: '14',
        dispensingUnit: '日分',
        formCode: 1 as const,
        usageCodeType: 1 as const,
      },
    ],
  };

  function validPatientSummary() {
    return {
      data: {
        id: 'patient_1',
        name: '山田花子',
        name_kana: 'ヤマダハナコ',
        birth_date: '1950-04-01T00:00:00.000Z',
        gender: 'female',
        allergy_info: [] as [],
      },
      isLoading: false,
      isError: false,
    };
  }

  function expectQrOutputUnreachable() {
    expect(screen.queryByRole('dialog', { name: 'お薬手帳QRコード' })).toBeNull();
    expect(screen.queryByRole('button', { name: '印刷' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'PNG保存' })).toBeNull();
  }

  function renderQrState(
    patientSummary: {
      data?: {
        id: string;
        name: string;
        name_kana: string;
        birth_date: string;
        gender: string;
        allergy_info: [];
      };
      isLoading: boolean;
      isError: boolean;
      refetch?: ReturnType<typeof vi.fn>;
    },
    exportContext: typeof jahisExportContext | null = jahisExportContext,
  ) {
    const refetch = patientSummary.refetch ?? vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      const key = String(queryKey[0]);
      if (key === 'medication-profiles') {
        return {
          data: { data: [profile] },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      if (key === 'patient-medication-summary') {
        return { ...patientSummary, refetch };
      }
      return {
        data: { data: [] },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    });

    const view = render(
      <MedicationsContent patientId="patient_1" jahisExportContext={exportContext ?? undefined} />,
    );
    return { refetch, rerender: view.rerender, unmount: view.unmount };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    qrToDataUrlMock.mockResolvedValue('data:image/png;base64,cXItZml4dHVyZQ==');
  });

  it('keeps both QR actions disabled while patient identity is loading', () => {
    renderQrState({ data: undefined, isLoading: true, isError: false });

    const status = screen.getByText(/患者情報を確認中のため、QRを生成できません/);
    for (const name of ['QR発行', 'お薬手帳QRを生成']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.className).toContain('min-h-[44px]');
      expect(button.getAttribute('aria-describedby')).toBe(status.parentElement?.id);
      fireEvent.click(button);
    }
    expect(qrToDataUrlMock).not.toHaveBeenCalled();
    expect(qrModuleLoadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'お薬手帳QRコード' })).toBeNull();
  });

  it('surfaces patient identity failure with a fixed retry and never generates a QR', () => {
    const { refetch } = renderQrState({ data: undefined, isLoading: false, isError: true });

    expect(screen.getByText(/患者情報を取得できないため、QRを生成できません/)).toBeTruthy();
    const retry = screen.getByRole('button', { name: '患者情報を再読み込み' });
    expect(retry.className).toContain('min-h-[44px]');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'QR発行' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'お薬手帳QRを生成' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(qrToDataUrlMock).not.toHaveBeenCalled();
    expect(qrModuleLoadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'お薬手帳QRコード' })).toBeNull();
  });

  it('rejects a placeholder patient returned by the summary reader', () => {
    renderQrState({
      data: {
        id: 'patient_1',
        name: '患者',
        name_kana: '',
        birth_date: '1950-04-01T00:00:00.000Z',
        gender: 'female',
        allergy_info: [],
      },
      isLoading: false,
      isError: false,
    });

    expect(screen.getByText(/患者氏名・生年月日・性別を確認できないため/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'QR発行' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'お薬手帳QRを生成' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(qrToDataUrlMock).not.toHaveBeenCalled();
    expect(qrModuleLoadMock).not.toHaveBeenCalled();
  });

  it.each(['other', 'その他', 'unknown'])(
    'rejects unsupported patient gender %s before importing the QR encoder',
    (gender) => {
      renderQrState({
        data: {
          id: 'patient_1',
          name: '山田花子',
          name_kana: 'ヤマダハナコ',
          birth_date: '1950-04-01T00:00:00.000Z',
          gender,
          allergy_info: [],
        },
        isLoading: false,
        isError: false,
      });

      expect(screen.getByText(/患者氏名・生年月日・性別を確認できないため/)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'QR発行' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(
        (screen.getByRole('button', { name: 'お薬手帳QRを生成' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(qrToDataUrlMock).not.toHaveBeenCalled();
      expect(qrModuleLoadMock).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'お薬手帳QRコード' })).toBeNull();
    },
  );

  it('generates the exact patient record only after identity validation succeeds', async () => {
    renderQrState({
      data: {
        id: 'patient_1',
        name: '山田花子',
        name_kana: 'ヤマダハナコ',
        birth_date: '1950-04-01T00:00:00.000Z',
        gender: 'female',
        allergy_info: [],
      },
      isLoading: false,
      isError: false,
    });
    const qrExportCard = screen
      .getByRole('heading', { level: 2, name: 'お薬手帳QR発行' })
      .closest('[data-slot="card"]');
    const qrExportDescriptionButton = qrExportCard?.querySelector<HTMLButtonElement>(
      'button[aria-label="説明を表示"]',
    );
    expect(qrExportDescriptionButton).toBeTruthy();
    fireEvent.click(qrExportDescriptionButton!);
    expect(screen.getByText(/確定した処方・調剤記録から JAHIS Ver\.2\.6 の QR/)).toBeTruthy();
    fireEvent.click(qrExportDescriptionButton!);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'お薬手帳QRを生成' }));
    });

    expect(await screen.findByRole('dialog', { name: 'お薬手帳QRコード' })).toBeTruthy();
    expect(screen.getByText(/確定した調剤記録から JAHIS Ver\.2\.6 形式の QR/)).toBeTruthy();
    expect(screen.queryByText(/JAHIS Ver\.2\.5/)).toBeNull();
    expect(qrModuleLoadMock).toHaveBeenCalledOnce();
    expect(qrToDataUrlMock).toHaveBeenCalledOnce();
    const segments = qrToDataUrlMock.mock.calls[0]?.[0] as Array<{
      data: Uint8Array;
      mode: string;
    }>;
    expect(segments).toHaveLength(1);
    expect(segments[0]?.mode).toBe('byte');
    const payload = new TextDecoder('shift_jis').decode(segments[0]?.data);
    expect(payload.split('\r\n')[1]).toBe('1,山田花子,2,19500401,,,,,,,ヤマダハナコ');
    expect(payload).toContain('11,PH-OS薬局,13,4,7654321,,,,1\r\n');
    expect(payload).toContain('201,1,アムロジピン錠5mg,1,錠,1,,1,,,\r\n');
    expect(payload).toContain('301,1,朝食後,14,日分,1,1,,1\r\n');
    expect(qrToDataUrlMock.mock.calls[0]?.[1]).not.toHaveProperty('toSJISFunc');
  });

  it('fails before QR rendering when a medication contains an unsupported character', async () => {
    renderQrState(validPatientSummary(), {
      ...jahisExportContext,
      medications: [{ ...jahisExportContext.medications[0], drugName: '薬剤😀' }],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'お薬手帳QRを生成' }));
    });

    expect(qrToDataUrlMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('QRコードの生成に失敗しました');
    expectQrOutputUnreachable();
  });

  it('keeps export disabled when no authoritative dispensing context is available', () => {
    renderQrState(validPatientSummary(), null);

    expect(screen.getByText(/確定した調剤日・調剤薬局・処方元・用量単位・調剤数量/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'お薬手帳QRを生成' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(qrToDataUrlMock).not.toHaveBeenCalled();
  });

  it('clears generated QR output when the route patient changes', async () => {
    const { rerender } = renderQrState(validPatientSummary());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'お薬手帳QRを生成' }));
    });
    expect(await screen.findByRole('dialog', { name: 'お薬手帳QRコード' })).toBeTruthy();

    await act(async () => {
      rerender(<MedicationsContent patientId="patient_2" />);
    });

    expectQrOutputUnreachable();
  });

  it('clears generated QR output when the tenant context changes', async () => {
    const { rerender } = renderQrState(validPatientSummary());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'お薬手帳QRを生成' }));
    });
    expect(await screen.findByRole('dialog', { name: 'お薬手帳QRコード' })).toBeTruthy();

    useOrgIdMock.mockReturnValue('org_2');
    await act(async () => {
      rerender(<MedicationsContent patientId="patient_1" />);
    });

    expectQrOutputUnreachable();
  });

  it('ignores a deferred QR result that resolves after the patient scope changes', async () => {
    let resolveDataUrl: ((dataUrl: string) => void) | undefined;
    qrToDataUrlMock.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveDataUrl = resolve;
      }),
    );
    const { rerender } = renderQrState(validPatientSummary());

    fireEvent.click(screen.getByRole('button', { name: 'お薬手帳QRを生成' }));
    await waitFor(() => expect(qrToDataUrlMock).toHaveBeenCalledOnce());

    rerender(<MedicationsContent patientId="patient_2" />);
    await act(async () => {
      resolveDataUrl?.('data:image/png;base64,b2xkLXNjb3Bl');
      await Promise.resolve();
    });

    expectQrOutputUnreachable();
  });

  it('keeps the later result when same-scope QR requests resolve out of order', async () => {
    let resolveFirst: ((dataUrl: string) => void) | undefined;
    let resolveSecond: ((dataUrl: string) => void) | undefined;
    qrToDataUrlMock
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveSecond = resolve;
        }),
      );
    renderQrState(validPatientSummary());

    const generateButton = screen.getByRole('button', { name: 'お薬手帳QRを生成' });
    fireEvent.click(generateButton);
    await waitFor(() => expect(qrToDataUrlMock).toHaveBeenCalledTimes(1));
    fireEvent.click(generateButton);
    await waitFor(() => expect(qrToDataUrlMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveSecond?.('data:image/png;base64,bmV3LXJlcXVlc3Q=');
      await Promise.resolve();
    });
    const image = await screen.findByRole('img', { name: '山田花子 お薬手帳QR' });
    expect(image.getAttribute('src')).toBe('data:image/png;base64,bmV3LXJlcXVlc3Q=');

    await act(async () => {
      resolveFirst?.('data:image/png;base64,b2xkLXJlcXVlc3Q=');
      await Promise.resolve();
    });
    expect(image.getAttribute('src')).toBe('data:image/png;base64,bmV3LXJlcXVlc3Q=');
  });

  it('ignores a deferred QR rejection after unmount without emitting a stale toast', async () => {
    let rejectDataUrl: ((reason?: unknown) => void) | undefined;
    const deferredDataUrl = new Promise<string>((_resolve, reject) => {
      rejectDataUrl = reject;
    });
    void deferredDataUrl.catch(() => undefined);
    qrToDataUrlMock.mockReturnValueOnce(deferredDataUrl);
    const { unmount } = renderQrState(validPatientSummary());

    fireEvent.click(screen.getByRole('button', { name: 'お薬手帳QRを生成' }));
    await waitFor(() => expect(qrToDataUrlMock).toHaveBeenCalledOnce());
    unmount();

    await act(async () => {
      rejectDataUrl?.(new Error('stale QR generation'));
      await Promise.resolve();
    });

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('prints generated identity and payload as text without document.write markup parsing', async () => {
    const patientName = '<img src=x onerror=patient-leak>';
    renderQrState({
      data: {
        id: 'patient_1',
        name: patientName,
        name_kana: 'ヤマダハナコ',
        birth_date: '1950-04-01',
        gender: 'female',
        allergy_info: [],
      },
      isLoading: false,
      isError: false,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'お薬手帳QRを生成' }));
    });
    expect(await screen.findByRole('dialog', { name: 'お薬手帳QRコード' })).toBeTruthy();

    const popupDocument = document.implementation.createHTMLDocument('');
    const writeSpy = vi.spyOn(popupDocument, 'write');
    const print = vi.fn();
    const focus = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({
      document: popupDocument,
      print,
      focus,
    } as unknown as Window);

    try {
      const printButton = screen.getByRole('button', { name: '印刷' });
      expect(printButton.className).toContain('min-h-[44px]');
      expect(screen.getByRole('link', { name: 'PNG保存' }).className).toContain('min-h-[44px]');
      fireEvent.click(printButton);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(popupDocument.title).toBe(`${patientName} お薬手帳QR`);
      expect(popupDocument.querySelector('h1')?.textContent).toBe(`${patientName} お薬手帳QR`);
      expect(popupDocument.querySelectorAll('img')).toHaveLength(1);
      expect(popupDocument.querySelector('[onerror]')).toBeNull();
      expect(popupDocument.querySelector('pre')?.textContent).toContain(patientName);
      expect(focus).toHaveBeenCalledOnce();
      expect(print).toHaveBeenCalledOnce();
    } finally {
      openSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });
});
