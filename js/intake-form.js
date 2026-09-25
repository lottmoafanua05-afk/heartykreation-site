/* Hearty Kreation multi-step intake form.
 * Shared by /start (website), /start-web-app and /start-artist.
 *
 * Markup contract:
 *   <form id="intake" data-kind="website" data-key="hk-intake-website">
 *     <fieldset class="step" data-title="...">          one per step
 *       <input name="x" required data-minlen="15" data-msg="...">
 *       <p class="err" data-err="x"></p>                 error slot per field
 *       <div data-repeater="services" data-max="6" data-min-rows="3" data-label="Service"
 *            data-require="name" data-msg="Add at least one.">
 *         <template>...inputs with data-k="name"...</template>
 *       </div>
 *       <button type="button" data-add="services">+ Add another</button>
 *     checkbox groups (several inputs, same name) submit as arrays;
 *     a group with data-require-group on its wrapper needs one checked.
 *   Buttons: #back #next #submit, success panel #done, error line #form-error,
 *   progress #step-label #step-pct #bar.
 *   Query params preselect radios, e.g. /start?template=ember.
 */
(function () {
  var form = document.getElementById('intake');
  if (!form) return;
  var steps = Array.prototype.slice.call(form.querySelectorAll('.step'));
  var back = document.getElementById('back');
  var next = document.getElementById('next');
  var submit = document.getElementById('submit');
  var KEY = form.getAttribute('data-key') || 'hk-intake';
  var KIND = form.getAttribute('data-kind') || 'website';
  var ENDPOINT = form.getAttribute('data-endpoint') || '/api/intake';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var URL_RE = /^https?:\/\/\S+\.\S+/i;
  var submitLabel = submit.innerHTML;
  var cur = 0;

  function $all(sel, root) { return Array.prototype.slice.call((root || form).querySelectorAll(sel)); }

  /* ---------- repeaters ---------- */
  function repeaters() { return $all('[data-repeater]'); }
  function addRow(rep, values) {
    var max = +rep.getAttribute('data-max') || 10;
    var rows = $all('.row-card', rep);
    if (rows.length >= max) return;
    var tpl = rep.querySelector('template');
    var row = document.createElement('div');
    row.className = 'row-card';
    var n = rows.length + 1;
    var fixed = rep.hasAttribute('data-fixed');
    row.innerHTML = '<div class="flex justify-between items-center mb-3"><span class="font-mono text-xs row-n" style="color:var(--muted)"></span>' +
      (!fixed && n > 1 ? '<button type="button" class="x font-mono" data-remove>Remove</button>' : '') + '</div>';
    row.appendChild(tpl.content.cloneNode(true));
    values = values || {};
    $all('[data-k]', row).forEach(function (el) { if (values[el.getAttribute('data-k')] != null) el.value = values[el.getAttribute('data-k')]; });
    rep.appendChild(row);
    renumber(rep);
  }
  function renumber(rep) {
    var label = rep.getAttribute('data-label') || 'Item';
    $all('.row-card', rep).forEach(function (r, i) { r.querySelector('.row-n').textContent = label + ' ' + (i + 1); });
    var add = form.querySelector('[data-add="' + rep.getAttribute('data-repeater') + '"]');
    if (add) add.hidden = $all('.row-card', rep).length >= (+rep.getAttribute('data-max') || 10);
  }
  function readRepeater(rep) {
    var req = rep.getAttribute('data-require') || null;
    return $all('.row-card', rep).map(function (r) {
      var o = {};
      $all('[data-k]', r).forEach(function (el) { o[el.getAttribute('data-k')] = el.value.trim(); });
      return o;
    }).filter(function (o) {
      if (req) return !!o[req];
      return Object.keys(o).some(function (k) { return o[k]; });
    });
  }
  form.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add]');
    if (add) { addRow(form.querySelector('[data-repeater="' + add.getAttribute('data-add') + '"]')); save(); }
    if (e.target.hasAttribute('data-remove')) {
      var rep = e.target.closest('[data-repeater]');
      e.target.closest('.row-card').remove(); renumber(rep); save();
    }
  });

  /* ---------- collect / persist ---------- */
  function groupNames() {
    var counts = {};
    $all('input[type=checkbox][name]').forEach(function (el) { counts[el.name] = (counts[el.name] || 0) + 1; });
    return counts;
  }
  function collect() {
    var o = {}, groups = groupNames();
    $all('input[name], textarea[name], select[name]').forEach(function (el) {
      if (el.closest('[data-repeater]')) return;
      var n = el.name;
      if (el.type === 'checkbox') {
        if (groups[n] > 1) { o[n] = o[n] || []; if (el.checked) o[n].push(el.value); }
        else o[n] = el.checked;
      } else if (el.type === 'radio') {
        if (el.checked) o[n] = el.value; else if (!(n in o)) o[n] = '';
      } else o[n] = el.value.trim();
    });
    repeaters().forEach(function (rep) { o[rep.getAttribute('data-repeater')] = readRepeater(rep); });
    o.kind = KIND;
    return o;
  }
  function save() {
    try { var o = collect(); delete o.website; localStorage.setItem(KEY, JSON.stringify({ data: o, step: cur })); } catch (e) {}
  }
  function restore() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    var d = (saved && saved.data) || {};
    $all('input[name], textarea[name], select[name]').forEach(function (el) {
      if (el.closest('[data-repeater]') || !(el.name in d) || el.name === 'website') return;
      var v = d[el.name];
      if (el.type === 'checkbox') el.checked = Array.isArray(v) ? v.indexOf(el.value) > -1 : !!v;
      else if (el.type === 'radio') { if (v) el.checked = el.value === v; }
      else el.value = v;
    });
    repeaters().forEach(function (rep) {
      var rows = d[rep.getAttribute('data-repeater')] || [];
      var min = +rep.getAttribute('data-min-rows') || 1;
      for (var i = 0; i < Math.max(rows.length, min); i++) addRow(rep, rows[i]);
    });
    var q = new URLSearchParams(location.search);
    q.forEach(function (val, key) {
      var r = form.querySelector('input[type=radio][name="' + key + '"][value="' + val.replace(/"/g, '') + '"]');
      if (r) r.checked = true;
      var c = form.querySelector('input[type=checkbox][name="' + key + '"][value="' + val.replace(/"/g, '') + '"]');
      if (c) c.checked = true;
    });
    if (saved && typeof saved.step === 'number' && Object.keys(d).some(function (k) { return d[k] && d[k].length && k !== 'kind'; })) {
      cur = Math.min(saved.step, steps.length - 1);
    }
  }

  /* ---------- validation ---------- */
  function clearErrors(scope) {
    $all('.invalid', scope).forEach(function (el) { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); });
    $all('[data-err]', scope).forEach(function (el) { el.textContent = ''; });
  }
  function fail(name, msg) {
    var p = form.querySelector('[data-err="' + name + '"]');
    if (p) p.textContent = msg;
    $all('[name="' + name + '"]').forEach(function (el) {
      if (el.type !== 'radio' && el.type !== 'checkbox') { el.classList.add('invalid'); el.setAttribute('aria-invalid', 'true'); }
    });
  }
  function validateStep(i) {
    var s = steps[i], bad = [], seen = {};
    clearErrors(s);
    $all('input[name], textarea[name], select[name]', s).forEach(function (el) {
      if (el.closest('[data-repeater]') || seen[el.name]) return;
      var n = el.name, v = (el.value || '').trim(), msg = el.getAttribute('data-msg');
      if (el.type === 'radio') {
        seen[n] = 1;
        if (el.required && !form.querySelector('input[name="' + n + '"]:checked')) { fail(n, msg || 'Pick one.'); bad.push(n); }
        return;
      }
      if (el.type === 'checkbox') {
        seen[n] = 1;
        var wrap = el.closest('[data-require-group]');
        if (wrap && !form.querySelector('input[name="' + n + '"]:checked')) { fail(n, wrap.getAttribute('data-msg') || 'Pick at least one.'); bad.push(n); }
        else if (!wrap && el.required && !el.checked) { fail(n, msg || 'Please confirm.'); bad.push(n); }
        return;
      }
      if (el.required && !v) { fail(n, msg || 'This one is needed.'); bad.push(n); return; }
      var min = +el.getAttribute('data-minlen') || 0;
      if (v && min && v.length < min) { fail(n, msg || 'A little more detail here, please.'); bad.push(n); return; }
      if (v && el.type === 'email' && !EMAIL_RE.test(v)) { fail(n, 'Check this email address.'); bad.push(n); return; }
      if (v && el.type === 'url' && !URL_RE.test(v)) { fail(n, 'Enter a full link starting with https://'); bad.push(n); }
    });
    $all('[data-repeater]', s).forEach(function (rep) {
      var name = rep.getAttribute('data-repeater');
      if (rep.hasAttribute('data-required') && !readRepeater(rep).length) { fail(name, rep.getAttribute('data-msg') || 'Add at least one.'); bad.push(name); }
      $all('input[type=url][data-k]', rep).forEach(function (el) {
        if (el.value.trim() && !URL_RE.test(el.value.trim())) { el.classList.add('invalid'); fail(name, 'Links need to start with https://'); bad.push(name); }
      });
    });
    if (bad.length) {
      var first = form.querySelector('[name="' + bad[0] + '"]:not([type=radio]):not([type=checkbox])');
      if (first) first.focus();
      else { var e = s.querySelector('[data-err="' + bad[0] + '"]'); if (e) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
    return !bad.length;
  }

  /* ---------- navigation ---------- */
  function show(i) {
    steps.forEach(function (s, j) { s.classList.toggle('active', j === i); });
    cur = i;
    back.style.visibility = i === 0 ? 'hidden' : 'visible';
    next.hidden = i === steps.length - 1;
    submit.hidden = i !== steps.length - 1;
    document.getElementById('step-label').textContent = 'Step ' + (i + 1) + ' of ' + steps.length + ': ' + steps[i].getAttribute('data-title');
    var pct = Math.round((i / steps.length) * 100);
    document.getElementById('step-pct').textContent = pct + '%';
    document.getElementById('bar').style.width = pct + '%';
    document.getElementById('form-error').textContent = '';
  }
  function go(i) {
    show(i); save();
    window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 140, behavior: 'smooth' });
    var lg = steps[i].querySelector('legend');
    if (lg) { lg.setAttribute('tabindex', '-1'); lg.focus({ preventScroll: true }); }
  }
  next.addEventListener('click', function () { if (validateStep(cur)) go(cur + 1); });
  back.addEventListener('click', function () { go(cur - 1); });
  form.addEventListener('input', save);
  form.addEventListener('change', save);
  form.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit' && cur < steps.length - 1) { e.preventDefault(); next.click(); }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (cur !== steps.length - 1) return;
    for (var i = 0; i < steps.length; i++) {
      if (!validateStep(i)) { if (i !== cur) show(i); return; }
    }
    submit.disabled = true; submit.textContent = 'Sending...';
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collect()) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }, function () { return { ok: false, b: {} }; }); })
      .then(function (x) {
        if (x.ok && x.b.ok) {
          try { localStorage.removeItem(KEY); } catch (err) {}
          form.hidden = true;
          var prog = document.getElementById('progress'); if (prog) prog.hidden = true;
          var d = document.getElementById('done'); d.hidden = false; d.focus();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          var fe = (x.b && x.b.fieldErrors) || {};
          Object.keys(fe).forEach(function (k) { fail(k, fe[k]); });
          document.getElementById('form-error').textContent = (x.b && x.b.error) || 'Something went wrong. Please try again, or email info@heartykreation.com.';
        }
      })
      .catch(function () { document.getElementById('form-error').textContent = 'Network error. Your answers are saved; try again in a moment.'; })
      .finally(function () { submit.disabled = false; submit.innerHTML = submitLabel; });
  });

  restore();
  show(cur);
})();
