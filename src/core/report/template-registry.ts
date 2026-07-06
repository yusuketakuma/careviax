import type { PhosFeatureModuleId } from '@/core/module-registry';

export type ReportTemplateType =
  | 'physician_report'
  | 'care_manager_report'
  | 'nurse_share'
  | 'facility_handoff';

export type ReportTemplatePolicy = Readonly<{
  targetRole: 'physician' | 'care_manager' | 'nurse' | 'facility_staff' | 'other';
  requiredPermission: 'canSendCareReport';
  maskingProfile: string;
  auditSurface: 'care_report_generation';
  printable: boolean;
}>;

export type ReportTemplateProvider = Readonly<{
  module: PhosFeatureModuleId;
  templateType: ReportTemplateType;
  policy: ReportTemplatePolicy;
  renderDraft(context: unknown): unknown;
}>;

export class ReportTemplateRegistry {
  readonly #providersByType: ReadonlyMap<ReportTemplateType, ReportTemplateProvider>;

  constructor(providers: readonly ReportTemplateProvider[]) {
    const providersByType = new Map<ReportTemplateType, ReportTemplateProvider>();
    for (const provider of providers) {
      if (providersByType.has(provider.templateType)) {
        throw new Error(`Duplicate report template provider: ${provider.templateType}`);
      }
      providersByType.set(provider.templateType, provider);
    }
    this.#providersByType = providersByType;
  }

  listTemplateTypes(): readonly ReportTemplateType[] {
    return [...this.#providersByType.keys()];
  }

  getProvider(templateType: ReportTemplateType): ReportTemplateProvider | null {
    return this.#providersByType.get(templateType) ?? null;
  }

  render(templateType: ReportTemplateType, context: unknown): unknown {
    const provider = this.getProvider(templateType);
    if (!provider) {
      throw new Error(`Report template provider is not registered: ${templateType}`);
    }
    return provider.renderDraft(context);
  }
}
