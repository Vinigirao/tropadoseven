import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";
import { computeMatchDeltas } from "../../../../lib/rating";

/**
 * Endpoint to update an existing match and recompute all rating history.
 *
 * The request body must contain:
 * {
 *   matchId: string | number,
 *   matchDate: string (YYYY‑MM‑DD),
 *   entries: Array<{ playerId: string; points: number }>
 * }
 *
 * Only an authenticated admin can call this endpoint.  It will:
 *  - update the match date;
 *  - replace all match entries for the match with the provided entries;
 *  - recompute rating deltas and rating history for all matches from scratch.
 */
const INITIAL_RATING = 1000;

export async function POST(req: Request) {
  // Ensure admin session is valid
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { matchId, matchDate, entries } = body || {};
  // Basic validation
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required" }, { status: 400 });
  }
  if (!matchDate || !/\d{4}-\d{2}-\d{2}/.test(matchDate)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  if (!Array.isArray(entries) || entries.length < 2) {
    return NextResponse.json({ error: "at least two players" }, { status: 400 });
  }
  const sb = supabaseServer();
  // Update the match date
  const { error: updateErr } = await sb
    .from("matches")
    .update({ match_date: matchDate })
    .eq("id", matchId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 });
  }
  // Remove old entries for this match
  const { error: deleteErr } = await sb
    .from("match_entries")
    .delete()
    .eq("match_id", matchId);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 400 });
  }
  // Insert new entries for this match
  const matchEntries = entries.map((e: any) => ({
    match_id: matchId,
    player_id: e.playerId,
    points: Number(e.points),
  }));
  const { error: insertErr } = await sb
    .from("match_entries")
    .insert(matchEntries);
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 400 });
  }
  // Recompute rating history for all matches from scratch
  // Fetch matches with their entries sorted by match_date then created_at
  const { data: matches, error: mErr } = await sb
    .from("matches")
    .select("id, match_date, created_at, match_entries(player_id, points)")
    .order("match_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }
  // Build rating map and history rows
  const ratingById: Record<string, number> = {};
  const historyRows: any[] = [];
  // Iterate through each match chronologically
  (matches || []).forEach((match: any) => {
    const entries = match.match_entries || [];
    const playerIds: string[] = entries.map((e: any) => e.player_id);
    const pointsById: Record<string, number> = {};
    entries.forEach((e: any) => {
      pointsById[e.player_id] = Number(e.points);
      if (!(e.player_id in ratingById)) {
        ratingById[e.player_id] = INITIAL_RATING;
      }
    });
    if (playerIds.length < 2) return; // ignore matches with less than 2 players
    const deltas = computeMatchDeltas(playerIds, pointsById, ratingById, {
      kFactor: 24,
      kPerf: 10,
      scale: 20,
    });
    playerIds.forEach((id) => {
      ratingById[id] += deltas[id];
      historyRows.push({
        match_id: match.id,
        player_id: id,
        rating_after: ratingById[id],
        delta: deltas[id],
      });
    });
  });
  // Clear existing history (Supabase requires a filter; use a non‑null condition)
  await sb.from("rating_history").delete().neq("match_id", "");
  // Insert recomputed history
  if (historyRows.length > 0) {
    const { error: histErr } = await sb
      .from("rating_history")
      .insert(historyRows);
    if (histErr) {
      return NextResponse.json({ error: histErr.message }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}