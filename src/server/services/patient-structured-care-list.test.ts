import { describe, expect, it, vi } from 'vitest';
import { listPatientStructuredCare } from './patient-structured-care-list';

function createDb(
  procedures: unknown[],
  narcotics: unknown[],
  users: Array<{ id: string; name: string }>,
) {
  const procFindMany = vi.fn().mockResolvedValue(procedures);
  const narcFindMany = vi.fn().mockResolvedValue(narcotics);
  const userFindMany = vi.fn().mockResolvedValue(users);
  const db = {
    patientMedicalProcedure: { findMany: procFindMany },
    patientNarcoticUse: { findMany: narcFindMany },
    user: { findMany: userFindMany },
  } as unknown as Parameters<typeof listPatientStructuredCare>[0];
  return { db, procFindMany, narcFindMany };
}

const baseProcedure = {
  id: 'mp_1',
  procedure_type: 'tpn',
  is_active: true,
  start_date: new Date('2026-06-10T00:00:00Z'),
  end_date: null,
  source: 'visit_record',
  confirmed_by: 'user_c',
  confirmed_at: new Date('2026-06-10T01:00:00Z'),
  notes: null,
};

const baseNarcotic = {
  id: 'nu_1',
  narcotic_kind: 'base',
  is_active: true,
  start_date: new Date('2026-06-11T00:00:00Z'),
  end_date: null,
  source: 'patient_detail_edit',
  confirmed_by: null,
  confirmed_at: null,
  notes: null,
};

describe('listPatientStructuredCare', () => {
  it('処置/麻薬を整形し確認者氏名を解決、Date を ISO 化する', async () => {
    const { db } = createDb([baseProcedure], [baseNarcotic], [{ id: 'user_c', name: '佐藤' }]);

    const result = await listPatientStructuredCare(db, { orgId: 'org_1', patientId: 'p1' });

    expect(result.procedures).toHaveLength(1);
    expect(result.procedures[0]).toMatchObject({
      kind: 'tpn',
      is_active: true,
      source: 'visit_record',
      confirmed_by_name: '佐藤',
      start_date: '2026-06-10T00:00:00.000Z',
      end_date: null,
    });
    expect(result.narcotics[0]).toMatchObject({
      kind: 'base',
      confirmed_by: null,
      confirmed_by_name: null,
    });
    expect(result.procedures[0]).not.toHaveProperty('notes');
  });

  it('既定では is_active=true のみ取得する', async () => {
    const { db, procFindMany, narcFindMany } = createDb([], [], []);

    await listPatientStructuredCare(db, { orgId: 'org_1', patientId: 'p1' });

    expect(procFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ org_id: 'org_1', patient_id: 'p1', is_active: true }),
        select: expect.not.objectContaining({ notes: true }),
      }),
    );
    expect(narcFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ is_active: true }) }),
    );
  });

  it('includeEnded=true なら is_active フィルタを外す', async () => {
    const { db, procFindMany } = createDb([], [], []);

    await listPatientStructuredCare(db, {
      orgId: 'org_1',
      patientId: 'p1',
      includeEnded: true,
    });

    const callWhere = (procFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(callWhere).not.toHaveProperty('is_active');
    expect(callWhere).toMatchObject({ org_id: 'org_1', patient_id: 'p1' });
  });
});
