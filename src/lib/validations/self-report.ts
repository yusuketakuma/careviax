import { z } from 'zod';

export const selfReportStatusSchema = z.enum([
  'submitted',
  'triaged',
  'converted_to_task',
  'resolved',
  'dismissed',
]);

