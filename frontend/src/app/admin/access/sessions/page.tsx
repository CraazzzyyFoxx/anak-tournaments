import { SessionsBrowser } from "@/components/admin/access/sessions/SessionsBrowser";

/**
 * Auth sessions (T2, F15). The Access layout carries the header and the
 * superuser gate; the screen is `SessionsBrowser`.
 */
export default function AccessAdminSessionsPage() {
  return <SessionsBrowser />;
}
