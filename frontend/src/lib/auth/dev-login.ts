// Password sign-in for a host-run `next dev` pointed at a remote stack
// (docs/dev-site.md, "Local frontend against the dev site"): OAuth cannot
// return to localhost, so `/auth/dev-login` signs in with these server-only
// credentials instead. Never active in a production build, whatever the env.
export function devLoginCredentials(): { email: string; password: string } | null {
  if (process.env.NODE_ENV === "production") return null;
  const email = process.env.DEV_AUTH_EMAIL;
  const password = process.env.DEV_AUTH_PASSWORD;
  return email && password ? { email, password } : null;
}
