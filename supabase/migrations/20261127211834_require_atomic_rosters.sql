-- Deploy after all live roster editors call public.save_roster. Execute atomically.
SET LOCAL lock_timeout='5s';
REVOKE INSERT(user_id,team_name) ON public.user_teams FROM authenticated;
REVOKE INSERT(team_id,player_id,roster_slot), DELETE ON public.team_players FROM authenticated;
REVOKE USAGE ON SEQUENCE public.user_teams_id_seq FROM authenticated;
DROP POLICY create_own_entry ON public.user_teams;
DROP POLICY add_to_own_roster ON public.team_players;
DROP POLICY remove_from_own_roster ON public.team_players;
CREATE OR REPLACE FUNCTION pool_private.ownership() RETURNS TABLE(player_id bigint,count bigint,percent numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.player_id,count(*),round(count(*)*100.0/nullif((SELECT count(*) FROM public.user_teams),0),1)
  FROM public.team_players r WHERE (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.app_settings WHERE id=1 AND show_ownership IS TRUE)
  GROUP BY r.player_id
$$;
NOTIFY pgrst,'reload schema';
