# Hearty Kreation

Static homepage + blog for heartykreation.com. Plain HTML with Tailwind CSS via CDN — no build step, no framework. The one exception is `api/approve.js`, a single dependency-free Node serverless function used by the blog pipeline below.

## Local preview

Open `index.html` directly in a browser, or serve it:

```
npx serve .
```

## Deploy

Pushing to `main` deploys automatically via the connected Vercel project.

## Blog

Plain HTML posts live in `blog/`. To add one by hand: copy `blog/welcome-to-the-blog.html`,
edit it, then add a matching card to `blog/index.html` just below the
`NEW-POSTS-INSERT-HERE` marker comment.

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
