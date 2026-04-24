import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import { runBackupMonitorChecks } from '@/server/services/backup-monitor';

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

  // DB check
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latencyMs: Date.now() - start };
  } catch {
    checks.database = { status: 'down' };
    overall = 'down';
  }

  // Backup monitor check
  try {
    const backupResult = await runBackupMonitorChecks();
    checks.backups = {
      status: backupResult.overall,
      details: backupResult.checks as Record<string, unknown>,
    };

    if (overall !== 'down' && backupResult.overall !== 'ok') {
      overall = 'degraded';
    }
  } catch (error) {
    checks.backups = {
      status: 'error',
      message: error instanceof Error ? error.message : 'backup monitor failed',
    };

    if (overall !== 'down') {
      overall = 'degraded';
    }
  }

  const authContext = await getAuthContext(req).catch(() => null);
  const includeDetailedChecks = Boolean(
    authContext && hasPermission(authContext.role, 'canAdmin'),
  );
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
