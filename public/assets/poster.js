import { el, remember } from './dom.js';

const root = document.getElementById('root');
const id = location.pathname.split('/').pop();
let timer = null;
let current = null;

function show(...nodes) {
  root.replaceChildren(...nodes);
}

function again(topic, label) {
  return el('a', { class: 'btn', href: '/', onclick: () => remember('cw.topic', topic || '') }, label);
}

function message(title, text, topic, label) {
  show(el('h1', {}, title), el('div', { class: 'panel' }, el('p', {}, text), el('p', {}, again(topic, label))));
}

function working(p) {
  const step = p.step || { index: 1, total: 5, label: 'In line' };
  show(
    el('h1', {}, 'Making your poster'),
    el(
      'div',
      { class: 'panel' },
      el('p', { class: 'hint' }, 'Topic: ' + p.topic),
      el('progress', { max: step.total, value: step.index, 'aria-label': 'Progress' }),
      el('p', { class: 'stage' }, `Step ${step.index} of ${step.total}: ${step.label}`),
      el('p', { class: 'hint' }, 'This takes a minute or two. You can close this tab and come back to this link.'),
    ),
  );
}

function ready(p) {
  const expires = new Date(p.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const preview = el('img', { class: 'preview', alt: `Preview of the poster: ${p.title || p.topic}`, src: `/api/posters/${p.id}/poster.png?theme=${p.theme}` });
  const buttons = p.themes.map((t) =>
    el('button', { type: 'button', role: 'radio', 'aria-checked': String(t.id === p.theme), onclick: () => pickTheme(p, t.id) }, t.name),
  );
  show(
    el(
      'div',
      { class: 'poster-grid' },
      preview,
      el(
        'div',
        {},
        el('h1', {}, p.title || p.topic),
        el('fieldset', { class: 'themes', role: 'radiogroup' }, el('legend', {}, 'Colours'), buttons),
        el(
          'div',
          { class: 'actions' },
          el('a', { class: 'btn', href: p.downloads.pdf }, 'Download PDF (print size)'),
          el('a', { class: 'btn ghost', href: p.downloads.png + '&download=1' }, 'Download PNG'),
        ),
        p.note ? el('p', { class: 'notice' }, p.note) : '',
        el('p', { class: 'notice' }, p.aiNote),
        el('p', { class: 'hint' }, `Keep this link private. The poster is deleted on ${expires}.`),
        el('p', {}, again(p.topic, 'Make another poster')),
      ),
    ),
  );
}

async function pickTheme(p, theme) {
  const buttons = root.querySelectorAll('.themes button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    const res = await fetch(`/api/posters/${id}/theme`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    current = data;
    ready(data);
  } catch {
    buttons.forEach((b) => (b.disabled = false));
    root.prepend(el('p', { class: 'error', role: 'alert' }, 'Could not change the colours. Try again.'));
  }
}

function render(p) {
  current = p;
  document.title = (p.title || p.topic) + ' - CheatWall';
  switch (p.status) {
    case 'ready': return ready(p);
    case 'refused': return message('We cannot make this one', p.message || 'We do not make posters for this topic.', p.topic, 'Try another topic');
    case 'failed': return message('That did not work', p.message || 'Something went wrong on our side.', p.topic, 'Try again');
    case 'expired': return message('This poster is gone', 'Posters are deleted after 30 days. You can make it again.', p.topic, 'Make it again');
    default: return working(p);
  }
}

async function poll() {
  try {
    const res = await fetch(`/api/posters/${id}`, { cache: 'no-store' });
    if (res.status === 404) return message('We could not find that poster', 'The link may be wrong, or the poster may be gone.', '', 'Make a poster');
    const p = await res.json();
    if (!current || current.status !== p.status || current.step?.index !== p.step?.index) render(p);
    if (p.status !== 'ready' && p.status !== 'refused' && p.status !== 'failed' && p.status !== 'expired') timer = setTimeout(poll, 2000);
  } catch {
    timer = setTimeout(poll, 4000);
  }
}

poll();
