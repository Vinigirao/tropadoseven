import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/auth";
import { supabaseServer } from "../../../../lib/supabaseServer";

export async function POST(req: Request) {
  if (!isAdminAuthenticated())
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await req.json();
  if (!name)
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("players").insert({ name });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}