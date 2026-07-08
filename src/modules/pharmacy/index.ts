import { definePhosModule } from '@/core/module-registry';

export { createPharmacyCollaborationAccessProviders } from './collaboration/access-providers';
export {
  createPharmacyPatientWorkspacePanelProviders,
  type BuildPharmacyPatientWorkspaceArgs,
  type PharmacyPatientWorkspaceProviderInput,
  type PharmacyPatientWorkspaceReadModel,
} from './patient-workspace/workspace-read-model';
export { createPharmacyCaseRiskProviders } from './risk/case-risk-providers';
export {
  buildPharmacyPrescriptionTimelineHref,
  getPharmacyCycleStatusLabel,
} from './patient-movement/timeline-links';
export {
  applyInboundSignalToMedicationStock,
  type ApplyInboundMedicationStockSignalResult,
} from './medication-stock/application/apply-inbound-medication-stock-signal';
export {
  applyVisitMedicationStockObservations,
  type VisitMedicationStockObservationInput,
} from './medication-stock/application/apply-visit-medication-stock-observation';
export { stageInboundMedicationStockSignalForReview } from './medication-stock/application/medication-stock-signal-adapter';
export { getPatientMedicationStockSummary } from './medication-stock/application/patient-medication-stock-summary';
export { createPharmacyReportTemplateProviders } from './reports/report-template-providers';
export {
  buildPharmacyVisitBriefDispensingItems,
  detectPharmacyVisitBriefMedicationChanges,
  normalizePharmacyJahisSupplementalRecordsForVisitBrief,
} from './visit/brief-presentation';

export const pharmacyModule = definePhosModule({
  id: 'pharmacy',
  label: 'Pharmacy home care',
  enabled: true,
  ownedModels: [
    'PrescriptionIntake',
    'PrescriptionLine',
    'MedicationCycle',
    'DispenseTask',
    'SetPlan',
  ],
  routePrefixes: [
    '/api/prescription-intakes',
    '/api/dispense-workbench',
    '/api/dispense-tasks',
    '/api/medication-cycles',
    '/api/visit-preparations',
    '/api/billing',
  ],
  publicServices: [
    'src/server/services/prescription-intake-service.ts',
    'src/server/services/dispense-workbench-patients.ts',
    'src/server/services/visit-preparation-readiness.ts',
    'src/server/services/billing-evidence/core.ts',
    'src/modules/pharmacy/patient-movement/timeline-links.ts',
    'src/modules/pharmacy/reports/report-template-providers.ts',
  ],
  riskDomainsRef: ['risk:medication', 'risk:dispensing', 'risk:visit_preparation', 'risk:billing'],
  taskRegistryRef: ['task:src/lib/tasks/task-registry.ts'],
  emittedEventsRef: [],
  tenantScope: ['org', 'org_case'],
  phiBoundary: 'phi_present',
  notes: [
    'Current product scope: pharmacy only.',
    'Risk, task, event, RLS, and DTO semantics remain in their existing registries.',
  ],
} as const);
