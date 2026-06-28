import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/server/services/patient-risk', () => ({
  listPatientRiskSummaries: vi.fn(),
}));

vi.mock('@/lib/utils/name-resolver', () => ({
  batchResolveNames: vi.fn(),
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  notifyWebhookEventForOrg: vi.fn(),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: vi.fn(),
}));

import { deriveBirthDate, listPatients } from './patient-service';
import { listPatientRiskSummaries } from '@/server/services/patient-risk';
import { batchResolveNames } from '@/lib/utils/name-resolver';

function makeDb() {
  return {
    patient: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient;
}

describe('listPatients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['missing', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['negative', -4],
  ])('uses the default page limit when the supplied limit is %s', async (_label, limit) => {
    const db = makeDb();

    await expect(
      listPatients(db, 'org_1', 'pharmacist', {
        limit,
      }),
    ).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });

    expect(db.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 151,
      }),
    );
  });

  it('caps oversized internal limits to the public API maximum', async () => {
    const db = makeDb();

    await listPatients(db, 'org_1', 'pharmacist', {
      limit: 10_000,
    });

    expect(db.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 251,
      }),
    );
  });
});

describe('listPatients cursor pagination optimization', () => {
  type CursorPatientRow = {
    id: string;
    name: string;
    name_kana: string;
    birth_date: Date;
    gender: 'female' | 'male';
    phone: string | null;
    medical_insurance_number: string | null;
    care_insurance_number: string | null;
    billing_support_flag: boolean;
    residences: unknown[];
    _count: { contacts: number };
    scheduling_preference: null;
    contacts: unknown[];
    conditions: unknown[];
    cases: unknown[];
    consents: unknown[];
  };

  // enrich の fan-out(careCase/$queryRaw/firstVisitDocument)を起動しないよう cases を空に保つ。
  function makePatient(id: string, billingSupportFlag = true): CursorPatientRow {
    return {
      id,
      name: id,
      name_kana: id,
      birth_date: new Date('1950-01-01'),
      gender: 'female',
      phone: null,
      medical_insurance_number: null,
      care_insurance_number: null,
      billing_support_flag: billingSupportFlag,
      residences: [],
      _count: { contacts: 0 },
      scheduling_preference: null,
      contacts: [],
      conditions: [],
      cases: [],
      consents: [],
    };
  }

  // Prisma findMany を cursor/skip/take honor でエミュレートする決定的モック。
  // cursor 指定時は該当行の次(skip:1)から、take で先頭 N 件に丸める。
  function makeCursorDb(rows: CursorPatientRow[]) {
    const findMany = vi.fn(
      async (args: { cursor?: { id: string }; skip?: number; take?: number } = {}) => {
        let result = [...rows];
        const cursorId = args.cursor?.id;
        if (cursorId) {
          const cursorIndex = result.findIndex((row) => row.id === cursorId);
          result = cursorIndex < 0 ? [] : result.slice(cursorIndex + (args.skip ?? 0));
        }
        if (typeof args.take === 'number') {
          result = result.slice(0, args.take);
        }
        return result;
      },
    );
    const db = {
      patient: { findMany },
      careCase: { findMany: vi.fn().mockResolvedValue([]) },
      patientShareCase: { findMany: vi.fn().mockResolvedValue([]) },
      firstVisitDocument: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    return { db, findMany };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listPatientRiskSummaries).mockResolvedValue([]);
    vi.mocked(batchResolveNames).mockResolvedValue(new Map());
  });

  it('derives the cursor page from the in-memory filtered set without a cursor/skip findMany', async () => {
    const { db, findMany } = makeCursorDb([makePatient('patient_1'), makePatient('patient_2')]);

    const result = await listPatients(db, 'org_1', 'pharmacist', {
      cursor: 'patient_1',
      limit: 1,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'patient_2' });
    // summary は全 filtered 集合(2件)基準で算出される(ページ件数=1 ではない)。
    expect(result.summary.total).toBe(2);

    // 最適化の証明: findMany は1回だけ、かつ cursor/skip なしで呼ばれる。
    expect(findMany).toHaveBeenCalledTimes(1);
    const [firstArgs] = findMany.mock.calls[0];
    expect(firstArgs).not.toHaveProperty('cursor');
    expect(firstArgs).not.toHaveProperty('skip');
  });

  it('falls back to a cursor + skip findMany when the cursor is absent from the filtered set', async () => {
    // patient_2 は billing_support フィルタで除外され、filtered 集合に不在となる端ケース。
    const { db, findMany } = makeCursorDb([
      makePatient('patient_1', true),
      makePatient('patient_2', false),
      makePatient('patient_3', true),
    ]);

    const result = await listPatients(db, 'org_1', 'pharmacist', {
      billing_support: 'true',
      cursor: 'patient_2',
      limit: 1,
    });

    // 旧挙動の保存: cursor 起点フォールバックが patient_2 以降の page を返す。
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'patient_3' });
    // summary は filtered 集合(patient_1 / patient_3 の2件)基準。
    expect(result.summary.total).toBe(2);

    // 1回目=全件走査(cursor なし)、2回目=フォールバック(cursor + skip:1)。
    expect(findMany).toHaveBeenCalledTimes(2);
    const [firstArgs] = findMany.mock.calls[0];
    expect(firstArgs).not.toHaveProperty('cursor');
    const [secondArgs] = findMany.mock.calls[1];
    expect(secondArgs).toMatchObject({ cursor: { id: 'patient_2' }, skip: 1 });
  });
});

describe('deriveBirthDate', () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  it('keeps an explicitly supplied birth date unchanged', () => {
    expect(deriveBirthDate('1950-03-15', 76)).toBe('1950-03-15');
  });

  it('derives the local pharmacy calendar birth date from reported age', () => {
    expect(deriveBirthDate(undefined, 76)).toBe('1950-01-01');
  });
});
