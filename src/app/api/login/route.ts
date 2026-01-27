import { NextResponse } from "next/server";
import { setAdminSession } from "../../../lib/auth";

/**
 * Simple login endpoint for the admin interface.  It reads a JSON body
 * containing a username and password and compares it against the
 * environment‑provided credentials.  On success it writes a signed
 * session token to an HTTP‑only cookie via `setAdminSession` and
 * returns `{ ok: true }`.  On failure it returns a 401 response.
 */
export async function POST(req: Request) {
  const { username, password } = await req.json();
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    setAdminSession();
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false }, { status: 401 });
}