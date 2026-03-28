import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  parseSettingInputValue,
  SETTING_CATALOG,
  stringifySettingValue,
  type SettingScope,
  type SettingValueItem,
} from '@/lib/admin/settings-catalog';

const scopeSchema = z.enum(['system', 'organization', 'site', 'user']);

const updateSettingsSchema = z.object({
  scope: scopeSchema,
  scope_id: z.string().trim().optional().nullable(),
  values: z.record(z.string(), z.string()),
});

async function resolveScopeTarget(
  orgId: string,
  userId: string,
  scope: SettingScope,
  scopeIdRaw: string | null | undefined
) {
  if (scope === 'system') {
    return { scopeId: null, entityValues: {} as Record<string, unknown> };
  }

  if (scope === 'organization') {
    const organization = await prisma.organization.findFirst({
      where: { id: orgId },
      select: {
        name: true,
        corporate_number: true,
      },
    });

    if (!organization) return null;
    return {
      scopeId: orgId,
      entityValues: {
        org_name: organization.name,
        corporate_number: organization.corporate_number ?? '',
      },
    };
  }

  if (scope === 'site') {
    const siteId = scopeIdRaw?.trim() || null;
    if (!siteId) {
      return null;
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: siteId, org_id: orgId },
      select: {
        id: true,
        name: true,
        dispensing_fee_category: true,
        is_health_support_pharmacy: true,
      },
    });

    if (!site) return null;
    return {
      scopeId: site.id,
      entityValues: {
        site_name: site.name,
        dispensing_fee_category: site.dispensing_fee_category ?? '1',
        is_health_support_pharmacy: String(site.is_health_support_pharmacy),
      },
    };
  }

  const targetUserId = scopeIdRaw?.trim() || userId;
  const user = await prisma.user.findFirst({
    where: { id: targetUserId, org_id: orgId },
    select: { id: true },
  });

  if (!user) return null;
  return { scopeId: user.id, entityValues: {} as Record<string, unknown> };
}

function buildSettingItems(
  scope: SettingScope,
  entityValues: Record<string, unknown>,
  storedValues: Map<string, Prisma.JsonValue>
): SettingValueItem[] {
  return SETTING_CATALOG[scope].map((item) => {
    const rawValue =
      item.storage === 'setting' ? storedValues.get(item.key) : entityValues[item.key];

    return {
      key: item.key,
      label: item.label,
      description: item.description,
      value: stringifySettingValue(rawValue, item.defaultValue),
      type: item.type,
      options: item.options,
    };
  });
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsedScope = scopeSchema.safeParse(searchParams.get('scope'));
    if (!parsedScope.success) {
      return validationError('scope が不正です', {
        scope: ['scope は system / organization / site / user のいずれかです'],
      });
    }

    const resolved = await resolveScopeTarget(
      ctx.orgId,
      ctx.userId,
      parsedScope.data,
      searchParams.get('scope_id')
    );
    if (!resolved) {
      return notFound('設定対象が見つかりません');
    }

    const rows =
      SETTING_CATALOG[parsedScope.data].filter((item) => item.storage === 'setting').length === 0
        ? []
        : await prisma.setting.findMany({
            where: {
              scope: parsedScope.data,
              scope_id: resolved.scopeId,
              key: {
                in: SETTING_CATALOG[parsedScope.data]
                  .filter((item) => item.storage === 'setting')
                  .map((item) => item.key),
              },
            },
            select: {
              key: true,
              value: true,
            },
          });

    return success({
      data: {
        scope: parsedScope.data,
        scope_id: resolved.scopeId,
        items: buildSettingItems(
          parsedScope.data,
          resolved.entityValues,
          new Map(rows.map((row) => [row.key, row.value]))
        ),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '管理設定の閲覧権限がありません',
  }
);

export const PATCH = withAuthContext(
  async (req: NextRequest, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const resolved = await resolveScopeTarget(
      ctx.orgId,
      ctx.userId,
      parsed.data.scope,
      parsed.data.scope_id
    );
    if (!resolved) {
      return notFound('設定対象が見つかりません');
    }

    const catalogItems = SETTING_CATALOG[parsed.data.scope];
    const unknownKeys = Object.keys(parsed.data.values).filter(
      (key) => !catalogItems.some((item) => item.key === key)
    );
    if (unknownKeys.length > 0) {
      return validationError('未定義の設定キーがあります', {
        values: unknownKeys,
      });
    }

    await prisma.$transaction(async (tx) => {
      if (parsed.data.scope === 'organization') {
        const organizationData: Record<string, string | null> = {};
        if ('org_name' in parsed.data.values) {
          organizationData.name = parsed.data.values.org_name;
        }
        if ('corporate_number' in parsed.data.values) {
          organizationData.corporate_number = parsed.data.values.corporate_number || null;
        }
        if (Object.keys(organizationData).length > 0) {
          await tx.organization.update({
            where: { id: ctx.orgId },
            data: organizationData,
          });
        }
      }

      if (parsed.data.scope === 'site' && resolved.scopeId) {
        const siteData: Record<string, string | boolean | null> = {};
        if ('site_name' in parsed.data.values) {
          siteData.name = parsed.data.values.site_name;
        }
        if ('dispensing_fee_category' in parsed.data.values) {
          siteData.dispensing_fee_category = parsed.data.values.dispensing_fee_category;
        }
        if ('is_health_support_pharmacy' in parsed.data.values) {
          siteData.is_health_support_pharmacy =
            parsed.data.values.is_health_support_pharmacy === 'true';
        }
        if (Object.keys(siteData).length > 0) {
          await tx.pharmacySite.update({
            where: { id: resolved.scopeId },
            data: siteData,
          });
        }
      }

      const settingBackedItems = catalogItems.filter((item) => item.storage === 'setting');
      await Promise.all(
        settingBackedItems
          .filter((item) => Object.prototype.hasOwnProperty.call(parsed.data.values, item.key))
          .map(async (item) => {
            const value = parseSettingInputValue(
              item.type,
              parsed.data.values[item.key] ?? item.defaultValue
            );
            const existing = await tx.setting.findFirst({
              where: {
                scope: parsed.data.scope,
                scope_id: resolved.scopeId,
                key: item.key,
              },
              select: { id: true },
            });

            if (existing) {
              return tx.setting.update({
                where: { id: existing.id },
                data: { value },
              });
            }

            return tx.setting.create({
              data: {
                scope: parsed.data.scope,
                scope_id: resolved.scopeId,
                key: item.key,
                value,
              },
            });
          })
      );
    });

    const rows =
      catalogItems.filter((item) => item.storage === 'setting').length === 0
        ? []
        : await prisma.setting.findMany({
            where: {
              scope: parsed.data.scope,
              scope_id: resolved.scopeId,
              key: {
                in: catalogItems.filter((item) => item.storage === 'setting').map((item) => item.key),
              },
            },
            select: {
              key: true,
              value: true,
            },
          });

    const refreshed = await resolveScopeTarget(
      ctx.orgId,
      ctx.userId,
      parsed.data.scope,
      resolved.scopeId
    );
    if (!refreshed) {
      return notFound('設定対象が見つかりません');
    }

    return success({
      data: {
        scope: parsed.data.scope,
        scope_id: refreshed.scopeId,
        items: buildSettingItems(
          parsed.data.scope,
          refreshed.entityValues,
          new Map(rows.map((row) => [row.key, row.value]))
        ),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '管理設定の更新権限がありません',
  }
);
