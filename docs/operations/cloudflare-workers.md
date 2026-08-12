# Cloudflare Workers Deployment

> **Current deployment status (2026-08-04)**: Cloudflare/OpenNext is a retained, opt-in backup
> capability. Vercel is Morpho's formal production environment; this document describes an optional
> independent Worker path and must not be read as evidence of the current production deployment.

## Architecture

Morpho uses Next.js with `@opennextjs/cloudflare` to package the complete App Router application as a Cloudflare Worker. This keeps route handlers, Supabase server-side session checks, streaming AI responses, and Next.js routing available. It is not a static export and does not use Cloudflare Pages.

The Cloudflare integration is independent from Vercel:

- `npm run build` remains the normal Next.js build used by Vercel.
- `npm run cf:build` runs the Cloudflare-only Webpack/standalone Next build, then creates the OpenNext Worker bundle in `.open-next/`. It temporarily moves an existing standard `.next`, removes the Cloudflare-only `.next` in `finally`, and restores the original directory after either success or failure.
- `npm run cf:preview` builds and starts a local Wrangler/workerd preview.
- `npm run cf:deploy` builds and deploys the Worker.

Morpho project data is still browser-local. Cloudflare deployment does not migrate, copy, or alter the project's `localStorage` or IndexedDB data.

`wrangler.jsonc` intentionally contains no KV, R2, D1, Queue, Durable Object, Cloudflare Images, custom-domain, or DNS binding. The Worker uses OpenNext's generated entry, the static-assets binding, `nodejs_compat`, public fetch behavior, source maps, and Workers observability only.

## Local Setup

1. Install dependencies with `npm.cmd install`.
2. Copy `.env.example` to `.env.local` and configure local Next.js values without committing the file.
3. Copy `.dev.vars.example` to `.dev.vars` for local Worker runtime values. Do not copy `.env.local` automatically; enter only the values needed for Worker runtime.
4. Keep `MORPHO_ALLOW_PAID_SMOKE_TESTS=false`.
5. Build with `npm.cmd run cf:build`.
6. Preview with `npm.cmd run cf:preview`.

`cf:build` runs Next.js during the OpenNext build. Therefore `NEXT_PUBLIC_*` values must be present in `.env.local` before this command. Wrangler reads `.dev.vars` only for the local Worker runtime; it does not replace Next.js build-time public configuration.

The local preview uses real Wrangler/workerd. It does not require a Cloudflare login. It will not call paid AI routes unless a signed-in user makes such a request, which is outside the default smoke test scope.

The Cloudflare-only build uses `next build --webpack` with standalone output before OpenNext packages the Worker. This is deliberately separate from `npm run build`: the retained OpenNext path produced missing Turbopack server-runtime chunks in the current Windows local preview, while the Webpack bundle runs correctly in workerd. The script is platform-neutral and can also be used by Workers Builds.

App Router `route.ts` files export only supported Route Module fields and HTTP handlers. Testable dependency factories live in adjacent `handler.ts` modules. GitHub Actions runs `cf:build` as an independent backup-build gate; it does not deploy or require Cloudflare credentials.

`npm.cmd run cf:typegen` refreshes the local `worker-configuration.d.ts` file from `wrangler.jsonc`. It is generated and ignored by Git because the current application does not import Cloudflare bindings directly.

## First Cloudflare Deployment

Do this only after local build and preview pass:

1. Log in to Cloudflare.
2. Run `npx wrangler login` and confirm the browser OAuth flow.
3. In the Cloudflare Worker dashboard, configure the build-time variables below when using Workers Builds or Git integration.
4. Configure the Worker runtime variables and secrets below.
5. Use the temporary any-host tldraw evaluation key for the `workers.dev` deployment. Do not reuse a Hobby key restricted to the Vercel domain.
6. Run `npm.cmd run cf:deploy`.
7. Record the returned `workers.dev` address for testing.
8. Test from mainland networks and complete the post-deployment checklist.

The first deployment uses the Worker name `morpho-cf-preview` and the default `workers.dev` address. It does not create a custom domain or modify DNS.

## Environment Matrix

| Variable | Local Next `.env.local` | Local Worker `.dev.vars` | Cloudflare build variable | Cloudflare runtime variable | Cloudflare runtime secret | Public |
| --- | --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | Yes | No | Yes | No | No | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | Yes | Yes | No | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Yes | Yes | Yes | No | Yes |
| `MORPHO_AUTH_REQUIRED` | Yes | Yes | No | Yes | No | No |
| `MORPHO_AI_PROVIDER` | Yes | Yes | No | Yes | No | No |
| `MORPHO_AI_BASE_URL` | Yes | Yes | No | Yes | No | No |
| `MORPHO_AI_MODEL` | Yes | Yes | No | Yes | No | No |
| `MORPHO_AI_REASONING_EFFORT` | Yes | Yes | No | Yes | No | No |
| `MORPHO_AI_WEB_SEARCH_ENABLED` | Yes | Yes | No | Yes | No | No |
| `MORPHO_GRS_BASE_URL` | Yes | Yes | No | Yes | No | No |
| `MORPHO_GRS_FALLBACK_BASE_URLS` | Yes | Yes | No | Yes | No | No |
| `MORPHO_GRS_DEFAULT_MODEL` | Yes | Yes | No | Yes | No | No |
| `MORPHO_GRS_IMAGE_MODEL` | Optional legacy fallback | Optional legacy fallback | No | Optional legacy fallback | No | No |
| `MORPHO_ALLOW_PAID_SMOKE_TESTS` | Yes, `false` | Yes, `false` | No | Yes, `false` | No | No |
| `MORPHO_AI_API_KEY` | Yes | Yes | No | No | Yes | No |
| `MORPHO_GRS_API_KEY` | Yes | Yes | No | No | Yes | No |

`AIJWS_API_KEY`, `AIJWS_BASE_URL`, and `AIJWS_MODEL` remain accepted compatibility aliases in the current server configuration. New Worker configuration should use the canonical `MORPHO_AI_*` names above. Never put either AI key in a `NEXT_PUBLIC_*` variable, a build variable, source code, documentation examples, or Git.

The production Agent Context Policy is fixed in `src/domain/morpho/agentContextPolicy.ts`. Legacy
`MORPHO_AI_CONTEXT_*` threshold variables are ignored by the runtime and must not be configured in
`.env.local`, `.dev.vars`, Workers Builds, or Cloudflare runtime settings.

Cloudflare separates build and runtime configuration. The two `NEXT_PUBLIC_SUPABASE_*` values are browser-safe, but the current Edge-compatible `middleware.ts` and server-side Supabase client also read them at Worker runtime, so they must be set in both places. The tldraw public key is only required at build time for the browser bundle.

## Build And Deployment Commands

```bash
npm.cmd run build
npm.cmd run cf:typegen
npm.cmd run cf:build
npm.cmd run cf:preview
npm.cmd run cf:deploy
```

Use `npm.cmd run build` for Vercel-compatible validation. `cf:deploy` runs `cf:build` first, then invokes OpenNext's Cloudflare deploy command.

## Local Preview Acceptance

With `MORPHO_ALLOW_PAID_SMOKE_TESTS=false`, verify the following in the local Wrangler/workerd preview:

1. `/login` renders and contains login and registration controls.
2. An unauthenticated request to `/` or a project route redirects to `/login?next=...`.
3. Static assets load and the tldraw client bundle loads.
4. Unauthenticated `POST` requests to `/api/ai/chat`, `/api/ai/agent/turns`, and `/api/ai/image` return `401`.
5. No page returns an unexpected `500`, and Wrangler reports no Node API, module-resolution, or bundle error.
6. Stop preview after verification so no local Worker process remains.

Do not create a permanent test account, print email addresses, or claim authenticated Supabase success without configured local values and a real user-controlled login. Do not call text or image AI during this smoke check without explicit authorization for paid use.

## Post-Deployment Acceptance

After the Worker is deployed and variables are configured, test:

- opening the home page without a proxy;
- registering a new account;
- logging out and back in;
- owner login;
- Supabase session cookie refresh;
- text AI;
- image AI;
- the tldraw license;
- PDF import;
- image import;
- reopening a project;
- editable backup export;
- access and behavior over China Telecom, China Unicom, China Mobile, and mobile networks;
- latency and stability at the `workers.dev` address.

## Rollback

If the Worker deployment fails, leave the Cloudflare files in the repository and continue using Vercel. Vercel still runs the unchanged `npm run build` command. No project data is moved, no Supabase migration is performed, and no Vercel setting is changed. Removing a failed Worker deployment is optional and does not require changes to the local project or Vercel deployment.
