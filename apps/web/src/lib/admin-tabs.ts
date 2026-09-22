/** Tabs of /admin, selected with `?tab=`. Kept out of the client component so the server page can read it. */
export const ADMIN_TABS = [["users", "Accounts"], ["players", "Admin players"], ["sites", "Site info"]] as const;
export type AdminTab = (typeof ADMIN_TABS)[number][0];
