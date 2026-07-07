export type AsNeededPrescriptionLineInput = {
  drug_name?: string | null;
  dosage_form?: string | null;
  frequency?: string | null;
  route?: string | null;
  packaging_instruction_tags?: string[] | null;
  packaging_instructions?: string | null;
  notes?: string | null;
  unit?: string | null;
};

const PRN_TEXT_PATTERN =
  /頓服|頓用|屯服|必要時|疼痛時|発熱時|不眠時|嘔気時|便秘時|発作時|頭痛時|症状時|PRN|prn|as needed|as-needed/i;

/**
 * Parse Japanese frequency text to time slots.
 * Used by both pharmacy packaging and visit-deadline logic.
 */
export function parseFrequencyToSlots(frequency: string | null | undefined): string[] {
  if (!frequency) return [];
  const f = frequency.trim();

  if (/毎食後?|1日3回|分3/.test(f)) return ['morning', 'noon', 'evening'];
  if (/朝昼夕/.test(f)) return ['morning', 'noon', 'evening'];
  if (/朝夕|1日2回|分2/.test(f)) return ['morning', 'evening'];
  if (/朝食後|1日1回\s*朝|朝のみ/.test(f)) return ['morning'];
  if (/昼食後|1日1回\s*昼/.test(f)) return ['noon'];
  if (/夕食後|1日1回\s*夕/.test(f)) return ['evening'];
  if (/就寝前|眠前|寝る前/.test(f)) return ['bedtime'];
  if (/頓服|頓用|疼痛時|発熱時|不眠時|嘔気時|必要時/.test(f)) return ['prn'];
  if (/毎食前/.test(f)) return ['morning', 'noon', 'evening'];
  if (/朝食前/.test(f)) return ['morning'];
  if (/夕食前/.test(f)) return ['evening'];
  if (/食間/.test(f)) return ['morning', 'evening'];
  if (/朝1回/.test(f)) return ['morning'];

  if (/朝/.test(f)) return ['morning'];
  if (/昼/.test(f)) return ['noon'];
  if (/夕/.test(f)) return ['evening'];
  if (/眠|就寝/.test(f)) return ['bedtime'];

  return [];
}

export function hasAsNeededPrescriptionText(line: AsNeededPrescriptionLineInput) {
  const text = [
    line.drug_name ?? '',
    line.dosage_form ?? '',
    line.frequency ?? '',
    line.packaging_instructions ?? '',
    line.notes ?? '',
    line.unit ?? '',
    ...(line.packaging_instruction_tags ?? []),
  ].join(' ');

  return PRN_TEXT_PATTERN.test(text);
}

export function isPrescriptionLineAsNeededByClinicalText(
  line: AsNeededPrescriptionLineInput,
): boolean {
  return parseFrequencyToSlots(line.frequency).includes('prn') || hasAsNeededPrescriptionText(line);
}
