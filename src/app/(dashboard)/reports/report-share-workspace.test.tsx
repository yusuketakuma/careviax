// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { ReportsTodayWorkspaceResponse } from '@/types/reports-today-workspace';
import { registerReportShareWorkspaceCases } from './fixtures/report-share-workspace.cases';
import { getReportShareWorkspaceTestSupport } from './fixtures/report-share-workspace.test-support';
import {
  buildReportEvidence,
  buildHeaderMeta,
  waitingBadgeLabel,
} from './report-share-workspace.helpers';

const { TODAY_WORKSPACE } = getReportShareWorkspaceTestSupport();

describe('ReportShareWorkspace', () => {
  registerReportShareWorkspaceCases();
});

describe('report-share-workspace helpers', () => {
  it('builds header meta with counts', () => {
    expect(buildHeaderMeta(new Date(2026, 5, 11), TODAY_WORKSPACE.counts)).toMatch(
      /^6\/11\(木\) — 書く3件・候補1件・課題抽出内2件・作成済み3件・待つ2件・解決1件$/,
    );
  });

  it('does not mark open issue counts as extracted when the API supplies a database total', () => {
    const countMetadata: ReportsTodayWorkspaceResponse['count_metadata'] = {
      ...TODAY_WORKSPACE.count_metadata,
      open_issues: {
        ...TODAY_WORKSPACE.count_metadata.open_issues,
        count_basis: 'database_total',
      },
    };

    expect(buildHeaderMeta(new Date(2026, 5, 11), TODAY_WORKSPACE.counts, countMetadata)).toMatch(
      /^6\/11\(木\) — 書く3件・候補1件・課題2件・作成済み3件・待つ2件・解決1件$/,
    );
  });

  it('focuses read receipt evidence on the external share queue', () => {
    expect(buildReportEvidence(TODAY_WORKSPACE)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'read-receipt',
          href: '/external?focus=shares',
        }),
      ]),
    );
  });

  it('labels waiting badge by elapsed days', () => {
    expect(waitingBadgeLabel(3)).toBe('3日経過');
    expect(waitingBadgeLabel(0)).toBe('本日送付');
  });
});
