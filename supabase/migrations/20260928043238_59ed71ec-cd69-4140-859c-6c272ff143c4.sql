REVOKE ALL ON public.manuscript_audits FROM anon, authenticated;
GRANT SELECT ON public.manuscript_audits TO authenticated;
REVOKE ALL ON public.manuscript_audit_findings FROM anon, authenticated;
GRANT SELECT ON public.manuscript_audit_findings TO authenticated;
GRANT UPDATE (status, user_notes) ON public.manuscript_audit_findings TO authenticated;