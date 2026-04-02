import { describe, expect, it } from 'vitest';
import { labelForPath, labelForSegment } from './route-labels';

describe('route labels', () => {
  it('labels admin sub-pages explicitly for recent-history navigation', () => {
    expect(labelForPath('/admin/pharmacy-sites')).toBe('薬局情報');
    expect(labelForPath('/admin/service-areas')).toBe('訪問エリア');
    expect(labelForPath('/admin/jobs')).toBe('ジョブ監視');
    expect(labelForPath('/admin/document-templates')).toBe('文書テンプレート');
    expect(labelForPath('/admin/professionals')).toBe('他職種');
    expect(labelForPath('/admin/settings')).toBe('管理設定');
    expect(labelForPath('/admin/performance')).toBe('パフォーマンス');
    expect(labelForPath('/admin/realtime')).toBe('リアルタイム監視');
    expect(labelForPath('/patients/p1/mcs')).toBe('MCS連携');
  });

  it('labels utility segments used by breadcrumb navigation', () => {
    expect(labelForSegment('prescriptions')).toBe('処方受付');
    expect(labelForSegment('prescriptions', 'patients')).toBe('処方履歴');
    expect(labelForSegment('print', 'reports')).toBe('印刷');
    expect(labelForSegment('full', 'medication-sets')).toBe('一覧');
    expect(labelForSegment('record', 'visits')).toBe('記録入力');
    expect(labelForSegment('settings', 'admin')).toBe('管理設定');
    expect(labelForSegment('mcs', 'patients')).toBe('MCS連携');
  });
});
