import type {
  VisitModeView,
  VisitStep,
  VisitStepMutationRequest,
} from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export type PhosVisitModeRepository = {
  getVisitMode(ctx: TenantContext, packet_id: string): Promise<VisitModeView | null>;
  updateVisitStep(
    ctx: TenantContext,
    packet_id: string,
    step: VisitStep,
    request: VisitStepMutationRequest,
  ): Promise<VisitModeView>;
};
