import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { runBackupMonitorChecks } from '@/server/services/backup-monitor';

const BACKUP_MONITOR_FAILED_MESSAGE = 'backup monitor failed';
const BACKUP_HEALTH_FORBIDDEN_KEY_RE =
  /(arn|account|identifier|endpoint|subnet|securitygroup|security_group|kms|secret|password|token|resourceid|resource_id|masteruser|master_user)/i;
const BACKUP_HEALTH_FORBIDDEN_VALUE_RE =
  /(arn:aws:|\b\d{12}\b|token=|password|secret|db_password|-----BEGIN|\.rds\.amazonaws\.com|sg-[0-9a-f-]+|subnet-[0-9a-f-]+)/i;

function sanitizeBackupHealthValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (value === null || value === undefined) return value ?? null;

  if (typeof value === 'string') {
    return BACKUP_HEALTH_FORBIDDEN_VALUE_RE.test(value) ? '[redacted]' : value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeBackupHealthValue(item, depth + 1));
  }

  const object = readJsonObject(value);
  if (!object) return null;

  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => !BACKUP_HEALTH_FORBIDDEN_KEY_RE.test(key))
      .map(([key, item]) => [key, sanitizeBackupHealthValue(item, depth + 1)]),
  );
}

function sanitizeBackupHealthChecks(checks: unknown) {
  const object = readJsonObject(checks);
  if (!object) return {};
  return readJsonObject(sanitizeBackupHealthValue(object)) ?? {};
}

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
          details: sanitizeBackupHealthChecks(backupResult.checks),
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
