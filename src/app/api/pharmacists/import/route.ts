import { NextRequest } from 'next/server';
import type { ZodError } from 'zod';

import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import {
  isOperationalMemberRole,
  membershipFlagsForRole,
  roleRequiresSite,
} from '@/lib/auth/member-roles';
import {
  type PharmacistImportRow,
  pharmacistImportEnvelopeSchema,
  pharmacistImportRowSchema,
  normalizePharmacistImportLookupKey,
} from '@/lib/validations/pharmacist-import';
import { deleteCognitoUser, inviteCognitoUser } from '@/server/services/cognito-admin';

type ImportResultStatus = 'created' | 'failed';
type ImportOutcome = 'created' | 'partial_failed' | 'failed';
type ImportResult = {
  row_number: number;
  email: string;
  name: string;
  status: ImportResultStatus;
  message: string;
};
type ParsedImportRow =
  | {
      status: 'valid';
      row_number: number;
      row: PharmacistImportRow;
    }
  | {
      status: 'failed';
      result: ImportResult;
    };

function summarizeImportOutcome(results: Array<{ status: ImportResultStatus }>) {
  const createdCount = results.filter((result) => result.status === 'created').length;
  const failedCount = results.filter((result) => result.status === 'failed').length;
  let outcome: ImportOutcome = 'created';
  if (createdCount > 0 && failedCount > 0) {
    outcome = 'partial_failed';
  } else if (failedCount > 0) {
    outcome = 'failed';
  }

  return { createdCount, failedCount, outcome };
}

function importResponse(results: ImportResult[]) {
  const { createdCount, failedCount, outcome } = summarizeImportOutcome(results);

  return success({
    data: {
      created_count: createdCount,
      failed_count: failedCount,
      outcome,
      results,
    },
  });
}

function readImportRowString(row: unknown, key: 'email' | 'name') {
  const payload = readJsonObject(row);
  const value = payload?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function formatImportRowValidationMessage(error: ZodError) {
  const messages = Array.from(new Set(error.issues.map((issue) => issue.message))).filter(
    (message) => message.length > 0,
  );
  return messages.length > 0
    ? `入力値が不正です: ${messages.slice(0, 3).join('、')}`
    : '入力値が不正です';
}

function parseImportRows(rows: unknown[]): ParsedImportRow[] {
  return rows.map((row, index) => {
    const parsed = pharmacistImportRowSchema.safeParse(row);
    const rowNumber = index + 1;
    if (parsed.success) {
      return {
        status: 'valid',
        row_number: rowNumber,
        row: parsed.data,
      };
    }

    return {
      status: 'failed',
      result: {
        row_number: rowNumber,
        email: readImportRowString(row, 'email'),
        name: readImportRowString(row, 'name'),
        status: 'failed',
        message: formatImportRowValidationMessage(parsed.error),
      },
    };
  });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'スタッフ一括取込の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = pharmacistImportEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const parsedRows = parseImportRows(parsed.data.rows);
  const validRows = parsedRows.filter(
    (parsedRow): parsedRow is Extract<ParsedImportRow, { status: 'valid' }> =>
      parsedRow.status === 'valid',
  );
  const results: ImportResult[] = [];

  if (validRows.length === 0) {
    return importResponse(
      parsedRows.flatMap((parsedRow) => (parsedRow.status === 'failed' ? [parsedRow.result] : [])),
    );
  }

  const duplicateEmails = new Set<string>();
  const seenEmails = new Set<string>();
  for (const { row } of validRows) {
    if (seenEmails.has(row.email)) {
      duplicateEmails.add(row.email);
      continue;
    }
    seenEmails.add(row.email);
  }

  const sites = await prisma.pharmacySite.findMany({
    where: { org_id: ctx.orgId },
    select: { id: true, name: true },
  });
  const duplicateSiteNames = new Set<string>();
  const siteIdByName = new Map<string, string>();
  for (const site of sites) {
    const key = normalizePharmacistImportLookupKey(site.name);
    if (siteIdByName.has(key)) {
      duplicateSiteNames.add(key);
      continue;
    }
    siteIdByName.set(key, site.id);
  }

  for (const parsedRow of parsedRows) {
    if (parsedRow.status === 'failed') {
      results.push(parsedRow.result);
      continue;
    }

    const { row_number: rowNumber, row } = parsedRow;
    const siteKey = row.site_name ? normalizePharmacistImportLookupKey(row.site_name) : null;
    const siteId = siteKey ? (siteIdByName.get(siteKey) ?? null) : null;

    if (duplicateEmails.has(row.email)) {
      results.push({
        row_number: rowNumber,
        email: row.email,
        name: row.name,
        status: 'failed',
        message: 'CSV内で同じメールアドレスが重複しています',
      });
      continue;
    }

    if (siteKey && duplicateSiteNames.has(siteKey)) {
      results.push({
        row_number: rowNumber,
        email: row.email,
        name: row.name,
        status: 'failed',
        message: `店舗 "${row.site_name}" は同名店舗があるため特定できません`,
      });
      continue;
    }

    if (roleRequiresSite(row.role) && !siteId) {
      results.push({
        row_number: rowNumber,
        email: row.email,
        name: row.name,
        status: 'failed',
        message: row.site_name ? `店舗 "${row.site_name}" が見つかりません` : '所属店舗が必須です',
      });
      continue;
    }

    const existing = await prisma.user.findFirst({
      where: {
        email: row.email.toLowerCase(),
      },
      select: { id: true },
    });
    if (existing) {
      results.push({
        row_number: rowNumber,
        email: row.email,
        name: row.name,
        status: 'failed',
        message: '同じメールアドレスのユーザーが既に存在します',
      });
      continue;
    }

    let identity: Awaited<ReturnType<typeof inviteCognitoUser>>;
    try {
      identity = await inviteCognitoUser({
        email: row.email,
        name: row.name,
        phone: row.phone ?? undefined,
      });
    } catch (error) {
      results.push({
        row_number: rowNumber,
        email: row.email,
        name: row.name,
        status: 'failed',
        message:
          error instanceof Error && error.message === 'COGNITO_NOT_CONFIGURED'
            ? 'Cognito 設定が不足しています'
            : 'Cognito 招待に失敗しました',
      });
      continue;
    }

    const invitedAt = new Date();
    const isOperational = isOperationalMemberRole(row.role);

    try {
      await withOrgContext(ctx.orgId, async (tx) => {
        const user = await tx.user.create({
          data: {
            org_id: ctx.orgId,
            cognito_sub: identity.sub,
            cognito_username: identity.username,
            email: row.email,
            name: row.name,
            name_kana: row.name_kana,
            phone: row.phone,
            max_daily_visits: null,
            max_weekly_visits: null,
            max_travel_minutes: null,
            can_accept_emergency: isOperational,
            visit_specialties: toPrismaJsonInput([]),
            coverage_area: toPrismaJsonInput([]),
            account_status: 'invited',
            invited_at: invitedAt,
            invited_by: ctx.userId,
            last_invited_at: invitedAt,
          },
        });

        await tx.membership.create({
          data: {
            org_id: ctx.orgId,
            user_id: user.id,
            site_id: siteId,
            role: row.role,
            ...membershipFlagsForRole(row.role),
          },
        });

        if (row.certification_type) {
          await tx.pharmacistCredential.create({
            data: {
              org_id: ctx.orgId,
              user_id: user.id,
              certification_type: row.certification_type,
              certification_number: row.certification_number,
              issued_date: row.issued_date ? new Date(row.issued_date) : null,
              expiry_date: row.expiry_date ? new Date(row.expiry_date) : null,
              tenure_years: row.tenure_years,
              weekly_work_hours: row.weekly_work_hours,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            org_id: ctx.orgId,
            actor_id: ctx.userId,
            action: 'pharmacist_imported',
            target_type: 'User',
            target_id: user.id,
            changes: {
              role: row.role,
              site_id: siteId,
              certification_type: row.certification_type,
            },
            ip_address: ctx.ipAddress,
            user_agent: ctx.userAgent,
          },
        });
      });
    } catch {
      try {
        await deleteCognitoUser(identity.username);
      } catch {
        results.push({
          row_number: rowNumber,
          email: row.email,
          name: row.name,
          status: 'failed',
          message:
            'スタッフ作成に失敗しました。Cognito ユーザーの削除に失敗したため管理者確認が必要です',
        });
        continue;
      }
      results.push({
        row_number: rowNumber,
        email: row.email,
        name: row.name,
        status: 'failed',
        message: 'スタッフ作成に失敗しました',
      });
      continue;
    }

    results.push({
      row_number: rowNumber,
      email: row.email,
      name: row.name,
      status: 'created',
      message: '招待を作成しました',
    });
  }

  return importResponse(results);
}
