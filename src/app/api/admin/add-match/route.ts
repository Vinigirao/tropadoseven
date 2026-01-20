import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { computeMatchDeltas } from "../../../../lib/rating";

const INITIAL_RATING = 1000;

export async function POST(req: Request) {
  if (!isAdminAuthenticated())
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { matchDate, entries } = await req.json();
  const sb = supabaseServer();
  // Validate input
  if (!/\d{4}-\d{2}-\d{2}/.test(matchDate)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  if (!Array.isArray(entries) || entries.length < 2) {
    return NextResponse.json({ error: "at least two players" }, { status: 400 });
  }
  const playerIds: string[] = entries.map((e: any) => e.playerId);
  const pointsById: Record<string, number> = {};
  for (const e of entries) {
    pointsById[e.playerId] = Number(e.points);
  }
  // Get current ratings
  const { data: ratingsData } = await sb
    .from("v_player_current_rating")
    .select("player_id, rating")
    .in("player_id", playerIds);
  const ratingById: Record<string, number> = {};
  playerIds.forEach((id) => (ratingById[id] = INITIAL_RATING));
  ratingsData?.forEach((r: any) => (ratingById[r.player_id] = r.rating ?? INITIAL_RATING));
  // Compute Elo deltas
  const deltas = computeMatchDeltas(playerIds, pointsById, ratingById, {
    kFactor: 24,
    kPerf: 10,
    scale: 20,
  });
  // Insert match
  const { data: match, error: matchErr } = await sb
    .from("matches")
    .insert({ match_date: matchDate })
    .select()
    .single();
  if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 400 });
  // Insert match entries
  const matchEntries = playerIds.map((id) => ({
    match_id: match.id,
    player_id: id,
    points: pointsById[id],
  }));
  const { error: entriesErr } = await sb.from("match_entries").insert(matchEntries);
  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 400 });
  // Insert rating history
  const historyRows = playerIds.map((id) => ({
    match_id: match.id,
    player_id: id,
    rating_after: ratingById[id] + deltas[id],
    delta: deltas[id],
  }));
  const { error: histErr } = await sb.from("rating_history").insert(historyRows);
  if (histErr) return NextResponse.json({ error: histErr.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}