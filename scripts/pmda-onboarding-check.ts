import process from 'node:process';
import { formatPmdaOnboardingMarkdown, getPmdaOnboardingSummary } from '@/lib/operations/external-readiness';
import { parseReportFormatArg } from './_shared/report-cli';

function main() {
  const args = { format: parseReportFormatArg(process.argv.slice(2)) };
  const summary = getPmdaOnboardingSummary();

  if (args.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(formatPmdaOnboardingMarkdown(summary));
}

main();
