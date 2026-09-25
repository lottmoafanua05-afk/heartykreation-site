// Intake endpoint: POST /api/intake
// One endpoint, three intakes, picked by `kind`:
//   website (/start)          - starter site from a template. Answers become a draft
//   webapp  (/start-web-app)  - custom web app scoping intake
//   artist  (/start-artist)   - artist, label, and touring act builds
// Web app and artist intakes are validated against the SPECS below and emailed
// to HK with the answers attached as JSON, plus a confirmation to the client.
//
// Website intake detail: receives the /start form, validates it, and turns the answers into a draft
// client file in the same shape as templates/_engine/clients/*.json, so a build
// starts from `python3 render.py clients/<slug>.json` once the copy is written.
//
// Sends two emails via Resend:
//   1. To HK: the readable intake plus the draft client JSON as an attachment.
//   2. To the client: a confirmation with a copy of their answers.
// Every intake (all three kinds) is also saved to Notion and texted to HK
// (email to the carrier's text gateway; Lott chose not to use Twilio).
// No npm dependencies, built-in fetch only.
//
// Required env vars (set in Vercel project settings):
//   RESEND_API_KEY       - secret API key from the Resend dashboard
// Optional:
//   CONTACT_TO_EMAIL     - inbox that receives intakes (default info@heartykreation.com)
//   CONTACT_FROM_EMAIL   - verified Resend sender (default info@heartykreation.com)
//   NOTION_TOKEN         - Notion internal integration secret (shared with /api/subscribe).
//                          The integration must be added to the intake database's Connections.
//   NOTION_INTAKE_DB_ID  - "HK Intakes: Website, Web App, Artist" in Business HQ,
//                          9fc2ff8285434f05ba981a809ed9fd42. Properties: Business (title),
//                          Kind, Template, Status (selects), Owner, Budget, Timeline, Domain,
//                          Summary (text), Email, Phone, Received (created time).
//                          Full answers go in the page body.
//   INTAKE_ALERT_SMS_EMAIL - carrier email-to-text address for Lott's phone, e.g.
//                          7755550100@vtext.com (Verizon) or @tmomail.net (T-Mobile).
//                          Comma separate to text more than one phone.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+\.\S+/i;
const TEMPLATES = { ember: 'Ember', ironworks: 'Ironworks', coastline: 'Coastline', unsure: 'Not sure yet' };
const SCHEMA_TYPES = { ember: 'Restaurant', ironworks: 'HomeAndConstructionBusiness', coastline: 'HealthAndBeautyBusiness' };
const CTA_ACTIONS = ['Call us', 'Book online', 'Get a quote', 'Order now', 'Send a message'];
const DOMAIN_STATUS = { have: 'Has a domain', need: 'Needs a domain', unsure: 'Not sure' };

function escapeHtml(str) {
  return String(str == null ? '' : str)
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
      if (data.length > 2e5) {
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

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function clean(body) {
  const v = {
    template: str(body.template, 20),
    brand_colors: str(body.brand_colors, 200),
    business_name: str(body.business_name, 120),
    business_type: str(body.business_type, 120),
    location: str(body.location, 160),
    elevator: str(body.elevator, 600),
    different: str(body.different, 800),
    headline: str(body.headline, 140),
    cta_action: str(body.cta_action, 40),
    cta_link: str(body.cta_link, 500),
    about: str(body.about, 1500),
    reviews_link: str(body.reviews_link, 500),
    public_phone: str(body.public_phone, 40),
    public_email: str(body.public_email, 200),
    address: str(body.address, 200),
    hours: str(body.hours, 500),
    instagram: str(body.instagram, 200),
    facebook: str(body.facebook, 200),
    tiktok: str(body.tiktok, 200),
    other_social: str(body.other_social, 200),
    domain_status: str(body.domain_status, 20),
    domain: str(body.domain, 200),
    assets_link: str(body.assets_link, 500),
    notes: str(body.notes, 2000),
    owner_name: str(body.owner_name, 120),
    owner_email: str(body.owner_email, 200),
    owner_phone: str(body.owner_phone, 40),
    confirm: body.confirm === true || body.confirm === 'yes',
  };
  v.services = (Array.isArray(body.services) ? body.services : [])
    .slice(0, 6)
    .map((s) => ({ name: str(s && s.name, 80), description: str(s && s.description, 220), price: str(s && s.price, 40) }))
    .filter((s) => s.name);
  v.reviews = (Array.isArray(body.reviews) ? body.reviews : [])
    .slice(0, 3)
    .map((r) => ({ text: str(r && r.text, 500), who: str(r && r.who, 60) }))
    .filter((r) => r.text);
  const rawStats = Array.isArray(body.stats) ? body.stats : [body.stat_1, body.stat_2, body.stat_3];
  v.stats = rawStats.slice(0, 3).map((s) => str(s, 60)).filter(Boolean);
  return v;
}

function validate(v) {
  const e = {};
  if (!TEMPLATES[v.template]) e.template = 'Pick a style, or choose "Not sure yet".';
  if (!v.business_name) e.business_name = 'Enter your business name.';
  if (!v.business_type) e.business_type = 'Tell us what kind of business it is.';
  if (!v.location) e.location = 'Enter your city or service area.';
  if (v.elevator.length < 15) e.elevator = 'A sentence or two here, please.';
  if (!v.services.length) e.services = 'Add at least one service or product.';
  if (!CTA_ACTIONS.includes(v.cta_action)) v.cta_action = 'Call us';
  if (v.cta_link && !URL_RE.test(v.cta_link)) e.cta_link = 'Enter a full link starting with https://';
  if (v.reviews_link && !URL_RE.test(v.reviews_link)) e.reviews_link = 'Enter a full link starting with https://';
  if (v.assets_link && !URL_RE.test(v.assets_link)) e.assets_link = 'Enter a full link starting with https://';
  if (v.public_email && !EMAIL_RE.test(v.public_email)) e.public_email = 'Check this email address.';
  if (!v.owner_name) e.owner_name = 'Enter your name.';
  if (!EMAIL_RE.test(v.owner_email)) e.owner_email = 'Enter a valid email.';
  if (!DOMAIN_STATUS[v.domain_status]) v.domain_status = 'unsure';
  if (!v.confirm) e.confirm = 'Please confirm to send.';
  return e;
}

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'client';
}

function socialUrl(kind, raw) {
  if (!raw) return '';
  if (URL_RE.test(raw)) return raw;
  const handle = raw.replace(/^@/, '').replace(/^(www\.)?(instagram|facebook|tiktok)\.com\//i, '');
  if (kind === 'Instagram') return 'https://instagram.com/' + handle;
  if (kind === 'Facebook') return 'https://facebook.com/' + handle;
  if (kind === 'TikTok') return 'https://tiktok.com/@' + handle;
  return /^[\w.-]+\.[a-z]{2,}/i.test(raw) ? 'https://' + raw : '';
}

function splitStat(s) {
  const m = s.match(/^([\d.,+%$]+(?:\s?(?:yrs?|years?|k|m|\+))?)\s+(.*)$/i);
  return m ? { value: m[1], label: m[2] } : { value: s, label: '' };
}

// Draft client file in the harness shape. Fields the writer still has to write
// are left as empty strings and listed in _todo; render.py refuses to build
// while any placeholder is empty, so nothing half-written can ship.
function buildClient(v) {
  const slug = slugify(v.business_name);
  const theme = v.template === 'unsure' ? '' : v.template;
  const cleanDomain = v.domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const phoneDigits = v.public_phone.replace(/[^0-9+]/g, '');
  let ctaHref = v.cta_link;
  if (!ctaHref && v.cta_action === 'Call us' && phoneDigits) ctaHref = 'tel:' + phoneDigits;
  if (!ctaHref) ctaHref = '#contact';

  const social = {};
  [['Instagram', v.instagram], ['Facebook', v.facebook], ['TikTok', v.tiktok], ['Link', v.other_social]].forEach(([k, raw]) => {
    const u = socialUrl(k, raw);
    if (u) social[k] = u;
  });

  const client = {
    slug,
    theme,
    demo: false,
    draft: true,
    business_name: v.business_name,
    title: `${v.business_name}: ${v.business_type} in ${v.location}`,
    meta_description: '',
    site_url: cleanDomain ? 'https://' + cleanDomain : '',
    schema_type: SCHEMA_TYPES[v.template] || 'LocalBusiness',
    services_nav_label: 'Services',
    hero_eyebrow: v.location,
    headline: v.headline,
    subhead: '',
    cta_label: v.cta_action,
    cta_href: ctaHref,
    secondary_cta_label: 'See services',
    hero_meta: [],
    services_eyebrow: 'Services',
    services_heading: '',
    services_intro: '',
    services: v.services.map((s) => ({ name: s.name, description: s.description, price: s.price })),
    about_eyebrow: 'About',
    about_heading: '',
    about_body: v.about ? v.about.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean) : [],
    stats: v.stats.map(splitStat),
    hours: v.hours ? v.hours.split(/\n/).map((h) => h.trim()).filter(Boolean) : [],
    proof_heading: '',
    reviews: v.reviews.map((r) => ({ text: r.text, who: r.who || 'Customer' })),
    contact_heading: '',
    phone: v.public_phone,
    email: v.public_email,
    address: v.address,
    social,
    form_button: 'Send',
    // The site's lead form must reach the client, not HK. FormSubmit emails the
    // address once to activate; forward that to the client or confirm it with them.
    form_endpoint: 'https://formsubmit.co/ajax/' + (v.public_email || v.owner_email),
  };
  if (theme === 'ironworks') {
    client.promises_heading = '';
    client.promises = [];
  }

  client._todo = [
    !theme && 'theme: client chose "Not sure yet"; recommend one of ember, ironworks, coastline',
    !client.headline && 'headline',
    'subhead', 'meta_description', 'hero_meta', 'services_heading', 'services_intro',
    'about_heading', 'proof_heading', 'contact_heading',
    !client.about_body.length && 'about_body',
    client.services.some((s) => !s.description) && 'services[].description for services left blank',
    theme === 'ironworks' && 'promises_heading and 3 to 4 promises (Ironworks checklist card)',
    'form_endpoint: confirm the lead form address with the client (FormSubmit sends a one time activation email)',
    !client.reviews.length && (v.reviews_link ? 'reviews: pull from reviews_link with client OK' : 'reviews: none provided, ask the client'),
  ].filter(Boolean);

  client._intake = {
    received: new Date().toISOString(),
    business_type: v.business_type,
    location: v.location,
    elevator: v.elevator,
    different: v.different,
    brand_colors: v.brand_colors,
    reviews_link: v.reviews_link,
    domain_status: DOMAIN_STATUS[v.domain_status],
    domain: cleanDomain,
    assets_link: v.assets_link,
    notes: v.notes,
    owner: { name: v.owner_name, email: v.owner_email, phone: v.owner_phone },
  };
  return client;
}

function summaryHtml(v) {
  const row = (k, val) => (val ? `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0">${escapeHtml(val).replace(/\n/g, '<br>')}</td></tr>` : '');
  const services = v.services.map((s) => `<li><strong>${escapeHtml(s.name)}</strong>${s.price ? ' (' + escapeHtml(s.price) + ')' : ''}${s.description ? ': ' + escapeHtml(s.description) : ''}</li>`).join('');
  const reviews = v.reviews.map((r) => `<li>"${escapeHtml(r.text)}" ${r.who ? '<em>' + escapeHtml(r.who) + '</em>' : ''}</li>`).join('');
  return `
    <table style="border-collapse:collapse;font-size:14px">
      ${row('Template', TEMPLATES[v.template])}
      ${row('Brand colors', v.brand_colors)}
      ${row('Business', v.business_name)}
      ${row('Type', v.business_type)}
      ${row('Area', v.location)}
      ${row('What they do', v.elevator)}
      ${row('What is different', v.different)}
      ${row('Headline idea', v.headline)}
      ${row('Main action', v.cta_action)}
      ${row('Action link', v.cta_link)}
      ${row('About', v.about)}
      ${row('Numbers', v.stats.join(' / '))}
      ${row('Reviews link', v.reviews_link)}
      ${row('Phone (public)', v.public_phone)}
      ${row('Email (public)', v.public_email)}
      ${row('Address', v.address)}
      ${row('Hours', v.hours)}
      ${row('Instagram', v.instagram)}
      ${row('Facebook', v.facebook)}
      ${row('TikTok', v.tiktok)}
      ${row('Other link', v.other_social)}
      ${row('Domain', DOMAIN_STATUS[v.domain_status] + (v.domain ? ': ' + v.domain : ''))}
      ${row('Logo and photos', v.assets_link)}
      ${row('Notes', v.notes)}
    </table>
    ${services ? '<p style="margin:16px 0 4px"><strong>Services</strong></p><ul>' + services + '</ul>' : ''}
    ${reviews ? '<p style="margin:16px 0 4px"><strong>Reviews</strong></p><ul>' + reviews + '</ul>' : ''}
  `;
}

const KIND_LABELS = { website: 'Website', webapp: 'Web app', artist: 'Artist' };

// Notion rich text objects hold at most 2000 characters each.
function richText(value) {
  const text = String(value == null ? '' : value);
  const out = [];
  for (let i = 0; i < text.length && out.length < 50; i += 1900) out.push({ type: 'text', text: { content: text.slice(i, i + 1900) } });
  return out;
}

// rec: { name, kind, template, owner, email, phone, budget, timeline, domain, summary, rows: [[label, value]] }
// Returns { ok: true, url } / { ok: false } / null when Notion is not configured. Never throws.
async function saveToNotion(rec) {
  // Vercel has this saved as Notion_Token; env names are case sensitive, so accept both.
  const token = process.env.NOTION_TOKEN || process.env.Notion_Token;
  const db = process.env.NOTION_INTAKE_DB_ID;
  if (!token || !db) return { ok: false, error: `not configured (token ${token ? 'set' : 'missing'}, database id ${db ? 'set' : 'missing'})` };
  const props = {
    Business: { title: richText(rec.name) },
    Kind: { select: { name: KIND_LABELS[rec.kind] || 'Website' } },
    Status: { select: { name: 'New' } },
    Owner: { rich_text: richText(rec.owner) },
    Email: { email: rec.email || null },
    Budget: { rich_text: richText(rec.budget) },
    Timeline: { rich_text: richText(rec.timeline) },
    Domain: { rich_text: richText(rec.domain) },
    Summary: { rich_text: richText(rec.summary) },
  };
  if (rec.template) props.Template = { select: { name: rec.template } };
  if (rec.phone) props.Phone = { phone_number: rec.phone };
  const children = [];
  rec.rows.filter(([, val]) => val).slice(0, 90).forEach(([label, val]) => {
    children.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: richText(label) } });
    children.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(val) } });
  });
  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: { database_id: db }, properties: props, children: children.slice(0, 100) }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error('Notion API error:', res.status, detail);
      let message = detail;
      try { message = JSON.parse(detail).message || detail; } catch (e) {}
      return { ok: false, error: `${res.status}: ${String(message).slice(0, 300)}` };
    }
    const page = await res.json().catch(() => ({}));
    return { ok: true, url: page.url || '' };
  } catch (err) {
    console.error('Notion write failed:', err);
    return { ok: false, error: String(err && err.message || err).slice(0, 300) };
  }
}

// Texts HK about a new intake by emailing the phone carrier's email-to-text
// address (for example 7755550100@vtext.com on Verizon, @tmomail.net on
// T-Mobile) through Resend. No Twilio. Never throws; returns true when sent.
async function textAlert(body) {
  const to = process.env.INTAKE_ALERT_SMS_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) {
    console.warn('INTAKE_ALERT_SMS_EMAIL is not set; no intake text sent.');
    return false;
  }
  const from = process.env.CONTACT_FROM_EMAIL || 'Hearty Kreation <info@heartykreation.com>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      // Carrier gateways turn the plain text body into the text message; keep it short.
      body: JSON.stringify({ from, to: to.split(',').map((x) => x.trim()).filter(Boolean), subject: 'HK intake', text: body.slice(0, 300) }),
    });
    if (!res.ok) {
      console.error('Intake text (email to SMS) failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Intake text (email to SMS) failed:', err);
    return false;
  }
}

function alertText(kindLabel, name, extra, owner, email, phone, notionUrl) {
  return [
    `New HK ${kindLabel.toLowerCase()} intake: ${name}${extra ? ' (' + extra + ')' : ''}`,
    `From ${owner}, ${email}${phone ? ', ' + phone : ''}`,
    notionUrl ? notionUrl : 'Details in your email.',
  ].join('\n');
}

function notionLine(notion) {
  if (!notion) return '';
  if (notion.ok) return `<p style="color:#555">Saved to Notion: ${notion.url ? `<a href="${escapeHtml(notion.url)}">open the page</a>` : 'yes'}</p>`;
  return `<p style="color:#b00">Not saved to Notion: ${escapeHtml(notion.error || 'unknown error')}</p>`;
}

function websiteRows(v) {
  return [
    ['Template', TEMPLATES[v.template]], ['Brand colors', v.brand_colors], ['Type of business', v.business_type], ['Area', v.location],
    ['What they do', v.elevator], ['What is different', v.different], ['Headline idea', v.headline],
    ['Services', v.services.map((x) => `${x.name}${x.price ? ' (' + x.price + ')' : ''}${x.description ? ': ' + x.description : ''}`).join('\n')],
    ['Main action', v.cta_action + (v.cta_link ? ': ' + v.cta_link : '')], ['About', v.about], ['Numbers', v.stats.join('\n')],
    ['Reviews', v.reviews.map((r) => `"${r.text}" ${r.who}`).join('\n')], ['Reviews link', v.reviews_link],
    ['Public phone', v.public_phone], ['Public email', v.public_email], ['Address', v.address], ['Hours', v.hours],
    ['Social', [v.instagram, v.facebook, v.tiktok, v.other_social].filter(Boolean).join('\n')],
    ['Domain', DOMAIN_STATUS[v.domain_status] + (v.domain ? ': ' + v.domain : '')], ['Logo and photos', v.assets_link], ['Notes', v.notes],
  ];
}

/* ---------- web app and artist intakes ---------- */
const SPECS = {
  webapp: {
    label: 'Web app',
    nameKey: 'project_name',
    required: ['project_name', 'app_type', 'problem', 'must_haves', 'timeline', 'budget', 'sensitive'],
    fields: [
      ['project_name', 'Business or organization', 120], ['app_type', 'Closest to', 60], ['problem', 'Problem and how it is handled today', 2000],
      ['current_tools', 'Current tools', 300], ['users', 'Users', 200, 'list'], ['user_count', 'How many users', 100],
      ['features', 'Features', 400, 'list'], ['must_haves', 'Day one must haves', 1500], ['integrations', 'Integrations', 300],
      ['data_desc', 'Data it holds', 1000], ['sensitive', 'Sensitive information', 60], ['devices', 'Devices', 100, 'list'],
      ['brand', 'Brand or website', 300], ['examples', 'Apps they like', 1000], ['timeline', 'Timeline', 60], ['budget', 'Budget', 60],
      ['phasing', 'Open to a smaller first version', 60], ['notes', 'Notes', 2000],
    ],
    messages: { problem: 'A few sentences here, please.', must_haves: 'List at least one must have.' },
    done: ['We review your answers and follow up with any questions.', 'We send a scope for a first version, with a price and timeline.', 'Once you approve, we design and build it with you.'],
  },
  artist: {
    label: 'Artist',
    nameKey: 'artist_name',
    required: ['artist_name', 'act_type', 'genre', 'needs', 'bio', 'budget', 'role'],
    fields: [
      ['artist_name', 'Artist or label', 120], ['act_type', 'Type', 60], ['genre', 'Genre', 120], ['home_base', 'Home base', 120],
      ['needs', 'Needs', 300, 'list'], ['bio', 'Story', 3000], ['highlights', 'Highlights', 2000], ['fans_of', 'Fans of', 200],
      ['tagline', 'Tagline', 140], ['spotify', 'Spotify', 300, 'url'], ['apple_music', 'Apple Music', 300, 'url'], ['youtube', 'YouTube', 300, 'url'],
      ['soundcloud', 'SoundCloud or Bandcamp', 300, 'url'], ['instagram', 'Instagram', 200], ['tiktok', 'TikTok', 200],
      ['featured_release', 'Featured release', 200], ['media_link', 'Photos and artwork', 500, 'url'], ['shows', 'Shows', 0, 'shows'],
      ['tour_link', 'Tour link', 300, 'url'], ['booking_email', 'Booking email', 200, 'email'], ['management', 'Management or label', 200],
      ['merch', 'Merch', 60], ['merch_link', 'Merch store', 300, 'url'], ['domain_status', 'Domain', 20], ['domain', 'Domain name', 200],
      ['deadline', 'Live by', 200], ['budget', 'Budget', 60], ['role', 'Role', 60], ['notes', 'Notes', 2000],
    ],
    messages: { needs: 'Pick at least one thing to build.', bio: 'A few sentences here, please.' },
    done: ['We review your music, links, and story.', 'We send a plan and price for your site, EPK, or store.', 'Once you approve, we write your copy and build it.'],
  },
};

function cleanGeneric(spec, body) {
  const v = {};
  spec.fields.forEach(([k, , max, type]) => {
    if (type === 'list') v[k] = (Array.isArray(body[k]) ? body[k] : []).slice(0, 20).map((x) => str(x, 80)).filter(Boolean);
    else if (type === 'shows') {
      v[k] = (Array.isArray(body[k]) ? body[k] : []).slice(0, 6)
        .map((r) => ({ date: str(r && r.date, 40), city: str(r && r.city, 80), venue: str(r && r.venue, 120), tickets: str(r && r.tickets, 500) }))
        .filter((r) => r.date);
    } else v[k] = str(body[k], max);
  });
  v.owner_name = str(body.owner_name, 120);
  v.owner_email = str(body.owner_email, 200);
  v.owner_phone = str(body.owner_phone, 40);
  v.confirm = body.confirm === true || body.confirm === 'yes';
  return v;
}

function validateGeneric(spec, v) {
  const e = {};
  spec.required.forEach((k) => {
    const val = v[k];
    if (!val || (Array.isArray(val) && !val.length)) e[k] = spec.messages[k] || 'This one is needed.';
  });
  spec.fields.forEach(([k, , , type]) => {
    if (type === 'url' && v[k] && !URL_RE.test(v[k])) e[k] = 'Enter a full link starting with https://';
    if (type === 'email' && v[k] && !EMAIL_RE.test(v[k])) e[k] = 'Check this email address.';
    if (type === 'shows') v[k].forEach((r) => { if (r.tickets && !URL_RE.test(r.tickets)) e[k] = 'Ticket links need to start with https://'; });
  });
  if (!v.owner_name) e.owner_name = 'Enter your name.';
  if (!EMAIL_RE.test(v.owner_email)) e.owner_email = 'Enter a valid email.';
  if (!v.confirm) e.confirm = 'Please confirm to send.';
  return e;
}

function genericSummary(spec, v) {
  const rows = spec.fields.map(([k, label, , type]) => {
    let val = v[k];
    if (type === 'list') val = val.join(', ');
    if (type === 'shows') val = val.map((r) => [r.date, r.city, r.venue, r.tickets].filter(Boolean).join(' / ')).join('\n');
    if (!val) return '';
    return `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0">${escapeHtml(val).replace(/\n/g, '<br>')}</td></tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;font-size:14px">${rows}</table>`;
}

function genericRows(spec, v) {
  return spec.fields.map(([k, label, , type]) => {
    let val = v[k];
    if (type === 'list') val = val.join(', ');
    if (type === 'shows') val = val.map((r) => [r.date, r.city, r.venue, r.tickets].filter(Boolean).join(' / ')).join('\n');
    return [label, val];
  });
}

async function handleGeneric(kind, body, res) {
  const spec = SPECS[kind];
  const v = cleanGeneric(spec, body);
  const errors = validateGeneric(spec, v);
  if (Object.keys(errors).length) {
    res.status(422).json({ ok: false, error: 'A few answers need another look.', fieldErrors: errors });
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured.');
    res.status(500).json({ ok: false, error: 'The intake form is not configured yet. Please email info@heartykreation.com.' });
    return;
  }
  const name = v[spec.nameKey];
  const slug = slugify(name);
  const summaryLine = kind === 'webapp' ? [v.app_type, (v.problem || '').slice(0, 300)].filter(Boolean).join(': ') : [v.act_type, v.genre, v.needs.join(', ')].filter(Boolean).join(' / ');
  const notion = await saveToNotion({
    name, kind, template: '', owner: v.owner_name + (v.role ? ' (' + v.role + ')' : ''), email: v.owner_email, phone: v.owner_phone,
    budget: v.budget, timeline: v.timeline || v.deadline || '', domain: v.domain || '', summary: summaryLine, rows: genericRows(spec, v),
  });
  const sms = textAlert(alertText(spec.label, name, v.budget, v.owner_name, v.owner_email, v.owner_phone, notion && notion.url));
  const toEmail = process.env.CONTACT_TO_EMAIL || 'info@heartykreation.com';
  const fromEmail = process.env.CONTACT_FROM_EMAIL || 'Hearty Kreation <info@heartykreation.com>';
  const summary = genericSummary(spec, v);
  const record = { kind, received: new Date().toISOString(), owner: { name: v.owner_name, email: v.owner_email, phone: v.owner_phone }, answers: { ...v } };
  delete record.answers.owner_name; delete record.answers.owner_email; delete record.answers.owner_phone; delete record.answers.confirm;

  const hkHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
      <h2 style="margin:0 0 4px">New ${escapeHtml(spec.label.toLowerCase())} intake: ${escapeHtml(name)}</h2>
      <p style="margin:0 0 16px;color:#555">From ${escapeHtml(v.owner_name)} &lt;${escapeHtml(v.owner_email)}&gt;${v.owner_phone ? ', ' + escapeHtml(v.owner_phone) : ''}</p>
      ${summary}
      <p style="margin-top:20px;color:#555">Full answers attached as ${escapeHtml(slug)}-${kind}.json.</p>
      ${notionLine(notion)}
    </div>`;
  const clientHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
      <p>Hi ${escapeHtml(v.owner_name.split(' ')[0])},</p>
      <p>Thanks for sending your intake for <strong>${escapeHtml(name)}</strong>. Here is what happens next:</p>
      <ol>${spec.done.map((d) => '<li>' + escapeHtml(d) + '</li>').join('')}</ol>
      <p>Want to add or change something? Just reply to this email.</p>
      <p style="margin-top:24px;color:#555"><strong>A copy of your answers:</strong></p>
      ${summary}
      <p style="margin-top:24px">Lott<br>Hearty Kreation<br><a href="https://heartykreation.com" style="color:#4a4a4a">heartykreation.com</a></p>
    </div>`;
  const send = (payload) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  try {
    const [hkRes, clientRes] = await Promise.all([
      send({
        from: fromEmail, to: [toEmail], reply_to: v.owner_email,
        subject: `New ${spec.label.toLowerCase()} intake: ${name}`,
        html: hkHtml,
        attachments: [{ filename: `${slug}-${kind}.json`, content: Buffer.from(JSON.stringify(record, null, 2)).toString('base64') }],
      }),
      send({ from: fromEmail, to: [v.owner_email], reply_to: toEmail, subject: `We got your intake: ${name}`, html: clientHtml }),
    ]);
    if (!hkRes.ok) {
      console.error('Resend API error (HK copy):', hkRes.status, await hkRes.text());
      res.status(502).json({ ok: false, error: 'Could not send your intake right now. Your answers are saved in this browser; please try again shortly.' });
      return;
    }
    if (!clientRes.ok) console.error('Resend API error (client copy):', clientRes.status, await clientRes.text());
    await sms;
    res.status(200).json({ ok: true, slug });
  } catch (err) {
    console.error('Intake send failed:', err);
    res.status(502).json({ ok: false, error: 'Could not send your intake right now. Your answers are saved in this browser; please try again shortly.' });
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

  // Honeypot: bots that fill the hidden field get a fake success and nothing is sent.
  if (body.website) {
    res.status(200).json({ ok: true });
    return;
  }

  const kind = String(body.kind || 'website');
  if (SPECS[kind]) {
    await handleGeneric(kind, body, res);
    return;
  }

  const v = clean(body);
  const errors = validate(v);
  if (Object.keys(errors).length) {
    res.status(422).json({ ok: false, error: 'A few answers need another look.', fieldErrors: errors });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured.');
    res.status(500).json({ ok: false, error: 'The intake form is not configured yet. Please email info@heartykreation.com.' });
    return;
  }

  const client = buildClient(v);
  const notion = await saveToNotion({
    name: v.business_name, kind: 'website', template: TEMPLATES[v.template], owner: v.owner_name, email: v.owner_email, phone: v.owner_phone,
    budget: '', timeline: '', domain: v.domain || DOMAIN_STATUS[v.domain_status], summary: `${v.business_type}, ${v.location}. ${v.elevator}`, rows: websiteRows(v),
  });
  const sms = textAlert(alertText('Website', v.business_name, TEMPLATES[v.template], v.owner_name, v.owner_email, v.owner_phone, notion && notion.url));
  const toEmail = process.env.CONTACT_TO_EMAIL || 'info@heartykreation.com';
  const fromEmail = process.env.CONTACT_FROM_EMAIL || 'Hearty Kreation <info@heartykreation.com>';
  const summary = summaryHtml(v);

  const hkHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
      <h2 style="margin:0 0 4px">New website intake: ${escapeHtml(v.business_name)}</h2>
      <p style="margin:0 0 16px;color:#555">From ${escapeHtml(v.owner_name)} &lt;${escapeHtml(v.owner_email)}&gt;${v.owner_phone ? ', ' + escapeHtml(v.owner_phone) : ''}</p>
      ${summary}
      <p style="margin-top:20px"><strong>Build file:</strong> ${escapeHtml(client.slug)}.json is attached. Drop it in templates/_engine/clients/, write the fields listed in <code>_todo</code>, remove <code>draft</code>, <code>_todo</code> and <code>_intake</code>, then run <code>python3 render.py clients/${escapeHtml(client.slug)}.json</code>.</p>
      ${notionLine(notion)}
    </div>`;

  const clientHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
      <p>Hi ${escapeHtml(v.owner_name.split(' ')[0])},</p>
      <p>Thanks for sending your intake for <strong>${escapeHtml(v.business_name)}</strong>. Here is what happens next:</p>
      <ol>
        <li>We write your site copy from your answers.</li>
        <li>We build your first version in the ${escapeHtml(TEMPLATES[v.template])} style${v.template === 'unsure' ? ' (we will recommend a style first)' : ''}.</li>
        <li>We connect your domain and send you the link to review.</li>
      </ol>
      <p>If anything is missing, I will email you. Want to add or change something? Just reply to this email.</p>
      <p style="margin-top:24px;color:#555"><strong>A copy of your answers:</strong></p>
      ${summary}
      <p style="margin-top:24px">Lott<br>Hearty Kreation<br><a href="https://heartykreation.com" style="color:#4a4a4a">heartykreation.com</a></p>
    </div>`;

  const send = (payload) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  try {
    const [hkRes, clientRes] = await Promise.all([
      send({
        from: fromEmail,
        to: [toEmail],
        reply_to: v.owner_email,
        subject: `New website intake: ${v.business_name} (${TEMPLATES[v.template]})`,
        html: hkHtml,
        attachments: [{ filename: `${client.slug}.json`, content: Buffer.from(JSON.stringify(client, null, 2)).toString('base64') }],
      }),
      send({
        from: fromEmail,
        to: [v.owner_email],
        reply_to: toEmail,
        subject: `We got your website intake: ${v.business_name}`,
        html: clientHtml,
      }),
    ]);

    if (!hkRes.ok) {
      console.error('Resend API error (HK copy):', hkRes.status, await hkRes.text());
      res.status(502).json({ ok: false, error: 'Could not send your intake right now. Your answers are saved in this browser; please try again shortly.' });
      return;
    }
    if (!clientRes.ok) console.error('Resend API error (client copy):', clientRes.status, await clientRes.text());

    await sms;
    res.status(200).json({ ok: true, slug: client.slug });
  } catch (err) {
    console.error('Intake send failed:', err);
    res.status(502).json({ ok: false, error: 'Could not send your intake right now. Your answers are saved in this browser; please try again shortly.' });
  }
};
