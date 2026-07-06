import { ReportTemplateRegistry } from '@/core/report/template-registry';
import { createPharmacyReportTemplateProviders } from '@/modules/pharmacy';

export const activeReportTemplateRegistry = new ReportTemplateRegistry([
  ...createPharmacyReportTemplateProviders(),
]);
