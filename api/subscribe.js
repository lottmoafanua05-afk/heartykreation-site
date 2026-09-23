// Lead magnet capture endpoint: POST /api/subscribe
// Captures an email in exchange for the free DIY website guide PDF, stores the
// lead in Notion, emails the download link via Resend, and notifies HK.
// No npm dependencies, built-in fetch only.
//
// Required env vars (set in Vercel project settings):
//   RESEND_API_KEY      - secret API key from the Resend dashboard
//   NOTION_TOKEN        - Notion internal integration secret
//   NOTION_LEADS_DB_ID  - id of the "HK Leads: DIY Guide Downloads" database
// Optional:
//   CONTACT_TO_EMAIL    - inbox notified of each new lead (default info@heartykreation.com)
//   CONTACT_FROM_EMAIL  - verified Resend sender (default info@heartykreation.com)
//   GUIDE_DOWNLOAD_URL  - PDF location (default /downloads/hk-diy-website-guide.pdf)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCES = ['DIY guide page', 'Website health audit', 'Contact form', 'Other'];
const SITE = 'https://heartykreation.com';
const DEFAULT_PATH = '/downloads/hk-diy-website-guide.pdf';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Stores the lead in Notion. Never throws: a Notion outage must not stop the
// visitor getting the guide they asked for.
async function saveToNotion(values) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_LEADS_DB_ID;
  if (!token || !databaseId) {
    console.warn('Notion is not configured; lead saved to email only:', values.email);
    return false;
  }

  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          Email: { title: [{ text: { content: values.email } }] },
          'First name': values.name
            ? { rich_text: [{ text: { content: values.name } }] }
            : { rich_text: [] },
          Source: { select: { name: values.source } },
          Status: { select: { name: 'New' } },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('Notion API error:', res.status, detail);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Notion write failed:', err);
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.status(400).json({ ok: false, error: 'Malformed request body.' });
    return;
  }

  // Honeypot: real visitors leave this hidden field blank. Bots that fill it get
  // a fake success so they do not learn the check exists, and nothing is stored.
  if (body.website) {
    res.status(200).json({ ok: true });
    return;
  }

  const email = String(body.email || '').trim();
  const name = String(body.name || '').trim().slice(0, 100);
  const rawSource = String(body.source || '').trim();
  const source = SOURCES.includes(rawSource) ? rawSource : 'Other';

  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    res.status(422).json({ ok: false, error: 'Enter a valid email address.', fieldErrors: { email: 'Enter a valid email address.' } });
    return;
  }

  const downloadUrl = process.env.GUIDE_DOWNLOAD_URL || SITE + DEFAULT_PATH;
  const values = { email, name, source };

  const saved = await saveToNotion(values);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured.');
    // The lead may still be stored, and the visitor can use the on-page link.
    res.status(200).json({ ok: true, downloadUrl, emailed: false });
    return;
  }

  const toEmail = process.env.CONTACT_TO_EMAIL || 'info@heartykreation.com';
  const fromEmail = process.env.CONTACT_FROM_EMAIL || 'Hearty Kreation <info@heartykreation.com>';
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';

  const guideHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
      <p>${greeting}</p>
      <p>Here is your copy of <strong>Build Your Own Small Business Website</strong>, the full nine step guide.</p>
      <p><a href="${downloadUrl}" style="display:inline-block;background:#D8FF3E;color:#0B0B0C;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:999px">Download the guide</a></p>
      <p>Work through it in order. Steps 2 and 8, buying the domain and connecting it, are where most people lose an evening, so take those slowly.</p>
      <p>If you get partway through and decide you would rather hand it off, we build single page sites from a short form, starting at seventy five dollars, live within twenty four hours of your domain being connected. Just reply to this email and I will send the details.</p>
      <p>Lott<br>Hearty Kreation<br><a href="${SITE}" style="color:#4a4a4a">heartykreation.com</a></p>
    </div>
  `;

  const notifyHtml = `
    <h2>New guide download</h2>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Name:</strong> ${escapeHtml(name) || '(not provided)'}</p>
    <p><strong>Source:</strong> ${escapeHtml(source)}</p>
    <p><strong>Saved to Notion:</strong> ${saved ? 'yes' : 'no, check the logs'}</p>
  `;

  try {
    const send = (payload) =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

    const [guideRes] = await Promise.all([
      send({
        from: fromEmail,
        to: [email],
        reply_to: toEmail,
        subject: 'Your free guide: Build Your Own Small Business Website',
        html: guideHtml,
      }),
      send({
        from: fromEmail,
        to: [toEmail],
        subject: `New guide download: ${email}`,
        html: notifyHtml,
      }),
    ]);

    if (!guideRes.ok) {
      const detail = await guideRes.text();
      console.error('Resend API error:', guideRes.status, detail);
      // The visitor still gets the on-page download link.
      res.status(200).json({ ok: true, downloadUrl, emailed: false });
      return;
    }

    res.status(200).json({ ok: true, downloadUrl, emailed: true });
  } catch (err) {
    console.error('Guide send failed:', err);
    res.status(200).json({ ok: true, downloadUrl, emailed: false });
  }
};
