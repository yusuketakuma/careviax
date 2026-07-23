// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { registerHandoffIncomingCases } from './fixtures/handoff-workspace-incoming.cases';
import { registerHandoffOutgoingCases } from './fixtures/handoff-workspace-outgoing.cases';
import { getHandoffWorkspaceTestSupport } from './fixtures/handoff-workspace.test-support';

const {
  buildHeaderMeta,
  buildItem,
  buildItemSubText,
  buildItemTitle,
  buildStatusBadge,
  progressPercent,
  remainingLabel,
} = getHandoffWorkspaceTestSupport();

describe('HandoffWorkspace', () => {
  registerHandoffOutgoingCases();
  registerHandoffIncomingCases();
});

describe('handoff-workspace helpers', () => {
  it('builds header meta with summary', () => {
    expect(buildHeaderMeta(new Date(2026, 5, 11), { outgoing_count: 3, incoming_count: 0 })).toBe(
      '6/11(木) — 渡した3・来た0',
    );
  });

  it('maps lifecycle status to badge labels and tones', () => {
    const now = new Date('2026-06-11T09:00:00');
    expect(buildStatusBadge(buildItem({ lifecycle_status: 'proposed' }), now).label).toBe(
      '承諾待ち',
    );
    const inProgress = buildStatusBadge(
      buildItem({ lifecycle_status: 'in_progress', progress_done: 9, progress_total: 12 }),
      now,
    );
    expect(inProgress.label).toBe('作業中 9/12');
    expect(inProgress.className).toContain('info');
    const confirming = buildStatusBadge(
      buildItem({
        lifecycle_status: 'confirming',
        deadline: new Date(now.getTime() + 30 * 60_000).toISOString(),
      }),
      now,
    );
    expect(confirming.label).toBe('確認中 30分');
    expect(confirming.className).toContain('confirm');
    expect(buildStatusBadge(buildItem({ consult_status: 'open' }), now).label).toBe('薬剤師相談');
    expect(buildStatusBadge(buildItem({}), now).label).toBe('要確認');
  });

  it('computes remaining deadline labels including overdue', () => {
    const now = new Date('2026-06-11T09:00:00');
    expect(remainingLabel(new Date(now.getTime() + 90 * 60_000).toISOString(), now)).toBe('1時間');
    expect(remainingLabel(new Date(now.getTime() - 60_000).toISOString(), now)).toBe('超過');
  });

  it('computes progress percent only for in-progress items', () => {
    expect(
      progressPercent(
        buildItem({ lifecycle_status: 'in_progress', progress_done: 9, progress_total: 12 }),
      ),
    ).toBe(75);
    expect(progressPercent(buildItem({ lifecycle_status: 'proposed' }))).toBeNull();
  });

  it('builds title and sub text per status', () => {
    expect(buildItemTitle(buildItem({ content: 'A', recipient_label: 'Bさん' }))).toBe('A → Bさん');
    expect(
      buildItemSubText(buildItem({ lifecycle_status: 'proposed', rationale: 'WIP超過' })),
    ).toBe('根拠: WIP超過');
    expect(
      buildItemSubText(buildItem({ lifecycle_status: 'in_progress', scope: '数量セットまで' })),
    ).toBe('許可済みの範囲: 数量セットまで');
    expect(
      buildItemSubText(
        buildItem({ lifecycle_status: 'confirming', rationale: '報告が止まるため' }),
      ),
    ).toBe('報告が止まるため');
  });
});
