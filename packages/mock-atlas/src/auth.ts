import type { IncomingMessage } from "node:http";

import { SignJWT, decodeJwt } from "jose";

const JWT_SECRET = new TextEncoder().encode("foresight-mock-atlas");
const JWT_TTL_SECONDS = 10 * 365 * 24 * 60 * 60; // long-lived so dev sessions never expire mid-flow

export const createJwt = async (address: string) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: ["user"] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(address.toLowerCase())
    .setIssuer("mock-atlas")
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_TTL_SECONDS)
    .sign(JWT_SECRET);
};

/** @returns the lowercase address from the Bearer token, or null when absent/garbled. */
export const bearerAddress = (req: IncomingMessage): string | null => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return decodeJwt(header.slice("Bearer ".length)).sub?.toLowerCase() ?? null;
  } catch {
    return null;
  }
};
