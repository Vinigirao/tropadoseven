import { NextResponse } from "next/server";
import { clearAdminSession } from "../../../lib/auth";

/**
 * Log the admin user out by clearing the session cookie.  Always
 * returns an `{ ok: true }` JSON response.
 */
export async function POST() {
  clearAdminSession();
  return NextResponse.json({ ok: true });
}