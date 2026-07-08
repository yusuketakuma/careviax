import {
  createRiskFindingProviderRegistry,
  type RiskFindingProvider,
} from '@/core/risk/provider-registry';
import { createPharmacyCaseRiskProviders } from '@/modules/pharmacy';
import { createCoreCaseRiskProviders } from './core-case-risk-providers';
import type { CaseRiskProviderInput } from './case-risk-provider-types';

const coreProviders = createCoreCaseRiskProviders();
const pharmacyProviders = createPharmacyCaseRiskProviders();
const [
  pharmacyVisitPreparationProvider,
  pharmacyDispensingProvider,
  pharmacyMedicationReconciliationProvider,
  pharmacyMedicationStockSnapshotProvider,
  pharmacyBillingEvidenceProvider,
] = pharmacyProviders;

const activeCaseRiskFindingProviders = [
  coreProviders[0],
  pharmacyVisitPreparationProvider,
  coreProviders[1],
  pharmacyDispensingProvider,
  pharmacyMedicationReconciliationProvider,
  pharmacyMedicationStockSnapshotProvider,
  ...coreProviders.slice(2),
  pharmacyBillingEvidenceProvider,
] as const satisfies readonly RiskFindingProvider<CaseRiskProviderInput>[];

export const activeCaseRiskFindingProviderRegistry = createRiskFindingProviderRegistry(
  activeCaseRiskFindingProviders,
);
