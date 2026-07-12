import { z } from 'zod';
import { patientFieldRevisionPresentationItemSchema } from '@/components/features/patients/patient-field-revision-timeline-response-schema';

export const visitReflectedFieldsResponseSchema = z
  .object({
    data: z.array(patientFieldRevisionPresentationItemSchema).max(100),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const identities = new Set<string>();
    for (const [index, item] of data.entries()) {
      if (identities.has(item.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate reflected-field identity',
        });
      }
      identities.add(item.id);

      if (index > 0 && Date.parse(item.created_at) > Date.parse(data[index - 1]!.created_at)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'created_at'],
          message: 'Reflected fields must be newest first',
        });
      }
    }
  });

export type VisitReflectedFieldsResponse = z.infer<typeof visitReflectedFieldsResponseSchema>;
