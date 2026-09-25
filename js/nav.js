// Shared site nav: dropdowns + mobile menu.
(function () {
  var nav = document.getElementById('site-nav');
  if (!nav) return;
  var burger = nav.querySelector('.hk-burger');
  var dds = nav.querySelectorAll('.hk-dd');
  function closeDDs(except) {
    dds.forEach(function (d) { if (d !== except) { d.classList.remove('open'); d.querySelector('button').setAttribute('aria-expanded', 'false'); } });
  }
  dds.forEach(function (d) {
    var b = d.querySelector('button');
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !d.classList.contains('open');
      closeDDs(d);
      d.classList.toggle('open', open);
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
  function setMenu(open) {
    nav.classList.toggle('menu-open', open);
    if (burger) {
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
  }
  if (burger) burger.addEventListener('click', function () { setMenu(!nav.classList.contains('menu-open')); });
  nav.addEventListener('click', function (e) { if (e.target.closest('a')) { setMenu(false); closeDDs(); } });
  document.addEventListener('click', function (e) { if (!nav.contains(e.target)) closeDDs(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setMenu(false); closeDDs(); } });
})();
