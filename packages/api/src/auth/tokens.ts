import jwt from "jsonwebtoken";

const COOKIE_NAME = "ipk_session";

export interface SessionClaims {
  sub: string; // user id
  email: string;
}

export function issueSession(claims: SessionClaims, secret: string, ttlHours: number): string {
  return jwt.sign(claims, secret, { expiresIn: `${ttlHours}h`, algorithm: "HS256" });
}

export type VerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: "expired" | "invalid" };

export function verifySession(token: string, secret: string): VerifyResult {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string" || !decoded.sub) return { ok: false, reason: "invalid" };
    return { ok: true, claims: { sub: String(decoded.sub), email: String(decoded.email ?? "") } };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  serialize(token: string, ttlHours: number, isProduction: boolean): string {
    const parts = [
      `${COOKIE_NAME}=${token}`,
      "HttpOnly",
      "Path=/",
      `Max-Age=${ttlHours * 3600}`,
      `SameSite=${isProduction ? "None" : "Lax"}`,
    ];
    if (isProduction) parts.push("Secure");
    return parts.join("; ");
  },
  clear(isProduction: boolean): string {
    const parts = [`${COOKIE_NAME}=`, "HttpOnly", "Path=/", "Max-Age=0", `SameSite=${isProduction ? "None" : "Lax"}`];
    if (isProduction) parts.push("Secure");
    return parts.join("; ");
  },
};
