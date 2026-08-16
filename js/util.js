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

export function fmtDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

// localStorage-backed captain key store (per tournament name).
export const keyStore = {
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
