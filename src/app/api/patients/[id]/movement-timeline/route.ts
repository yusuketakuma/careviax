import { createPatientTimelineGET } from '../timeline-route-handler';

export const GET = createPatientTimelineGET({ auditView: 'patient_movement_timeline' });
