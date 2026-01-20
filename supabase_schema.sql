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

create table if not exists rating_history (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  rating_after numeric not null,
  delta numeric not null,
  created_at timestamptz not null default now()
);

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