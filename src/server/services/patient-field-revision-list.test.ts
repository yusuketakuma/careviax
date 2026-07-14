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
  references: {
    facilities?: Array<{ id: string; name: string }>;
    facilityUnits?: Array<{ id: string; name: string }>;
  } = {},
) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const countMock = vi.fn().mockResolvedValue(count);
  const userFindMany = vi.fn().mockResolvedValue(users);
  const facilityFindMany = vi.fn().mockResolvedValue(references.facilities ?? []);
  const facilityUnitFindMany = vi.fn().mockResolvedValue(references.facilityUnits ?? []);
  const db = {
    patientFieldRevision: { findMany, count: countMock },
    user: { findMany: userFindMany },
    facility: { findMany: facilityFindMany },
    facilityUnit: { findMany: facilityUnitFindMany },
  } as unknown as Parameters<typeof listPatientFieldRevisions>[0];
  return {
    db,
    findMany,
    countMock,
    userFindMany,
    facilityFindMany,
    facilityUnitFindMany,
  };
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
          change_reason: '家族から連絡あり',
        },
      ],
      [{ id: 'user_u', name: '田中' }],
    );
    const result = await listPatientFieldRevisions(db, { orgId: 'org_1', patientId: 'p1' });
    // 生値(value_label/previous/current)は API 応答に出さない
    expect(result[0].value_label).toBeNull();
    expect(result[0].previous).not.toBe('090-0000-0000');
    expect(result[0].current).not.toBe('080-1111-2222');
    expect(result[0].change_reason).toBeNull();
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

  it('内部スタッフ向けprojectionでは機微なscalarとstructured valueを正確に返す', async () => {
    const phoneRow = {
      ...baseRow,
      id: 'rev_phone',
      category: 'basic',
      field_key: 'phone',
      field_label: '電話番号',
      value_label: '090-0000-0000 → 080-1111-2222',
      old_value: '090-0000-0000',
      new_value: '080-1111-2222',
      change_reason: '家族から連絡あり',
    };
    const contactsRow = {
      ...baseRow,
      id: 'rev_contacts',
      category: 'contacts',
      field_key: 'contacts',
      field_label: '連絡先',
      value_label: '1件 → 1件',
      old_value: [{ name: '家族A', phone: '090-0000-0000' }],
      new_value: [{ name: '家族B', phone: '080-1111-2222' }],
    };
    const { db } = createDb([phoneRow, contactsRow], [{ id: 'user_u', name: '田中' }]);

    const result = await listPatientFieldRevisions(db, {
      orgId: 'org_1',
      patientId: 'p1',
      exposeSensitiveValues: true,
    });

    expect(result[0]).toMatchObject({
      value_label: phoneRow.value_label,
      previous: phoneRow.old_value,
      current: phoneRow.new_value,
      change_reason: phoneRow.change_reason,
    });
    expect(result[1]).toMatchObject({
      value_label: contactsRow.value_label,
      previous: contactsRow.old_value,
      current: contactsRow.new_value,
    });
  });

  it('opaque reference valuesを同一組織でbatch解決しraw IDをprimary labelにしない', async () => {
    const rows = [
      {
        ...baseRow,
        id: 'rev_staff',
        category: 'basic',
        field_key: 'primary_pharmacist_id',
        field_label: '主担当薬剤師',
        value_label: 'user_old → user_new',
        old_value: 'user_old',
        new_value: 'user_new',
      },
      {
        ...baseRow,
        id: 'rev_facility',
        category: 'residence',
        field_key: 'facility_id',
        field_label: '施設',
        value_label: 'facility_old → facility_new',
        old_value: 'facility_old',
        new_value: 'facility_new',
      },
      {
        ...baseRow,
        id: 'rev_unit',
        category: 'residence',
        field_key: 'facility_unit_id',
        field_label: '施設ユニット',
        value_label: 'unit_old → unit_new',
        old_value: 'unit_old',
        new_value: 'unit_new',
      },
    ];
    const { db, userFindMany, facilityFindMany, facilityUnitFindMany } = createDb(
      rows,
      [
        { id: 'user_u', name: '更新者' },
        { id: 'user_c', name: '確認者' },
        { id: 'user_old', name: '旧担当' },
        { id: 'user_new', name: '新担当' },
      ],
      rows.length,
      {
        facilities: [
          { id: 'facility_old', name: '旧施設' },
          { id: 'facility_new', name: '新施設' },
        ],
        facilityUnits: [
          { id: 'unit_old', name: '旧ユニット' },
          { id: 'unit_new', name: '新ユニット' },
        ],
      },
    );

    const result = await listPatientFieldRevisions(db, {
      orgId: 'org_1',
      patientId: 'p1',
      exposeSensitiveValues: true,
    });

    expect(result.map((row) => row.value_label)).toEqual([
      '旧担当 → 新担当',
      '旧施設 → 新施設',
      '旧ユニット → 新ユニット',
    ]);
    expect(result[0]).toMatchObject({ previous: 'user_old', current: 'user_new' });
    expect(userFindMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: expect.arrayContaining(['user_u', 'user_c', 'user_old', 'user_new']) },
      },
      select: { id: true, name: true },
    });
    expect(facilityFindMany).toHaveBeenCalledWith({
      where: { org_id: 'org_1', id: { in: ['facility_old', 'facility_new'] } },
      select: { id: true, name: true },
    });
    expect(facilityUnitFindMany).toHaveBeenCalledWith({
      where: { org_id: 'org_1', id: { in: ['unit_old', 'unit_new'] } },
      select: { id: true, name: true },
    });
    expect(JSON.stringify(result.map((row) => row.value_label))).not.toContain('user_old');
    expect(JSON.stringify(result.map((row) => row.value_label))).not.toContain('facility_old');
    expect(JSON.stringify(result.map((row) => row.value_label))).not.toContain('unit_old');
  });

  it('resolver未対応のopaque referenceはraw IDではなく安全な未解決labelを返す', async () => {
    const { db } = createDb(
      [
        {
          ...baseRow,
          field_key: 'future_reference_id',
          value_label: 'secret_old_id → secret_new_id',
          old_value: 'secret_old_id',
          new_value: 'secret_new_id',
        },
      ],
      [{ id: 'user_u', name: '田中' }],
    );

    const result = await listPatientFieldRevisions(db, {
      orgId: 'org_1',
      patientId: 'p1',
      exposeSensitiveValues: true,
    });

    expect(result[0].value_label).toBe('参照先不明 → 参照先不明');
    expect(result[0]).toMatchObject({
      previous: 'secret_old_id',
      current: 'secret_new_id',
    });
    expect(result[0].value_label).not.toContain('secret_old_id');
    expect(result[0].value_label).not.toContain('secret_new_id');
  });

  it('fail-closed projectionではopaque referenceのlabel queryを実行しない', async () => {
    const { db, userFindMany, facilityFindMany, facilityUnitFindMany } = createDb(
      [
        {
          ...baseRow,
          field_key: 'facility_id',
          value_label: 'facility_old → facility_new',
          old_value: 'facility_old',
          new_value: 'facility_new',
          change_reason: '転居',
        },
      ],
      [{ id: 'user_u', name: '更新者' }],
    );

    const result = await listPatientFieldRevisions(db, {
      orgId: 'org_1',
      patientId: 'p1',
    });

    expect(result[0]).toMatchObject({
      value_label: null,
      previous: '〔記録あり〕',
      current: '〔記録あり〕',
      change_reason: null,
    });
    expect(userFindMany).toHaveBeenCalledWith({
      where: { org_id: 'org_1', id: { in: ['user_u', 'user_c'] } },
      select: { id: true, name: true },
    });
    expect(facilityFindMany).not.toHaveBeenCalled();
    expect(facilityUnitFindMany).not.toHaveBeenCalled();
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
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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
      selection_basis: 'latest_created_at_desc_id_desc',
      presentation_order: 'created_at_asc_id_asc',
      limit: 1,
    });
    expect(JSON.stringify(result.meta)).not.toContain('田中');
    expect(JSON.stringify(result.meta)).not.toContain('care_4');
  });

  it('selects the latest bounded window and presents only that window from past to present', async () => {
    const allRows = Array.from({ length: 51 }, (_, chronologicalIndex) => {
      return {
        ...baseRow,
        id: `rev_${String(chronologicalIndex).padStart(2, '0')}`,
        created_at: new Date(Date.UTC(2026, 5, 16, 1, 0, chronologicalIndex)),
      };
    });
    const { db, findMany } = createDb(
      [],
      [
        { id: 'user_u', name: '田中' },
        { id: 'user_c', name: '佐藤' },
      ],
      51,
    );
    findMany.mockImplementation(async (query: { take?: number }) =>
      [...allRows]
        .sort(
          (left, right) =>
            right.created_at.getTime() - left.created_at.getTime() ||
            right.id.localeCompare(left.id),
        )
        .slice(0, query.take),
    );

    const result = await listPatientFieldRevisionPage(db, {
      orgId: 'org_1',
      patientId: 'p1',
      limit: 50,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { org_id: 'org_1', patient_id: 'p1' },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    expect(result.data).toHaveLength(50);
    expect(result.data[0]?.id).toBe('rev_01');
    expect(result.data.at(-1)?.id).toBe('rev_50');
    expect(result.data.some((row) => row.id === 'rev_00')).toBe(false);
    expect(result.meta).toMatchObject({
      total_count: 51,
      visible_count: 50,
      hidden_count: 1,
      truncated: true,
      selection_basis: 'latest_created_at_desc_id_desc',
      presentation_order: 'created_at_asc_id_asc',
    });
  });

  it('uses id as the stable tie-breaker when equal timestamps are presented chronologically', async () => {
    const sameTime = new Date('2026-06-16T01:00:00.000Z');
    const { db } = createDb(
      [
        { ...baseRow, id: 'rev_b', created_at: sameTime },
        { ...baseRow, id: 'rev_a', created_at: sameTime },
      ],
      [
        { id: 'user_u', name: '田中' },
        { id: 'user_c', name: '佐藤' },
      ],
    );

    const result = await listPatientFieldRevisionPage(db, {
      orgId: 'org_1',
      patientId: 'p1',
      limit: 50,
    });

    expect(result.data.map((row) => row.id)).toEqual(['rev_a', 'rev_b']);
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
