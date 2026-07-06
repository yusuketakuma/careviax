import {
  assertUniquePhosModules,
  listEnabledPhosModules,
  type PhosModuleMetadata,
} from '@/core/module-registry';
import { pharmacyModule } from '@/modules/pharmacy';

export const activeModules = [pharmacyModule] as const satisfies readonly PhosModuleMetadata[];

assertUniquePhosModules(activeModules);

export const enabledModules = listEnabledPhosModules(activeModules);
