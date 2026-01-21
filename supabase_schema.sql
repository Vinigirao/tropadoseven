-- SQL schema for 7 Wonders rating system
-- Creates tables for players, matches, match entries, rating history
-- and views for current ratings and dashboard stats.

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  match_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists match_entries (
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  points numeric not null,
  primary key (match_id, player_id)
);

-- Parameter table for Elo calculations. Allows admins to adjust kFactor, performance weight and scale.
create table if not exists rating_params (
  id integer primary key default 1,
  k_factor numeric not null,
  k_perf numeric not null,
  scale numeric not null
);

-- Insert default parameters if not present.
insert into rating_params (id, k_factor, k_perf, scale)
values (1, 24, 10, 20)
on conflict (id) do nothing;

create table if not exists rating_history (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  rating_after numeric not null,
  delta numeric not null,
  created_at timestamptz not null default now()
);

-- Function: compute Elo rating history for all matches. This procedure recalculates
-- ratings and deltas for every match using the parameters in rating_params and
-- overwrites the rating_history table. It performs the same algorithm as the
-- original JavaScript implementation but runs entirely within the database.
create or replace function compute_rating_history()
returns void
language plpgsql
as $$
declare
  initial_rating numeric := 1000;
  kFactor numeric;
  kPerf numeric;
  scale numeric;
  rec_match record;
  rating_by_id jsonb := '{}'::jsonb;
  deltas jsonb;
  rec_pair record;
  rec_player record;
  ra numeric;
  rb numeric;
  expected_a numeric;
  score_a numeric;
  delta numeric;
  current_delta numeric;
  perf_adj numeric;
  new_rating numeric;
  avg_points numeric;
begin
  -- Load parameters
  select k_factor, k_perf, scale into kFactor, kPerf, scale from rating_params where id = 1;
  -- Reset history
  delete from rating_history;
  -- Iterate through matches chronologically
  for rec_match in
    select id, match_date, created_at from matches order by match_date, created_at
  loop
    -- Reset deltas for this match
    deltas := '{}'::jsonb;
    -- Initialise deltas and ratings for participating players
    for rec_player in select player_id, points from match_entries where match_id = rec_match.id loop
      if not rating_by_id ? rec_player.player_id::text then
        rating_by_id := rating_by_id || jsonb_build_object(rec_player.player_id::text, initial_rating);
      end if;
      deltas := deltas || jsonb_build_object(rec_player.player_id::text, 0);
    end loop;
    -- Compute pairwise Elo deltas
    for rec_pair in
      select a.player_id as a_id, a.points as a_pts, b.player_id as b_id, b.points as b_pts
      from match_entries a
      join match_entries b on a.match_id = b.match_id and a.player_id < b.player_id
      where a.match_id = rec_match.id
    loop
      ra := (rating_by_id ->> rec_pair.a_id::text)::numeric;
      rb := (rating_by_id ->> rec_pair.b_id::text)::numeric;
      expected_a := 1 / (1 + power(10, (rb - ra) / 400));
      if rec_pair.a_pts > rec_pair.b_pts then
        score_a := 1;
      elsif rec_pair.a_pts < rec_pair.b_pts then
        score_a := 0;
      else
        score_a := 0.5;
      end if;
      delta := kFactor * (score_a - expected_a);
      -- increment delta for player A
      current_delta := coalesce((deltas ->> rec_pair.a_id::text)::numeric, 0);
      deltas := jsonb_set(deltas, array[rec_pair.a_id::text], to_jsonb(current_delta + delta));
      -- decrement delta for player B
      current_delta := coalesce((deltas ->> rec_pair.b_id::text)::numeric, 0);
      deltas := jsonb_set(deltas, array[rec_pair.b_id::text], to_jsonb(current_delta - delta));
    end loop;
    -- Performance adjustment
    select avg(points) into avg_points from match_entries where match_id = rec_match.id;
    for rec_player in select player_id, points from match_entries where match_id = rec_match.id loop
      current_delta := (deltas ->> rec_player.player_id::text)::numeric;
      perf_adj := kPerf * tanh((rec_player.points - avg_points) / scale);
      deltas := jsonb_set(deltas, array[rec_player.player_id::text], to_jsonb(current_delta + perf_adj));
    end loop;
    -- Update ratings and insert history rows
    for rec_player in select player_id from match_entries where match_id = rec_match.id loop
      new_rating := (rating_by_id ->> rec_player.player_id::text)::numeric + (deltas ->> rec_player.player_id::text)::numeric;
      rating_by_id := jsonb_set(rating_by_id, array[rec_player.player_id::text], to_jsonb(new_rating));
      insert into rating_history (match_id, player_id, rating_after, delta, created_at)
        values (rec_match.id, rec_player.player_id, new_rating, (deltas ->> rec_player.player_id::text)::numeric, rec_match.match_date);
    end loop;
  end loop;
end;
$$;

-- View: latest rating per player
create or replace view v_player_current_rating as
select
  p.id as player_id,
  p.name,
  coalesce(r.rating_after, null) as rating,
  r.created_at as rating_ts
from players p
left join lateral (
  select rh.rating_after, rh.created_at
  from rating_history rh
  where rh.player_id = p.id
  order by rh.created_at desc
  limit 1
) r on true;

-- View: dashboard statistics (players who have played at least 1 match)
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
select
  p.player_id,
  p.name,
  p.rating,
  g.games,
  g.avg_points,
  (w.wins / nullif(g.games, 0)) as win_pct,
  coalesce(d.delta_last_10, 0) as delta_last_10
from v_player_current_rating p
join games g on g.player_id = p.player_id
left join wins w on w.player_id = p.player_id
left join delta10 d on d.player_id = p.player_id;

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