import { NextRequest } from 'next/server';
import { z } from 'zod';
import { forbidden, success, validationError } from '@/lib/api/response';
import { isAdmin, withAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import {
  importGenericNameMappings,
  importMhlwGenericFlags,
} from '@/server/services/drug-master-import/mhlw';

const requestSchema = z.object({
  mode: z.enum(['flags', 'mappings', 'all']).default('all'),
  workbookUrl: z.string().url().optional(),
});

export const POST = withAuthContext(async (req: NextRequest, authCtx) => {
  if (!isAdmin(authCtx.role)) {
    return forbidden('医薬品マスター取込は管理者のみ実行できます');
  }

  const body = await req.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const result = {
    flags: null as Awaited<ReturnType<typeof importMhlwGenericFlags>> | null,
    mappings: null as Awaited<ReturnType<typeof importGenericNameMappings>> | null,
  };

  if (parsed.data.mode === 'flags' || parsed.data.mode === 'all') {
    result.flags = await importMhlwGenericFlags(prisma, {
      workbookUrl: parsed.data.workbookUrl,
    });
  }

  if (parsed.data.mode === 'mappings' || parsed.data.mode === 'all') {
    result.mappings = await importGenericNameMappings(prisma, {
      workbookUrl: parsed.data.workbookUrl,
    });
  }

  return success(
    {
      data: {
        mode: parsed.data.mode,
        flags: result.flags
          ? {
              logId: result.flags.log.id,
              status: result.flags.log.status,
              importedCount: result.flags.importedCount,
              workbookUrl: result.flags.workbookUrl,
            }
          : null,
        mappings: result.mappings
          ? {
              logId: result.mappings.log.id,
              status: result.mappings.log.status,
              importedCount: result.mappings.importedCount,
              workbookUrl: result.mappings.workbookUrl,
            }
          : null,
      },
    },
    201
  );
});
