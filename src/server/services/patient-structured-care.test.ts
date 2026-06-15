import { describe, expect, it, vi } from 'vitest';
import { syncStructuredHomeCare } from './patient-structured-care';

function createTx(
  existingProcedures: Array<{ id: string; procedure_type: string }> = [],
  existingNarcotics: Array<{ id: string; narcotic_kind: string }> = []
) {
  const procCreate = vi.fn();
  const procUpdateMany = vi.fn();
  const narcCreate = vi.fn();
  const narcUpdateMany = vi.fn();
  const tx = {
    patientMedicalProcedure: {
      findMany: vi.fn().mockResolvedValue(existingProcedures),
      create: procCreate,
      updateMany: procUpdateMany,
    },
    patientNarcoticUse: {
      findMany: vi.fn().mockResolvedValue(existingNarcotics),
      create: narcCreate,
      updateMany: narcUpdateMany,
    },
  } as unknown as Parameters<typeof syncStructuredHomeCare>[0];
  return { tx, procCreate, procUpdateMany, narcCreate, narcUpdateMany };
}

const baseArgs = {
  orgId: 'org_1',
  patientId: 'p1',
  caseId: 'case_1',
  startDate: new Date('2026-06-17T00:00:00.000Z'),
};

describe('syncStructuredHomeCare', () => {
  it('intake に在って表に無い処置を開始日付きで作成する', async () => {
    const { tx, procCreate } = createTx([]);
    const result = await syncStructuredHomeCare(tx, {
      ...baseArgs,
      intake: {
        special_medical_procedures: ['tpn', 'home_oxygen'],
        narcotics_base: false,
        narcotics_rescue: false,
      },
    });
    expect(result.proceduresAdded).toEqual(['tpn', 'home_oxygen']);
    expect(procCreate).toHaveBeenCalledTimes(2);
    expect(procCreate.mock.calls[0][0].data).toMatchObject({
      org_id: 'org_1',
      patient_id: 'p1',
      case_id: 'case_1',
      procedure_type: 'tpn',
      is_active: true,
      start_date: baseArgs.startDate,
    });
  });

  it('表に在って intake に無い処置を end_date 付きで非activeにする', async () => {
    const { tx, procCreate, procUpdateMany } = createTx([{ id: 'mp_1', procedure_type: 'tpn' }]);
    const result = await syncStructuredHomeCare(tx, {
      ...baseArgs,
      intake: { special_medical_procedures: [], narcotics_base: false, narcotics_rescue: false },
    });
    expect(result.proceduresAdded).toEqual([]);
    expect(procCreate).not.toHaveBeenCalled();
    expect(procUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['mp_1'] } },
      data: { is_active: false, end_date: baseArgs.startDate },
    });
  });

  it('既に在る処置は再作成しない(冪等)', async () => {
    const { tx, procCreate, procUpdateMany } = createTx([{ id: 'mp_1', procedure_type: 'tpn' }]);
    const result = await syncStructuredHomeCare(tx, {
      ...baseArgs,
      intake: { special_medical_procedures: ['tpn'], narcotics_base: false, narcotics_rescue: false },
    });
    expect(result.proceduresAdded).toEqual([]);
    expect(procCreate).not.toHaveBeenCalled();
    expect(procUpdateMany).not.toHaveBeenCalled();
  });

  it('麻薬 base/rescue を narcotic_kind 行へ反映する', async () => {
    const { tx, narcCreate } = createTx([], []);
    const result = await syncStructuredHomeCare(tx, {
      ...baseArgs,
      intake: { special_medical_procedures: [], narcotics_base: true, narcotics_rescue: true },
    });
    expect(result.narcoticsAdded).toEqual(['base', 'rescue']);
    expect(narcCreate).toHaveBeenCalledTimes(2);
    expect(narcCreate.mock.calls[0][0].data).toMatchObject({ narcotic_kind: 'base', is_active: true });
  });

  it('intake が null なら既存行に触れず no-op(誤って end しない)', async () => {
    const { tx, procCreate, procUpdateMany, narcCreate } = createTx(
      [{ id: 'mp_1', procedure_type: 'tpn' }],
      []
    );
    const result = await syncStructuredHomeCare(tx, { ...baseArgs, intake: null });
    expect(result).toEqual({ proceduresAdded: [], narcoticsAdded: [] });
    expect(procCreate).not.toHaveBeenCalled();
    expect(procUpdateMany).not.toHaveBeenCalled();
    expect(narcCreate).not.toHaveBeenCalled();
  });
});
