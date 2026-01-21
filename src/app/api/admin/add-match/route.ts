import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";

/**
 * Register a new match and compute the updated Elo ratings via a
 * database function.  Only authenticated admins may call this
 * endpoint.  The request body must include a `matchDate` in
 * YYYY‑MM‑DD format and an `entries` array containing player IDs and
 * their points.  The Supabase RPC `compute_rating_history` is invoked
 * after inserting the match and its entries to recompute all ratings
 * and deltas entirely in the database.
 */
export async function POST(req: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { matchDate, entries } = body || {};
  // Validate match date
  if (!matchDate || typeof matchDate !== "string" || !/\d{4}-\d{2}-\d{2}/.test(matchDate)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  // Validate entries
  if (!Array.isArray(entries) || entries.length < 2) {
    return NextResponse.json({ error: "at least two players" }, { status: 400 });
  }
  const sb = supabaseServer();
  // Create the match
  const { data: match, error: matchErr } = await sb
    .from("matches")
    .insert({ match_date: matchDate })
    .select()
    .single();
  if (matchErr) {
    return NextResponse.json({ error: matchErr.message }, { status: 400 });
  }
  // Prepare entries for insert; ensure numeric points
  const matchEntries = entries.map((e: any) => ({
    match_id: match.id,
    player_id: e.playerId,
    points: Number(e.points),
  }));
  // Insert match entries
  const { error: entriesErr } = await sb.from("match_entries").insert(matchEntries);
  if (entriesErr) {
    return NextResponse.json({ error: entriesErr.message }, { status: 400 });
  }
  // Recompute Elo ratings using the database function.  This will
  // delete and repopulate the rating_history table based on all
  // existing matches, including the newly inserted one.
  const { error: rpcErr } = await sb.rpc("compute_rating_history");
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}