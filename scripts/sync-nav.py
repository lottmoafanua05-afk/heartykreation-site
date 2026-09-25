#!/usr/bin/env python3
"""Rewrite the <nav> and footer bottom bar on every HK page with the shared nav below.
Keeps each page's own call-to-action button and container width.
Usage: python3 scripts/sync-nav.py"""
import re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = ["index.html", "start.html", "start-web-app.html", "start-artist.html",
         "diy-website-guide.html", "privacy.html", "terms.html", "templates/index.html"] + \
        sorted(str(p.relative_to(ROOT)) for p in (ROOT / "blog").glob("*.html"))
CHEV = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 3.5l3 3 3-3"/></svg>'
NAV = '''<link rel="stylesheet" href="/css/nav.css">
<nav id="site-nav" class="fixed top-0 w-full z-50 backdrop-blur bg-[#0B0B0C]/85 border-b border-[var(--line)]">
  <div class="{WIDTH} mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
    <a href="/" class="font-display font-semibold text-base sm:text-lg tracking-tight whitespace-nowrap flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-[var(--acid)]"></span>
      HEARTY KREATION
    </a>
    <div class="hk-links">
      <div class="hk-dd">
        <button type="button" aria-expanded="false" aria-haspopup="true">Services {CHEV}</button>
        <div class="hk-panel">
          <a href="/templates">Websites<small>Landing pages from $75</small></a>
          <a href="/#web-apps">Web Apps<small>Custom tools and dashboards</small></a>
          <a href="/#artists">Artists &amp; Labels<small>Sites for music acts</small></a>
          <a href="/#services">All services</a>
        </div>
      </div>
      <a href="/#builds">Work</a>
      <div class="hk-dd">
        <button type="button" aria-expanded="false" aria-haspopup="true">Resources {CHEV}</button>
        <div class="hk-panel">
          <a href="/blog/">Blog<small>Notes from the work</small></a>
          <a href="/diy-website-guide">Free DIY Guide<small>Build your own site</small></a>
        </div>
      </div>
      <a href="/#about">About</a>
    </div>
    <div class="flex items-center gap-2">
      {CTA}
      <button type="button" class="hk-burger" aria-label="Open menu" aria-expanded="false" aria-controls="hk-mobile"><span></span><span></span><span></span></button>
    </div>
  </div>
  <div id="hk-mobile" class="hk-mobile">
    <a href="/">Home</a>
    <div class="hk-group">Services</div>
    <a href="/templates">Websites from $75</a>
    <a href="/#web-apps">Web Apps</a>
    <a href="/#artists">Artists &amp; Labels</a>
    <div class="hk-group">Company</div>
    <a href="/#builds">Work</a>
    <a href="/#about">About</a>
    <a href="/#contact">Contact</a>
    <div class="hk-group">Resources</div>
    <a href="/blog/">Blog</a>
    <a href="/diy-website-guide">Free DIY Guide</a>
  </div>
</nav>
<script src="/js/nav.js" defer></script>'''
NAV_RE = re.compile(r'(?:<link rel="stylesheet" href="/css/nav.css">\n)?<nav\b.*?</nav>(?:\n<script src="/js/nav.js" defer></script>)?', re.S)
CTA_RE = re.compile(r'<a [^>]*class="btn-(?:primary|outline)[^"]*"[^>]*>.*?</a>', re.S)
for rel in PAGES:
    p = ROOT / rel
    s = p.read_text()
    m = NAV_RE.search(s)
    if not m:
        print("no nav:", rel); continue
    old = m.group(0)
    cta = CTA_RE.search(old)
    width = re.search(r'max-w-\w+', old)
    new = NAV.replace("{CHEV}", CHEV).replace("{WIDTH}", width.group(0) if width else "max-w-6xl") \
             .replace("{CTA}", cta.group(0) if cta else "")
    if new != old:
        p.write_text(s[:m.start()] + new + s[m.end():])
        print("updated:", rel)

# ---------- footer bottom bar ----------
FB = '<path d="M22 12.06C22 6.53 17.52 2.04 12 2.04S2 6.53 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94Z"/>'
IG = '<path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.97.24 2.43.4a4.9 4.9 0 0 1 1.77 1.15 4.9 4.9 0 0 1 1.15 1.77c.16.46.35 1.26.4 2.43.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.24 1.97-.4 2.43a4.9 4.9 0 0 1-1.15 1.77 4.9 4.9 0 0 1-1.77 1.15c-.46.16-1.26.35-2.43.4-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.97-.24-2.43-.4a4.9 4.9 0 0 1-1.77-1.15 4.9 4.9 0 0 1-1.15-1.77c-.16-.46-.35-1.26-.4-2.43C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.24-1.97.4-2.43a4.9 4.9 0 0 1 1.15-1.77A4.9 4.9 0 0 1 5.55 1.8c.46-.16 1.26-.35 2.43-.4C9.25 1.34 9.63 1.33 12 1.33Zm0 1.84c-3.15 0-3.5.01-4.74.07-.96.04-1.48.2-1.83.34-.46.18-.79.4-1.14.75-.35.35-.57.68-.75 1.14-.14.35-.3.87-.34 1.83-.06 1.24-.07 1.59-.07 4.74s.01 3.5.07 4.74c.04.96.2 1.48.34 1.83.18.46.4.79.75 1.14.35.35.68.57 1.14.75.35.14.87.3 1.83.34 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c.96-.04 1.48-.2 1.83-.34.46-.18.79-.4 1.14-.75.35-.35.57-.68.75-1.14.14-.35.3-.87.34-1.83.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.04-.96-.2-1.48-.34-1.83a3.06 3.06 0 0 0-.75-1.14 3.06 3.06 0 0 0-1.14-.75c-.35-.14-.87-.3-1.83-.34-1.24-.06-1.59-.07-4.74-.07Zm0 3.13a4.87 4.87 0 1 1 0 9.74 4.87 4.87 0 0 1 0-9.74Zm0 1.84a3.03 3.03 0 1 0 0 6.06 3.03 3.03 0 0 0 0-6.06Zm5.06-2.02a1.14 1.14 0 1 1 0 2.28 1.14 1.14 0 0 1 0-2.28Z"/>'
def foot(width, email=True):
    mail = '<a href="mailto:info@heartykreation.com">info@heartykreation.com</a>' if email else ''
    return f'''<div class="hk-foot {width} mx-auto" data-hk-foot>
    <div class="hk-foot-brand"><i></i><span>&copy; 2026 Hearty Kreation</span></div>
    <div class="hk-foot-links">
      <a href="/privacy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
      {mail}
      <a class="hk-soc" href="https://facebook.com/heartykreation" target="_blank" rel="noopener noreferrer" aria-label="Hearty Kreation on Facebook"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{FB}</svg></a>
      <a class="hk-soc" href="https://instagram.com/heartykreation" target="_blank" rel="noopener noreferrer" aria-label="Hearty Kreation on Instagram"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{IG}</svg></a>
    </div>
  </div>'''
FOOT_RE = re.compile(r'<footer\b[^>]*>.*?</footer>', re.S)
for rel in PAGES:
    p = ROOT / rel
    s = p.read_text()
    m = FOOT_RE.search(s)
    if not m:
        print("no footer:", rel); continue
    old = m.group(0)
    width = (re.search(r'max-w-\w+', old) or [None]) and re.search(r'max-w-\w+', old).group(0)
    if rel == "index.html":
        # keep the homepage "Let's build." block; replace only the bottom bar
        top = re.search(r'(<footer\b[^>]*>\s*<div class="[^"]*mb-16.*?\n  </div>\n)', old, re.S).group(1)
        new = top + '  <div class="' + width + ' mx-auto pt-8 border-t border-[var(--line)]">\n  ' + foot(width, email=False) + '\n  </div>\n</footer>'
    else:
        new = '<footer class="border-t border-[var(--line)] py-10 px-6">\n  ' + foot(width) + '\n</footer>'
    if new != old:
        p.write_text(s[:m.start()] + new + s[m.end():])
        print("footer updated:", rel)
