-- Drop existing views to avoid dependency conflicts
DROP VIEW IF EXISTS v_rating_history_with_order CASCADE;
DROP VIEW IF EXISTS v_dashboard_players CASCADE;
DROP VIEW IF EXISTS v_player_current_rating CASCADE;

-- Drop existing tables in the correct order (foreign-key constraints)
DROP TABLE IF EXISTS rating_history CASCADE;
DROP TABLE IF EXISTS match_entries CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS rating_params CASCADE;

-- Recreate tables
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE match_entries (
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points NUMERIC NOT NULL,
  -- Optional map field storing the wonder board used by the player in this match.
  -- Existing matches will have NULL values and from now on this column should not be left blank.
  map TEXT,
  PRIMARY KEY (match_id, player_id)
);

-- Parameter table for Elo calculations
CREATE TABLE rating_params (
  id INTEGER PRIMARY KEY DEFAULT 1,
  k_factor NUMERIC NOT NULL,
  k_perf NUMERIC NOT NULL,
  scale NUMERIC NOT NULL
);

INSERT INTO rating_params (id, k_factor, k_perf, scale)
VALUES (1, 24, 10, 20)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE rating_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rating_after NUMERIC NOT NULL,
  delta NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Function to recompute ratings; ensure variable naming avoids ambiguous references
CREATE OR REPLACE FUNCTION compute_rating_history()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  initial_rating NUMERIC := 1000;
  kFactor NUMERIC;
  kPerf NUMERIC;
  scale_param NUMERIC;
  rec_match RECORD;
  rating_by_id JSONB := '{}'::jsonb;
  deltas JSONB;
  rec_pair RECORD;
  rec_player RECORD;
  ra NUMERIC;
  rb NUMERIC;
  expected_a NUMERIC;
  score_a NUMERIC;
  delta NUMERIC;
  current_delta NUMERIC;
  perf_adj NUMERIC;
  new_rating NUMERIC;
  avg_points NUMERIC;
BEGIN
  SELECT k_factor, k_perf, scale INTO kFactor, kPerf, scale_param FROM rating_params WHERE id = 1;
  DELETE FROM rating_history WHERE match_id IS NOT NULL;

  FOR rec_match IN SELECT id, match_date, created_at FROM matches ORDER BY match_date, created_at LOOP
    deltas := '{}'::jsonb;
    FOR rec_player IN SELECT player_id, points FROM match_entries WHERE match_id = rec_match.id LOOP
      IF NOT rating_by_id ? rec_player.player_id::text THEN
        rating_by_id := rating_by_id || jsonb_build_object(rec_player.player_id::text, initial_rating);
      END IF;
      deltas := deltas || jsonb_build_object(rec_player.player_id::text, 0);
    END LOOP;
    FOR rec_pair IN
      SELECT a.player_id AS a_id, a.points AS a_pts, b.player_id AS b_id, b.points AS b_pts
      FROM match_entries a
      JOIN match_entries b ON a.match_id = b.match_id AND a.player_id < b.player_id
      WHERE a.match_id = rec_match.id
    LOOP
      ra := (rating_by_id ->> rec_pair.a_id::text)::NUMERIC;
      rb := (rating_by_id ->> rec_pair.b_id::text)::NUMERIC;
      expected_a := 1 / (1 + POWER(10, (rb - ra) / 400));
      IF rec_pair.a_pts > rec_pair.b_pts THEN
        score_a := 1;
      ELSIF rec_pair.a_pts < rec_pair.b_pts THEN
        score_a := 0;
      ELSE
        score_a := 0.5;
      END IF;
      delta := kFactor * (score_a - expected_a);
      current_delta := COALESCE((deltas ->> rec_pair.a_id::text)::NUMERIC, 0);
      deltas := jsonb_set(deltas, ARRAY[rec_pair.a_id::text], TO_JSONB(current_delta + delta));
      current_delta := COALESCE((deltas ->> rec_pair.b_id::text)::NUMERIC, 0);
      deltas := jsonb_set(deltas, ARRAY[rec_pair.b_id::text], TO_JSONB(current_delta - delta));
    END LOOP;
    SELECT AVG(points) INTO avg_points FROM match_entries WHERE match_id = rec_match.id;
    FOR rec_player IN SELECT player_id, points FROM match_entries WHERE match_id = rec_match.id LOOP
      current_delta := (deltas ->> rec_player.player_id::text)::NUMERIC;
      perf_adj := kPerf * tanh((rec_player.points - avg_points) / scale_param);
      deltas := jsonb_set(deltas, ARRAY[rec_player.player_id::text], TO_JSONB(current_delta + perf_adj));
    END LOOP;
    FOR rec_player IN SELECT player_id FROM match_entries WHERE match_id = rec_match.id LOOP
      new_rating := (rating_by_id ->> rec_player.player_id::text)::NUMERIC + (deltas ->> rec_player.player_id::text)::NUMERIC;
      rating_by_id := jsonb_set(rating_by_id, ARRAY[rec_player.player_id::text], TO_JSONB(new_rating));
      INSERT INTO rating_history (match_id, player_id, rating_after, delta, created_at)
        VALUES (rec_match.id, rec_player.player_id, new_rating, (deltas ->> rec_player.player_id::text)::NUMERIC, rec_match.match_date);
    END LOOP;
  END LOOP;
END;
$$;

-- Views
CREATE OR REPLACE VIEW v_player_current_rating AS
with 
mat as (
select 
*
, row_number() over(order by created_at asc) as rank
from matches
)
SELECT
  p.id AS player_id,
  p.name,
  COALESCE(r.rating_after, NULL) AS rating,
  r.created_at AS rating_ts
FROM players p
LEFT JOIN LATERAL (
  SELECT rh.rating_after, rh.created_at, rank
  FROM rating_history rh
  left join  mat on mat.id = rh.match_id
  WHERE rh.player_id = p.id
  ORDER BY mat.rank desc, rh.created_at DESC
  LIMIT 1
) r ON TRUE;

create or replace view v_dashboard_players as
with games as (
  select
    me.player_id,
    count(*) as games,
    avg(me.points) as avg_points
  from match_entries me
  group by me.player_id
),
match_max as (
  select
    match_id,
    max(points) as max_points
  from match_entries
  group by match_id
),
match_winners as (
  select
    me.match_id,
    count(*) as winners
  from match_entries me
  join match_max mm on mm.match_id = me.match_id
  where me.points = mm.max_points
  group by me.match_id
),
wins as (
  select
    me.player_id,
    sum(
      case
        when me.points = mm.max_points and mw.winners = 1 then 1
        when me.points = mm.max_points and mw.winners > 1 then 0.5
        else 0
      end
    ) as wins
  from match_entries me
  join match_max mm on mm.match_id = me.match_id
  join match_winners mw on mw.match_id = me.match_id
  group by me.player_id
),
delta10 as (
  select
    player_id,
    sum(delta) as delta_last_10
  from (
    select
      player_id,
      delta,
      row_number() over (partition by player_id order by created_at desc) as rn
    from rating_history
  ) t
  where rn <= 10
  group by player_id
)
-- Total points per player across all matches.  This summarises the overall
-- scoring contribution and can be surfaced in dashboards.
, total as (
  select
    player_id,
    sum(points) as total_points
  from match_entries
  group by player_id
)
select
  p.player_id,
  p.name,
  p.rating,
  g.games,
  g.avg_points,
  (w.wins / nullif(g.games, 0)) as win_pct,
  coalesce(d.delta_last_10, 0) as delta_last_10,
  coalesce(total.total_points, 0) as total_points
from v_player_current_rating p
join games g on g.player_id = p.player_id
left join wins w on w.player_id = p.player_id
left join delta10 d on d.player_id = p.player_id
left join total on total.player_id = p.player_id;

-- View: rating history with match order index for charting.
create or replace view v_rating_history_with_order as
select
  rh.player_id,
  rh.match_id,
  rh.rating_after,
  rh.delta,
  rh.created_at,
  m.match_index
from rating_history rh
join (
  select id as match_id,
         row_number() over (order by match_date, created_at) as match_index
  from matches
) m on m.match_id = rh.match_id;
