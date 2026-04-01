export type ReportFormat = 'json' | 'markdown';

function readArgValue(argv: string[], key: string) {
  const flagValue = argv.find((value) => value.startsWith(`${key}=`));
  if (flagValue) {
    const [, ...rest] = flagValue.split('=');
    return rest.join('=');
  }

  const index = argv.indexOf(key);
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }

  return null;
}

export function parseReportFormatArg(argv: string[], fallback: ReportFormat = 'markdown'): ReportFormat {
  const format = readArgValue(argv, '--format');
  if (format === 'json' || format === 'markdown') {
    return format;
  }
  return fallback;
}

export function parseOrgReportArgs(argv: string[]) {
  const orgId = readArgValue(argv, '--org') ?? process.env.ORG_ID ?? '';
  if (!orgId) {
    throw new Error('--org で org_id を指定してください');
  }

  return {
    orgId,
    format: parseReportFormatArg(argv),
  };
}

export function parseOptionalStringArg(argv: string[], key: string) {
  return readArgValue(argv, key);
}
