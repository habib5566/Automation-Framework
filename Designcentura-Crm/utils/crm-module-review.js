/**
 * Per-URL CRM quality notes for Word narrative (not live crawl — informed checklist).
 * Paths match https://designcentura.com + route.
 */
const CRM_MODULE_REVIEW = [
  {
    path: '/crm-pay/admin/dashboard',
    fullUrl: 'https://designcentura.com/crm-pay/admin/dashboard',
    name: 'Dashboard',
    purpose:
      'Central landing: KPIs, shortcuts, alerts, and navigation into operational modules. First impression of system health for admins.',
    typicalIssues:
      'Stale widgets after deploy; wrong tenant or date range; widgets calling slow APIs blocking paint; role-based tiles hidden without explanation; empty state when APIs 401 silently.',
    improvements:
      'Add skeleton loaders and explicit “last refreshed” timestamps; surface API errors in-widget; cache KPIs with TTL; verify widgets for each role in UAT; monitor LCP and API p95 for dashboard queries.',
  },
  {
    path: '/crm-pay/admin/payment',
    fullUrl: 'https://designcentura.com/crm-pay/admin/payment',
    name: 'Payments',
    purpose:
      'Tracks invoices, settlements, gateways, and reconciliation — high financial sensitivity.',
    typicalIssues:
      'Rounding mismatches; duplicate charges; timezone on settlement dates; partial refunds not tied to original txn; export CSV missing columns; PII in logs.',
    improvements:
      'Idempotent payment APIs; immutable audit trail; reconcile job with alerts; mask PAN/card in UI; reconciliation dashboard; automated contract tests on refund and void flows.',
  },
  {
    path: '/crm-pay/admin/customer',
    fullUrl: 'https://designcentura.com/crm-pay/admin/customer',
    name: 'Customers',
    purpose:
      'Customer master: profiles, contacts, tags, and links to orders/briefs — hub for support and sales.',
    typicalIssues:
      'Duplicate merges; GDPR export incomplete; search N+1 queries; soft-delete vs hard-delete confusion; phone/email validation inconsistent.',
    improvements:
      'Dedup rules and merge preview; field-level encryption where needed; indexed search with pagination caps; clear retention policy UI; bulk import validation report.',
  },
  {
    path: '/crm-pay/admin/brief/list',
    fullUrl: 'https://designcentura.com/crm-pay/admin/brief/list',
    name: 'Brief list',
    purpose:
      'Operational list of creative/project briefs — filters, status, assignment drive daily work.',
    typicalIssues:
      'Filter state lost on refresh; wrong default sort; status transitions not permission-checked; large lists without virtualization causing jank.',
    improvements:
      'Persist filters in URL query; server-side pagination + cursor; optimistic UI with rollback; SLA columns and overdue highlighting; saved views per user.',
  },
  {
    path: '/crm-pay/admin/lead/list',
    fullUrl: 'https://designcentura.com/crm-pay/admin/lead/list',
    name: 'Lead list',
    purpose:
      'Pipeline and lead assignment — feeds revenue; often integrated with email/calendar.',
    typicalIssues:
      'Lead leakage across owners; duplicate leads from imports; stage automation firing twice; scoring stale.',
    improvements:
      'Unique keys on email/phone; import dry-run; automation idempotency keys; scoring refresh job with metrics; export audit who exported PII.',
  },
  {
    path: '/crm-pay/admin/chat',
    fullUrl: 'https://designcentura.com/crm-pay/admin/chat',
    name: 'Chat',
    purpose:
      'Real-time or async messaging with customers or internal teams — expectations of low latency and delivery receipts.',
    typicalIssues:
      'Missed websocket reconnect; messages out of order; attachment virus scan missing; notification spam; history not searchable.',
    improvements:
      'Exponential backoff reconnect; message sequence IDs; file type/size limits + scan; full-text search with retention; rate limits and mute rules.',
  },
  {
    path: '/crm-pay/admin/brief/link/list',
    fullUrl: 'https://designcentura.com/crm-pay/admin/brief/link/list',
    name: 'Brief link list',
    purpose:
      'Shared links / portals for external stakeholders — security boundary is critical.',
    typicalIssues:
      'Long-lived tokens in URL; no expiry on shared links; permission escalation via link; hotlinking assets.',
    improvements:
      'Short-lived signed URLs; optional password + OTP on link; revoke-audit; IP/geo allowlists for sensitive briefs; watermark on previews.',
  },
  {
    path: '/crm-pay/admin/activity-logs',
    fullUrl: 'https://designcentura.com/crm-pay/admin/activity-logs',
    name: 'Activity logs',
    purpose:
      'Audit and compliance: who changed what, when — relied on for disputes and security reviews.',
    typicalIssues:
      'Logs truncated; admin actions not logged; PII over-logged; no export for SIEM; clock skew across servers.',
    improvements:
      'Structured append-only log store; hash chain or WORM storage option; redaction rules; CSV/JSON export with signed checksum; NTP discipline; retention tiers.',
  },
];

module.exports = { CRM_MODULE_REVIEW };
