// Runs before first paint so there is no light/dark flash.
try {
  const t = localStorage.getItem('dibs-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* storage blocked: follow the system */ }
