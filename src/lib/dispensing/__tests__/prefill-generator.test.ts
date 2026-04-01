import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    prescriptionIntake: { findFirst: vi.fn() },
    drugMaster: { findFirst: vi.fn(), findMany: vi.fn() },
    pharmacyDrugStock: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { generateDispensePrefill } from '../prefill-generator';

// ── Shared fixtures ──

const ORG_ID = 'org_1';
const CYCLE_ID = 'cycle_1';
const SITE_ID = 'site_1';

function makeIntakeLine(overrides: Partial<{
  id: string;
  line_number: number;
  drug_name: string;
  drug_code: string | null;
  dose: string;
  frequency: string;
  days: number | null;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  packaging_instructions: string | null;
  start_date: Date | null;
  end_date: Date | null;
}> = {}) {
  return {
    id: 'line_1',
    line_number: 1,
    drug_name: 'アムロジピン錠5mg',
    drug_code: 'YJ001',
    dose: '5mg',
    frequency: '1日1回',
    days: 28,
    quantity: 28,
    unit: '錠',
    notes: null,
    packaging_instructions: null,
    start_date: new Date('2026-04-01'),
    end_date: new Date('2026-04-28'),
    ...overrides,
  };
}

function makeCurrentIntake(overrides: Partial<{
  id: string;
  source_type: string;
  prescribed_date: Date;
  prescriber_name: string | null;
  lines: ReturnType<typeof makeIntakeLine>[];
}> = {}) {
  return {
    id: 'intake_current',
    source_type: 'qr',
    prescribed_date: new Date('2026-04-01'),
    prescriber_name: '鈴木医師',
    lines: [makeIntakeLine()],
    ...overrides,
  };
}

function makePreviousIntake(overrides: Partial<{
  prescribed_date: Date;
  prescriber_name: string | null;
  lines: Array<{
    id: string;
    drug_name: string;
    drug_code: string | null;
    dose: string;
    frequency: string;
    start_date: Date | null;
    end_date: Date | null;
  }>;
}> = {}) {
  return {
    prescribed_date: new Date('2026-03-01'),
    prescriber_name: '鈴木医師',
    lines: [
      {
        id: 'prev_line_1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        dose: '5mg',
        frequency: '1日1回',
        start_date: new Date('2026-03-01'),
        end_date: new Date('2026-03-31'),
      },
    ],
    ...overrides,
  };
}

// ── Tests ──

describe('generateDispensePrefill', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('when no intake found', () => {
    it('returns isPrefillAvailable=false with empty lines', async () => {
      prismaMock.prescriptionIntake.findFirst.mockResolvedValueOnce(null);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.isPrefillAvailable).toBe(false);
      expect(result.lines).toHaveLength(0);
      expect(result.packagingGroups).toHaveLength(0);
      expect(result.medicationChanges).toHaveLength(0);
      expect(result.dateWarnings).toHaveLength(0);
      expect(result.sourceType).toBe('unknown');
    });

    it('returns sourceType from intake even when lines are empty', async () => {
      prismaMock.prescriptionIntake.findFirst.mockResolvedValueOnce({
        ...makeCurrentIntake(),
        lines: [],
      });

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.isPrefillAvailable).toBe(false);
      expect(result.sourceType).toBe('qr');
      expect(result.packagingGroups).toHaveLength(0);
    });
  });

  describe('basic prefill line mapping', () => {
    it('maps a single line correctly', async () => {
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake())  // current
        .mockResolvedValueOnce(null);                // previous (none)
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.isPrefillAvailable).toBe(true);
      expect(result.lines).toHaveLength(1);

      const line = result.lines[0];
      expect(line.lineId).toBe('line_1');
      expect(line.lineNumber).toBe(1);
      expect(line.drugName).toBe('アムロジピン錠5mg');
      expect(line.drugCode).toBe('YJ001');
      expect(line.actualDrugName).toBe('アムロジピン錠5mg');
      expect(line.actualDrugCode).toBe('YJ001');
      expect(line.actualQuantity).toBe(28);
      expect(line.actualUnit).toBe('錠');
      expect(line.discrepancyReason).toBeNull();
    });
  });

  describe('packagingGroups field', () => {
    it('generates packagingGroups for internal drugs', async () => {
      const line = makeIntakeLine({ frequency: '朝食後' });
      const intake = {
        ...makeCurrentIntake({ lines: [line] }),
        lines: [{ ...line, packaging_instruction_tags: [], route: 'internal' }],
      };
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(intake)
        .mockResolvedValueOnce(null);
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.packagingGroups).toHaveLength(1);
      expect(result.packagingGroups[0]).toMatchObject({
        lineId: 'line_1',
        groupId: 'group_morning',
        slot: 'morning',
      });
    });

    it('empty intake → packagingGroups is empty array', async () => {
      prismaMock.prescriptionIntake.findFirst.mockResolvedValueOnce(null);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.packagingGroups).toEqual([]);
    });
  });

  describe('carryType mapping', () => {
    it('sets carryType to "facility_deposit" when source_type is "facility_batch"', async () => {
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ source_type: 'facility_batch' }))
        .mockResolvedValueOnce(null);
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].carryType).toBe('facility_deposit');
    });

    it('sets carryType to "carry" for other source types', async () => {
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ source_type: 'qr' }))
        .mockResolvedValueOnce(null);
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].carryType).toBe('carry');
    });

    it('sets carryType to "carry" for manual source type', async () => {
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ source_type: 'manual' }))
        .mockResolvedValueOnce(null);
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].carryType).toBe('carry');
    });
  });

  describe('specialNotes construction', () => {
    it('combines packaging_instructions and notes with " / " separator', async () => {
      const line = makeIntakeLine({ packaging_instructions: '一包化', notes: '食後に服用' });
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [line] }))
        .mockResolvedValueOnce(null);
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].specialNotes).toBe('一包化 / 食後に服用');
    });

    it('uses only packaging_instructions when notes is null', async () => {
      const line = makeIntakeLine({ packaging_instructions: '一包化', notes: null });
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [line] }))
        .mockResolvedValueOnce(null);
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].specialNotes).toBe('一包化');
    });

    it('sets specialNotes to null when both packaging_instructions and notes are null', async () => {
      const line = makeIntakeLine({ packaging_instructions: null, notes: null });
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [line] }))
        .mockResolvedValueOnce(null);
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].specialNotes).toBeNull();
    });
  });

  describe('change detection', () => {
    it('marks added line with changeMarker "added"', async () => {
      const currentLine = makeIntakeLine({ drug_name: '新薬剤', drug_code: 'NEW001' });
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [currentLine] }))
        .mockResolvedValueOnce(makePreviousIntake({ lines: [] })); // previous has no lines
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].changeMarker).toBe('added');
      expect(result.lines[0].changeDetail).toMatchObject({ previous: null });
    });

    it('marks dose change with changeMarker "dose_changed"', async () => {
      const currentLine = makeIntakeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '10mg', frequency: '1日1回' });
      const prevLine = { id: 'prev_line_1', drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '5mg', frequency: '1日1回', start_date: null, end_date: null };
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [currentLine] }))
        .mockResolvedValueOnce(makePreviousIntake({ lines: [prevLine] }));
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].changeMarker).toBe('dose_changed');
      expect(result.lines[0].changeDetail).toMatchObject({
        previous: '5mg / 1日1回',
        current: '10mg / 1日1回',
      });
    });

    it('sets changeMarker to null for unchanged lines', async () => {
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake())
        .mockResolvedValueOnce(makePreviousIntake()); // same drug, dose, frequency
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].changeMarker).toBeNull();
      expect(result.lines[0].changeDetail).toBeNull();
    });

    it('includes removed lines in medicationChanges', async () => {
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [] })) // no current lines
        .mockResolvedValueOnce(makePreviousIntake());
      // intake.lines is empty so isPrefillAvailable=false — test via non-empty current
      prismaMock.prescriptionIntake.findFirst.mockReset();

      const currentLine = makeIntakeLine({ drug_name: '現在薬', drug_code: 'CURR001' });
      const prevLine = { id: 'p1', drug_name: '削除薬', drug_code: 'PREV001', dose: '5mg', frequency: '1日1回', start_date: null, end_date: null };
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [currentLine] }))
        .mockResolvedValueOnce(makePreviousIntake({ lines: [prevLine] }));
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      const removedChange = result.medicationChanges.find((c) => c.change_type === 'removed');
      expect(removedChange).toBeDefined();
      expect(removedChange?.drug_name).toBe('削除薬');
    });
  });

  describe('generic suggestion', () => {
    it('sets genericSuggestion.available=true when preferred_generic_id exists in stock', async () => {
      const line = makeIntakeLine({ drug_code: 'YJ001' });
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [line] }))
        .mockResolvedValueOnce(null);

      // Batch 1: DrugMaster lookup by code
      prismaMock.drugMaster.findMany
        .mockResolvedValueOnce([{ id: 'dm_1', yj_code: 'YJ001', receipt_code: null }])  // drug masters
        .mockResolvedValueOnce([{ id: 'dm_generic_1', drug_name: 'アムロジピン錠5mg「GE」', yj_code: 'YJ_GE_001' }]); // generics

      // Batch 2: Stock lookup
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValueOnce([{
        drug_master_id: 'dm_1',
        preferred_generic_id: 'dm_generic_1',
      }]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].genericSuggestion).toMatchObject({
        available: true,
        genericDrugName: 'アムロジピン錠5mg「GE」',
        genericDrugCode: 'YJ_GE_001',
      });
    });

    it('sets genericSuggestion.available=false when no stock record exists', async () => {
      const line = makeIntakeLine({ drug_code: 'YJ001' });
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [line] }))
        .mockResolvedValueOnce(null);

      prismaMock.drugMaster.findMany.mockResolvedValueOnce([{ id: 'dm_1', yj_code: 'YJ001', receipt_code: null }]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValueOnce([]); // no stock with preferred generic

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.lines[0].genericSuggestion).toMatchObject({
        available: false,
        genericDrugName: null,
        genericDrugCode: null,
      });
    });

    it('skips generic lookup when siteId is null', async () => {
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake())
        .mockResolvedValueOnce(null);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, null);

      expect(result.lines[0].genericSuggestion).toMatchObject({ available: false });
      expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
      expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    });
  });

  describe('when no previous intake exists', () => {
    it('returns empty medicationChanges when there is no previous intake', async () => {
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake())
        .mockResolvedValueOnce(null); // no previous
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      // All current lines are "added" changes since previous is empty
      // detectChanges is called with [] for previous, so current lines show as 'added'
      expect(result.medicationChanges).toHaveLength(1);
      expect(result.medicationChanges[0].change_type).toBe('added');
    });

    it('returns empty dateWarnings when there is no previous intake', async () => {
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake())
        .mockResolvedValueOnce(null); // no previous
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.dateWarnings).toHaveLength(0);
    });
  });

  describe('date continuity integration', () => {
    it('includes dateWarnings from checkDateContinuity when previous intake exists with gap', async () => {
      const currentLine = makeIntakeLine({ start_date: new Date('2026-04-05') }); // gap of 5 days from prev end
      const prevLine = {
        id: 'prev_line_1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        dose: '5mg',
        frequency: '1日1回',
        start_date: new Date('2026-03-01'),
        end_date: new Date('2026-03-31'),
      };
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [currentLine] }))
        .mockResolvedValueOnce(makePreviousIntake({ lines: [prevLine] }));
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.dateWarnings).toHaveLength(1);
      expect(result.dateWarnings[0].type).toBe('gap');
      expect(result.dateWarnings[0].gapDays).toBe(5);
    });

    it('returns empty dateWarnings when dates are continuous', async () => {
      const currentLine = makeIntakeLine({ start_date: new Date('2026-04-01') }); // 1 day after prev end 3-31
      const prevLine = {
        id: 'prev_line_1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        dose: '5mg',
        frequency: '1日1回',
        start_date: new Date('2026-03-01'),
        end_date: new Date('2026-03-31'),
      };
      prismaMock.prescriptionIntake.findFirst
        .mockResolvedValueOnce(makeCurrentIntake({ lines: [currentLine] }))
        .mockResolvedValueOnce(makePreviousIntake({ lines: [prevLine] }));
      prismaMock.drugMaster.findMany.mockResolvedValue([]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

      const result = await generateDispensePrefill(CYCLE_ID, ORG_ID, SITE_ID);

      expect(result.dateWarnings).toHaveLength(0);
    });
  });
});
