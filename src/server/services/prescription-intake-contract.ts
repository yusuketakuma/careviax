import type { Prisma, PrescriptionSourceType } from '@prisma/client';
import type {
  PackagingInstructionTagValue,
  PackagingMethodValue,
} from '@/lib/dispensing/packaging';
import type { MedicationChange } from '@/lib/prescription/medication-diff';
import type { PrescriptionAccessContext } from '@/server/services/prescription-access';
import type { ApplyPrescriptionSupplyForIntakeResult } from '@/modules/pharmacy/medication-stock/application/apply-prescription-supply';

export interface CreateIntakeLineInput {
  line_number: number;
  drug_name: string;
  drug_master_id?: string | null;
  drug_code?: string | null;
  source_drug_code?: string | null;
  source_drug_code_type?: string | null;
  dosage_form?: string;
  dose: string;
  frequency: string;
  days: number;
  quantity?: number;
  unit?: string;
  is_generic?: boolean;
  is_generic_name_prescription?: boolean;
  packaging_method?: PackagingMethodValue;
  packaging_instructions?: string;
  packaging_instruction_tags?: PackagingInstructionTagValue[];
  notes?: string;
  route?: 'internal' | 'external' | 'injection' | 'other';
  dispensing_method?: 'standard' | 'unit_dose' | 'crushed' | 'other';
  start_date?: string;
  end_date?: string;
  source_intake_id?: string;
  source_line_id?: string;
  source_intake_updated_at_snapshot?: string;
  source_line_updated_at_snapshot?: string;
}

export interface CreateIntakeInput {
  cycle_id?: string;
  case_id?: string;
  patient_id?: string;
  source_type: PrescriptionSourceType;
  external_prescription_id?: string;
  prescribed_date: string;
  prescription_expiry_date?: string;
  prescriber_name?: string;
  prescriber_institution_id?: string;
  prescriber_institution?: string;
  original_document_url?: string;
  refill_remaining_count?: number;
  refill_next_dispense_date?: string;
  split_dispense_total?: number;
  split_dispense_current?: number;
  split_next_dispense_date?: string;
  prescription_category?: string; // regular | emergency
  emergency_category?: string; // planned_disease_exacerbation | other_exacerbation | online
  lines: CreateIntakeLineInput[];
  inquiry?: {
    reason: string;
    inquiry_to_physician: string;
    inquiry_content: string;
    request_due_date?: string;
    proposal_origin?: 'post_inquiry' | 'pre_issuance';
    residual_adjustment?: boolean;
  };
}

export interface CreateIntakeOptions {
  skipStructuringCheck?: boolean;
  skipExpiryCheck?: boolean;
  accessContext?: PrescriptionAccessContext;
}

export type CreatedIntakeLine = {
  drug_name: string;
  drug_code?: string | null;
  drug_master_id?: string | null;
  source_drug_code?: string | null;
  source_drug_code_type?: string | null;
  drug_resolution_status?: string | null;
  dose: string;
  frequency: string;
  days?: number | null;
  start_date?: string | Date | null;
};

export type CreatedIntake = {
  id: string;
  rx_number: string | null;
  lines: CreatedIntakeLine[];
};

export type MedicationProfileSyncLine = {
  drug_name: string;
  drug_master_id?: string | null;
  drug_code?: string | null;
  dose: string;
  frequency: string;
  start_date?: Date | string | null;
};

export interface ProfileSyncResult {
  created: number;
  updated: number;
  discontinued: number;
}

export type PrescriptionLineDrugResolutionStatus =
  | 'resolved'
  | 'missing_code'
  | 'code_not_found'
  | 'ambiguous_code';

export type ResolvedCreateIntakeLineInput = Omit<CreateIntakeLineInput, 'drug_code'> & {
  drug_code?: string | null;
  drug_master_id?: string | null;
  source_drug_code?: string | null;
  source_drug_code_type?: string | null;
  drug_resolution_status: PrescriptionLineDrugResolutionStatus;
};

export type UpdatedCycle = {
  id: string;
  patient_id: string;
  case_id: string | null;
};
export type Tx = {
  careCase: Pick<Prisma.TransactionClient['careCase'], 'findFirst'>;
  communicationEvent: Pick<Prisma.TransactionClient['communicationEvent'], 'create'>;
  communicationRequest: Pick<Prisma.TransactionClient['communicationRequest'], 'create'>;
  cycleTransitionLog: Pick<Prisma.TransactionClient['cycleTransitionLog'], 'create'>;
  dispenseTask: Pick<Prisma.TransactionClient['dispenseTask'], 'create' | 'findFirst'>;
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findMany'>;
  inquiryRecord: Pick<Prisma.TransactionClient['inquiryRecord'], 'count' | 'create'>;
  medicationCycle: Pick<
    Prisma.TransactionClient['medicationCycle'],
    'create' | 'findFirst' | 'updateMany'
  >;
  prescriberInstitution: Pick<Prisma.TransactionClient['prescriberInstitution'], 'findFirst'>;
  prescriptionIntake: Pick<Prisma.TransactionClient['prescriptionIntake'], 'create'> &
    Partial<Pick<Prisma.TransactionClient['prescriptionIntake'], 'update'>>;
  prescriptionLine: Pick<Prisma.TransactionClient['prescriptionLine'], 'findMany'>;
  task: Pick<Prisma.TransactionClient['task'], 'create' | 'updateMany' | 'upsert'>;
  workflowException: Pick<Prisma.TransactionClient['workflowException'], 'create' | 'findFirst'>;
  webhookRegistration: Pick<Prisma.TransactionClient['webhookRegistration'], 'findMany'>;
  webhookDelivery: Pick<Prisma.TransactionClient['webhookDelivery'], 'createMany'>;
};

// Discriminated union for results returned from within the transaction
export type TransactionResult =
  | { kind: 'intake'; intake: CreatedIntake; cycle: UpdatedCycle }
  | { kind: 'error'; error: 'cycle_not_found' }
  | { kind: 'error'; error: 'invalid_refill_remaining_count' }
  | { kind: 'error'; error: 'missing_refill_next_dispense_date' }
  | {
      kind: 'error';
      error: 'refill_window_out_of_range';
      targetDate: Date;
      windowStart: Date;
      windowEnd: Date;
    }
  | {
      kind: 'error';
      error: 'duplicate_prescription_lines';
      duplicates: Array<{ key: string; lines: Array<{ line_number: number; drug_name: string }> }>;
    }
  | {
      kind: 'error';
      error: 'structuring_blocked_lines';
      blockedLines: Array<{ line_number: number; drug_name: string }>;
    }
  | {
      kind: 'error';
      error: 'outpatient_injection_not_eligible';
      blockedLines: Array<{ line_number: number; drug_name: string; reason: string }>;
    }
  | { kind: 'error'; error: 'invalid_drug_master_id'; drugMasterIds: string[] }
  | { kind: 'error'; error: 'expiry_exceeded' }
  | { kind: 'error'; error: 'future_prescribed_date' }
  | { kind: 'error'; error: 'invalid_source_prescription_line' }
  | { kind: 'error'; error: 'source_revision_conflict' }
  | { kind: 'error'; error: 'invalid_transition' }
  | { kind: 'error'; error: 'version_conflict' };

export type TransactionRollbackResult = Extract<
  TransactionResult,
  { kind: 'error'; error: 'invalid_transition' | 'version_conflict' }
>;

export class PrescriptionIntakeTransactionRollback extends Error {
  constructor(readonly result: TransactionRollbackResult) {
    super(result.error);
    this.name = 'PrescriptionIntakeTransactionRollback';
  }
}

export type CreateIntakeServiceResult =
  | {
      ok: true;
      intake: CreatedIntake;
      cycle: UpdatedCycle;
      medicationChanges: MedicationChange[];
      profileSyncResult: ProfileSyncResult | null;
      prescriptionSupplyResult: ApplyPrescriptionSupplyForIntakeResult | null;
    }
  | { ok: false; error: 'cycle_not_found' }
  | { ok: false; error: 'invalid_refill_remaining_count' }
  | { ok: false; error: 'missing_refill_next_dispense_date' }
  | {
      ok: false;
      error: 'refill_window_out_of_range';
      targetDate: Date;
      windowStart: Date;
      windowEnd: Date;
    }
  | {
      ok: false;
      error: 'duplicate_prescription_lines';
      duplicates: Array<{ key: string; lines: Array<{ line_number: number; drug_name: string }> }>;
    }
  | {
      ok: false;
      error: 'structuring_blocked_lines';
      blockedLines: Array<{ line_number: number; drug_name: string }>;
    }
  | {
      ok: false;
      error: 'outpatient_injection_not_eligible';
      blockedLines: Array<{ line_number: number; drug_name: string; reason: string }>;
    }
  | { ok: false; error: 'invalid_drug_master_id'; drugMasterIds: string[] }
  | { ok: false; error: 'expiry_exceeded' }
  | { ok: false; error: 'future_prescribed_date' }
  | { ok: false; error: 'prescriber_institution_not_found'; message: string }
  | { ok: false; error: 'invalid_source_prescription_line' }
  | { ok: false; error: 'source_revision_conflict' }
  | { ok: false; error: 'invalid_transition' }
  | { ok: false; error: 'version_conflict' };
