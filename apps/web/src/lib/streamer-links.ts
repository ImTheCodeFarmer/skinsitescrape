/**
 * The channels and socials a streamer profile can list, in display order.
 * Shared by the server (to clean what an admin saves) and the client (to
 * render the form and the buttons), so no server-only imports here.
 * `base` turns a bare handle into a URL; a full URL is kept as given.
 */
export const STREAMER_PLATFORMS = [
  { key: "twitch", label: "Twitch", color: "#9146ff", base: "https://twitch.tv/" },
  { key: "kick", label: "Kick", color: "#53fc18", base: "https://kick.com/" },
  { key: "youtube", label: "YouTube", color: "#ff0033", base: "https://youtube.com/@" },
  { key: "x", label: "X / Twitter", color: "#e7e9ea", base: "https://x.com/" },
  { key: "tiktok", label: "TikTok", color: "#25f4ee", base: "https://tiktok.com/@" },
  { key: "instagram", label: "Instagram", color: "#e1306c", base: "https://instagram.com/" },
  { key: "discord", label: "Discord", color: "#5865f2", base: "https://discord.gg/" },
  { key: "website", label: "Website", color: "#a1a1aa", base: "https://" },
] as const;

export type StreamerPlatform = (typeof STREAMER_PLATFORMS)[number]["key"];
export type StreamerLinks = Partial<Record<StreamerPlatform, string>>;

/** What an admin entered for a streamer-marked player. */
export type StreamerProfile = { site: string; id: string; name: string | null; bio: string | null; links: StreamerLinks; updatedAt: string | null };

/**
 * A handle or URL as typed into the form, as a URL, or null when empty or
 * not something we would link to. "@name", "name" and "twitch.tv/name" all
 * work; only http(s) links are kept.
 */
export function streamerLinkUrl(platform: StreamerPlatform, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const p = STREAMER_PLATFORMS.find((x) => x.key === platform);
  if (!p) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+\//.test(v) || platform === "website" ? `https://${v}` : `${p.base}${v.replace(/^@/, "")}`);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
}

/** The short form shown on a button: the handle for known platforms, the host and path for a website. */
export function streamerLinkLabel(platform: StreamerPlatform, url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if (platform === "website" || platform === "discord" || !path) return `${u.host.replace(/^www\./, "")}${path}`;
    return `@${path.replace(/^\/@?/, "")}`;
  } catch {
    return url;
  }
}
