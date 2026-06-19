export const BILLING_VALIDATION_LAYER_KEYS = ['evidence', 'rule_engine', 'close_review'] as const;

export type BillingValidationLayerKey = (typeof BILLING_VALIDATION_LAYER_KEYS)[number];
export type BillingValidationLayerState = 'passed' | 'manual_review' | 'blocked';

export type BillingValidationLayer = {
  label: string;
  state: BillingValidationLayerState;
  message: string;
  version?: string;
};

export type BillingValidationLayers = Record<BillingValidationLayerKey, BillingValidationLayer>;
export type BillingValidationLayerSnapshot = Partial<
  Record<BillingValidationLayerKey, Partial<BillingValidationLayer> | null>
>;
