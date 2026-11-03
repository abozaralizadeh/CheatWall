// Small helper. Builds elements with textContent only, so nothing from the server is ever parsed as HTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export function remember(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* storage can be blocked */ }
}

export function recall(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
