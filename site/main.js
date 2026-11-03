// CheatWall site: theme toggle, copy buttons, scroll reveals, lazy hero video, pinned posters.
const root = document.documentElement;
root.classList.add('js');

function stored() {
  try { return localStorage.getItem('cw-theme'); } catch { return null; }
}
const saved = stored();
if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

// Screenshots follow the page theme, also when it was picked by hand
function syncPictures() {
  const t = root.dataset.theme;
  for (const s of document.querySelectorAll('picture source[data-dark]')) {
    s.media = t === 'dark' ? 'all' : t === 'light' ? 'not all' : '(prefers-color-scheme: dark)';
  }
}
syncPictures();

const modeBtn = document.querySelector('.mode');
if (modeBtn) {
  const current = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const label = () => modeBtn.setAttribute('aria-label', current() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  label();
  modeBtn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('cw-theme', next); } catch { /* private mode */ }
    label();
    syncPictures();
  });
}

const header = document.querySelector('.top');
const onScroll = () => header && header.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Copy buttons on install blocks
for (const btn of document.querySelectorAll('.copy')) {
  const text = btn.querySelector('span');
  btn.addEventListener('click', async () => {
    const pre = btn.parentElement.querySelector('pre');
    const lines = [...pre.innerText.split('\n')].map((l) => l.replace(/^\$ /, '')).filter((l) => !l.startsWith('#'));
    const value = lines.join('\n').trim();
    let ok = false;
    try { await navigator.clipboard.writeText(value); ok = true; } catch {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      sel.removeAllRanges();
    }
    btn.classList.toggle('done', ok);
    text.textContent = ok ? 'Copied' : 'Select and copy';
    setTimeout(() => { btn.classList.remove('done'); text.textContent = 'Copy'; }, 1800);
  });
}

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Scroll reveals
const items = document.querySelectorAll('.reveal');
if (calm || !('IntersectionObserver' in window)) {
  items.forEach((el) => el.classList.add('in'));
} else {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  items.forEach((el) => io.observe(el));
}

// Hero video: load after the page, play only when on screen, never when motion is unwelcome
const video = document.querySelector('.screen video');
if (video) {
  const start = () => {
    if (calm) return;
    for (const s of video.querySelectorAll('source[data-src]')) s.src = s.dataset.src;
    video.load();
    const vo = new IntersectionObserver(([e]) => { if (e.isIntersecting) video.play().catch(() => {}); else video.pause(); }, { threshold: 0.25 });
    vo.observe(video);
  };
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
}

// Pinned posters: tap to take one off the wall on touch screens
for (const pin of document.querySelectorAll('.pin')) {
  pin.addEventListener('click', () => {
    const up = !pin.classList.contains('up');
    document.querySelectorAll('.pin.up').forEach((p) => p.classList.remove('up'));
    pin.classList.toggle('up', up);
    pin.setAttribute('aria-pressed', String(up));
  });
}
