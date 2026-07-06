import {
  createRiskFindingProviderRegistry,
  type RiskFindingProvider,
} from '@/core/risk/provider-registry';
import { createPharmacyCaseRiskProviders } from '@/modules/pharmacy';
import { createCoreCaseRiskProviders } from './core-case-risk-providers';
import type { CaseRiskProviderInput } from './case-risk-provider-types';

const coreProviders = createCoreCaseRiskProviders();
const pharmacyProviders = createPharmacyCaseRiskProviders();

const activeCaseRiskFindingProviders = [
  coreProviders[0],
  pharmacyProviders[0],
  coreProviders[1],
  pharmacyProviders[1],
  pharmacyProviders[2],
  ...coreProviders.slice(2),
  pharmacyProviders[3],
] as const satisfies readonly RiskFindingProvider<CaseRiskProviderInput>[];

export const activeCaseRiskFindingProviderRegistry = createRiskFindingProviderRegistry(
  activeCaseRiskFindingProviders,
);
