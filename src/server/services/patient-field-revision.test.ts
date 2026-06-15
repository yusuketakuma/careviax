import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  formatRevisionValueLabel,
  isJsonEqual,
  sortJsonArrayStable,
  writePatientFieldRevisions,
  type PatientFieldRevisionTxClient,
} from './patient-field-revision';

function createTx() {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const create = vi.fn().mockResolvedValue({});
  const tx: PatientFieldRevisionTxClient = {
    patientFieldRevision: { updateMany, create },
  };
  return { tx, updateMany, create };
}

const baseArgs = {
  orgId: 'org_1',
  patientId: 'patient_1',
  actorId: 'user_actor',
  validFrom: new Date('2026-06-16T00:00:00.000Z'),
};

describe('writePatientFieldRevisions', () => {
  let tx: PatientFieldRevisionTxClient;
  let updateMany: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ tx, updateMany, create } = createTx());
  });

  it('値が変化していないエントリはスキップする', async () => {
    const written = await writePatientFieldRevisions(tx, {
      ...baseArgs,
      entries: [
        { category: 'basic', field_key: 'phone', old_value: '090', new_value: '090' },
        { category: 'basic', field_key: 'name', old_value: null, new_value: null },
      ],
    });
    expect(written).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('変化した項目は現在行をクローズしてから新しい現在行を作成する(時点管理)', async () => {
    const written = await writePatientFieldRevisions(tx, {
      ...baseArgs,
      entries: [
        {
          category: 'basic',
          field_key: 'phone',
          field_label: '電話番号',
          old_value: '090-0000-0000',
          new_value: '080-1111-2222',
        },
      ],
    });

    expect(written).toBe(1);

    // 旧現在行のクローズ
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        field_key: 'phone',
        is_current: true,
      },
      data: { is_current: false, valid_to: baseArgs.validFrom },
    });

    // 新現在行の作成
    expect(create).toHaveBeenCalledTimes(1);
    const created = create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      org_id: 'org_1',
      patient_id: 'patient_1',
      field_key: 'phone',
      field_label: '電話番号',
      old_value: '090-0000-0000',
      new_value: '080-1111-2222',
      source: 'patient_detail_edit',
      is_current: true,
      valid_from: baseArgs.validFrom,
      updated_by: 'user_actor',
      importance: 'normal',
    });
    // value_label は old/new から自動生成される
    expect(created.value_label).toBe('090-0000-0000 → 080-1111-2222');
  });

  it('null 値は SQL NULL(Prisma.DbNull)として書き込まれ source/visit 由来を引き継ぐ', async () => {
    await writePatientFieldRevisions(tx, {
      ...baseArgs,
      source: 'visit_record',
      sourceVisitRecordId: 'visit_1',
      entries: [
        { category: 'medical_care', field_key: 'tpn', old_value: null, new_value: true },
      ],
    });

    const created = create.mock.calls[0][0].data;
    expect(created.old_value).toBe(Prisma.DbNull);
    expect(created.new_value).toBe(true);
    expect(created.source).toBe('visit_record');
    expect(created.source_visit_record_id).toBe('visit_1');
    expect(created.value_label).toBe('(未設定) → あり');
  });

  it('複数の変化項目をそれぞれ独立に履歴化する', async () => {
    const written = await writePatientFieldRevisions(tx, {
      ...baseArgs,
      entries: [
        { category: 'basic', field_key: 'name', old_value: '山田', new_value: '山田 太郎' },
        { category: 'basic', field_key: 'phone', old_value: '090', new_value: '090' }, // no-op
        {
          category: 'conditions',
          field_key: 'conditions',
          old_value: [{ name: '高血圧' }],
          new_value: [{ name: '高血圧' }, { name: '糖尿病' }],
        },
      ],
    });
    expect(written).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});

describe('isJsonEqual', () => {
  it('スカラ・null・キー順違いのオブジェクト・配列を正しく比較する', () => {
    expect(isJsonEqual('a', 'a')).toBe(true);
    expect(isJsonEqual(null, undefined)).toBe(true);
    expect(isJsonEqual(null, '')).toBe(false);
    expect(isJsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(isJsonEqual([{ x: 1 }], [{ x: 2 }])).toBe(false);
    expect(isJsonEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe('sortJsonArrayStable', () => {
  it('内容が同一なら順序が違っても安定ソート後は等価になる(偽の差分を防ぐ)', () => {
    const a = [{ name: 'b' }, { name: 'a' }];
    const b = [{ name: 'a' }, { name: 'b' }];
    // 順序依存のまま比較すると不一致
    expect(isJsonEqual(a, b)).toBe(false);
    // 安定ソート後は内容同一で等価
    expect(isJsonEqual(sortJsonArrayStable(a), sortJsonArrayStable(b))).toBe(true);
    // 入力配列は破壊しない
    expect(a[0]).toEqual({ name: 'b' });
  });
});

describe('formatRevisionValueLabel', () => {
  it('未設定/真偽/配列件数/文字列を読める形に整形する', () => {
    expect(formatRevisionValueLabel(null, 'あり')).toBe('(未設定) → あり');
    expect(formatRevisionValueLabel(false, true)).toBe('なし → あり');
    expect(formatRevisionValueLabel([1], [1, 2, 3])).toBe('1件 → 3件');
    expect(formatRevisionValueLabel('要介護2', '要介護4')).toBe('要介護2 → 要介護4');
  });
});
