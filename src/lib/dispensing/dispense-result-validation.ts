import {
  areQuantitiesEquivalentForUnit,
  isQuantityAllowedForUnit,
  quantityStepAttribute,
} from '@/lib/dispensing/quantity-unit';

export type ActualQuantitySource =
  | 'existing_result'
  | 'prescription_quantity_confirmed'
  | 'manual_entry';

export type DispenseResultValidationLine = {
  line_id: string;
  actual_drug_name: string;
  actual_drug_code?: string | null;
  actual_quantity: number;
  actual_quantity_confirmed?: boolean;
  actual_quantity_source?: ActualQuantitySource;
  actual_unit?: string | null;
  discrepancy_reason?: string | null;
  carry_type: 'carry' | 'facility_deposit' | 'deferred';
};

export type PrescribedDispenseLine = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  quantity: number | null;
  unit: string | null;
};

export type ExistingDispenseResultQuantity = {
  line_id: string;
  actual_quantity: number;
};

export type ActualQuantityConfirmationError = {
  line_id: string;
  reason:
    | 'actual_quantity_confirmation_required'
    | 'actual_quantity_source_required'
    | 'existing_result_required'
    | 'existing_result_quantity_mismatch'
    | 'prescribed_quantity_required'
    | 'prescription_quantity_mismatch';
};

export type ActualQuantityUnitError = {
  line_id: string;
  reason: 'actual_quantity_unit_step_invalid';
  unit: string;
  step: string;
};

export function resolveCanonicalActualUnit(input: {
  prescribedUnit?: string | null;
  actualUnit?: string | null;
}) {
  return input.prescribedUnit?.trim() || input.actualUnit?.trim() || undefined;
}

export function buildDiscrepancyReasonErrors(input: {
  submittedLines: DispenseResultValidationLine[];
  prescribedLines: PrescribedDispenseLine[];
}) {
  const prescribedByLineId = new Map(input.prescribedLines.map((line) => [line.id, line]));

  return input.submittedLines.flatMap((line) => {
    const prescribed = prescribedByLineId.get(line.line_id);
    if (!prescribed) return [];

    const hasDrugDiff =
      line.actual_drug_name !== prescribed.drug_name ||
      (line.actual_drug_code?.trim() || null) !== (prescribed.drug_code?.trim() || null);
    const hasQuantityDiff =
      prescribed.quantity != null &&
      !areQuantitiesEquivalentForUnit({
        left: line.actual_quantity,
        right: prescribed.quantity,
        unit: prescribed.unit ?? line.actual_unit,
        referenceQuantity: prescribed.quantity,
      });
    const requiresReason = hasDrugDiff || hasQuantityDiff || line.carry_type === 'deferred';

    if (!requiresReason || line.discrepancy_reason?.trim()) return [];

    return [
      {
        line_id: line.line_id,
        prescribed_drug_name: prescribed.drug_name,
        reason:
          line.carry_type === 'deferred'
            ? '後日対応時は理由コードが必須です'
            : '処方との差異があるため理由コードが必須です',
      },
    ];
  });
}

export function buildUnresolvedPrescribedQuantityErrors(input: {
  submittedLines: DispenseResultValidationLine[];
  prescribedLines: Array<Pick<PrescribedDispenseLine, 'id' | 'quantity' | 'unit'>>;
}) {
  const prescribedByLineId = new Map(input.prescribedLines.map((line) => [line.id, line]));

  return input.submittedLines.flatMap((line) => {
    const prescribed = prescribedByLineId.get(line.line_id);
    if (!prescribed) return [];
    if (
      typeof prescribed.quantity === 'number' &&
      Number.isFinite(prescribed.quantity) &&
      prescribed.quantity > 0
    ) {
      return [];
    }
    return [{ line_id: line.line_id, reason: 'prescribed_quantity_required' as const }];
  });
}

export function buildActualQuantityUnitErrors(input: {
  submittedLines: DispenseResultValidationLine[];
  prescribedLines: Array<Pick<PrescribedDispenseLine, 'id' | 'quantity' | 'unit'>>;
}): ActualQuantityUnitError[] {
  const prescribedByLineId = new Map(input.prescribedLines.map((line) => [line.id, line]));

  return input.submittedLines.flatMap((line): ActualQuantityUnitError[] => {
    const prescribed = prescribedByLineId.get(line.line_id);
    const unit = prescribed?.unit?.trim() || line.actual_unit?.trim() || '';
    if (!unit) return [];

    const referenceQuantity = prescribed?.quantity ?? null;
    if (
      isQuantityAllowedForUnit({
        quantity: line.actual_quantity,
        unit,
        referenceQuantity,
      })
    ) {
      return [];
    }

    return [
      {
        line_id: line.line_id,
        reason: 'actual_quantity_unit_step_invalid' as const,
        unit,
        step: quantityStepAttribute(unit, referenceQuantity),
      },
    ];
  });
}

export function buildActualQuantityConfirmationErrors(input: {
  submittedLines: DispenseResultValidationLine[];
  prescribedLines: Array<Pick<PrescribedDispenseLine, 'id' | 'quantity' | 'unit'>>;
  existingResults: ExistingDispenseResultQuantity[];
}): ActualQuantityConfirmationError[] {
  const prescribedByLineId = new Map(input.prescribedLines.map((line) => [line.id, line]));
  const existingResultByLineId = new Map(
    input.existingResults.map((result) => [result.line_id, result]),
  );

  return input.submittedLines.flatMap((line): ActualQuantityConfirmationError[] => {
    if (line.actual_quantity_confirmed !== true) {
      return [
        {
          line_id: line.line_id,
          reason: 'actual_quantity_confirmation_required' as const,
        },
      ];
    }
    if (!line.actual_quantity_source) {
      return [
        {
          line_id: line.line_id,
          reason: 'actual_quantity_source_required' as const,
        },
      ];
    }

    if (line.actual_quantity_source === 'existing_result') {
      const existing = existingResultByLineId.get(line.line_id);
      if (!existing) {
        return [
          {
            line_id: line.line_id,
            reason: 'existing_result_required' as const,
          },
        ];
      }
      if (existing.actual_quantity !== line.actual_quantity) {
        return [
          {
            line_id: line.line_id,
            reason: 'existing_result_quantity_mismatch' as const,
          },
        ];
      }
      return [];
    }

    if (line.actual_quantity_source === 'prescription_quantity_confirmed') {
      const prescribed = prescribedByLineId.get(line.line_id);
      if (
        !prescribed ||
        typeof prescribed.quantity !== 'number' ||
        !Number.isFinite(prescribed.quantity) ||
        prescribed.quantity <= 0
      ) {
        return [
          {
            line_id: line.line_id,
            reason: 'prescribed_quantity_required' as const,
          },
        ];
      }
      if (
        !areQuantitiesEquivalentForUnit({
          left: line.actual_quantity,
          right: prescribed.quantity,
          unit: prescribed.unit ?? line.actual_unit,
          referenceQuantity: prescribed.quantity,
        })
      ) {
        return [
          {
            line_id: line.line_id,
            reason: 'prescription_quantity_mismatch' as const,
          },
        ];
      }
    }

    return [];
  });
}
