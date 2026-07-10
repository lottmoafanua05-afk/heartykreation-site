// Twilio webhook: POST /api/approve
// Handles the owner's YES/NO reply to the daily draft-post SMS.
//
// YES: reads drafts/pending.json + the pending draft HTML from the `drafts`
//      branch (GitHub Contents API), commits the post to `blog/{slug}.html`
//      on `main`, prepends a listing card to `blog/index.html` on `main`,
//      and clears drafts/pending.json.
// NO:  clears drafts/pending.json.
//
// No npm dependencies — built-in Node APIs only (fetch, crypto).

const crypto = require('crypto');

const GITHUB_API = 'https://api.github.com';
const INSERT_MARKER =
  '<!-- NEW-POSTS-INSERT-HERE: automated and manual posts both go directly below this line, newest first -->';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(Object.fromEntries(new URLSearchParams(data)));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function validateTwilioSignature(req, authToken, params) {
  const signature = req.headers['x-twilio-signature'];
  if (!signature || !authToken) return false;

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `https://${host}${req.url}`;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function ghGetFile(repo, path, ref, token) {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path}@${ref} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return {
    sha: json.sha,
    content: Buffer.from(json.content, 'base64').toString('utf8'),
  };
}

async function ghPutFile(repo, path, { content, message, branch, sha }, token) {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path}@${branch} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function buildCard(pending) {
  return `\n    <a href="/blog/${pending.slug}.html" class="sys-card rounded-xl p-8 block">\n      <div class="tag inline-block px-2 py-1 rounded mb-4 font-mono">${escapeHtml(pending.date_tag || '')}</div>\n      <h2 class="font-display font-semibold text-2xl mb-2">${escapeHtml(pending.title)}</h2>\n      <p class="text-zinc-400 text-sm leading-relaxed">\n        ${escapeHtml(pending.excerpt)}\n      </p>\n    </a>\n`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const { TWILIO_AUTH_TOKEN, TWILIO_TO_NUMBER, GITHUB_TOKEN, GITHUB_REPO, SKIP_TWILIO_SIGNATURE_CHECK } = process.env;

  const params = req.body && typeof req.body === 'object' && Object.keys(req.body).length
    ? req.body
    : await parseRawBody(req);

  const respond = (message, status = 200) => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
    res.status(status).setHeader('Content-Type', 'text/xml').send(xml);
  };

  if (SKIP_TWILIO_SIGNATURE_CHECK !== 'true') {
    if (!validateTwilioSignature(req, TWILIO_AUTH_TOKEN, params)) {
      console.error('Rejected: invalid Twilio signature');
      res.status(403).setHeader('Content-Type', 'text/xml').send('<Response></Response>');
      return;
    }
  }

  const from = (params.From || '').trim();
  if (TWILIO_TO_NUMBER && from !== TWILIO_TO_NUMBER) {
    console.error(`Rejected: unauthorized sender ${from}`);
    res.status(403).setHeader('Content-Type', 'text/xml').send('<Response></Response>');
    return;
  }

  const body = (params.Body || '').trim().toUpperCase();

  try {
    if (body === 'YES') {
      const pendingFile = await ghGetFile(GITHUB_REPO, 'drafts/pending.json', 'drafts', GITHUB_TOKEN);
      const pending = pendingFile ? JSON.parse(pendingFile.content || '{}') : {};

      if (!pending.filename || !pending.slug) {
        respond('Nothing pending to publish right now.');
        return;
      }

      const draft = await ghGetFile(GITHUB_REPO, `drafts/${pending.filename}`, 'drafts', GITHUB_TOKEN);
      if (!draft) {
        respond('Could not find the pending draft file. Check the repo.');
        return;
      }

      const blogPath = `blog/${pending.slug}.html`;
      const existingPost = await ghGetFile(GITHUB_REPO, blogPath, 'main', GITHUB_TOKEN);
      await ghPutFile(
        GITHUB_REPO,
        blogPath,
        {
          content: draft.content,
          message: `Publish blog post: ${pending.title}`,
          branch: 'main',
          sha: existingPost ? existingPost.sha : undefined,
        },
        GITHUB_TOKEN
      );

      const indexFile = await ghGetFile(GITHUB_REPO, 'blog/index.html', 'main', GITHUB_TOKEN);
      if (!indexFile || !indexFile.content.includes(INSERT_MARKER)) {
        throw new Error('Insert marker not found in blog/index.html on main');
      }
      const updatedIndex = indexFile.content.replace(INSERT_MARKER, `${INSERT_MARKER}\n${buildCard(pending)}`);
      await ghPutFile(
        GITHUB_REPO,
        'blog/index.html',
        {
          content: updatedIndex,
          message: `Add "${pending.title}" to blog index`,
          branch: 'main',
          sha: indexFile.sha,
        },
        GITHUB_TOKEN
      );

      await ghPutFile(
        GITHUB_REPO,
        'drafts/pending.json',
        {
          content: '{}\n',
          message: 'Clear pending draft after publish',
          branch: 'drafts',
          sha: pendingFile ? pendingFile.sha : undefined,
        },
        GITHUB_TOKEN
      );

      respond(`Published. Live at heartykreation.com/blog/${pending.slug}`);
      return;
    }

    if (body === 'NO') {
      const pendingFile = await ghGetFile(GITHUB_REPO, 'drafts/pending.json', 'drafts', GITHUB_TOKEN);
      await ghPutFile(
        GITHUB_REPO,
        'drafts/pending.json',
        {
          content: '{}\n',
          message: 'Clear skipped draft',
          branch: 'drafts',
          sha: pendingFile ? pendingFile.sha : undefined,
        },
        GITHUB_TOKEN
      );
      respond('Skipped. A new post will generate tomorrow.');
      return;
    }

    respond('Reply YES to publish or NO to skip.');
  } catch (err) {
    console.error(err);
    respond('Something went wrong publishing. Check Vercel logs.');
  }
};
