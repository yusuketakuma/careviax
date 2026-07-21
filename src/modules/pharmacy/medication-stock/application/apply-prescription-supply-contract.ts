import { Prisma } from '@prisma/client';
import type { MedicationStockSnapshotItem } from './stock-snapshot';

export type PrescriptionSupplyReviewReason =
  | 'ambiguous_stock_item'
  | 'existing_stock_item_missing'
  | 'unresolved_drug_identity'
  | 'name_only_identity'
  | 'package_only_identity'
  | 'ambiguous_package_identity'
  | 'package_metadata_missing'
  | 'package_level_unsupported'
  | 'package_quantity_invalid'
  | 'unsupported_unit'
  | 'unit_conversion_required'
  | 'quantity_missing'
  | 'quantity_non_positive'
  | 'idempotency_fingerprint_conflict'
  | 'equivalence_review_pending';

export type PrescriptionSupplySkipReason =
  | 'non_stock_relevant_line'
  | 'missing_patient_or_case'
  | 'unsupported_route';

export type ApplyPrescriptionSupplyLineResult =
  | {
      kind: 'applied';
      prescription_line_id: string;
      stock_item_id: string;
      stock_event_id: string;
      snapshot: {
        current_quantity: number | null;
        stock_risk_level: 'ok' | 'watch' | 'shortage_expected' | 'urgent' | 'unknown';
        calculated_at: string;
      };
      idempotent_replay: boolean;
    }
  | {
      kind: 'review_required';
      prescription_line_id: string;
      reason_code: PrescriptionSupplyReviewReason;
      task_id: string;
      candidate_count: number;
    }
  | {
      kind: 'skipped';
      prescription_line_id: string;
      reason_code: PrescriptionSupplySkipReason;
    }
  | {
      kind: 'not_found';
      prescription_line_id: string;
      reason_code: 'intake_not_found' | 'prescription_line_not_found';
    };

export type ApplyPrescriptionSupplyForIntakeResult = {
  intake_id: string;
  applied_count: number;
  review_required_count: number;
  skipped_count: number;
  results: ApplyPrescriptionSupplyLineResult[];
};

export type ApplyPrescriptionSupplyDb = Pick<
  Prisma.TransactionClient,
  | 'drugMaster'
  | 'drugPackage'
  | 'medicationStockEvent'
  | 'medicationStockSnapshot'
  | 'patientMedicationStockItem'
  | 'prescriptionIntake'
  | 'task'
>;

export type PrescriptionSupplyLineRow = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  drug_master_id: string | null;
  source_drug_code: string | null;
  source_drug_code_type: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  route: string | null;
};

export type PrescriptionSupplyIntakeRow = {
  id: string;
  source_type: string;
  prescribed_date: Date;
  refill_next_dispense_date: Date | null;
  split_dispense_total: number | null;
  split_dispense_current: number | null;
  split_next_dispense_date: Date | null;
  cycle: {
    id: string;
    patient_id: string;
    case_id: string | null;
  };
  lines: PrescriptionSupplyLineRow[];
};

export type DrugMasterIdentityRow = {
  id: string;
  yj_code: string;
  receipt_code: string | null;
  hot_code: string | null;
  jan_code: string | null;
  drug_name: string;
  generic_name: string | null;
  dosage_form: string | null;
  manufacturer: string | null;
};

export type StockItemRow = MedicationStockSnapshotItem & {
  drug_master_id: string | null;
  drug_package_id: string | null;
  source_type: string;
  unit: string;
  equivalence_review_status: string;
};

export type DrugPackageIdentityRow = {
  id: string;
  drug_master_id: string;
  gtin: string;
  jan_code: string | null;
  package_level: string | null;
  package_quantity: Prisma.Decimal | null;
  package_quantity_unit: string | null;
};

export type DrugPackageIndexes = Map<string, DrugPackageIdentityRow[]>;

export type ResolvedPrescriptionSupplyTarget =
  | {
      ok: true;
      quantity: number;
      unit: string;
      drugMasterId: string;
      drugPackage: DrugPackageIdentityRow | null;
      unitSupported: true;
      quantityPresent: true;
    }
  | {
      ok: false;
      reasonCode: PrescriptionSupplyReviewReason;
      candidateCount: number;
      unitSupported: boolean;
      quantityPresent: boolean;
    };

export type PrescriptionSupplyReviewPreview =
  | {
      kind: 'not_found';
      reason_code: 'intake_not_found' | 'prescription_line_not_found';
    }
  | {
      kind: 'blocked';
      reason_code: PrescriptionSupplyReviewReason | PrescriptionSupplySkipReason;
      line: PrescriptionSupplyReviewLine;
    }
  | {
      kind: 'reviewable';
      line: PrescriptionSupplyReviewLine;
      normalized_supply: { quantity: number; unit: string };
      candidates: PrescriptionSupplyReviewCandidate[];
    };

export type PrescriptionSupplyReviewLine = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  route: string | null;
};

export type PrescriptionSupplyReviewCandidate = {
  id: string;
  display_id: string | null;
  display_name: string;
  case_id: string | null;
  unit: string;
  dosage_form: string | null;
  route: string | null;
  equivalence_review_status: string;
  applicable: boolean;
  current_quantity: number | null;
  snapshot_calculated_at: string | null;
};

export type PrescriptionSupplyManagingParty = 'patient' | 'family' | 'facility' | 'pharmacy';

export type CreatePrescriptionSupplyStockItemResult =
  | {
      kind: 'created';
      stock_item_id: string;
    }
  | {
      kind: 'not_found';
      reason_code: 'intake_not_found' | 'prescription_line_not_found';
    }
  | {
      kind: 'review_required';
      reason_code:
        | PrescriptionSupplyReviewReason
        | PrescriptionSupplySkipReason
        | 'existing_stock_item_available';
    };

export type DrugMasterIndexes = {
  byId: Map<string, DrugMasterIdentityRow>;
  byYj: Map<string, DrugMasterIdentityRow[]>;
  byReceipt: Map<string, DrugMasterIdentityRow[]>;
  byHot: Map<string, DrugMasterIdentityRow[]>;
};
