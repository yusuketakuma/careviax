import { describe, expect, it, vi } from 'vitest';
import {
  listFieldRevisionsBySourceVisitRecord,
  listPatientFieldRevisionPage,
  listPatientFieldRevisions,
} from './patient-field-revision-list';

function createDb(
  rows: unknown[],
  users: Array<{ id: string; name: string }>,
  count = rows.length,
) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const countMock = vi.fn().mockResolvedValue(count);
  const userFindMany = vi.fn().mockResolvedValue(users);
  const db = {
    patientFieldRevision: { findMany, count: countMock },
    user: { findMany: userFindMany },
  } as unknown as Parameters<typeof listPatientFieldRevisions>[0];
  return { db, findMany, countMock, userFindMany };
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
  patient_id: 'p1',
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
      ],
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
      }),
    );
  });

  it('機微項目(電話など)は生値を返さず、変更の有無のみマスクする', async () => {
    const { db } = createDb(
      [
        {
          ...baseRow,
          id: 'rev_phone',
          category: 'basic',
          field_key: 'phone',
          field_label: '電話番号',
          value_label: '090-0000-0000 → 080-1111-2222',
          old_value: '090-0000-0000',
          new_value: '080-1111-2222',
        },
      ],
      [{ id: 'user_u', name: '田中' }],
    );
    const result = await listPatientFieldRevisions(db, { orgId: 'org_1', patientId: 'p1' });
    // 生値(value_label/previous/current)は API 応答に出さない
    expect(result[0].value_label).toBeNull();
    expect(result[0].previous).not.toBe('090-0000-0000');
    expect(result[0].current).not.toBe('080-1111-2222');
    // ただし変更前後に値があった事実(=「変更」バッジ算出)は保持する
    expect(result[0].previous).not.toBeNull();
    expect(result[0].current).not.toBeNull();
  });

  it('連絡先カテゴリ(PHI配列)も生値を返さない', async () => {
    const { db } = createDb(
      [
        {
          ...baseRow,
          id: 'rev_contacts',
          category: 'contacts',
          field_key: 'contacts',
          field_label: '連絡先',
          value_label: '2件 → 3件',
          old_value: [{ name: '家族', phone: '090-0000-0000' }],
          new_value: [{ name: '家族', phone: '080-1111-2222' }],
        },
      ],
      [{ id: 'user_u', name: '田中' }],
    );
    const result = await listPatientFieldRevisions(db, { orgId: 'org_1', patientId: 'p1' });
    expect(result[0].value_label).toBeNull();
    expect(JSON.stringify(result[0].previous)).not.toContain('090-0000-0000');
    expect(JSON.stringify(result[0].current)).not.toContain('080-1111-2222');
  });

  it('患者メモ・アレルギー・病名問題はAPI境界でpresenceだけ返す', async () => {
    const { db } = createDb(
      [
        {
          ...baseRow,
          id: 'rev_notes',
          category: 'basic',
          field_key: 'notes',
          field_label: 'メモ',
          value_label: '詳細な患者メモ → 別の患者メモ',
          old_value: '詳細な患者メモ',
          new_value: '別の患者メモ',
        },
        {
          ...baseRow,
          id: 'rev_allergy',
          category: 'basic',
          field_key: 'allergy_info',
          field_label: 'アレルギー情報',
          value_label: '内容変更',
          old_value: [{ allergen: 'ペニシリン', reaction: '発疹' }],
          new_value: [{ allergen: 'NSAIDs', reaction: '喘息' }],
        },
        {
          ...baseRow,
          id: 'rev_conditions',
          category: 'conditions',
          field_key: 'conditions',
          field_label: '病名・問題',
          value_label: '内容変更',
          old_value: [{ name: '心不全', notes: '夜間呼吸苦あり' }],
          new_value: [{ name: '腎不全', notes: '透析導入相談' }],
        },
      ],
      [{ id: 'user_u', name: '田中' }],
    );

    const result = await listPatientFieldRevisions(db, { orgId: 'org_1', patientId: 'p1' });
    const serialized = JSON.stringify(result);

    expect(result.every((row) => row.value_label === null)).toBe(true);
    expect(serialized).not.toContain('詳細な患者メモ');
    expect(serialized).not.toContain('ペニシリン');
    expect(serialized).not.toContain('心不全');
    expect(serialized).not.toContain('透析導入相談');
    expect(result.every((row) => row.previous === '〔記録あり〕')).toBe(true);
    expect(result.every((row) => row.current === '〔記録あり〕')).toBe(true);
  });

  it('confirmed_by が無い行は confirmed_by_name を null にする', async () => {
    const { db } = createDb(
      [{ ...baseRow, confirmed_by: null, confirmed_at: null }],
      [{ id: 'user_u', name: '田中' }],
    );
    const result = await listPatientFieldRevisions(db, { orgId: 'org_1', patientId: 'p1' });
    expect(result[0].confirmed_by_name).toBeNull();
    expect(result[0].confirmed_at).toBeNull();
  });
});

describe('listPatientFieldRevisionPage', () => {
  it('returns counted metadata for truncated revision lists without exposing hidden rows', async () => {
    const { db, findMany, countMock } = createDb([baseRow], [{ id: 'user_u', name: '田中' }], 4);

    const result = await listPatientFieldRevisionPage(db, {
      orgId: 'org_1',
      patientId: 'p1',
      category: 'basic',
      limit: 1,
    });

    expect(countMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', patient_id: 'p1', category: 'basic' },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { org_id: 'org_1', patient_id: 'p1', category: 'basic' },
      orderBy: [{ created_at: 'desc' }],
      take: 1,
    });
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({
      total_count: 4,
      visible_count: 1,
      hidden_count: 3,
      truncated: true,
      count_basis: 'patient_field_revisions',
      filters_applied: { category: 'basic' },
      sort_basis: 'created_at_desc',
      limit: 1,
    });
    expect(JSON.stringify(result.meta)).not.toContain('田中');
    expect(JSON.stringify(result.meta)).not.toContain('care_4');
  });
});

describe('listFieldRevisionsBySourceVisitRecord', () => {
  it('source_visit_record_id と patient_id でフィルタし、整形・氏名解決して返す', async () => {
    const { db, findMany } = createDb(
      [{ ...baseRow, source: 'visit_record', source_visit_record_id: 'vr_1' }],
      [{ id: 'user_u', name: '田中' }],
    );

    const result = await listFieldRevisionsBySourceVisitRecord(db, {
      orgId: 'org_1',
      patientId: 'p1',
      sourceVisitRecordId: 'vr_1',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'p1',
          source_visit_record_id: 'vr_1',
        }),
      }),
    );
    expect(result[0]).toMatchObject({
      field_key: 'care_level',
      source: 'visit_record',
      source_visit_record_id: 'vr_1',
      updated_by_name: '田中',
    });
  });

  it('同じ source_visit_record_id でも別患者の反映履歴は返さない', async () => {
    const rows = [
      {
        ...baseRow,
        id: 'rev_same_patient',
        patient_id: 'p1',
        source: 'visit_record',
        source_visit_record_id: 'vr_1',
      },
      {
        ...baseRow,
        id: 'rev_other_patient',
        patient_id: 'p2',
        source: 'visit_record',
        source_visit_record_id: 'vr_1',
      },
    ];
    const findMany = vi.fn().mockImplementation(async (query) => {
      return rows.filter(
        (row) =>
          row.patient_id === query.where.patient_id &&
          row.source_visit_record_id === query.where.source_visit_record_id,
      );
    });
    const db = {
      patientFieldRevision: { findMany },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'user_u', name: '田中' }]) },
    } as unknown as Parameters<typeof listFieldRevisionsBySourceVisitRecord>[0];

    const result = await listFieldRevisionsBySourceVisitRecord(db, {
      orgId: 'org_1',
      patientId: 'p1',
      sourceVisitRecordId: 'vr_1',
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('rev_same_patient');
    expect(JSON.stringify(result)).not.toContain('rev_other_patient');
  });
});
