-- Dashboard accounts: one row per Steam account that has signed in to the
-- web app (Steam OpenID). Sessions themselves live in a signed cookie; this
-- only records who has connected and when, for the admin page.
CREATE TABLE IF NOT EXISTS site_users (
  steam_id    text PRIMARY KEY,
  name        text,
  avatar      text,
  first_login timestamptz NOT NULL DEFAULT now(),
  last_login  timestamptz NOT NULL DEFAULT now(),
  logins      integer NOT NULL DEFAULT 1
);
