// Runs before first paint: applies the saved theme (no light/dark flash) and keeps the browser /
// Android status-bar colour (theme-color) in step with it.
(function () {
  var DARK = '#0b0c11', LIGHT = '#eceef4';
  try {
    var t = localStorage.getItem('dibs-theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* storage blocked: follow the system */ }

  function sync() {
    var chosen = document.documentElement.dataset.theme;
    var dark = chosen ? chosen === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    var m = document.querySelector('meta[name="theme-color"][data-dyn]');
    if (!m) {
      m = document.createElement('meta');
      m.name = 'theme-color';
      m.setAttribute('data-dyn', '1');
      document.head.insertBefore(m, document.head.firstChild); // first match wins, so this overrides the media ones
    }
    m.content = dark ? DARK : LIGHT;
  }
  sync();
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync); } catch (e) { /* old browser */ }
  window.dibsTheme = { sync: sync };
})();
