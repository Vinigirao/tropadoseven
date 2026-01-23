import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";

/**
 * Update an existing match and recompute all Elo ratings.  An admin must
 * provide a `matchId`, new `matchDate` and an array of `entries`
 * containing player IDs and their new points.  After updating the
 * match date and replacing its entries, the Supabase RPC
 * `compute_rating_history` is called to recalculate the entire
 * rating_history table.  This avoids computing deltas in
 * JavaScript and centralises the logic in the database.
 */
export async function POST(req: Request) {
  // Require admin session
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { matchId, matchDate, entries } = body || {};
  // Validate inputs
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required" }, { status: 400 });
  }
  if (!matchDate || typeof matchDate !== "string" || !/\d{4}-\d{2}-\d{2}/.test(matchDate)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  if (!Array.isArray(entries) || entries.length < 2) {
    return NextResponse.json({ error: "at least two players" }, { status: 400 });
  }
  const sb = supabaseServer();
  // Update match date
  const { error: updateErr } = await sb
    .from("matches")
    .update({ match_date: matchDate })
    .eq("id", matchId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 });
  }
  // Delete existing entries for the match
  const { error: deleteErr } = await sb
    .from("match_entries")
    .delete()
    .eq("match_id", matchId);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 400 });
  }
  // Insert new entries
  const matchEntries = entries.map((e: any) => ({
    match_id: matchId,
    player_id: e.playerId,
    points: Number(e.points),
    map: e.map ?? null,
  }));
  const { error: insertErr } = await sb.from("match_entries").insert(matchEntries);
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 400 });
  }
  // Recalculate ratings using the database function
  const { error: rpcErr } = await sb.rpc("compute_rating_history");
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}