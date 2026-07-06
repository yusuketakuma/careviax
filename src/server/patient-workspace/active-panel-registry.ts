import { createPatientWorkspacePanelRegistry } from '@/core/patient/workspace-panel';
import type {
  PharmacyPatientWorkspaceProviderInput,
  PharmacyPatientWorkspaceReadModel,
} from '@/modules/pharmacy';
import { createPharmacyPatientWorkspacePanelProviders } from '@/modules/pharmacy';

const pharmacyProviders = createPharmacyPatientWorkspacePanelProviders();

export const activePatientWorkspacePanelRegistry = createPatientWorkspacePanelRegistry<
  PharmacyPatientWorkspaceProviderInput,
  PharmacyPatientWorkspaceReadModel,
  typeof pharmacyProviders
>(pharmacyProviders);
