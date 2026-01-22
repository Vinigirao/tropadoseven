import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";

/**
 * Delete an existing match and recompute all Elo ratings.
 *
 * This endpoint expects a JSON payload with a `matchId` identifying
 * the match to remove.  It first verifies the admin session using
 * `isAdminAuthenticated()`.  If authentication fails it returns
 * HTTP 401.  Once authenticated it deletes any match_entries
 * associated with the match and then removes the match itself.  On
 * successful deletion, the stored procedure `compute_rating_history`
 * is invoked to rebuild the rating_history table so that ratings
 * reflect the removal of the match.  A JSON `{ ok: true }` response
 * indicates success.
 */
export async function POST(req: Request) {
  // Require admin session
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { matchId } = body || {};
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required" }, { status: 400 });
  }
  const sb = supabaseServer();
  // Delete match entries.  Although match_entries has ON DELETE CASCADE
  // referencing matches, deleting explicitly here avoids leaving
  // orphaned rating_history rows until the function is called.
  const { error: delEntriesErr } = await sb
    .from("match_entries")
    .delete()
    .eq("match_id", matchId);
  if (delEntriesErr) {
    return NextResponse.json({ error: delEntriesErr.message }, { status: 400 });
  }
  // Delete the match itself.
  const { error: delMatchErr } = await sb
    .from("matches")
    .delete()
    .eq("id", matchId);
  if (delMatchErr) {
    return NextResponse.json({ error: delMatchErr.message }, { status: 400 });
  }
  // Recalculate all ratings using the database function.  This
  // procedure rewrites rating_history from scratch, so all existing
  // history for the deleted match will be removed and subsequent
  // matches will be re-evaluated.
  const { error: rpcErr } = await sb.rpc("compute_rating_history");
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}