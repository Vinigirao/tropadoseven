import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";

/**
 * List all matches with their entries and player names.  This
 * endpoint is restricted to authenticated admins.  Matches are
 * returned in descending order of match_date and created_at so that
 * recent matches appear first.  Each match includes an array of
 * `match_entries` where each entry contains the player_id, points
 * scored, and the associated player's name.
 */
export async function GET() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseServer();
  const { data: matches, error } = await sb
    .from("matches")
    .select(
      "id, match_date, created_at, match_entries (player_id, points, map, players (name))",
    )
    .order("match_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ matches: matches || [] });
}