import type { PhosModuleId } from '@/core/module-registry';
import type { RiskDomain, RiskFinding } from '@/lib/risk/risk-finding';

export type RiskFindingProvider<TInput, TProviderId extends string = string> = Readonly<{
  module: PhosModuleId;
  providerId: TProviderId;
  domains: readonly RiskDomain[];
  collect(input: TInput): readonly RiskFinding[];
}>;

export type RiskFindingProviderRegistry<TInput, TProviderId extends string = string> = Readonly<{
  get(providerId: string): RiskFindingProvider<TInput, TProviderId> | null;
  providerIds(): readonly TProviderId[];
  collectAll(input: TInput): RiskFinding[];
}>;

export function createRiskFindingProviderRegistry<
  TInput,
  const TProvider extends readonly RiskFindingProvider<TInput>[],
>(providers: TProvider): RiskFindingProviderRegistry<TInput, TProvider[number]['providerId']> {
  const byProviderId = new Map<string, TProvider[number]>();

  for (const provider of providers) {
    if (byProviderId.has(provider.providerId)) {
      throw new Error(`Duplicate risk finding provider: ${provider.providerId}`);
    }
    byProviderId.set(provider.providerId, provider);
  }

  const providerIds = Object.freeze(Array.from(byProviderId.keys()));

  return Object.freeze({
    get(providerId: string) {
      return byProviderId.get(providerId) ?? null;
    },
    providerIds() {
      return providerIds;
    },
    collectAll(input: TInput) {
      return providers.flatMap((provider) => {
        try {
          return [...provider.collect(input)];
        } catch {
          return [];
        }
      });
    },
  });
}
