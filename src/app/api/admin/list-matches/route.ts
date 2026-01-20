import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";

/**
 * GET /api/admin/list-matches
 *
 * Returns a list of all matches with their entries and player names.  This
 * endpoint is restricted to authenticated admins.
 */
export async function GET() {
  // Only allow calls if the current session is an authenticated admin.
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseServer();
  // Select matches and join players via match_entries.players
  const { data: matches, error } = await sb
    .from("matches")
    .select(
      "id, match_date, created_at, match_entries (player_id, points, players (name))",
    )
    .order("match_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ matches: matches || [] });
}