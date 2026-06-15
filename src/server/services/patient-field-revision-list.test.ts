import { describe, expect, it, vi } from 'vitest';
import { listPatientFieldRevisions } from './patient-field-revision-list';

function createDb(rows: unknown[], users: Array<{ id: string; name: string }>) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const userFindMany = vi.fn().mockResolvedValue(users);
  const db = {
    patientFieldRevision: { findMany },
    user: { findMany: userFindMany },
  } as unknown as Parameters<typeof listPatientFieldRevisions>[0];
  return { db, findMany, userFindMany };
}

const baseRow = {
  id: 'rev_1',
  category: 'clinical',
  field_key: 'care_level',
  field_label: '介護度',
  value_label: 'care_2 → care_4',
  old_value: 'care_2',
  new_value: 'care_4',
  source: 'patient_detail_edit',
  source_visit_record_id: null,
  change_reason: null,
  importance: 'normal',
  confirmed_by: 'user_c',
  confirmed_at: new Date('2026-06-16T00:00:00Z'),
  valid_from: new Date('2026-06-16T00:00:00Z'),
  valid_to: null,
  is_current: true,
  updated_by: 'user_u',
  created_at: new Date('2026-06-16T01:00:00Z'),
};

describe('listPatientFieldRevisions', () => {
  it('行を整形し更新者/確認者の氏名を解決する', async () => {
    const { db } = createDb(
      [baseRow],
      [
        { id: 'user_u', name: '田中' },
        { id: 'user_c', name: '佐藤' },
      ]
    );

    const result = await listPatientFieldRevisions(db, { orgId: 'org_1', patientId: 'p1' });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      field_key: 'care_level',
      previous: 'care_2',
      current: 'care_4',
      updated_by_name: '田中',
      confirmed_by_name: '佐藤',
      is_current: true,
      valid_to: null,
    });
    // Date は ISO 文字列へ正規化される
    expect(result[0].created_at).toBe('2026-06-16T01:00:00.000Z');
    expect(result[0].valid_from).toBe('2026-06-16T00:00:00.000Z');
  });

  it('category フィルタをクエリへ渡す', async () => {
    const { db, findMany } = createDb([], []);
    await listPatientFieldRevisions(db, { orgId: 'org_1', patientId: 'p1', category: 'basic' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ org_id: 'org_1', patient_id: 'p1', category: 'basic' }),
      })
    );
  });

  it('confirmed_by が無い行は confirmed_by_name を null にする', async () => {
    const { db } = createDb([{ ...baseRow, confirmed_by: null, confirmed_at: null }], [
      { id: 'user_u', name: '田中' },
    ]);
    const result = await listPatientFieldRevisions(db, { orgId: 'org_1', patientId: 'p1' });
    expect(result[0].confirmed_by_name).toBeNull();
    expect(result[0].confirmed_at).toBeNull();
  });
});
