// Generates today's draft blog post via the Anthropic API, writes it to
// drafts/YYYY-MM-DD-{slug}.html using blog/_post-template.html, updates
// drafts/pending.json, and texts the owner for approval.
//
// Runs inside .github/workflows/daily-blog.yml on the `drafts` branch.
// No npm dependencies — uses only built-in Node APIs (fetch, fs, crypto-free).

import fs from 'node:fs';

const {
  ANTHROPIC_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
  TWILIO_TO_NUMBER,
  GITHUB_REPOSITORY, // auto-provided by GitHub Actions, e.g. "owner/repo"
} = process.env;

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const CTA_URL = 'https://tally.so/r/VLQGEN';

const TOPICS = [
  'web design tips',
  'business systems',
  'digital presence',
  'artist/musician digital tools',
  'what to expect working with an agency',
  'pricing and ROI of good web work',
];

const SYSTEM_PROMPT = `You write blog posts for Hearty Kreation, a web design and business systems agency based in Nevada serving small businesses, artists, musicians, consultants, and entrepreneurs. Voice: warm, professional casual, no em dashes, beginner-accessible. Posts are 250-300 words. Always end with a single call to action linking to https://tally.so/r/VLQGEN. Return ONLY valid JSON, no markdown code fences, no commentary before or after. Fields: title, slug, audience, excerpt (1 sentence), body (full post in plain paragraphs separated by blank lines, use **bold** for emphasis), cta_text.`;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function todayTopic() {
  const start = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  const now = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const dayOfYear = Math.floor((now - start) / 86400000);
  return TOPICS[dayOfYear % TOPICS.length];
}

function slugify(input) {
  const slug = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'post';
}

function dateTag(date = new Date()) {
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function generatePost(topic) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': requireEnv('ANTHROPIC_API_KEY', ANTHROPIC_API_KEY),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Write today's post. Topic for today: ${topic}. Return only the JSON object described in the system prompt.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const raw = (data.content?.[0]?.text || '').trim();
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse model output as JSON: ${err.message}\nRaw output:\n${raw}`);
  }

  for (const field of ['title', 'slug', 'excerpt', 'body', 'cta_text']) {
    if (!parsed[field]) throw new Error(`Model output missing required field: ${field}`);
  }
  return parsed;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bodyToHtml(body) {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const escaped = escapeHtml(p);
      const bolded = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return `      <p>${bolded}</p>`;
    })
    .join('\n');
}

async function fetchTemplate() {
  const url = `https://raw.githubusercontent.com/${requireEnv('GITHUB_REPOSITORY', GITHUB_REPOSITORY)}/main/blog/_post-template.html`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch post template from ${url}: ${res.status}`);
  return res.text();
}

function renderPost(template, post, tag) {
  return template
    .replaceAll('{{TITLE}}', escapeHtml(post.title))
    .replaceAll('{{DATE_TAG}}', escapeHtml(tag))
    .replaceAll('{{BODY_HTML}}', bodyToHtml(post.body))
    .replaceAll('{{CTA_URL}}', CTA_URL)
    .replaceAll('{{CTA_TEXT}}', escapeHtml(post.cta_text));
}

async function sendSms(message) {
  const accountSid = requireEnv('TWILIO_ACCOUNT_SID', TWILIO_ACCOUNT_SID);
  const authToken = requireEnv('TWILIO_AUTH_TOKEN', TWILIO_AUTH_TOKEN);
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const params = new URLSearchParams({
    To: requireEnv('TWILIO_TO_NUMBER', TWILIO_TO_NUMBER),
    From: requireEnv('TWILIO_FROM_NUMBER', TWILIO_FROM_NUMBER),
    Body: message,
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Twilio send failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const topic = todayTopic();
  console.log(`Generating post for topic: ${topic}`);

  const post = await generatePost(topic);
  const slug = slugify(post.slug || post.title);
  const tag = dateTag();
  const date = isoDate();
  const filename = `${date}-${slug}.html`;

  const template = await fetchTemplate();
  const html = renderPost(template, post, tag);

  fs.mkdirSync('drafts', { recursive: true });
  fs.writeFileSync(`drafts/${filename}`, html, 'utf8');

  const pending = {
    filename,
    slug,
    title: post.title,
    excerpt: post.excerpt,
    date_tag: tag,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync('drafts/pending.json', JSON.stringify(pending, null, 2) + '\n', 'utf8');

  console.log(`Draft written: drafts/${filename}`);

  const smsBody = `${post.title}\n\n${post.excerpt}\n\nReply YES to publish or NO to skip.`;
  await sendSms(smsBody);
  console.log('SMS sent.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
