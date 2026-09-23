import { ContactView } from "@/components/views/contact";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact us — SkinWagerTracker", description: "Questions, feature requests or partnerships: send us a message and we reply by email, Telegram or Discord." };

export default async function Page() {
  const session = await getSession();
  return <ContactView siteKey={process.env.TURNSTILE_SITE_KEY ?? null} defaultName={session?.name ?? ""} />;
}
