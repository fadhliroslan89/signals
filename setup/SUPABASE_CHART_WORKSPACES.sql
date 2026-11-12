-- KuCoin Radar v2.0 Full Chart. Paste into your Supabase project's SQL Editor.
-- PUBLIC publishable key only in browser. Keep RLS enabled and service_role key PRIVATE.
-- Chart drawings are stored per authenticated user, symbol and timeframe.
CREATE TABLE IF NOT EXISTS public.chart_workspaces (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9]{1,20}-USDT$'),
  timeframe text NOT NULL CHECK (timeframe IN ('1m','5m','15m','30m','1h','4h')),
  drawings jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chart_workspaces_pkey PRIMARY KEY (user_id, symbol, timeframe)
);
ALTER TABLE public.chart_workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chart_select_own" ON public.chart_workspaces;
DROP POLICY IF EXISTS "chart_insert_own" ON public.chart_workspaces;
DROP POLICY IF EXISTS "chart_update_own" ON public.chart_workspaces;
DROP POLICY IF EXISTS "chart_delete_own" ON public.chart_workspaces;
CREATE POLICY "chart_select_own" ON public.chart_workspaces FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY "chart_insert_own" ON public.chart_workspaces FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "chart_update_own" ON public.chart_workspaces FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "chart_delete_own" ON public.chart_workspaces FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chart_workspaces TO authenticated;
-- Never run statements granting access to anon, nor disable RLS for this table.
