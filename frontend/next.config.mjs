import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';

const __dirname = dirname(fileURLToPath(import.meta.url));

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the Turbopack workspace root to this directory. Otherwise Next infers the
  // root from lockfiles and can pick a stray parent (e.g. ~/package-lock.json),
  // which breaks module resolution (tailwindcss not found) and prints a warning.
  turbopack: {
    root: __dirname,
  },
  // Dynamic segments default to a 0s client Router Cache stale time (Next 15+),
  // so every client-side navigation under a `force-dynamic` layout (e.g.
  // /tournaments/[id]/*) refetches that layout's RSC payload from scratch.
  // 30s lets flipping between tabs reuse the just-fetched shell instead of a
  // full round trip on every click.
  experimental: {
    staleTimes: {
      dynamic: 30,
    },
  },
  // Only use standalone output in production builds
  ...(process.env.NODE_ENV === 'production' && { output: "standalone" }),
  // Enable polling only inside Docker (native fs watcher doesn't work with bind mounts)
  ...(process.env.DOCKER === '1' && { watchOptions: { pollIntervalMs: 1000 } }),
  allowedDevOrigins: ['exultantly-peaceful-adjutant.cloudpub.ru'],
  async rewrites() {
    // Everything is one gateway behind one origin. In production the browser hits
    // nginx and /api/* never reaches Next, so these rewrites are only a fallback
    // for hitting the Next dev server (:3000) directly: each gateway namespace is
    // forwarded to the internal gateway. /api/auth/* route handlers and /api/account
    // are filesystem routes and take precedence over these afterFiles rewrites.
    const gateway = process.env.NEXT_INTERNAL_API_URL?.replace(/\/$/, "");
    if (!gateway) return [];
    return ["/api/v1", "/api/balancer", "/api/analytics", "/api/streams", "/api/auth"].map((prefix) => ({
      source: `${prefix}/:path*`,
      destination: `${gateway}${prefix}/:path*`,
    }));
  },
  async redirects() {
    // Framework-level so these are real HTTP redirects. The same `redirect()`
    // call inside a page returns 200 with the redirect encoded in the RSC
    // stream — the browser still follows it, but a crawler, a bookmark or a
    // link checker sees a successful empty page instead of a moved one.
    return [
      {
        // `/matches` is a container, not a view: its content is the
        // `encounters` sub-tab. Settled by the IA move, so 308.
        source: "/admin/tournaments/:id/matches",
        destination: "/admin/tournaments/:id/matches/encounters",
        permanent: true,
      },
      {
        // Logs stopped being a top-level tab. This move is settled, so 308.
        source: "/admin/tournaments/:id/logs",
        destination: "/admin/tournaments/:id/matches/logs",
        permanent: true,
      },

      // ── Admin IA move (docs/admin-redesign/01-ia.md §3.2) ──────────────
      //
      // Authored here in one pass (PR-1) so the map lives in one place. A line
      // stays COMMENTED until its destination exists — a redirect to a route
      // that has not been built is a 404 with extra steps — and the WU that
      // creates the target uncomments it in the same commit that deletes the
      // old page. Keep the WU tags: they are the checklist.
      //
      // PR-2e  bracket
      { source: "/admin/tournaments/:id/stages", destination: "/admin/tournaments/:id/bracket", permanent: true },

      // PR-2b  registration sub-tabs
      { source: "/admin/tournaments/:id/registration", destination: "/admin/tournaments/:id/registration/entries", permanent: true },

      // PR-2c  teams + draft. Next carries the unmatched query through, so the
      // Integrations card's `?challongeSync=1` deep link survives the hop.
      { source: "/admin/tournaments/:id/teams", destination: "/admin/tournaments/:id/teams/roster", permanent: true },
      { source: "/admin/tournaments/:id/draft", destination: "/admin/tournaments/:id/teams/draft", permanent: true },

      // PR-2d  matches sub-tabs + the /admin/matches browser
      { source: "/admin/tournaments/:id/matches/results", destination: "/admin/tournaments/:id/matches/encounters", permanent: true },
      { source: "/admin/tournaments/:id/matches/maps", destination: "/admin/tournaments/:id/matches/parsed", permanent: true },
      { source: "/admin/encounters", destination: "/admin/matches?view=encounters", permanent: true },
      { source: "/admin/match-reports", destination: "/admin/matches?view=reports", permanent: true },
      { source: "/admin/standings", destination: "/admin/matches?view=standings", permanent: true },
      // `missing` keeps the new browser's own `?view=` links from looping:
      // only a bare /admin/matches (the old parsed-maps bookmark) is moved.
      { source: "/admin/matches", missing: [{ type: "query", key: "view" }], destination: "/admin/matches?view=parsed", permanent: true },

      // PR-2f  tournament settings sections
      { source: "/admin/tournaments/:id/settings", destination: "/admin/tournaments/:id/settings/general", permanent: true },
      { source: "/admin/tournaments/:id/pickBan", destination: "/admin/tournaments/:id/settings/pre-game", permanent: true },
      { source: "/admin/tournaments/:id/links", destination: "/admin/tournaments/:id/settings/links", permanent: true },
      { source: "/admin/tournaments/:id/matches/report-form", destination: "/admin/tournaments/:id/settings/report-form", permanent: true },

      // PR-3a  people
      { source: "/admin/users", destination: "/admin/people", permanent: true },
      { source: "/admin/players", destination: "/admin/people", permanent: true },

      // PR-3d  members
      { source: "/admin/workspaces/members", destination: "/admin/members", permanent: true },

      // PR-4a  workspace settings hub. NOT redirected: §1.1 sent the old
      // /admin/settings (itself only a page-level redirect to the rank
      // collector's settings tab) on to /admin/collectors/rank?tab=settings,
      // but that path is now the hub's own root and a 308 here would shadow
      // its index forever. Recorded in §13.

      // PR-4b  statuses, sub-roles, subscription providers
      { source: "/admin/balancer", destination: "/admin/settings/statuses", permanent: true },
      { source: "/admin/sub-roles", destination: "/admin/settings/sub-roles", permanent: true },

      // PR-4c  divisions
      { source: "/admin/divisions", destination: "/admin/settings/divisions", permanent: true },

      // PR-5a  game content
      { source: "/admin/heroes", destination: "/admin/content/heroes", permanent: true },
      { source: "/admin/maps", destination: "/admin/content/maps", permanent: true },
      { source: "/admin/gamemodes", destination: "/admin/content/gamemodes", permanent: true },
      { source: "/admin/aliases", destination: "/admin/content/unresolved", permanent: true },

      // PR-5b  collectors
      { source: "/admin/rank", destination: "/admin/collectors/rank", permanent: true },
      { source: "/admin/subscriptions", destination: "/admin/collectors/subscriptions", permanent: true },
      { source: "/admin/streams", destination: "/admin/collectors/streams", permanent: true },

      // PR-5c  access. `access/users` first: the matcher is ordered, and
      // `/admin/access` alone must not swallow its own child.
      { source: "/admin/access/users", destination: "/admin/access/accounts", permanent: true },
      { source: "/admin/access", destination: "/admin/access/accounts", permanent: true },

      // PR-6   cleanup. The mix builder never belonged under /admin: it is a
      // balancer tool, and this path was a runtime redirect pretending to be
      // a route.
      { source: "/admin/pickup", destination: "/balancer/pickup", permanent: true },

      // ── Public tournament page (docs/tournament-redesign/plan.md §1.1) ───
      //
      // Four thin tabs folded into their neighbours. Phases and the map pool
      // are cards on the overview; standings is a view of the bracket; hero
      // stats is a tab of the statistics section. Unmatched query strings
      // (`?stage=`) carry through on their own.
      { source: "/tournaments/:slug/schedule", destination: "/tournaments/:slug#phases", permanent: true },
      { source: "/tournaments/:slug/maps", destination: "/tournaments/:slug#map-pool", permanent: true },
      { source: "/tournaments/:slug/standings", destination: "/tournaments/:slug/bracket?view=standings", permanent: true },
      { source: "/tournaments/:slug/heroes", destination: "/tournaments/:slug/stats?tab=heroes", permanent: true },
    ];
  },
  images: {
    unoptimized: true,
    qualities: [25, 50, 75, 100],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'd15f34w2p8l1cc.cloudfront.net',
        port: '',
        pathname: '/overwatch/**',
      },
      {
        protocol: 'https',
        hostname: 'overfast.craazzzyyfoxx.me',
        port: '',
        pathname: '/static/**',
      },
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'minio.craazzzyyfoxx.me',
        port: '',
        pathname: '/aqt/**',
      },
      {
        protocol: 'https',
        hostname: 'static.nl.craazzzyyfoxx.me',
        port: '',
        pathname: '/aqt/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
