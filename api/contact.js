// Native contact form endpoint: POST /api/contact
// Validates the submission server-side, then sends a notification email via
// the Resend API (https://resend.com). No npm dependencies — built-in fetch only.
//
// Required env vars (set in Vercel project settings):
//   RESEND_API_KEY   - secret API key from the Resend dashboard
//   CONTACT_TO_EMAIL - inbox that should receive submissions (defaults to info@heartykreation.com)
//   CONTACT_FROM_EMAIL - verified sending address in Resend (defaults to
//                        info@heartykreation.com, which requires the
//                        heartykreation.com domain to be verified in Resend)

const PROJECT_TYPES = [
  'Website Design',
  'Website Development',
  'E-Commerce',
  'Branding',
  'SEO & Marketing',
  'Website Maintenance',
  'Other',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function validate(fields) {
  const errors = {};
  const name = String(fields.name || '').trim();
  const email = String(fields.email || '').trim();
  const organization = String(fields.organization || '').trim();
  const projectType = String(fields.projectType || '').trim();
  const message = String(fields.message || '').trim();

  if (!name || name.length > 200) errors.name = 'Enter your name.';
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (organization.length > 200) errors.organization = 'Organization name is too long.';
  if (!projectType || !PROJECT_TYPES.includes(projectType)) errors.projectType = 'Select a project type.';
  if (!message || message.length < 10 || message.length > 5000) {
    errors.message = 'Message must be between 10 and 5000 characters.';
  }

  return { errors, values: { name, email, organization, projectType, message } };
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

  // Honeypot: real visitors never fill this hidden field in. Bots that do get a
  // fake success response so they don't learn the check exists, and nothing is sent.
  if (body.website) {
    res.status(200).json({ ok: true });
    return;
  }

  const { errors, values } = validate(body);
  if (Object.keys(errors).length > 0) {
    res.status(422).json({ ok: false, error: 'Please fix the highlighted fields.', fieldErrors: errors });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured.');
    res.status(500).json({ ok: false, error: 'Contact form is not configured yet. Please email us directly.' });
    return;
  }

  const toEmail = process.env.CONTACT_TO_EMAIL || 'info@heartykreation.com';
  const fromEmail = process.env.CONTACT_FROM_EMAIL || 'Hearty Kreation Website <info@heartykreation.com>';

  const html = `
    <h2>New project inquiry from heartykreation.com</h2>
    <p><strong>Name:</strong> ${escapeHtml(values.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(values.email)}</p>
    <p><strong>Organization:</strong> ${escapeHtml(values.organization) || '(not provided)'}</p>
    <p><strong>Project type:</strong> ${escapeHtml(values.projectType)}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(values.message).replace(/\n/g, '<br>')}</p>
  `;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        reply_to: values.email,
        subject: `New inquiry: ${values.projectType} — ${values.name}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error('Resend API error:', resendRes.status, detail);
      res.status(502).json({ ok: false, error: 'Could not send your message right now. Please try again shortly.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact form send failed:', err);
    res.status(502).json({ ok: false, error: 'Could not send your message right now. Please try again shortly.' });
  }
};
