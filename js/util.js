// game-state — tiny DOM/util helpers (no framework).

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// A button that asks for a second tap instead of window.confirm(). Some
// browsers (in-app webviews, or after "prevent additional dialogs") suppress
// confirm() and it returns false without showing anything, so the action
// would silently never run.
export function confirmButton(label, question, onConfirm, cls = 'btn ghost') {
  const b = el('button', { class: cls, type: 'button' }, label);
  let timer = null;
  const disarm = () => { clearTimeout(timer); b.classList.remove('armed'); b.textContent = label; };
  b.addEventListener('click', (e) => {
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = question;
      timer = setTimeout(disarm, 5000);
      return;
    }
    disarm();
    onConfirm(e);
  });
  return b;
}

// An inline message in place of window.alert(), for the same reason.
export function say(node, text, cls = 'sm danger') {
  clear(node);
  if (text) node.append(el('p', { class: cls }, text));
}

// localStorage-backed team identity ({fp, token}), per tournament name.
export const identityStore = {
  k: (name) => `game-state:captain:${name}`,
  save(name, data) { localStorage.setItem(this.k(name), JSON.stringify(data)); },
  load(name) {
    try { return JSON.parse(localStorage.getItem(this.k(name))); } catch { return null; }
  },
  clear(name) { localStorage.removeItem(this.k(name)); },
};

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
