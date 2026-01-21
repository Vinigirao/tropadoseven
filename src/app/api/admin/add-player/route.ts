import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";

/**
 * Create a new player.  Only authenticated admins may call this
 * endpoint.  The request body must contain a `name` property.  The
 * player name is unique; attempting to insert a duplicate will
 * return a 400 error with the Supabase error message.  On success it
 * returns `{ ok: true }`.
 */
export async function POST(req: Request) {
  if (!isAdminAuthenticated())
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await req.json();
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  }
  const sb = supabaseServer();
  const { error } = await sb.from("players").insert({ name });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}