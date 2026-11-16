import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";

export const ADMIN_EMAIL = "8887ashu@gmail.com";

export interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
}

function loadAppletFirebaseConfig(): {
  projectId: string;
  firestoreDatabaseId: string;
} {
  let projectId = "gen-lang-client-0737333490";
  let firestoreDatabaseId = "(default)";
  try {
    const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as {
        projectId?: string;
        firestoreDatabaseId?: string;
      };
      if (parsed.projectId) projectId = parsed.projectId;
      if (parsed.firestoreDatabaseId) {
        firestoreDatabaseId = parsed.firestoreDatabaseId;
      }
    }
  } catch {
    // Fallback to defaults
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || projectId,
    firestoreDatabaseId:
      process.env.FIREBASE_DATABASE_ID?.trim() || firestoreDatabaseId,
  };
}

const FIREBASE_REST_CONFIG = loadAppletFirebaseConfig();
const FIREBASE_PROJECT_ID = FIREBASE_REST_CONFIG.projectId;

export function getFirebaseRestConfig(): {
  projectId: string;
  databaseId: string;
} {
  return {
    projectId: FIREBASE_REST_CONFIG.projectId,
    databaseId: FIREBASE_REST_CONFIG.firestoreDatabaseId,
  };
}
const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

async function getGooglePublicCerts(
  forceRefresh = false,
): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && certsExpiresAt > now && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_CERTS_URL, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    if (Object.keys(cachedCerts).length > 0) return cachedCerts;
    throw new Error(`Failed to fetch Firebase auth certificates (${res.status})`);
  }

  const data = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  cachedCerts = data;
  certsExpiresAt = Date.now() + Math.max(60, maxAgeSec) * 1000;
  return cachedCerts;
}

function decodeBase64Url(segment: string): Buffer {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
  return Buffer.from(padded, "base64");
}

export async function verifyFirebaseIdToken(
  token: string,
): Promise<VerifiedUser | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(decodeBase64Url(headerB64).toString("utf8")) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== "RS256" || !header.kid) return null;

    let certs = await getGooglePublicCerts(false);
    let cert = certs[header.kid];
    if (!cert) {
      certs = await getGooglePublicCerts(true);
      cert = certs[header.kid];
    }
    if (!cert) return null;

    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();

    const signatureBuf = decodeBase64Url(signatureB64);
    const validSig = verifier.verify(cert, signatureBuf);
    if (!validSig) return null;

    const payload = JSON.parse(decodeBase64Url(payloadB64).toString("utf8")) as {
      aud?: string;
      iss?: string;
      sub?: string;
      user_id?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const expectedIss = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== expectedIss) return null;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
    if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) return null;

    return {
      uid: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      emailVerified: Boolean(payload.email_verified),
      name: typeof payload.name === "string" ? payload.name : "",
      picture: typeof payload.picture === "string" ? payload.picture : "",
    };
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function resolveRequestUser(
  req: Request,
): Promise<VerifiedUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifyFirebaseIdToken(token);
}

export function isVerifiedAdmin(user: VerifiedUser | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email.trim().toLowerCase() === ADMIN_EMAIL,
  );
}
