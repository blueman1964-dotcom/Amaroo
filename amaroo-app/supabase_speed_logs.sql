CREATE TABLE IF NOT EXISTS speed_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vessel_id text DEFAULT 'amaroo',
  tag text NOT NULL CHECK (tag IN ('calm', 'sea')),
  rpm integer NOT NULL,
  stw numeric(6,2) NOT NULL,
  sog numeric(6,2) NOT NULL,
  notes text DEFAULT '',
  wave_mode text,
  combine_mode text,
  heading_deg numeric(6,2),
  wave_from_deg numeric(6,2),
  swell_from_deg numeric(6,2),
  hs_wave_m numeric(5,2),
  hs_swell_m numeric(5,2),
  hs_total_m numeric(5,2),
  tp_wave_s numeric(5,2),
  tp_swell_s numeric(5,2),
  tp_total_s numeric(5,2),
  fmin_used numeric(5,3),
  g_r0 numeric(5,3),
  g_sigma numeric(5,3),
  g_gmin numeric(5,3),
  g_gmax numeric(5,3),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE speed_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'speed_logs'
      AND policyname = 'Allow all'
  ) THEN
    CREATE POLICY "Allow all" ON speed_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
