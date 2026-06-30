import { describe, expect, it, vi } from 'vitest';
import { verifyDispenseBarcodeForLine } from './dispense-barcode-verification';

const line = {
  id: 'line_1',
  drug_code: 'YJ001',
  drug_name: 'テスト薬',
};

function barcodeClient(args: {
  packageMatches?: Array<{ drug_master: { yj_code: string | null } }>;
  legacyMaster?: { yj_code: string | null } | null;
}) {
  return {
    drugPackage: {
      findMany: vi.fn().mockResolvedValue(args.packageMatches ?? []),
    },
    drugMaster: {
      findFirst: vi.fn().mockResolvedValue(args.legacyMaster ?? null),
    },
  };
}

describe('verifyDispenseBarcodeForLine', () => {
  it('resolves GS1 GTIN through DrugPackage before legacy DrugMaster jan_code', async () => {
    const client = barcodeClient({
      packageMatches: [{ drug_master: { yj_code: 'YJ001' } }],
      legacyMaster: { yj_code: 'DIFFERENT' },
    });

    const result = await verifyDispenseBarcodeForLine({
      client,
      line,
      barcode: '0101234567890123',
    });

    expect(result.match).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(client.drugPackage.findMany).toHaveBeenCalledWith({
      where: {
        is_active: true,
        OR: [
          { gtin: '1234567890123' },
          { jan_code: '1234567890123' },
          { gtin: '01234567890123' },
          { jan_code: '01234567890123' },
        ],
      },
      select: {
        drug_master: {
          select: { yj_code: true },
        },
      },
    });
    expect(client.drugMaster.findFirst).not.toHaveBeenCalled();
  });

  it('does not fall back to legacy jan_code when package resolution mismatches the line', async () => {
    const client = barcodeClient({
      packageMatches: [{ drug_master: { yj_code: 'DIFFERENT' } }],
      legacyMaster: { yj_code: 'YJ001' },
    });

    const result = await verifyDispenseBarcodeForLine({
      client,
      line,
      barcode: '0101234567890123',
    });

    expect(result.match).toBe(false);
    expect(result.evidence.warning_codes).toContain('drug_mismatch');
    expect(client.drugMaster.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when package lookup maps one GTIN/JAN to multiple DrugMaster codes', async () => {
    const client = barcodeClient({
      packageMatches: [
        { drug_master: { yj_code: 'YJ001' } },
        { drug_master: { yj_code: 'YJ002' } },
      ],
      legacyMaster: { yj_code: 'YJ001' },
    });

    const result = await verifyDispenseBarcodeForLine({
      client,
      line,
      barcode: '0101234567890123',
    });

    expect(result.match).toBe(false);
    expect(result.evidence.warning_codes).toContain('drug_mismatch');
    expect(client.drugMaster.findFirst).not.toHaveBeenCalled();
  });

  it('keeps legacy DrugMaster jan_code fallback when no DrugPackage row exists', async () => {
    const client = barcodeClient({
      packageMatches: [],
      legacyMaster: { yj_code: 'YJ001' },
    });

    const result = await verifyDispenseBarcodeForLine({
      client,
      line,
      barcode: '0101234567890123',
    });

    expect(result.match).toBe(true);
    expect(client.drugMaster.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ jan_code: '1234567890123' }, { jan_code: '01234567890123' }],
      },
      select: { yj_code: true },
    });
  });
});
