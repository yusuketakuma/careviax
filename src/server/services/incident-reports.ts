import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import type {
  CreateIncidentReportInput,
  IncidentStatus,
  UpdateIncidentReportInput,
} from '@/lib/validations/incident-report';

export const incidentReportListSelect = {
  id: true,
  title: true,
  what_happened: true,
  cause: true,
  immediate_action: true,
  prevention_plan: true,
  related_process: true,
  severity: true,
  status: true,
  occurred_at: true,
  reported_by: true,
  created_at: true,
  updated_at: true,
} as const satisfies Prisma.IncidentReportSelect;

export type IncidentReportListItem = Prisma.IncidentReportGetPayload<{
  select: typeof incidentReportListSelect;
}>;

type IncidentAuditContext = Pick<AuthContext, 'orgId' | 'userId' | 'ipAddress' | 'userAgent'>;

export function buildIncidentCreateData(
  ctx: IncidentAuditContext,
  input: CreateIncidentReportInput,
) {
  return {
    org_id: ctx.orgId,
    reported_by: ctx.userId,
    title: input.title,
    what_happened: input.what_happened ?? null,
    cause: input.cause ?? null,
    immediate_action: input.immediate_action ?? null,
    prevention_plan: input.prevention_plan ?? null,
    related_process: input.related_process ?? null,
    ...(input.severity ? { severity: input.severity } : {}),
    occurred_at: input.occurred_at ? new Date(input.occurred_at) : null,
  } satisfies Prisma.IncidentReportUncheckedCreateInput;
}

export function buildIncidentUpdateData(input: UpdateIncidentReportInput) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.what_happened !== undefined ? { what_happened: input.what_happened } : {}),
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
    ...(input.immediate_action !== undefined ? { immediate_action: input.immediate_action } : {}),
    ...(input.prevention_plan !== undefined ? { prevention_plan: input.prevention_plan } : {}),
    ...(input.related_process !== undefined ? { related_process: input.related_process } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  } satisfies Prisma.IncidentReportUncheckedUpdateInput;
}

export function listUpdatedIncidentFields(input: UpdateIncidentReportInput): string[] {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

export function buildIncidentAuditChanges(
  report: Pick<IncidentReportListItem, 'title' | 'severity' | 'status' | 'related_process'>,
  updatedFields?: readonly string[],
): Prisma.InputJsonObject {
  return {
    title: report.title,
    severity: report.severity,
    status: report.status,
    related_process: report.related_process,
    ...(updatedFields ? { updated_fields: [...updatedFields] } : {}),
  };
}

export async function listIncidentReports(
  ctx: Pick<AuthContext, 'orgId'>,
  status?: IncidentStatus,
): Promise<IncidentReportListItem[]> {
  return withOrgContext(ctx.orgId, (tx) =>
    tx.incidentReport.findMany({
      where: {
        org_id: ctx.orgId,
        ...(status ? { status } : {}),
      },
      orderBy: [{ created_at: 'desc' }],
      take: 100,
      select: incidentReportListSelect,
    }),
  );
}

export async function createIncidentReport(
  ctx: IncidentAuditContext,
  input: CreateIncidentReportInput,
): Promise<IncidentReportListItem> {
  return withOrgContext(ctx.orgId, async (tx) => {
    const created = await tx.incidentReport.create({
      data: buildIncidentCreateData(ctx, input),
      select: incidentReportListSelect,
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'incident_report_created',
      targetType: 'IncidentReport',
      targetId: created.id,
      changes: buildIncidentAuditChanges(created),
    });

    return created;
  });
}

export async function updateIncidentReport(
  ctx: IncidentAuditContext,
  id: string,
  input: UpdateIncidentReportInput,
): Promise<IncidentReportListItem | null> {
  const existing = await prisma.incidentReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return null;

  const updatedFields = listUpdatedIncidentFields(input);

  return withOrgContext(ctx.orgId, async (tx) => {
    const updated = await tx.incidentReport.update({
      where: { id },
      data: buildIncidentUpdateData(input),
      select: incidentReportListSelect,
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'incident_report_updated',
      targetType: 'IncidentReport',
      targetId: updated.id,
      changes: buildIncidentAuditChanges(updated, updatedFields),
    });

    return updated;
  });
}
