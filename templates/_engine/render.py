#!/usr/bin/env python3
"""HK site harness renderer.

Usage:
    python3 render.py clients/<client>.json [--out ../<slug>/index.html]

Reads a client file (the intake answers, normalized) plus the theme it names,
fills base.html, and writes a finished single page site. The model writes the
words into the client file; this script builds the page. Nothing about the
layout is improvised per client, which is what keeps the output consistent.
"""

import json
import os
import re
import sys
import html


HERE = os.path.dirname(os.path.abspath(__file__))
STARS = "&#9733;&#9733;&#9733;&#9733;&#9733;"


def esc(value):
    return html.escape(str(value), quote=True)


def load(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def favicon(theme, client):
    letter = esc(client["business_name"].strip()[0].upper())
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
        "<rect width='64' height='64' rx='14' fill='{brand}'/>"
        "<text x='32' y='44' font-size='36' font-family='sans-serif' font-weight='700'"
        " text-anchor='middle' fill='{ink}'>{letter}</text></svg>"
    ).format(brand=theme["colors"]["brand"], ink=theme["colors"]["brand_ink"], letter=letter)
    return svg.replace("#", "%23").replace("<", "%3C").replace(">", "%3E").replace('"', "'").replace(" ", "%20")


def services_cards(client):
    out = []
    for i, svc in enumerate(client["services"], start=1):
        price = f'<span class="price">{esc(svc["price"])}</span>' if svc.get("price") else ""
        out.append(
            f'<div class="card"><span class="svc-num">{i:02d}</span>'
            f'<h3>{esc(svc["name"])}</h3><p>{esc(svc["description"])}</p>{price}</div>'
        )
    return "\n".join(out)


def stats_markup(client):
    return "\n".join(
        f'<div class="stat"><b>{esc(s["value"])}</b><span>{esc(s["label"])}</span></div>'
        for s in client.get("stats", [])
    )


def quotes_markup(client):
    out = []
    for q in client.get("reviews", []):
        out.append(
            f'<div class="quote"><div class="stars">{STARS}</div>'
            f'<p>{esc(q["text"])}</p><span class="who">{esc(q["who"])}</span></div>'
        )
    return "\n".join(out)


def contact_info(client):
    rows = []
    phone = client.get("phone")
    if phone:
        digits = re.sub(r"[^0-9+]", "", phone)
        rows.append(f'<div class="info-row"><span class="k">Phone</span><span><a href="tel:{digits}">{esc(phone)}</a></span></div>')
    if client.get("email"):
        rows.append(f'<div class="info-row"><span class="k">Email</span><span><a href="mailto:{esc(client["email"])}">{esc(client["email"])}</a></span></div>')
    if client.get("address"):
        maps = "https://maps.google.com/?q=" + esc(client["address"]).replace(" ", "+")
        rows.append(f'<div class="info-row"><span class="k">Find us</span><span><a href="{maps}" target="_blank" rel="noopener">{esc(client["address"])}</a></span></div>')
    elif client.get("service_area"):
        rows.append(f'<div class="info-row"><span class="k">Serving</span><span>{esc(client["service_area"])}</span></div>')
    if client.get("hours"):
        hours = "<br>".join(esc(h) for h in client["hours"])
        rows.append(f'<div class="info-row"><span class="k">Hours</span><span>{hours}</span></div>')
    return "\n".join(rows)


def social_links(client):
    return "\n".join(
        f'<a href="{esc(url)}" target="_blank" rel="noopener">{esc(name)}</a>'
        for name, url in client.get("social", {}).items()
    )


def about_side(theme, client):
    kind = theme["layout"].get("about_side", "quote")
    if kind == "hours_card" and client.get("hours"):
        rows = "".join(f'<div class="info-row"><span class="k">{esc(h.split(":")[0])}</span><span>{esc(":".join(h.split(":")[1:]).strip())}</span></div>' for h in client["hours"])
        return f'<div class="card" style="padding:26px"><h3 style="margin-bottom:14px">Hours</h3>{rows}</div>'
    if kind == "checklist":
        items = "".join(f'<div class="info-row"><span class="k">{i:02d}</span><span>{esc(p)}</span></div>' for i, p in enumerate(client.get("promises", []), start=1))
        return f'<div class="card" style="padding:26px"><h3 style="margin-bottom:14px">{esc(client.get("promises_heading", "What you get"))}</h3>{items}</div>'
    first = (client.get("reviews") or [{"text": client["subhead"], "who": client["business_name"]}])[0]
    return f'<div class="quote"><div class="stars">{STARS}</div><p>{esc(first["text"])}</p><span class="who">{esc(first["who"])}</span></div>'


def schema_block(client):
    data = {
        "@context": "https://schema.org",
        "@type": client.get("schema_type", "LocalBusiness"),
        "name": client["business_name"],
        "description": client["meta_description"],
        "url": client.get("site_url", ""),
    }
    if client.get("phone"):
        data["telephone"] = client["phone"]
    if client.get("address"):
        data["address"] = {"@type": "PostalAddress", "streetAddress": client["address"]}
    if client.get("service_area"):
        data["areaServed"] = client["service_area"]
    return json.dumps(data)


def build(client_path, out_path=None):
    client = load(client_path)
    theme = load(os.path.join(HERE, "themes", client["theme"] + ".json"))
    c, f, lay = theme["colors"], theme["fonts"], theme["layout"]

    name = esc(client["business_name"])
    if " " in client["business_name"]:
        head, tail = client["business_name"].split(" ", 1)
        name_markup = f"{esc(head)} <span>{esc(tail)}</span>"
    else:
        name_markup = f"<span>{name}</span>"

    demo = client.get("demo", False)
    ribbon = (
        '<div class="demo-ribbon">Demo template: <strong>' + esc(theme["name"]) + '</strong>. '
        'This is a Hearty Kreation sample, not a real business. '
        '<a href="https://heartykreation.com/templates">See all templates</a></div>'
    ) if demo else ""

    values = {
        "title": client["title"],
        "meta_description": client["meta_description"],
        "site_url": client.get("site_url", ""),
        "favicon": favicon(theme, client),
        "schema": schema_block(client),
        "font_url": f["url"],
        "font_display": f["display"],
        "font_body": f["body"],
        "font_ui": f["ui"],
        "display_weight": str(f.get("display_weight", 700)),
        "display_tracking": f.get("display_tracking", "-0.01em"),
        "h1_size": lay.get("h1_size", "4.1rem"),
        "c_bg": c["bg"], "c_surface": c["surface"], "c_ink": c["ink"], "c_muted": c["muted"],
        "c_brand": c["brand"], "c_brand_ink": c["brand_ink"], "c_accent": c["accent"], "c_line": c["line"],
        "radius": lay.get("radius", "14px"),
        "btn_radius": lay.get("btn_radius", "999px"),
        "section_pad": lay.get("section_pad", "86px"),
        "hero_pad": lay.get("hero_pad", "96px"),
        "hero_bg": lay.get("hero_bg", "var(--surface)"),
        "hero_fx": lay.get("hero_fx", "background:none"),
        "hero_align": lay.get("hero_align", ""),
        "hero_h1_extra": lay.get("hero_h1_extra", ""),
        "hero_lead_extra": lay.get("hero_lead_extra", ""),
        "hero_actions_extra": lay.get("hero_actions_extra", ""),
        "hero_meta_extra": lay.get("hero_meta_extra", ""),
        "hero_eyebrow_color": lay.get("hero_eyebrow_color", "var(--brand)"),
        "hero_ghost_color": lay.get("hero_ghost_color", "var(--ink)"),
        "hero_ghost_border": lay.get("hero_ghost_border", "var(--line)"),
        "nav_bg": lay.get("nav_bg", "var(--bg)"),
        "about_bg": lay.get("about_bg", "var(--surface)"),
        "contact_bg": lay.get("contact_bg", "var(--surface)"),
        "contact_ink": lay.get("contact_ink", "var(--ink)"),
        "contact_muted": lay.get("contact_muted", "var(--muted)"),
        "contact_line": lay.get("contact_line", "var(--line)"),
        "contact_link": lay.get("contact_link", "var(--brand)"),
        "contact_eyebrow_color": lay.get("contact_eyebrow_color", "var(--brand)"),
        "footer_bg": lay.get("footer_bg", "var(--bg)"),
        "shadow_brand": c.get("shadow", "rgba(0,0,0,0.35)"),
        "demo_ribbon": ribbon,
        "business_name": name,
        "business_name_markup": name_markup,
        "nav_services_label": esc(client.get("services_nav_label", "Services")),
        "cta_label": esc(client["cta_label"]),
        "cta_href": esc(client.get("cta_href", "#contact")),
        "secondary_cta_label": esc(client.get("secondary_cta_label", "What we do")),
        "hero_eyebrow": esc(client["hero_eyebrow"]),
        "headline": esc(client["headline"]),
        "subhead": esc(client["subhead"]),
        "hero_meta": "\n".join(f"<span>{esc(m)}</span>" for m in client.get("hero_meta", [])),
        "services_eyebrow": esc(client.get("services_eyebrow", "What we do")),
        "services_heading": esc(client["services_heading"]),
        "services_intro": esc(client.get("services_intro", "")),
        "services_cards": services_cards(client),
        "about_eyebrow": esc(client.get("about_eyebrow", "Who we are")),
        "about_heading": esc(client["about_heading"]),
        "about_body": "\n".join(f"<p class=\"muted\">{esc(p)}</p>" for p in client["about_body"]),
        "about_side": about_side(theme, client),
        "stats": stats_markup(client),
        "proof_heading": esc(client.get("proof_heading", "In their words")),
        "quotes": quotes_markup(client),
        "contact_heading": esc(client["contact_heading"]),
        "contact_info": contact_info(client),
        "social_links": social_links(client),
        "form_button": esc(client.get("form_button", "Send message")),
        "form_endpoint": client.get("form_endpoint", "https://formsubmit.co/ajax/info@heartykreation.com"),
    }

    with open(os.path.join(HERE, "base.html"), "r", encoding="utf-8") as fh:
        page = fh.read()

    for key, val in values.items():
        page = page.replace("{{" + key + "}}", val)

    leftovers = re.findall(r"\{\{([a-z_]+)\}\}", page)
    if leftovers:
        raise SystemExit("Unfilled placeholders, refusing to write: " + ", ".join(sorted(set(leftovers))))
    if not demo and "demo-ribbon" in page:
        raise SystemExit("Demo ribbon markup present in a client build, refusing to write.")

    out = out_path or os.path.join(HERE, "..", client["slug"], "index.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(page)
    print("wrote", os.path.relpath(out, HERE), f"({len(page)} bytes, theme: {theme['name']})")
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    args = sys.argv[1:]
    out = None
    if "--out" in args:
        i = args.index("--out")
        out = args[i + 1]
        args = args[:i] + args[i + 2:]
    for client_file in args:
        build(client_file, out)
