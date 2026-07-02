import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { runBackupMonitorChecks } from '@/server/services/backup-monitor';

const BACKUP_MONITOR_FAILED_MESSAGE = 'backup monitor failed';

export async function GET(req: NextRequest) {
  const checks: Record<
    string,
    {
      status: string;
      latencyMs?: number;
      message?: string;
      details?: Record<string, unknown>;
    }
  > = {};
  let overall: 'ok' | 'degraded' | 'down' = 'ok';
  const authContext = await getAuthContext(req).catch(() => null);
  const includeDetailedChecks = Boolean(authContext && hasPermission(authContext.role, 'canAdmin'));

  if (includeDetailedChecks) {
    // DB readiness is admin-only; public liveness must remain cheap.
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', latencyMs: Date.now() - start };
    } catch {
      checks.database = { status: 'down' };
      overall = 'down';
    }

    if (overall !== 'down') {
      // Backup monitor checks touch AWS APIs; keep public health cheap.
      try {
        const backupResult = await runBackupMonitorChecks();
        checks.backups = {
          status: backupResult.overall,
          details: readJsonObject(backupResult.checks) ?? {},
        };

        if (backupResult.overall !== 'ok') {
          overall = 'degraded';
        }
      } catch {
        checks.backups = {
          status: 'error',
          message: BACKUP_MONITOR_FAILED_MESSAGE,
        };

        overall = 'degraded';
      }
    }
  }

  const publicChecks = Object.fromEntries(
    Object.entries(checks).map(([key, value]) => [key, { status: value.status }]),
  );

  return NextResponse.json(
    {
      status: overall,
      checks: includeDetailedChecks ? checks : publicChecks,
      timestamp: new Date().toISOString(),
    },
    { status: overall === 'down' ? 503 : 200 },
  );
}
