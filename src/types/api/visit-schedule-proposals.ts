import { z, type ZodType } from 'zod';

type VisitScheduleProposalWireItem = {
  id: string;
};

export type VisitScheduleProposalBillingAlert = {
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details: Record<string, unknown>;
  as_of: string;
};

export type VisitScheduleProposalDiagnostics = {
  accepted: unknown[];
  rejected: unknown[];
};

export type VisitScheduleProposalGenerationResult<TProposal, TAlert, TDiagnostics> = {
  data: TProposal[];
  alerts: TAlert[];
  diagnostics?: TDiagnostics;
  replayed: boolean;
};

const proposalWireItemSchema = z
  .object({
    id: z.string().trim().min(1),
  })
  .passthrough();

const billingAlertSchema = z
  .object({
    type: z.string().trim().min(1),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
    as_of: z.string().trim().min(1),
  })
  .passthrough();

const diagnosticsSchema = z
  .object({
    accepted: z.array(z.unknown()),
    rejected: z.array(z.unknown()),
  })
  .passthrough();

export function visitScheduleProposalGenerationResponseSchema<
  TProposal extends VisitScheduleProposalWireItem = VisitScheduleProposalWireItem,
  TAlert extends VisitScheduleProposalBillingAlert = VisitScheduleProposalBillingAlert,
  TDiagnostics extends VisitScheduleProposalDiagnostics = VisitScheduleProposalDiagnostics,
>() {
  return z
    .object({
      data: z.array(proposalWireItemSchema),
      meta: z
        .object({
          alerts: z.array(billingAlertSchema),
          diagnostics: diagnosticsSchema.optional(),
          replayed: z.boolean(),
        })
        .strict(),
    })
    .strict()
    .transform(
      ({ data, meta }): VisitScheduleProposalGenerationResult<TProposal, TAlert, TDiagnostics> => ({
        data: data as TProposal[],
        alerts: meta.alerts as TAlert[],
        ...(meta.diagnostics === undefined
          ? {}
          : { diagnostics: meta.diagnostics as TDiagnostics }),
        replayed: meta.replayed,
      }),
    );
}

export function visitScheduleProposalPaletteResponseSchema<TData>(dataSchema: ZodType<TData>) {
  return z
    .object({
      data: dataSchema,
      meta: z
        .object({
          has_more: z.boolean(),
        })
        .strict(),
    })
    .strict();
}
