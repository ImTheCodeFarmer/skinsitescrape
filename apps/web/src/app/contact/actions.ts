"use server";

import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { submitContact, type ContactInput, type ContactResult } from "@/lib/contact";

/** Send the contact form. Cloudflare puts the visitor's address and country in CF-Connecting-IP and CF-IPCountry. */
export async function sendContactAction(input: ContactInput): Promise<ContactResult> {
  const [h, session] = await Promise.all([headers(), getSession()]);
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const country = h.get("cf-ipcountry");
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return submitContact(
    { name: str(input?.name), email: str(input?.email), telegram: str(input?.telegram), discord: str(input?.discord), message: str(input?.message), website: str(input?.website), token: str(input?.token) },
    { ip, country, steam: session ? `${session.name} (${session.steamId})` : null },
  );
}
