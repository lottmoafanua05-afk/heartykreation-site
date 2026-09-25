#!/usr/bin/env python3
"""Rewrite the <nav> on every HK page with the shared nav below.
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
