# Hearty Kreation

Static homepage + blog for heartykreation.com. Plain HTML, no framework. Tailwind CSS
is compiled at build time (Tailwind v4). The serverless functions in `api/` are
dependency-free CommonJS.

## CSS

Tailwind is compiled from two entry files into two stylesheets:

| Entry | Output | Used by |
| --- | --- | --- |
| `src/input.css` | `dist/site.css` | `index.html`, `privacy.html`, `terms.html` |
| `src/blog.css` | `dist/blog.css` | `blog/index.html`, `blog/*.html` posts |

They are deliberately separate. The blog is a different design system that reuses the
custom-property names `--ink`, `--panel` and `--line` with completely different values,
and maps `.font-display` to Space Grotesk rather than Fraunces. A single `:root` would
break one theme or the other.

Build both:

```
npm install
npm run build
```

Rebuild on change while working: `npm run watch` (or `npm run watch:blog`).

`dist/` is generated and git-ignored — Vercel builds it on deploy. Because the pages
link `/dist/site.css` by absolute path, **opening `index.html` from the filesystem no
longer works**; use the local preview below.

Each entry file carries a short "v3 parity" section restoring behaviour that changed
between the old Tailwind v3 CDN and v4 (button cursor, the responsive font-size /
line-height pairing, and the blog's pinned zinc shades). Those blocks are what keep the
rendering identical to the pre-build site — read the comments before touching them.

## Local preview

```
npm run build && npx serve .
```

## Deploy

Pushing to `main` deploys automatically via the connected Vercel project.

`vercel.json` pins `buildCommand` to `npm run build`, `framework` to `null`, and
`outputDirectory` to `"."`.

`outputDirectory` is **required**. Before this project had a build step, Vercel served
the repo root by zero-config. Once a `buildCommand` exists it stops doing that and looks
for an output directory, defaulting to `public/` — which does not exist here, so the
build fails with *"No Output Directory named public found after the Build completed."*
Setting it to `"."` keeps the repo root as the served output. Verified with a local
`vercel build`: `dist/` lands in the static output even though it is gitignored, and
`api/*.js` still compiles to serverless functions.

Node is pinned to 22.x via `engines` and `.nvmrc`. That is Vercel's supported default
and also the runtime for `api/*.js`; the build output is byte-identical on 22 and 24.

### Blocked paths

`outputDirectory: "."` publishes the repo root, so everything committed is web-reachable
unless something shadows it. `vercel.json` blocks twelve paths:

| Path | Why |
| --- | --- |
| `/drafts`, `/drafts/*` | `pending.json` holds the next post's title, slug and excerpt between generation and approval — unpublished content |
| `/.github/*` | `generate-post.mjs` contains the full AI pipeline: system prompt, model, CTA URL, and the names of every Anthropic and Twilio secret |
| `/src/*` | Tailwind sources |
| `/scripts/*` | build guard |
| `/README.md` | documents the approval flow, the `drafts` branch, and the required secret names |
| `/vercel.json`, `/.gitignore`, `/.nvmrc`, `/.vercelignore` | config surface |

They are **`redirects`, not `routes` or `rewrites`**, and the choice is forced:

- `routes` is legacy and cannot coexist with `cleanUrls`, which this file uses. Adopting
  it would mean hand-reimplementing the clean-URL behaviour.
- `rewrites` are a *fallback*, evaluated only after the filesystem check. These paths are
  real files, so they would be served before a rewrite ever ran.
- `redirects` are evaluated *before* the filesystem, so they are the only modern-config
  mechanism that can shadow a file that exists.

They return **307 to `/`, not 404**. Content is fully blocked — following the redirect
returns the homepage — but the 307 does reveal that a path is special-cased. A true 404
would require legacy `routes`, and that trade is not worth losing `cleanUrls` over.

`/api/*.js` needs no entry: Vercel already 308s it to the function ahead of the
filesystem, so the source is never served. `package.json` and `package-lock.json` are
stripped from the static output by Vercel automatically.

When adding a new top-level non-web file or directory, add a matching redirect here.

Note the root `package.json` must **not** declare `"type": "module"` — `api/contact.js`
and `api/approve.js` are CommonJS and would fail to load as ES modules.

`npm run build` ends with `scripts/check-build.mjs`, which exits non-zero if either
stylesheet is missing or under 5 KB, so a silently empty build cannot deploy green.

## Blog

Plain HTML posts live in `blog/`. To add one by hand: copy `blog/welcome-to-the-blog.html`,
edit it, then add a matching card to `blog/index.html` just below the
`NEW-POSTS-INSERT-HERE` marker comment.

Post markup should stick to classes already used elsewhere in `blog/`. `dist/blog.css`
only contains the utilities found by scanning `blog/**/*.html` and `api/approve.js`, so
a brand-new utility class introduced by hand will not have any CSS until the next build.

### Automated daily draft pipeline

`.github/workflows/daily-blog.yml` runs daily, generates a draft via the Anthropic API,
commits it to the `drafts` branch, and texts the owner for a YES/NO approval via Twilio.
`api/approve.js` (a Vercel function) handles the reply: YES publishes the draft to `main`
and adds it to the blog listing; NO discards it.

Required GitHub Actions secrets: `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_TO_NUMBER`, `GH_PAT`.

Required Vercel env vars: `TWILIO_AUTH_TOKEN`, `TWILIO_TO_NUMBER`, `GITHUB_TOKEN`,
`GITHUB_REPO`.

The `drafts` branch must exist before the first scheduled run (branch off `main` after
this pipeline is merged).
