const DECIMAL_UNIT_PATTERNS = [
  /^u?g$/i,
  /^μg$/i,
  /^mcg$/i,
  /^mg$/i,
  /^g$/i,
  /^kg$/i,
  /^m?l$/i,
  /^ml$/i,
  /^mL$/,
  /^l$/i,
  /^cc$/i,
  /^%$/,
];

const HALF_STEP_UNIT_PATTERNS = [/錠/, /tablet/i, /^tab\.?$/i];

const INTEGER_UNIT_PATTERNS = [
  /包/,
  /本/,
  /枚/,
  /個/,
  /カプセル/,
  /cap/i,
  /capsule/i,
  /瓶/,
  /袋/,
  /箱/,
  /管/,
  /筒/,
  /アンプル/,
  /amp/i,
  /vial/i,
  /キット/,
  /kit/i,
];

export type QuantityStep = 1 | 0.5 | 0.001;

function normalizeUnit(unit: string | null | undefined) {
  return (unit ?? '').normalize('NFKC').trim().replace(/\s+/g, '');
}

function baseQuantityStepForUnit(unit: string | null | undefined): QuantityStep {
  const normalized = normalizeUnit(unit);
  if (!normalized) return 0.001;
  if (DECIMAL_UNIT_PATTERNS.some((pattern) => pattern.test(normalized))) return 0.001;
  if (HALF_STEP_UNIT_PATTERNS.some((pattern) => pattern.test(normalized))) return 0.5;
  if (INTEGER_UNIT_PATTERNS.some((pattern) => pattern.test(normalized))) return 1;
  return 0.001;
}

export function isQuantityAlignedToStep(quantity: number, step: QuantityStep) {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  const scaled = quantity / step;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

export function quantityStepForUnit(
  unit: string | null | undefined,
  referenceQuantity?: number | null,
): QuantityStep {
  const baseStep = baseQuantityStepForUnit(unit);
  if (
    typeof referenceQuantity === 'number' &&
    Number.isFinite(referenceQuantity) &&
    referenceQuantity > 0 &&
    !isQuantityAlignedToStep(referenceQuantity, baseStep)
  ) {
    return 0.001;
  }
  return baseStep;
}

export function quantityStepAttribute(
  unit: string | null | undefined,
  referenceQuantity?: number | null,
) {
  return String(quantityStepForUnit(unit, referenceQuantity));
}

export function quantityInputModeForUnit(
  unit: string | null | undefined,
  referenceQuantity?: number | null,
) {
  return quantityStepForUnit(unit, referenceQuantity) === 1 ? 'numeric' : 'decimal';
}

export function isQuantityAllowedForUnit(input: {
  quantity: number;
  unit?: string | null;
  referenceQuantity?: number | null;
}) {
  return isQuantityAlignedToStep(
    input.quantity,
    quantityStepForUnit(input.unit, input.referenceQuantity),
  );
}

export function areQuantitiesEquivalentForUnit(input: {
  left: number;
  right: number;
  unit?: string | null;
  referenceQuantity?: number | null;
}) {
  if (!Number.isFinite(input.left) || !Number.isFinite(input.right)) return false;
  const step = quantityStepForUnit(input.unit, input.referenceQuantity);
  const leftScaled = input.left / step;
  const rightScaled = input.right / step;
  const leftRounded = Math.round(leftScaled);
  const rightRounded = Math.round(rightScaled);
  const epsilon = 1e-9;
  if (
    Math.abs(leftScaled - leftRounded) > epsilon ||
    Math.abs(rightScaled - rightRounded) > epsilon
  ) {
    return false;
  }
  return leftRounded === rightRounded;
}
