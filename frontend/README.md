This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

## Branding via .env

The site name and main icon/logo can be configured via environment variables.

- Copy `frontend/.env.example` to `frontend/.env` (or `frontend/.env.local`)
- Set `NEXT_PUBLIC_SITE_NAME` (e.g. "Moonrise Tournaments")
- Set `NEXT_PUBLIC_SITE_ICON` (e.g. "/logo.webp")
- (Optional) Set `NEXT_PUBLIC_SITE_FAVICON` (e.g. "/favicon.ico")
- Restart `npm run dev`

## Favicon replacement (Docker)

The app serves the browser favicon from `frontend/public/favicon.ico`. In production, you can replace it by bind-mounting your own file into the container:

`./conf/favicon.ico:/app/public/favicon.ico:ro`

## Docker workflow (breaking change)

- `docker-compose.override.yml` is removed.
- Dev behavior is defined in `docker-compose.yml`.
- Start core frontend/backend stack with:

```bash
docker compose up -d --wait
```

- Enable Kong gateway and workers when needed:

```bash
docker compose --profile gateway --profile workers up -d --wait
```

Production image builds now use explicit Docker build args/env values and no longer copy `.env` into image layers.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## UI/UX

Design principles and UI patterns used across the app are documented in `frontend/DESIGN.md`.
