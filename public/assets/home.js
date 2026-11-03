import { recall, remember } from './dom.js';

const form = document.getElementById('make');
const topic = document.getElementById('topic');
const level = document.getElementById('level');
const err = document.getElementById('err');
const go = document.getElementById('go');

const saved = recall('cw.topic');
if (saved) topic.value = saved;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const value = topic.value.trim();
  if (value.length < 2) {
    err.textContent = 'Type the topic you want to study.';
    topic.focus();
    return;
  }
  go.disabled = true;
  go.textContent = 'Starting...';
  try {
    const res = await fetch('/api/posters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: value, level: level.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Something went wrong. Try again.');
    remember('cw.topic', value);
    location.assign(data.url);
  } catch (ex) {
    err.textContent = ex.message || 'Something went wrong. Try again.';
    go.disabled = false;
    go.textContent = 'Make my poster';
  }
});
