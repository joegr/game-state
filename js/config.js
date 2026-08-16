// game-state — config loading. All state lives in static JSON under /config,
// fetched relative to the page so it works under any GitHub Pages base path.

async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export async function loadTournament() {
  return loadJson(new URL('config/tournament.json', document.baseURI).href);
}

export async function loadBracket() {
  try {
    return await loadJson(new URL('config/bracket.json', document.baseURI).href);
  } catch {
    return { activePhase: 'signup', views: {} };
  }
}
