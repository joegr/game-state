// game-state — the drawn bracket (d3, SVG).
//
// Draws the reconstructed bracket exactly as the record has it: one column per
// round, a card per match with both teams and the published score, elbow
// connectors that light up as winners move forward, the current round marked
// live, and the champion at the end. Hovering or tapping a team traces its
// whole path. The columns stretch to fill the available width; a bracket too
// big for the screen scrolls sideways inside its own frame.

import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const ROW = 30;          // one team row
const CARD = ROW * 2;    // a match card
const GAP = 22;          // between match cards in the first round
const LABEL = 18;        // match id above a card
const HEAD = 44;         // round titles
const MIN_W = 116;       // card width limits
const MAX_W = 300;
const MIN_COL_GAP = 36;

// record: from reconstruct(). host: an element to draw into.
export function drawBracket(host, record, { onTeam } = {}) {
  const { state, results, round: liveRound, stage } = record;
  const rounds = state.rounds;
  const R = rounds.length;
  const score = new Map(results.map((r) => [r.matchId, r]));

  // Vertical layout: first-round cards evenly spaced; every later card sits
  // centred between the two it is fed by.
  const slot = CARD + LABEL + GAP;
  const ys = [rounds[0].matches.map((_, i) => HEAD + LABEL + i * slot)];
  for (let r = 1; r < R; r++) ys.push(rounds[r].matches.map((_, i) => (ys[r - 1][2 * i] + ys[r - 1][2 * i + 1]) / 2));
  const height = HEAD + rounds[0].matches.length * slot;

  // Horizontal layout: R columns plus the champion card, stretched to fill.
  const avail = Math.max(host.clientWidth, 320) - 4;   // 2px each side, so outer strokes are not clipped
  const cols = R + 1;
  let cardW = Math.min(MAX_W, Math.max(MIN_W, (avail - (cols - 1) * MIN_COL_GAP) / cols));
  let colGap = Math.max(MIN_COL_GAP, (avail - cols * cardW) / (cols - 1));
  if (colGap > cardW * 1.2) { colGap = cardW * 1.2; cardW = Math.min(MAX_W, (avail - (cols - 1) * colGap) / cols); colGap = Math.max(MIN_COL_GAP, (avail - cols * cardW) / (cols - 1)); }
  const width = Math.max(avail, cols * cardW + (cols - 1) * colGap) + 4;
  const x = (r) => 2 + r * (cardW + colGap);

  d3.select(host).selectAll('*').remove();
  const svg = d3.select(host).append('svg')
    .attr('class', 'bracket-svg')
    .attr('width', width).attr('height', height + 8)
    .attr('viewBox', `0 0 ${width} ${height + 8}`)
    .attr('role', 'img')
    .attr('aria-label', `Bracket: ${rounds.map((r) => r.label).join(', ')}`);

  // Round titles.
  const heads = svg.append('g').attr('class', 'heads');
  rounds.forEach((rd, r) => {
    const live = stage === 'round' && liveRound === r + 1;
    const done = rd.matches.every((m) => m.winner);
    const g = heads.append('g').attr('transform', `translate(${x(r)},0)`);
    g.append('text').attr('class', 'round-title').attr('y', 16).text(rd.label);
    g.append('text').attr('class', `round-sub ${live ? 'live' : done ? 'done' : ''}`).attr('y', 32)
      .text(live ? '● LIVE — scores open' : done ? 'Decided' : `${rd.matches.length} match${rd.matches.length === 1 ? '' : 'es'}`);
  });
  heads.append('text').attr('class', 'round-title').attr('x', x(R)).attr('y', 16).text('Champion');

  // Connectors: from each match to the one its winner goes to.
  const links = [];
  for (let r = 0; r < R - 1; r++) {
    rounds[r].matches.forEach((m, i) => {
      links.push({ x1: x(r) + cardW, y1: ys[r][i] + ROW, x2: x(r + 1), y2: ys[r + 1][Math.floor(i / 2)] + ROW, fp: m.winner, won: !!m.winner });
    });
  }
  if (R) links.push({ x1: x(R - 1) + cardW, y1: ys[R - 1][0] + ROW, x2: x(R), y2: ys[R - 1][0] + ROW, fp: state.champion, won: !!state.champion });
  svg.append('g').attr('class', 'links').selectAll('path').data(links).join('path')
    .attr('class', (d) => `link${d.won ? ' won' : ''}`)
    .attr('data-fp', (d) => d.fp || null)
    .attr('d', (d) => {
      const xm = (d.x1 + d.x2) / 2;
      return `M${d.x1},${d.y1} H${xm} V${d.y2} H${d.x2}`;
    });

  // Match cards.
  const cards = svg.append('g').attr('class', 'matches');
  rounds.forEach((rd, r) => {
    rd.matches.forEach((m, i) => {
      const res = score.get(m.id);
      const live = stage === 'round' && liveRound === r + 1 && m.a && m.b && !m.winner;
      const g = cards.append('g').attr('class', `match-card${live ? ' live' : ''}${m.winner ? ' decided' : ''}`)
        .attr('transform', `translate(${x(r)},${ys[r][i]})`);
      g.append('text').attr('class', 'match-id').attr('y', -6).text(m.id);
      g.append('rect').attr('class', 'card-bg').attr('width', cardW).attr('height', CARD).attr('rx', 9);
      g.append('line').attr('class', 'card-split').attr('x1', 0).attr('x2', cardW).attr('y1', ROW).attr('y2', ROW);
      ['a', 'b'].forEach((side, k) => {
        const fp = m[side];
        const feeder = r > 0 ? rounds[r - 1].matches[2 * i + k] : null;
        const isBye = !fp && r === 0;
        const won = m.winner && fp === m.winner;
        const lost = m.winner && fp && fp !== m.winner;
        const row = g.append('g').attr('class', `team-row${won ? ' won' : ''}${lost ? ' lost' : ''}${fp ? '' : ' empty'}`)
          .attr('transform', `translate(0,${k * ROW})`)
          .attr('data-fp', fp || null);
        row.append('rect').attr('class', 'row-hit').attr('width', cardW).attr('height', ROW).attr('rx', 9);
        if (won) row.append('rect').attr('class', 'win-bar').attr('x', 0).attr('y', 4).attr('width', 3).attr('height', ROW - 8).attr('rx', 1.5);
        row.append('text').attr('class', fp ? 'code' : 'placeholder').attr('x', 12).attr('y', ROW / 2 + 5)
          .text(fp || (isBye ? 'bye' : feeder ? `Winner of ${feeder.id}` : 'TBD'));
        if (res && fp) {
          row.append('text').attr('class', 'score').attr('x', cardW - 12).attr('y', ROW / 2 + 5).attr('text-anchor', 'end')
            .text(fp === res.winner ? res.scoreWinner : res.scoreLoser);
        } else if (won && !res) {
          row.append('text').attr('class', 'score adv').attr('x', cardW - 12).attr('y', ROW / 2 + 5).attr('text-anchor', 'end').text('adv.');
        }
        if (fp) {
          row.style('cursor', 'pointer')
            .on('mouseenter', () => highlight(svg, fp))
            .on('mouseleave', () => highlight(svg, null))
            .on('click', () => { highlight(svg, fp); onTeam?.(fp); });
        }
      });
    });
  });

  // The champion.
  if (R) {
    const cy = ys[R - 1][0] + ROW - ROW / 2 - 6;
    const g = svg.append('g').attr('class', `champion-card${state.champion ? ' crowned' : ''}`).attr('transform', `translate(${x(R)},${cy})`)
      .attr('data-fp', state.champion || null);
    g.append('rect').attr('class', 'card-bg').attr('width', cardW).attr('height', ROW + 12).attr('rx', 10);
    g.append('text').attr('class', state.champion ? 'code' : 'placeholder').attr('x', 12).attr('y', (ROW + 12) / 2 + 5)
      .text(state.champion ? `🏆 ${state.champion}` : 'To be decided');
    if (state.champion) {
      g.style('cursor', 'pointer')
        .on('mouseenter', () => highlight(svg, state.champion))
        .on('mouseleave', () => highlight(svg, null))
        .on('click', () => onTeam?.(state.champion));
    }
  }

  return { highlight: (fp) => highlight(svg, fp) };
}

function highlight(svg, fp) {
  svg.classed('tracing', !!fp);
  svg.selectAll('[data-fp]').classed('hl', function () { return !!fp && this.getAttribute('data-fp') === fp; });
}
