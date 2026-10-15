export interface AuditEntry {
  id: string;
  timestamp: string;
  actor?: string;
  kind: string;
  target?: string;
  summary?: string;
  detail?: unknown;
}
