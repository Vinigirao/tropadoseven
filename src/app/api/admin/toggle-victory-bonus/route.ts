import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";

/**
 * Toggle the victory bonus setting and recalculate all ratings.
 * POST body: { enabled: boolean }
 * When enabled, winners receive (N-1) bonus rating points per match.
 * The entire rating history is recomputed retroactively.
 */
export async function POST(req: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { enabled } = body || {};
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  const sb = supabaseServer();
  // Update the victory_bonus_enabled flag
  const { error: updateErr } = await sb
    .from("rating_params")
    .update({ victory_bonus_enabled: enabled })
    .eq("id", 1);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  // Recompute entire rating history with the new setting
  const { error: rpcErr } = await sb.rpc("compute_rating_history");
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, victory_bonus_enabled: enabled });
}

/**
 * GET the current victory bonus state.
 */
export async function GET() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("rating_params")
    .select("victory_bonus_enabled")
    .eq("id", 1)
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ victory_bonus_enabled: data.victory_bonus_enabled });
}
