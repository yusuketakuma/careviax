export type CdsAlertSeverity = 'critical' | 'warning' | 'info';

export type CdsAlert = {
  type: string;
  severity: CdsAlertSeverity;
  message: string;
  details?: Record<string, unknown>;
};
