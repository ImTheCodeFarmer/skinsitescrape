import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for secrets stored in the database (Telegram bot
 * tokens). AES-256-GCM under a key derived from ALERTS_SECRET, or
 * SESSION_SECRET, or as a last resort DATABASE_URL, so the web app and the
 * collector agree on the key without extra configuration. Set ALERTS_SECRET
 * to rotate it independently; existing rows then need re-entering.
 */
function key(): Buffer {
  const s = process.env.ALERTS_SECRET || process.env.SESSION_SECRET || (process.env.DATABASE_URL ? `swt-alerts:${process.env.DATABASE_URL}` : "");
  if (!s) throw new Error("ALERTS_SECRET (or SESSION_SECRET / DATABASE_URL) must be set");
  return createHash("sha256").update(s).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(enc: string): string {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
