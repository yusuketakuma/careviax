import { describe, expect, it } from 'vitest';
import { activeCaseRiskFindingProviderRegistry } from './active-case-risk-registry';

describe('activeCaseRiskFindingProviderRegistry', () => {
  it('keeps the legacy case-risk collection order while separating core and pharmacy providers', () => {
    expect(activeCaseRiskFindingProviderRegistry.providerIds()).toEqual([
      'core.consent_plan_lifecycle',
      'pharmacy.visit_preparation',
      'core.report_delivery',
      'pharmacy.dispensing',
      'pharmacy.medication_reconciliation',
      'core.notification',
      'core.data_quality',
      'core.integration',
      'core.inbound_interprofessional',
      'core.privacy_security',
      'core.task_sla',
      'pharmacy.billing_evidence',
    ]);
  });

  it('exposes provider module and domain ownership', () => {
    expect(activeCaseRiskFindingProviderRegistry.get('pharmacy.dispensing')).toMatchObject({
      module: 'pharmacy',
      domains: ['dispensing'],
    });
    expect(activeCaseRiskFindingProviderRegistry.get('core.privacy_security')).toMatchObject({
      module: 'core',
      domains: ['privacy_security'],
    });
    expect(
      activeCaseRiskFindingProviderRegistry.get('core.inbound_interprofessional'),
    ).toMatchObject({
      module: 'core',
      domains: ['integration', 'medication', 'visit_preparation'],
    });
    expect(activeCaseRiskFindingProviderRegistry.get('missing.provider')).toBeNull();
  });
});
