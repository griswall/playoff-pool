-- Existing database only. Fail atomically unless the now-protected membership
-- is exactly the same sole confirmed account as the original admin predicate.
SET LOCAL lock_timeout='5s';
LOCK TABLE public.admins IN SHARE MODE;
DO $$
DECLARE matches integer;
BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES('anon'),('authenticated')) AS roles(role_name)
    WHERE has_any_column_privilege(role_name,'public.admins','INSERT,UPDATE')
       OR has_table_privilege(role_name,'public.admins','DELETE,TRUNCATE')) THEN
    RAISE EXCEPTION 'Admin membership must be protected before conversion';
  END IF;
  WITH trusted AS (
    SELECT id FROM auth.users WHERE email_confirmed_at IS NOT NULL AND email=(
      SELECT substring(prosrc FROM $pattern$= '([^']+)';$pattern$) FROM pg_proc
      WHERE oid='pool_private.is_admin_user()'::regprocedure)
  ) SELECT CASE WHEN (SELECT count(*) FROM trusted)=1 AND (SELECT count(*) FROM public.admins)=1
      THEN (SELECT count(*) FROM trusted JOIN public.admins a ON a.user_id=trusted.id) ELSE 0 END INTO matches;
  IF matches<>1 THEN RAISE EXCEPTION 'Admin identities cannot be reconciled automatically. No changes applied.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION pool_private.is_admin_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id=(SELECT auth.uid()));
$$;
NOTIFY pgrst,'reload schema';
