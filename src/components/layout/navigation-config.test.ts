import { describe, expect, it } from 'vitest';
import {
  MOBILE_BOTTOM_NAV_ITEMS,
  SIDEBAR_ADMIN_NAV_GROUPS,
  SIDEBAR_MAIN_NAV_GROUPS,
  TOP_WORKFLOW_LINKS,
} from './navigation-config';

describe('layout navigation config', () => {
  it('keeps the sidebar main business route in the same order as the top-level workflow', () => {
    const businessRoute = SIDEBAR_MAIN_NAV_GROUPS.find(
      (group) => group.label === '主業務ルート',
    );

    expect(businessRoute?.items.map((item) => item.label)).toEqual([
      '処方登録',
      '調剤',
      '調剤監査',
      'セット',
      'セット監査',
      'スケジュール',
      '訪問時',
      '報告書',
    ]);
    expect(businessRoute?.items.map((item) => item.href)).toEqual([
      '/prescriptions',
      '/dispensing',
      '/auditing',
      '/medication-sets',
      '/medication-sets',
      '/schedules',
      '/visits',
      '/reports',
    ]);
  });

  it('keeps mobile field-work shortcuts focused on schedule and visit execution', () => {
    expect(MOBILE_BOTTOM_NAV_ITEMS.map((item) => item.label)).toEqual([
      'ホーム',
      'スケジュール',
      '訪問時',
      '患者',
    ]);
    expect(MOBILE_BOTTOM_NAV_ITEMS.find((item) => item.label === '訪問時')).toEqual(
      expect.objectContaining({
        activePrefixes: ['/visits', '/my-day'],
        excludePrefixes: ['/visits/handoffs'],
      }),
    );
  });

  it('keeps header shortcuts aligned with the highest-frequency workflow exits', () => {
    expect(TOP_WORKFLOW_LINKS.map((item) => item.label)).toEqual([
      '業務本流',
      'スケジュール',
      '訪問時',
      '報告書',
    ]);
    expect(TOP_WORKFLOW_LINKS.map((item) => item.href)).toEqual([
      '/workflow',
      '/schedules',
      '/visits',
      '/reports',
    ]);
  });

  it('keeps collaboration and handoff surfaces outside the main business route', () => {
    const support = SIDEBAR_MAIN_NAV_GROUPS.find((group) => group.label === '補助導線');

    expect(support?.items.map((item) => item.label)).toEqual([
      'QRスキャン',
      '申し送り',
      '多職種連携',
      '依頼・照会',
      '外部連携',
    ]);
  });

  it('includes packaging method management in the admin drug master group', () => {
    const drugGroup = SIDEBAR_ADMIN_NAV_GROUPS.find((group) => group.label === '薬剤');

    expect(drugGroup?.items.map((item) => item.label)).toEqual(
      expect.arrayContaining(['採用薬', '配薬方法', 'マスタ', '処方安全アラート']),
    );
  });
});
