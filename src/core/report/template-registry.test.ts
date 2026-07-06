import { describe, expect, it, vi } from 'vitest';
import { ReportTemplateRegistry, type ReportTemplateProvider } from './template-registry';

function provider(templateType: ReportTemplateProvider['templateType']): ReportTemplateProvider {
  return {
    module: 'pharmacy',
    templateType,
    policy: {
      targetRole: 'other',
      requiredPermission: 'canSendCareReport',
      maskingProfile: 'test_report_template',
      auditSurface: 'care_report_generation',
      printable: true,
    },
    renderDraft: vi.fn((context) => ({ templateType, context })),
  };
}

describe('ReportTemplateRegistry', () => {
  it('renders registered template providers by report type', () => {
    const registry = new ReportTemplateRegistry([
      provider('physician_report'),
      provider('care_manager_report'),
    ]);

    expect(registry.listTemplateTypes()).toEqual(['physician_report', 'care_manager_report']);
    expect(registry.render('physician_report', { visitRecordId: 'vr-1' })).toEqual({
      templateType: 'physician_report',
      context: { visitRecordId: 'vr-1' },
    });
  });

  it('fails closed for unknown template types', () => {
    const registry = new ReportTemplateRegistry([]);

    expect(registry.getProvider('physician_report')).toBeNull();
    expect(() => registry.render('physician_report', {})).toThrow(
      'Report template provider is not registered: physician_report',
    );
  });

  it('propagates provider failures without fallback content', () => {
    const failingProvider = provider('physician_report');
    vi.mocked(failingProvider.renderDraft).mockImplementation(() => {
      throw new Error('template failed');
    });
    const registry = new ReportTemplateRegistry([failingProvider]);

    expect(() => registry.render('physician_report', {})).toThrow('template failed');
  });

  it('rejects duplicate template providers', () => {
    expect(
      () =>
        new ReportTemplateRegistry([provider('physician_report'), provider('physician_report')]),
    ).toThrow('Duplicate report template provider: physician_report');
  });
});
