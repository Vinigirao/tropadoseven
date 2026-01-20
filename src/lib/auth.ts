import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Simple session mechanism for protecting the admin interface. We sign a
 * timestamp payload and store it in a cookie. The signature is generated
 * using a secret defined in the environment (ADMIN_SESSION_SECRET).
 */
const COOKIE_NAME = "admin_session";

function sign(payload: string) {
  return crypto
    .createHmac("sha256", process.env.ADMIN_SESSION_SECRET!)
    .update(payload)
    .digest("hex");
}

export function setAdminSession() {
  const payload = Date.now().toString();
  const token = `${payload}.${sign(payload)}`;
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
  });
}

export function clearAdminSession() {
  cookies().set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
}

export function isAdminAuthenticated(): boolean {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return false;
  const [payload, signature] = token.split(".");
  return signature === sign(payload);
}