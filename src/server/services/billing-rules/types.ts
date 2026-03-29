import type { PayerBasis } from '@prisma/client';

export type BillingRuleSeed = {
  ssot_key: string;
  rule_type: string;
  service_type: 'medical_home_visit' | 'care_home_management' | 'generic';
  payer_basis: PayerBasis;
  provider_scope: string | null;
  selection_mode: 'auto' | 'manual';
  calculation_unit: 'point' | 'unit' | 'percent';
  display_order: number;
  name: string;
  code: string;
  amount: number;
  conditions: Record<string, unknown>;
  evidence_requirements?: Record<string, unknown>;
  source_url: string;
  source_note: string;
};

export type BillingEvidenceContext = {
  orgId: string;
  payerBasis: PayerBasis;
  serviceType: 'medical_home_visit' | 'care_home_management';
  providerScope: 'pharmacy' | 'hospital_clinic';
  buildingPatientCount: number;
  monthlyVisitCount: number;
  weeklyVisitCount: number;
  claimable: boolean;
  exclusionReason?: string | null;
  specialCapEligible?: boolean;
  onlineEligible?: boolean;
  regionAddOnEligible?: Array<'special_15' | 'small_office_10' | 'resident_5'>;
  /** VisitType from the schedule — drives emergency billing rule selection */
  visitType?: string | null;
};

export type BillingCandidateSpec = {
  ssotKey: string;
  code: string;
  name: string;
  status: 'candidate' | 'confirmed' | 'excluded';
  points: number | null;
  exclusionReason: string | null;
  calculationBreakdown: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
};

export type BillingRevision = {
  code: string;           // e.g., '2024'
  label: string;          // e.g., '令和6年度(2024)改定'
  effectiveFrom: Date;    // e.g., 2024-06-01
  effectiveTo: Date | null; // null = current
  source: string;         // URL to official gazette
};
