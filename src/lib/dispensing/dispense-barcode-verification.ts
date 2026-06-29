import { isExpired, parseGS1Barcode } from '@/lib/pharmacy/barcode';
import { formatUtcDateKey } from '@/lib/date-key';

export type DispenseBarcodeVerificationLine = {
  id: string;
  drug_code: string | null;
  drug_name: string;
};

type DispenseBarcodeVerificationClient = {
  drugMaster: {
    findFirst: (args: {
      where: { OR: Array<{ jan_code: string }> };
      select: { yj_code: true };
    }) => Promise<{ yj_code: string | null } | null>;
  };
};

export type DispenseBarcodeVerificationEvidence = {
  line_id: string;
  match: boolean;
  gtin: string | null;
  expiry_date: string | null;
  lot_number_present: boolean;
  expired: boolean;
  warning_codes: Array<'expired' | 'drug_mismatch'>;
};

function normalizeExpiryDate(value: unknown) {
  if (typeof value === 'string') return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatUtcDateKey(value);
  }
  return null;
}

async function resolveGtinMatchesDrugCode(args: {
  client: DispenseBarcodeVerificationClient;
  gtin: string | null | undefined;
  lineDrugCode: string | null;
}) {
  if (!args.gtin) return false;

  const gtin = args.gtin;
  const janFromGtin = gtin.length === 14 ? gtin.substring(1) : gtin;

  const drugByJan = await args.client.drugMaster.findFirst({
    where: {
      OR: [{ jan_code: janFromGtin }, { jan_code: gtin }],
    },
    select: { yj_code: true },
  });

  if (drugByJan) {
    const masterYjCode = drugByJan.yj_code?.trim();
    const lineDrugCode = args.lineDrugCode?.trim();
    return Boolean(masterYjCode && lineDrugCode && masterYjCode === lineDrugCode);
  }

  return false;
}

export async function verifyDispenseBarcodeForLine(args: {
  client: DispenseBarcodeVerificationClient;
  line: DispenseBarcodeVerificationLine;
  barcode: string;
}) {
  const decoded = parseGS1Barcode(args.barcode);
  const expiryDate = normalizeExpiryDate(decoded.expiryDate);
  const expired = expiryDate ? isExpired(expiryDate) : false;
  const match = await resolveGtinMatchesDrugCode({
    client: args.client,
    gtin: decoded.gtin,
    lineDrugCode: args.line.drug_code,
  });

  const warnings: string[] = [];
  const warningCodes: DispenseBarcodeVerificationEvidence['warning_codes'] = [];

  if (expired) {
    warnings.push('有効期限切れの薬剤です');
    warningCodes.push('expired');
  }

  if (!match) {
    warnings.push('バーコードが処方薬と一致しません');
    warningCodes.push('drug_mismatch');
  }

  return {
    match,
    decoded: {
      gtin: decoded.gtin,
      expiryDate: decoded.expiryDate,
      lotNumber: decoded.lotNumber,
    },
    expected: {
      drug_code: args.line.drug_code,
      drug_name: args.line.drug_name,
    },
    warnings,
    evidence: {
      line_id: args.line.id,
      match,
      gtin: decoded.gtin ?? null,
      expiry_date: expiryDate,
      lot_number_present: Boolean(decoded.lotNumber),
      expired,
      warning_codes: warningCodes,
    } satisfies DispenseBarcodeVerificationEvidence,
  };
}
