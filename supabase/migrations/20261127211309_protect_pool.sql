-- Apply as one transaction via the Supabase migration runner. The first stage
-- keeps owner-only direct saves available to the original Vercel client.
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA pool_private;
REVOKE ALL ON SCHEMA pool_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA pool_private TO authenticated;

-- Keep the trusted admin predicate verbatim, including the owner's existing
-- identity. The old public.admins table was client-writable and is not trusted.
ALTER FUNCTION public.is_admin_user() SET SCHEMA pool_private;
ALTER FUNCTION pool_private.is_admin_user() SET search_path = '';
REVOKE ALL ON FUNCTION pool_private.is_admin_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pool_private.is_admin_user() TO authenticated;
CREATE FUNCTION public.is_admin_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND coalesce(pool_private.is_admin_user(),false)
$$;

-- Remove only the exact policies present in the recovered project. Abort on
-- unexpected policies to avoid silently retaining or deleting unrelated rules.
DO $$
DECLARE p record;
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN
    ('admins','app_settings','player_scores','players','team_players','user_teams')) <> 22 THEN
    RAISE EXCEPTION 'Unexpected policy inventory. Inspect and reconcile the schema before applying.';
  END IF;
  FOR p IN SELECT * FROM (VALUES
    ('admins','Admins are private'),('admins','Allow all access to admins table'),
    ('app_settings','Allow public read access to app settings'),
    ('player_scores','Allow public read access to player scores'),('player_scores','Enable read access for all users'),('player_scores','Enable write access for admins only'),
    ('players','Allow public read access to players'),
    ('team_players','Allow users to add players to their own teams'),('team_players','Allow users to see players on their own teams'),('team_players','Allow users to update/delete players on their own teams'),('team_players','Auth manage players'),
    ('user_teams','Allow users to create their own teams'),('user_teams','Allow users to delete their own teams'),('user_teams','Allow users to see their own teams'),('user_teams','Allow users to update their own teams'),('user_teams','Auth delete teams'),('user_teams','Auth insert teams'),('user_teams','Enable delete for users based on user_id'),('user_teams','Enable insert for authenticated users only'),('user_teams','Enable read access for all users'),('user_teams','Enable update for users based on user_id'),('user_teams','Public view teams')
  ) AS names(table_name,policy_name) LOOP
    EXECUTE format('DROP POLICY %I ON public.%I',p.policy_name,p.table_name);
  END LOOP;
END $$;

REVOKE ALL ON public.admins,public.app_settings,public.player_scores,public.players,
  public.team_players,public.user_teams FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.players_id_seq,public.user_teams_id_seq FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.app_settings,public.players,public.player_scores,public.user_teams,public.team_players TO authenticated;
GRANT INSERT(user_id,team_name), DELETE ON public.user_teams TO authenticated;
GRANT INSERT(team_id,player_id,roster_slot), DELETE ON public.team_players TO authenticated;
GRANT USAGE ON SEQUENCE public.user_teams_id_seq TO authenticated;

CREATE POLICY read_settings ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY read_catalog ON public.players FOR SELECT TO authenticated USING (true);
CREATE POLICY read_scores ON public.player_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY read_own_entries ON public.user_teams FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
CREATE POLICY read_own_rosters ON public.team_players FOR SELECT TO authenticated USING (
  team_id IN (SELECT id FROM public.user_teams WHERE user_id=(SELECT auth.uid())));
CREATE POLICY create_own_entry ON public.user_teams FOR INSERT TO authenticated WITH CHECK (
  user_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.app_settings WHERE id=1 AND entries_locked IS FALSE));
CREATE POLICY delete_own_entry ON public.user_teams FOR DELETE TO authenticated USING (
  user_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.app_settings WHERE id=1 AND entries_locked IS FALSE));
CREATE POLICY add_to_own_roster ON public.team_players FOR INSERT TO authenticated WITH CHECK (
  team_id IN (SELECT id FROM public.user_teams WHERE user_id=(SELECT auth.uid()))
  AND EXISTS (SELECT 1 FROM public.app_settings WHERE id=1 AND entries_locked IS FALSE));
CREATE POLICY remove_from_own_roster ON public.team_players FOR DELETE TO authenticated USING (
  team_id IN (SELECT id FROM public.user_teams WHERE user_id=(SELECT auth.uid()))
  AND EXISTS (SELECT 1 FROM public.app_settings WHERE id=1 AND entries_locked IS FALSE));

-- Public API exposes league totals. Raw participant rows are visible to their owner.
CREATE FUNCTION pool_private.standings() RETURNS TABLE(rank bigint,team_name text,total_points numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT rank() OVER (ORDER BY sum(coalesce(s.points,0)) DESC), t.team_name, sum(coalesce(s.points,0))
  FROM public.user_teams t LEFT JOIN public.team_players r ON r.team_id=t.id
  LEFT JOIN public.player_scores s ON s.player_id=r.player_id
  WHERE (SELECT auth.uid()) IS NOT NULL GROUP BY t.id,t.team_name
  ORDER BY 3 DESC,t.id
$$;
CREATE OR REPLACE FUNCTION public.get_standings() RETURNS TABLE(rank bigint,team_name text,total_points numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT * FROM pool_private.standings() $$;
CREATE FUNCTION pool_private.ownership() RETURNS TABLE(player_id bigint,count bigint,percent numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.player_id,count(*),round(count(*)*100.0/nullif((SELECT count(*) FROM public.user_teams),0),1)
  FROM public.team_players r WHERE (SELECT auth.uid()) IS NOT NULL GROUP BY r.player_id
$$;
CREATE OR REPLACE FUNCTION public.get_player_ownership() RETURNS TABLE(player_id bigint,count bigint,percent numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT * FROM pool_private.ownership() $$;
ALTER FUNCTION public.get_team_score(bigint) SET search_path = '';

CREATE FUNCTION pool_private.write_scores(batch jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR pool_private.is_admin_user() IS NOT TRUE THEN
    RAISE EXCEPTION 'Scoring requires an administrator' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(batch) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected a score array'; END IF;
  IF jsonb_array_length(batch)>4000 THEN RAISE EXCEPTION 'Score batch is too large'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(batch) item WHERE
    jsonb_typeof(item->'player_id_to_update') IS DISTINCT FROM 'number'
    OR coalesce(item->>'round_to_update','') NOT IN ('WC','DIV','CONF','SB')
    OR NOT (item ? 'points_to_update') OR jsonb_typeof(item->'points_to_update') NOT IN ('number','null')) THEN
    RAISE EXCEPTION 'Invalid score. Supply a player ID, playoff round, and numeric or null points.';
  END IF;
  INSERT INTO public.player_scores AS scores(player_id,playoff_round,points)
  SELECT player_id_to_update, round_to_update, points_to_update
  FROM jsonb_to_recordset(batch) AS changed(player_id_to_update bigint,round_to_update text,points_to_update numeric)
  ON CONFLICT (player_id,playoff_round) DO UPDATE SET points=excluded.points
  WHERE scores.points IS DISTINCT FROM excluded.points;
END $$;
CREATE OR REPLACE FUNCTION public.bulk_upsert_player_scores(scores_to_update json) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT pool_private.write_scores(scores_to_update::jsonb) $$;

CREATE INDEX team_players_player_id_idx ON public.team_players(player_id);
CREATE INDEX user_teams_user_id_idx ON public.user_teams(user_id);
ALTER TABLE public.user_teams ADD COLUMN create_request_id uuid;
CREATE UNIQUE INDEX user_teams_create_request_idx ON public.user_teams(user_id,create_request_id) WHERE create_request_id IS NOT NULL;
ALTER TABLE public.team_players ADD CONSTRAINT pool_unique_roster_slot UNIQUE(team_id,roster_slot);
ALTER TABLE public.team_players ADD CONSTRAINT pool_roster_slot CHECK (roster_slot IN ('QB','RB1','RB2','RB3','WR1','WR2','WR3','FLEX','DST','K'));
ALTER TABLE public.player_scores ADD CONSTRAINT pool_playoff_round CHECK (playoff_round IN ('WC','DIV','CONF','SB'));
ALTER TABLE public.user_teams ADD CONSTRAINT pool_safe_team_name CHECK (
  char_length(btrim(team_name)) BETWEEN 1 AND 120 AND team_name !~ '[<>"[:cntrl:]]');

CREATE FUNCTION pool_private.save_roster(p_team_id bigint,p_team_name text,p_roster jsonb,p_request_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  saved_id bigint;
  requested_name text := btrim(p_team_name);
  valid_roster boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to save' USING ERRCODE='42501'; END IF;
  -- Serialize creates/edits per participant and prevent stale four-entry checks.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
  IF p_team_id IS NULL AND p_request_id IS NOT NULL THEN
    SELECT id INTO saved_id FROM public.user_teams WHERE user_id=actor AND create_request_id=p_request_id;
    IF FOUND THEN RETURN saved_id; END IF;
  END IF;
  PERFORM 1 FROM public.app_settings WHERE id=1 AND entries_locked IS FALSE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entries are locked' USING ERRCODE='42501'; END IF;
  IF requested_name IS NULL OR char_length(requested_name) NOT BETWEEN 1 AND 120 OR requested_name ~ '[<>"[:cntrl:]]' THEN
    RAISE EXCEPTION 'Enter a name of 1 to 120 characters without markup or control characters';
  END IF;
  IF jsonb_typeof(p_roster) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected a roster array'; END IF;
  IF jsonb_array_length(p_roster)<>10 THEN RAISE EXCEPTION 'Select exactly ten players'; END IF;
  WITH selected AS (
    SELECT r.roster_slot,p.id,p.team,p.salary,p.position FROM jsonb_to_recordset(p_roster) AS r(player_id bigint,roster_slot text)
    JOIN public.players p ON p.id=r.player_id
  ) SELECT count(*)=10 AND count(DISTINCT id)=10 AND count(DISTINCT roster_slot)=10
    AND sum(salary)<=38500000 AND NOT EXISTS (SELECT 1 FROM selected GROUP BY team HAVING count(*)>3)
    AND bool_and(CASE WHEN roster_slot IN ('QB','DST','K') THEN position=roster_slot
      WHEN roster_slot IN ('RB1','RB2','RB3') THEN position='RB'
      WHEN roster_slot IN ('WR1','WR2','WR3') THEN position='WR'
      WHEN roster_slot='FLEX' THEN position IN ('RB','WR','TE') ELSE false END)
  INTO valid_roster FROM selected;
  IF valid_roster IS NOT TRUE THEN RAISE EXCEPTION 'Check players, slots, salary cap and NFL team limits'; END IF;
  IF p_team_id IS NULL THEN
    IF (SELECT count(*) FROM public.user_teams WHERE user_id=actor)>=4 THEN RAISE EXCEPTION 'Four-entry limit reached'; END IF;
    INSERT INTO public.user_teams(user_id,team_name,create_request_id) VALUES(actor,requested_name,p_request_id) RETURNING id INTO saved_id;
  ELSE
    UPDATE public.user_teams SET team_name=requested_name WHERE id=p_team_id AND user_id=actor RETURNING id INTO saved_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entry unavailable' USING ERRCODE='42501'; END IF;
    DELETE FROM public.team_players WHERE team_id=saved_id;
  END IF;
  INSERT INTO public.team_players(team_id,player_id,roster_slot)
  SELECT saved_id, r.player_id,r.roster_slot FROM jsonb_to_recordset(p_roster) AS r(player_id bigint,roster_slot text);
  RETURN saved_id;
END $$;
CREATE FUNCTION public.save_roster(p_team_id bigint,p_team_name text,p_roster jsonb,p_request_id uuid DEFAULT NULL) RETURNS bigint
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT pool_private.save_roster(p_team_id,p_team_name,p_roster,p_request_id) $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pool_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION pool_private.is_admin_user(),pool_private.standings(),pool_private.ownership(),pool_private.write_scores(jsonb),pool_private.save_roster(bigint,text,jsonb,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.is_admin_user(),public.get_standings(),public.get_player_ownership(),public.get_team_score(bigint),public.bulk_upsert_player_scores(json),public.save_roster(bigint,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user(),public.get_standings(),public.get_player_ownership(),public.get_team_score(bigint),public.bulk_upsert_player_scores(json),public.save_roster(bigint,text,jsonb,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
