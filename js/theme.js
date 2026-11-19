// Applies a saved theme before first paint. Kept as its own tiny file because the CSP forbids inline scripts.
try {
  var t = JSON.parse(localStorage.getItem('ox.theme'));
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* no saved theme */ }
