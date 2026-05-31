import { RequestStatus } from '@prisma/client';
import { z } from 'zod';

export const communicationRequestStatusSchema = z.nativeEnum(RequestStatus);

