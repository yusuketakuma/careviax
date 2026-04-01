import process from 'node:process';
import { getUatFeedbackSummary } from '@/server/services/uat-feedback-summary';
import { parseOrgReportArgs } from './_shared/report-cli';

async function main() {
  const args = parseOrgReportArgs(process.argv.slice(2));
  const summary = await getUatFeedbackSummary(args.orgId);

  if (args.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`# UAT Feedback Summary

- org_id: ${args.orgId}
- generated_at: ${summary.generated_at}
- total_feedback: ${summary.total_feedback}
- blocker_count: ${summary.blocker_count}
- priorities: critical ${summary.priorities.critical} / high ${summary.priorities.high} / medium ${summary.priorities.medium} / low ${summary.priorities.low}

## Action Items
${summary.action_items.length > 0 ? summary.action_items.map((item) => `- [${item.priority}] ${item.feedback} (${item.created_at})`).join('\n') : '- 重大な blocker はありません'}

## Lowest Coverage Checklist
${summary.checklist_coverage.slice(0, 5).map((item) => `- ${item.label}: ${item.checked_count}`).join('\n')}

## Recommendations
${summary.recommendations.map((item) => `- ${item}`).join('\n')}
`);
}

void main();
