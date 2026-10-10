// Runs before first paint (plain script in <head>) so a saved theme never flashes the wrong colours.
try {
  const saved = JSON.parse(localStorage.getItem('oc.v1.settings') || '{}');
  if (saved.theme === 'dark' || saved.theme === 'light') document.documentElement.dataset.theme = saved.theme;
} catch {
  /* storage unavailable: fall back to the system theme */
}
