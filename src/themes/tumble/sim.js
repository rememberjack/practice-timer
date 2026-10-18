/* Tumble's logic, with no DOM: every note played falls into a wooden crate as a toy block and piles up into a wall. view.js draws it,
   pile.js tumbles the blocks with a physics engine once it has loaded, tests.js checks it.
   A block is one note: its colour is the note (the twelve notes are twelve colours round the circle of fifths, so the seven notes of a key
   are a family of colours and a wrong note stands out), its name is on its face, its width is how long the note was held (one unit for each
   QUANT seconds, up to MAXU; a longer note drops planks in a row) and it falls in where the pitch is, low notes on the left and high notes on
   the right (the crate's width is a pitch range that widens to take in what is played). Only playing drops blocks: nothing falls while quiet,
   paused or stopped. Three or four notes of one chord played in a row (an arpeggio, a broken chord) are a chord outline: the blocks light up
   gold and the chord is named. The pile's height is the record of the session: a mark is written on the crate's wall at the pile's height as
   each minute of play time passes, and the practice goal is a gold line the wall reaches at the goal; reaching it drops a trophy block.
   The pile itself (where blocks land) is a Pile: StackPile here, a plain stack that settles without a physics engine (and what the tests
   use), or the physics pile in pile.js. Both keep the same shape: live blocks (falling or resting, with x, y, w, h in block units, y up from
   the crate's floor) and settled ones (deep in the wall, kept only as a record to draw). */
'use strict';
const { seededRng } = require('../../core.js');

const TU = {
  COLS: 20,                              // the crate is 20 blocks wide
  QUANT: 0.25, MAXU: 8,                  // a block's width: one unit for each quarter second the note was held, up to 8 (2 s); longer notes drop planks in a row
  MIN_NOTE: 0.06,                        // a note shorter than this is a glitch, not a block
  MISS: 0.15,                            // the pitch may drop out this long in a held note before it is taken as released
  LO: 48, HI: 84, MARGIN: 2,             // the pitch range across the crate at first (C3 to C6); it widens by MARGIN past any note outside it
  CHORD_GAP: 0.8, CHORD_NOTE: 1.2,       // a chord outline: 3 or 4 notes in a row, none held longer than CHORD_NOTE s, no more than CHORD_GAP s between them
  TROPHY_W: 6, TROPHY_H: 1.25,           // the trophy block
  SHARE: 12,                             // blocks a following device is told about at a time
  RISE: 1.2, LOOSE: 1.15,                // how many units the wall rises a minute before there is anything to measure, and how much tumbled blocks loosen a packed area
  DEEP: 8,                               // a resting block this far under the pile's surface is settled for good
  GRAVITY: 30, SLIDE: 8, TOPPLE: 1.5,    // StackPile: how fast blocks fall (units/s²), how many half-unit slides a block may take to find support, how far a narrow tower may stand above its neighbours before a small block topples off it
};
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];   // as the page names the notes heard
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];                     // the pitch classes round the circle of fifths: C G D A E B F♯ C♯ A♭ E♭ B♭ F
const PALETTE = ['#E2574A', '#EC8A3C', '#EFB53E', '#D9CF4A', '#9AC94E', '#55BD75', '#3FB8A4', '#45A9D6', '#5F8FE0', '#8A78DC', '#B86CCC', '#D8619F'];   // toy paint, round the wheel
const COLOUR = []; FIFTHS.forEach((pc, i) => { COLOUR[pc] = PALETTE[i]; });
const pcOf = m => ((Math.round(m) % 12) + 12) % 12;
function tuColour(pc) { return COLOUR[pcOf(pc)]; }
function tuName(pc) { return NOTE_NAMES[pcOf(pc)]; }
/* chords by their intervals from the root; the lead-sheet symbol after the root's name */
const CHORDS = [['', [0, 4, 7]], ['m', [0, 3, 7]], ['°', [0, 3, 6]], ['+', [0, 4, 8]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]],
  ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['°7', [0, 3, 6, 9]], ['ø7', [0, 3, 6, 10]], ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]]];
/* the chord the notes (key numbers) spell, { root (0..11), suffix }, or null; the lowest note is tried as the root first */
function chordOf(midis) {
  const pcs = [...new Set(midis.map(pcOf))]; if (pcs.length < 3 || pcs.length > 4) return null;
  const bass = pcOf(Math.min(...midis)), roots = [bass].concat(pcs.filter(p => p !== bass));
  for (const r of roots) { const rel = pcs.map(p => (p - r + 12) % 12).sort((a, b) => a - b);
    for (const [suffix, ints] of CHORDS) if (ints.length === rel.length && ints.every((v, i) => v === rel[i])) return { root: r, suffix: suffix }; }
  return null;
}
function unitsFor(held) { return Math.max(1, Math.min(TU.MAXU, Math.round(held / TU.QUANT))); }
const median = a => { const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)] || 0; };

/* A plain pile: blocks fall straight down a grid of half units and rest on the highest column under them; a block whose middle hangs over
   the edge of its support slides a half unit toward the drop and falls on, so a heap takes shape. The stand-in for the physics pile, and what
   the tests run against. Blocks are { b: the spec, x, y (the middle, units, y up), w, h, a: angle, rest } */
class StackPile {
  constructor() { this.kind = 'stack'; this.reset(); }
  reset() { this.live = []; this.settled = []; this.cols = new Array(TU.COLS * 2).fill(0); this.spawnY = 24; this.count = 0; }
  add(b) { const w = b.units, h = b.h || 1, x = Math.max(w / 2, Math.min(TU.COLS - w / 2, b.x));
    this.live.push({ b: b, x: Math.round(x * 2) / 2, y: this.spawnY + h / 2, w: w, h: h, a: 0, vy: 0, rest: false, slid: 0 }); this.count++; }
  span(k) { const c0 = Math.max(0, Math.min(this.cols.length - 1, Math.round((k.x - k.w / 2) * 2))); return [c0, Math.min(this.cols.length, c0 + Math.round(k.w * 2))]; }
  under(k) { const [c0, c1] = this.span(k); let top = 0; for (let c = c0; c < c1; c++) if (this.cols[c] > top) top = this.cols[c]; return top; }
  step(dt) {
    for (const k of this.live) {
      if (k.rest) continue;
      k.vy -= TU.GRAVITY * dt; k.y += k.vy * dt;
      for (let guard = 0; guard < 4; guard++) {   // land, or slide off an edge and fall on
        const top = this.under(k); if (k.y - k.h / 2 > top) break;
        const [c0, c1] = this.span(k), on = []; for (let c = c0; c < c1; c++) if (this.cols[c] >= top - 1e-6) on.push(c);
        const n = c1 - c0, cm = c0 + (n >> 1), first = on[0], last = on[on.length - 1];   // cm: the column under the block's middle (for an even count, the right one of the two)
        const steady = on.length / n > 0.5 || (n % 2 ? on.indexOf(cm) >= 0 : on.indexOf(cm) >= 0 && on.indexOf(cm - 1) >= 0) || (first < cm && last >= cm);   // more than half under it, or its middle held, or held on both sides (a bridge)
        const edgeL = c0 > 0 ? this.cols[c0 - 1] : top, edgeR = c1 < this.cols.length ? this.cols[c1] : top, cliff = top - Math.min(edgeL, edgeR);   // a narrow tower: a small block topples off it
        const topple = steady && k.w <= 2 && cliff > TU.TOPPLE && top > 0 && k.slid < TU.SLIDE;
        if ((steady && !topple) || k.slid >= TU.SLIDE || top <= 0) { k.y = top + k.h / 2; k.vy = 0; k.rest = true; for (let c = c0; c < c1; c++) this.cols[c] = k.y + k.h / 2; break; }
        const left = topple ? edgeL <= edgeR : (n % 2 ? first > cm : first >= cm), nx = k.x + (left ? -0.5 : 0.5);   // its support is all to one side (or it topples): slide toward the drop
        if (nx - k.w / 2 < 0 || nx + k.w / 2 > TU.COLS) { k.slid = TU.SLIDE; continue; }
        k.x = nx; k.slid++; k.y = Math.max(k.y, top + k.h / 2);
      }
    }
  }
  /* the pile's height: the middle one of twenty columns' tops, so one tower does not count as the whole wall */
  surface() { const bins = []; for (let i = 0; i < TU.COLS; i++) bins.push(Math.max(this.cols[2 * i], this.cols[2 * i + 1])); return median(bins); }
  /* resting blocks whose top is under y (units) are settled: taken out of the live pile and kept as a record; returns the ones settled now */
  settleBelow(y) { const out = []; this.live = this.live.filter(k => { if (k.rest && k.y + k.h / 2 < y) { out.push(k); this.settled.push(k); return false; } return true; }); return out; }
}

class TumbleSim {
  constructor(pile) { this.pile = pile || new StackPile(); this.reset(0, 1); }
  reset(goal, seed) {
    this.goal = goal || 0; this.seed = seed || 1; this.rnd = seededRng(this.seed); this.t = 0; this.play = 0;
    this.blocks = 0; this.chords = 0; this.area = 0; this.tally = new Array(12).fill(0); this.cur = null; this.quiet = 0; this.seq = []; this.recent = []; this.seen = 0; this.next = 1;
    this.lo = TU.LO; this.hi = TU.HI; this.stamps = []; this.goalDone = false; this.goalY = 0; this.events = []; this.pile.reset();
  }
  get surface() { return this.pile.surface(); }
  /* where a pitch lands across the crate (units): low notes on the left, high on the right; the range widens to take in a note outside it */
  pitchX(m) { if (m < this.lo) this.lo = m - TU.MARGIN; if (m > this.hi) this.hi = m + TU.MARGIN; return 1.5 + (m - this.lo) / (this.hi - this.lo) * (TU.COLS - 3); }
  /* i: {state, music (the clock is counting), notes (note starts since the last update), midi (the pitch heard, key number, or null), play (s),
     follow (on a following device: its blocks come from follow(), not from the sound)} */
  update(dt, i) {
    const running = i.state === 'running'; this.t += dt; this.play = i.play || 0;
    if (!i.follow) {
      const sounding = running && i.music && i.midi != null && isFinite(i.midi);
      if (sounding) {
        this.quiet = 0; const k = Math.round(i.midi);
        if (i.notes > 0 || !this.cur) { if (this.cur) this.release(this.cur); this.start(k); }
        else if (this.t - this.cur.start >= TU.MAXU * TU.QUANT - 1e-6) { this.drop(this.cur, TU.MAXU, true); this.cur.start = this.t; this.cur.id = this.next++; }   // a long note: a plank, and on
      } else if (this.cur) { this.quiet += dt; if (!running || !i.music || this.quiet >= TU.MISS) { this.release(this.cur); this.cur = null; } }
    }
    while (this.stamps.length < Math.floor(this.play / 60)) this.stamps.push({ m: this.stamps.length + 1, y: this.pile.surface() });   // a minute mark on the wall, at the pile's height
    if (running && !this.goalDone && this.goal > 0 && this.play >= this.goal) this.trophy();
  }
  start(k) { this.cur = { id: this.next++, key: k, pc: pcOf(k), oct: Math.floor(k / 12) - 1, start: this.t, x: this.pitchX(k), cont: false }; }
  release(c) { const held = this.t - c.start; if (held < TU.MIN_NOTE && !c.cont) return; this.drop(c, unitsFor(held), false); }
  /* the note's block falls; cont: the next plank of a long note (not a new note for the chord outline, not counted again) */
  drop(c, units, cont) {
    const b = { id: c.id, kind: 'note', pc: c.pc, oct: c.oct, units: units, h: 1, x: c.x, chord: '' };
    this.emit(b); c.cont = true;
    if (!cont) { this.tally[c.pc]++; this.seq.push({ b: b, key: c.key, start: c.start, end: this.t, used: false }); if (this.seq.length > 4) this.seq.shift(); this.outline(); }
  }
  /* how many units the wall rises in a minute of playing, from what has fallen so far: the blocks' area over the crate's width, loosened by the gaps
     between tumbled blocks (the pile's own surface is too lumpy to measure early on). The ruler's coming minutes and the goal line are placed by it */
  perMin() { return this.play > 15 ? Math.max(0.3, this.area / TU.COLS / (this.play / 60) * TU.LOOSE) : TU.RISE; }
  emit(b) { this.blocks++; this.area += b.units * (b.h || 1); this.pile.add(b); this.events.push({ k: 'block', b: b }); this.recent.push(b); if (this.recent.length > TU.SHARE) this.recent.shift(); }
  /* a chord outline: the last 4 or 3 notes, played close together and none held long, spell a chord. The blocks are marked and the notes
     used, so one run of notes names one chord; a fourth note after a named triad can still grow it into a seventh (G B D, then F: G, then G7),
     which renames the blocks and is not counted again */
  outline() {
    for (const n of [4, 3]) {
      if (this.seq.length < n) continue;
      const w = this.seq.slice(-n), fresh = w.filter(e => !e.used).length; if (fresh < (n === 3 ? 3 : 1)) continue;
      if (w.some(e => e.end - e.start > TU.CHORD_NOTE) || w.some((e, j) => j && e.start - w[j - 1].end > TU.CHORD_GAP)) continue;
      if (new Set(w.map(e => e.b.pc)).size !== n) continue;
      const ch = chordOf(w.map(e => e.key)); if (!ch) continue;
      const name = tuName(ch.root) + ch.suffix;
      for (const e of w) { e.b.chord = name; e.used = true; }
      if (fresh >= 3) this.chords++;
      this.events.push({ k: 'chord', root: ch.root, suffix: ch.suffix, ids: w.map(e => e.b.id) }); return;
    }
  }
  trophy() { this.goalDone = true; this.goalY = this.pile.surface(); const b = { id: this.next++, kind: 'trophy', pc: -1, oct: 0, units: TU.TROPHY_W, h: TU.TROPHY_H, x: TU.COLS / 2, chord: '' };
    this.pile.add(b); this.events.push({ k: 'goal', b: b }); }
  goalChanged(goal, play) { this.goal = goal; if (play < goal) this.goalDone = false; }
  /* what a following device needs: the blocks lately dropped (the id tells it which it has) and whether the trophy fell */
  share() { return { n: this.blocks, c: this.chords, g: this.goalDone ? 1 : 0, r: this.recent.map(b => [b.id, b.pc, b.oct, b.units, Math.round(b.x * 10) / 10, b.chord]) }; }
  follow(d) {
    if (!d || !Array.isArray(d.r)) return;
    for (const r of d.r) if (Array.isArray(r) && r[0] > this.seen) { this.seen = r[0]; const b = { id: r[0], kind: 'note', pc: pcOf(r[1] || 0), oct: r[2] | 0, units: unitsFor((r[3] | 0) * TU.QUANT), h: 1, x: +r[4] || TU.COLS / 2, chord: typeof r[5] === 'string' ? r[5] : '' };
      this.emit(b); this.tally[b.pc]++; }
    if (d.g && !this.goalDone) this.trophy();
    if (typeof d.n === 'number' && d.n > this.blocks) this.blocks = d.n;   // blocks that fell before the follower joined
    if (typeof d.c === 'number' && d.c > this.chords) this.chords = d.c;
  }
  save() { return { blocks: this.blocks, chords: this.chords, notes: this.tally.slice() }; }
}

module.exports = { TU, NOTE_NAMES, FIFTHS, PALETTE, TumbleSim, StackPile, chordOf, unitsFor, tuColour, tuName, pcOf };
