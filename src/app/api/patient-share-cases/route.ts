import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { dateKeySchema } from '@/lib/validations/date-key';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';

const PATIENT_SHARE_SCOPE_KEYS = [
  'prescription_history',
  'medication_profile',
  'care_reports',
  'attachments',
  'print',
  'pdf_output',
  'download',
] as const;

type PatientShareScopeKey = (typeof PATIENT_SHARE_SCOPE_KEYS)[number];
type PatientShareScope = Record<PatientShareScopeKey, boolean>;

const DEFAULT_SHARE_SCOPE: PatientShareScope = {
  prescription_history: true,
  medication_profile: true,
  care_reports: true,
  attachments: false,
  print: false,
  pdf_output: false,
  download: false,
};

const shareCaseStatusSchema = z.enum([
  'draft',
  'pending_partner',
  'active',
  'suspended',
  'revoked',
  'ended',
]);
const viewContextSchema = z
  .enum(['pharmacy_cooperation_workflow', 'patient_share_cases_api'])
  .default('patient_share_cases_api');
const dateOnlySchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');

const createPatientShareCaseSchema = z
  .object({
    partnership_id: z.string().trim().min(1, '薬局間連携IDは必須です'),
    base_patient_id: z.string().trim().min(1, '患者IDは必須です'),
    base_case_id: z.string().trim().min(1).optional(),
    share_scope: z
      .record(z.string(), z.unknown())
      .optional()
      .transform((value) => normalizeShareScope(value)),
    starts_at: dateOnlySchema.optional().nullable(),
    ends_at: dateOnlySchema.optional().nullable(),
    shared_management_plan_id: z.string().trim().min(1).optional(),
    shared_management_plan_version: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.starts_at && value.ends_at && value.ends_at < value.starts_at) {
      ctx.addIssue({
        code: 'custom',
        path: ['ends_at'],
        message: '終了日は開始日以降を指定してください',
      });
    }
  });

type PatientForSnapshot = {
  id: string;
  name: string;
  name_kana: string;
  birth_date: Date;
  gender: string;
  residences: Array<{
    address: string;
    facility_id: string | null;
    facility_unit_id: string | null;
    unit_name: string | null;
  }>;
};

function optionalSearchParam(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalDate(value: string | null | undefined) {
  return value ? utcDateFromLocalKey(value) : null;
}

function normalizeShareScope(value: Record<string, unknown> | undefined): PatientShareScope {
  const normalized: PatientShareScope = { ...DEFAULT_SHARE_SCOPE };
  if (!value) return normalized;

  for (const key of PATIENT_SHARE_SCOPE_KEYS) {
    const rawValue = value[key];
    if (typeof rawValue === 'boolean') {
      normalized[key] = rawValue;
    }
  }

  return normalized;
}

function enabledShareScopeKeys(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const scope = value as Record<string, unknown>;
  return PATIENT_SHARE_SCOPE_KEYS.filter((key) => scope[key] === true);
}

function dateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildBasePatientSnapshot(patient: PatientForSnapshot) {
  const residence = patient.residences[0] ?? null;
  return {
    id: patient.id,
    name: patient.name,
    name_kana: patient.name_kana,
    birth_date: dateKeyFromDate(patient.birth_date),
    gender: patient.gender,
    primary_residence: residence
      ? {
          address: residence.address,
          facility_id: residence.facility_id,
          facility_unit_id: residence.facility_unit_id,
          unit_name: residence.unit_name,
        }
      : null,
  };
}

function toSafePatientLink(
  link: {
    id: string;
    match_status: string;
    approved_by_base: string | null;
    approved_by_partner: string | null;
    accepted_at: Date | null;
    declined_at: Date | null;
    partner_patient_id?: string | null;
    base_patient_snapshot?: unknown;
    partner_patient_snapshot?: unknown;
    decline_reason?: string | null;
  } | null,
) {
  if (!link) return null;
  return {
    id: link.id,
    match_status: link.match_status,
    approved_by_base: link.approved_by_base,
    approved_by_partner: link.approved_by_partner,
    accepted_at: link.accepted_at,
    declined_at: link.declined_at,
    has_partner_patient_id: Boolean(link.partner_patient_id),
  };
}

function toSafePatientShareCase<T extends object>(row: T) {
  const source = row as T & {
    share_scope?: unknown;
    patient_link?: Parameters<typeof toSafePatientLink>[0];
  };
  const { share_scope: shareScope, patient_link: patientLink, ...safe } = source;
  return {
    ...safe,
    scope_keys: enabledShareScopeKeys(shareScope),
    patient_link: toSafePatientLink(patientLink ?? null),
  };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const rawStatus = optionalSearchParam(searchParams.get('status'));
    const status = rawStatus ? shareCaseStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', {
          status: ['対応していないステータスです'],
        }),
      );
    }

    const partnershipId = optionalSearchParam(searchParams.get('partnership_id'));
    const basePatientId = optionalSearchParam(searchParams.get('base_patient_id'));
    const rawViewContext = optionalSearchParam(searchParams.get('view_context'));
    const viewContext = viewContextSchema.safeParse(rawViewContext ?? undefined);
    if (!viewContext.success) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', {
          view_context: ['対応していない閲覧画面です'],
        }),
      );
    }

    const rows = await withOrgContext(ctx.orgId, async (tx) => {
      const result = await tx.patientShareCase.findMany({
        where: {
          org_id: ctx.orgId,
          ...(status ? { status: status.data } : {}),
          ...(partnershipId ? { partnership_id: partnershipId } : {}),
          ...(basePatientId ? { base_patient_id: basePatientId } : {}),
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        include: {
          partnership: {
            select: {
              id: true,
              status: true,
              base_site_id: true,
              partner_pharmacy: { select: { id: true, name: true, status: true } },
            },
          },
          patient_link: {
            select: {
              id: true,
              match_status: true,
              approved_by_base: true,
              approved_by_partner: true,
              accepted_at: true,
              declined_at: true,
              partner_patient_id: true,
            },
          },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_cases_viewed',
        targetType: 'PatientShareCase',
        targetId: result[0]?.id ?? 'patient_share_cases',
        changes: {
          target_screen: viewContext.data,
          viewer_role: ctx.role,
          viewed_count: Math.min(result.length, limit),
          share_case_ids: result.slice(0, limit).map((row) => row.id),
          base_patient_ids: result.slice(0, limit).map((row) => row.base_patient_id),
          base_site_ids: [
            ...new Set(result.slice(0, limit).map((row) => row.partnership.base_site_id)),
          ],
          partner_pharmacy_ids: [
            ...new Set(result.slice(0, limit).map((row) => row.partnership.partner_pharmacy.id)),
          ],
          filters: {
            status: status?.data ?? null,
            has_partnership_id: Boolean(partnershipId),
            has_base_patient_id: Boolean(basePatientId),
            limit,
          },
        },
      });

      return result;
    });

    const page = buildCursorPage(rows, limit, (row) => row.id);
    return withSensitiveNoStore(
      success({
        ...page,
        data: page.data.map(toSafePatientShareCase),
      }),
    );
  },
  {
    permission: 'canVisit',
    message: '患者共有ケースの閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = createPatientShareCaseSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const [partnership, patient, careCase] = await Promise.all([
        tx.pharmacyPartnership.findFirst({
          where: { id: parsed.data.partnership_id, org_id: ctx.orgId },
          select: {
            id: true,
            status: true,
            partner_pharmacy: { select: { status: true } },
          },
        }),
        tx.patient.findFirst({
          where: { id: parsed.data.base_patient_id, org_id: ctx.orgId, archived_at: null },
          select: {
            id: true,
            name: true,
            name_kana: true,
            birth_date: true,
            gender: true,
            residences: {
              where: { is_primary: true },
              orderBy: { updated_at: 'desc' },
              take: 1,
              select: {
                address: true,
                facility_id: true,
                facility_unit_id: true,
                unit_name: true,
              },
            },
          },
        }),
        parsed.data.base_case_id
          ? tx.careCase.findFirst({
              where: { id: parsed.data.base_case_id, org_id: ctx.orgId },
              select: { id: true, patient_id: true },
            })
          : Promise.resolve(null),
      ]);

      if (!partnership) return { response: notFound('薬局間連携が見つかりません') };
      if (partnership.status !== 'active') {
        return {
          response: validationError('入力値が不正です', {
            partnership_id: ['有効な薬局間連携にのみ共有ケースを作成できます'],
          }),
        };
      }
      if (partnership.partner_pharmacy.status !== 'active') {
        return {
          response: validationError('入力値が不正です', {
            partnership_id: ['有効な協力薬局との連携にのみ共有ケースを作成できます'],
          }),
        };
      }
      if (!patient) return { response: notFound('患者が見つかりません') };
      if (parsed.data.base_case_id && !careCase) {
        return { response: notFound('患者ケースが見つかりません') };
      }
      if (careCase && careCase.patient_id !== parsed.data.base_patient_id) {
        return {
          response: validationError('入力値が不正です', {
            base_case_id: ['指定した患者ケースは対象患者に紐づいていません'],
          }),
        };
      }

      const shareCase = await tx.patientShareCase.create({
        data: {
          org_id: ctx.orgId,
          partnership_id: parsed.data.partnership_id,
          base_patient_id: parsed.data.base_patient_id,
          base_case_id: parsed.data.base_case_id,
          status: 'draft',
          share_scope: toPrismaJsonInput(parsed.data.share_scope),
          starts_at: optionalDate(parsed.data.starts_at),
          ends_at: optionalDate(parsed.data.ends_at),
          shared_management_plan_id: parsed.data.shared_management_plan_id,
          shared_management_plan_version: parsed.data.shared_management_plan_version,
          created_by: ctx.userId,
          updated_by: ctx.userId,
          patient_link: {
            create: {
              org_id: ctx.orgId,
              base_patient_id: parsed.data.base_patient_id,
              match_status: 'pending',
              base_patient_snapshot: toPrismaJsonInput(buildBasePatientSnapshot(patient)),
            },
          },
        },
        include: {
          patient_link: {
            select: {
              id: true,
              match_status: true,
              approved_by_base: true,
              approved_by_partner: true,
              accepted_at: true,
              declined_at: true,
              partner_patient_id: true,
            },
          },
          partnership: {
            select: {
              id: true,
              status: true,
              partner_pharmacy: { select: { id: true, name: true, status: true } },
            },
          },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_case_created',
        targetType: 'PatientShareCase',
        targetId: shareCase.id,
        changes: {
          partnership_id: parsed.data.partnership_id,
          base_patient_id: parsed.data.base_patient_id,
          base_case_id: parsed.data.base_case_id ?? null,
          status: shareCase.status,
          share_scope_keys: enabledShareScopeKeys(parsed.data.share_scope).sort(),
          starts_at: parsed.data.starts_at ?? null,
          ends_at: parsed.data.ends_at ?? null,
        },
      });

      return { shareCase };
    });

    if ('response' in result) {
      return withSensitiveNoStore(result.response ?? validationError('入力値が不正です'));
    }
    return withSensitiveNoStore(success(toSafePatientShareCase(result.shareCase), 201));
  },
  {
    permission: 'canManagePatientSharing',
    message: '患者共有ケースの作成権限がありません',
  },
);
