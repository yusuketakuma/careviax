export type PrescriptionDiffReviewChangeType = 'added' | 'removed' | 'changed' | 'unchanged';

export type PrescriptionDiffReviewRow = {
  key: string;
  drug_name: string;
  current_drug_master_id: string | null;
  current_drug_code: string | null;
  previous_drug_master_id: string | null;
  previous_drug_code: string | null;
  change_type: PrescriptionDiffReviewChangeType;
  change_label: string;
  previous_label: string | null;
  current_label: string | null;
  pharmacist_memo: string | null;
};

export type PrescriptionDiffReview = {
  rows: PrescriptionDiffReviewRow[];
  set_impacts: string[];
  patient_checks: string[];
  change_count: number;
};

export type PrescriptionDiffMeta = {
  current: { id: string; prescribed_date: string };
  previous: { id: string; prescribed_date: string };
};
