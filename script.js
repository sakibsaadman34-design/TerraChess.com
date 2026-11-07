/* ===== TerraChess: script.js ===== */
const $ = s => document.querySelector(s);
const EMO = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;   // emojis are stripped from everything shown (usernames included)
const esc = s => String(s ?? '').replace(EMO, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Accounts ---------- */
// MAKE ACCOUNTS WORK IN EVERY BROWSER: create a free Firebase project -> Build -> Realtime Database -> "Create database"
// -> start in TEST mode, then paste its URL below, e.g. 'https://my-terrachess-default-rtdb.firebaseio.com'
// Leave it empty and accounts are saved in this browser only.
const DB_URL = 'https://terra-chess-2fc28-default-rtdb.firebaseio.com';
const cloud = DB_URL.replace(/\/+$/, '');
let ACC = JSON.parse(localStorage.getItem('tc_acc') || '{}'), ME = localStorage.getItem('tc_s'), CUR = null;
const norm = a => { if (a) { a.d = a.d || {}; a.d.games = a.d.games || []; a.d.pz = a.d.pz || []; a.d.hist = a.d.hist || []; a.d.beat = a.d.beat || {}; a.d.tw = a.d.tw || {}; a.d.titles = a.d.titles || []; a.d.rating = a.d.rating || 800; } return a; };
async function getAcc(id) { if (cloud) { const r = await fetch(`${cloud}/accounts/${id}.json`); if (!r.ok) throw 0; return norm(await r.json()); } return norm(ACC[id] || null); }
async function putAcc(id, a) {
  if (cloud) { const r = await fetch(`${cloud}/accounts/${id}.json`, { method: 'PUT', body: JSON.stringify(a) }); if (!r.ok) throw 0; }
  else { ACC[id] = a; localStorage.setItem('tc_acc', JSON.stringify(ACC)); }
}
let saveT; const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { putAcc(ME, CUR).catch(() => {}); pubPush(); }, 600); };
const D = () => CUR.d;
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function hashPw(pw, salt) {
  const te = new TextEncoder(), k = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(salt), iterations: 100000 }, k, 256));
}
const msg = t => { const e = $('#fm'); e.style.display = 'block'; e.textContent = t; $('#go').disabled = false; return false; };
function authView(signup) {
  $('#app').innerHTML = `<div class="wrap" style="max-width:460px"><div class="card"><h2>${signup ? 'Create your account' : 'Log in'}</h2>
  <p class="mut">${signup ? 'Pick a username with at least 6 characters that nobody else uses, and a password.' : 'You need an account to use TerraChess.'}</p>
  <label>Username<input id="u" class="fi" maxlength="20" autocomplete="username"></label>
  <label>Password<input id="p" type="password" class="fi" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
  ${signup ? '<label>Confirm password<input id="p2" type="password" class="fi"></label>' : ''}
  <div class="stat" id="fm" style="display:none"></div>
  <button class="btn" id="go" style="width:100%">${signup ? 'Sign up' : 'Log in'}</button>
  ${cloud ? '' : '<p class="mut" style="font-size:14px">Accounts are saved in this browser only. To use one account in every browser, set DB_URL at the top of the accounts section in script.js.</p>'}
  <p class="mut">${signup ? 'Have an account? <a href="#login">Log in</a>' : 'New here? <a href="#signup">Sign up</a>'}</p></div></div>`;
  $('#go').onclick = signup ? doSignup : doLogin;
  document.querySelectorAll('.fi').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') $('#go').click(); }));
}
async function doSignup() {
  const n = $('#u').value.trim(), p = $('#p').value, id = n.toLowerCase();
  if (n.length < 6) return msg('Your username must be at least 6 characters long.');
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(n)) return msg('Use only letters, numbers, dashes and underscores (max 20).');
  if (p.length < 6) return msg('Your password must be at least 6 characters long.');
  if (p !== $('#p2').value) return msg('The passwords don’t match.');
  $('#go').disabled = true;
  try {
    if (await getAcc(id)) return msg('Sorry, that username is already taken.');
    const salt = hex(crypto.getRandomValues(new Uint8Array(16))), a = { u: n, salt, joined: Date.now(), hash: await hashPw(p, salt), d: { rating: 800, games: [], pz: [] } };
    await putAcc(id, a); enter(id, a);
  } catch (e) { msg('Could not reach the account database. Please try again.'); }
}
async function doLogin() {
  const id = $('#u').value.trim().toLowerCase(); $('#go').disabled = true;
  try {
    const a = await getAcc(id);
    if (!a) return msg("This username doesn't hold an account.");
    if (await hashPw($('#p').value, a.salt) !== a.hash) return msg('The password is incorrect.');
    enter(id, a);
  } catch (e) { msg('Could not reach the account database. Please try again.'); }
}
function enter(id, a) { ME = id; CUR = a; localStorage.setItem('tc_s', id); loadMyTitle().finally(() => { location.hash = '#profile'; route(); }); }
function logout() { stopPresence(); ME = null; CUR = null; localStorage.removeItem('tc_s'); location.hash = '#login'; route(); }

/* ---------- Sounds (capture + check) ---------- */
let AX; const tone = (f, t, d, ty, v) => { const o = AX.createOscillator(), g = AX.createGain(); o.type = ty; o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(AX.destination); o.start(t); o.stop(t + d); };
function noise(t, d, v, f) {   // short filtered burst, used for the "clack" of a capture
  const len = Math.floor(AX.sampleRate * d), buf = AX.createBuffer(1, len, AX.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = AX.createBufferSource(), fl = AX.createBiquadFilter(), g = AX.createGain(); src.buffer = buf; fl.type = 'bandpass'; fl.frequency.value = f; g.gain.value = v;
  src.connect(fl); fl.connect(g); g.connect(AX.destination); src.start(t);
}
addEventListener('pointerdown', () => { try { AX = AX || new AudioContext(); AX.resume(); } catch (e) {} }, { once: true });   // browsers only allow sound after a click
function sound(mv, g) {   // three different sounds: capture (loud wooden clack), check (two high beeps), checkmate (deep boom + rising chord)
  try {
    AX = AX || new AudioContext(); AX.resume(); const t = AX.currentTime + .02, mate = g.in_checkmate && g.in_checkmate(), late = mv.captured ? .22 : 0;
    if (mv.captured) { noise(t, .1, 1.6, 1600); tone(420, t, .12, 'triangle', .7); tone(240, t, .16, 'sine', .6); }
    if (mate) { tone(65, t + late, .9, 'sawtooth', .3); tone(523, t + late + .05, .6, 'triangle', .25); tone(659, t + late + .2, .6, 'triangle', .25); tone(784, t + late + .35, .6, 'triangle', .25); tone(1047, t + late + .5, 1.1, 'triangle', .25); }
    else if (g.in_check()) { tone(880, t + late, .13, 'square', .13); tone(1319, t + late + .11, .2, 'square', .13); }
  } catch (e) {}
}

/* ---------- Pieces: PNG files from the image folder (wk.png, bq.png, ...). If a file is missing, the built-in drawing is used instead. ---------- */
const pieceImg = (c, t) => `<img src="image/${c}${t}.png" alt="" draggable="false" style="width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;display:block;pointer-events:none" onerror="pieceFallback(this,'${t}')">`;
function pieceFallback(img, t) { img.outerHTML = `<svg viewBox="0 0 100 100"><use href="#s-${t}"/></svg>`; }

/* ---------- Board (click, drag, right-click arrows, premoves) ---------- */
const DR = [[1, 1], [1, -1], [-1, 1], [-1, -1]], OR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function reach(b, r, c) {   // squares a piece could go to, ignoring whose turn it is and ignoring own pieces (used for premoves)
  const p = b[r][c]; if (!p) return []; const out = [], add = (a, d) => { if (a >= 0 && a < 8 && d >= 0 && d < 8) out.push([a, d]); };
  if (p.type === 'n') for (const [a, d] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(r + a, c + d);
  else if (p.type === 'k') { for (let a = -1; a <= 1; a++) for (let d = -1; d <= 1; d++) if (a || d) add(r + a, c + d); }
  else if (p.type === 'p') {
    const f = p.color === 'w' ? -1 : 1; for (const dc of [-1, 1]) add(r + f, c + dc);
    if (b[r + f] && !b[r + f][c]) { add(r + f, c); if (r === (p.color === 'w' ? 6 : 1) && !b[r + 2 * f][c]) add(r + 2 * f, c); }
  } else for (const [a, d] of p.type === 'b' ? DR : p.type === 'r' ? OR : DR.concat(OR)) { let x = r + a, y = c + d; while (x >= 0 && x < 8 && y >= 0 && y < 8) { out.push([x, y]); if (b[x][y]) break; x += a; y += d; } }
  return out;
}
function Board(el, o) {
  const B = { g: o.g, flip: false, last: null, sel: null, marks: [], arrows: [], pre: [], rs: null };
  const rc = s => [8 - s[1], 'abcdefgh'.indexOf(s[0])], nm = (r, c) => 'abcdefgh'[c] + (8 - r);
  B.pm = () => { const m = o.me && o.me(); return !!m && !B.g.game_over() && B.g.turn() !== m; };   // opponent to move: moves become premoves
  B.vb = () => { const b = B.g.board().map(r => r.slice()); for (const m of B.pre) { const [fr, fc] = rc(m.from), [tr, tc] = rc(m.to); b[tr][tc] = m.promo ? { type: m.promo, color: b[fr][fc].color } : b[fr][fc]; b[fr][fc] = null; } return b; };
  B.targets = s => { if (B.pm()) { const [r, c] = rc(s); return reach(B.vb(), r, c).map(x => nm(x[0], x[1])); } return B.g.moves({ square: s, verbose: true }).map(m => m.to); };
  B.mine = s => { const [r, c] = rc(s), pm = B.pm(), p = (pm ? B.vb() : B.g.board())[r][c]; return !!p && (pm ? p.color === o.me() : p.color === B.g.turn() && (!o.can || o.can(p.color))); };
  B.ctr = s => { let [r, c] = rc(s); if (B.flip) { r = 7 - r; c = 7 - c; } return [c + .5, r + .5]; };
  B.svg = () => {
    const ar = (a, b) => { const [x1, y1] = B.ctr(a), [x2, y2] = B.ctr(b), dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, bx = x2 - ux * .4, by = y2 - uy * .4;
      return `<line x1="${x1 + ux * .2}" y1="${y1 + uy * .2}" x2="${bx}" y2="${by}" stroke-width=".18" stroke-linecap="round"/><polygon stroke="none" points="${x2},${y2} ${bx - uy * .28},${by + ux * .28} ${bx + uy * .28},${by - ux * .28}"/>`; };
    if (!B.arrows.length && !B.pre.length) return '';
    return `<svg viewBox="0 0 8 8" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"><g fill="#f59e0b" stroke="#f59e0b" opacity=".85">${B.arrows.map(x => ar(x[0], x[1])).join('')}</g><g fill="#dc2626" stroke="#dc2626" opacity=".85">${B.pre.map(x => ar(x.from, x.to)).join('')}</g></svg>`;
  };
  B.draw = () => {
    const g = B.g, bd = g.board(), ck = g.in_check() ? g.turn() : null, tg = B.sel ? B.targets(B.sel) : []; let h = '';
    for (let i = 0; i < 64; i++) {
      const r = B.flip ? 7 - (i >> 3) : i >> 3, c = B.flip ? 7 - (i & 7) : i & 7, s = nm(r, c), p = bd[r][c]; let k = 'sq ' + ((r + c) % 2 ? 'dk' : 'lt');
      if (s === B.sel) k += ' sel'; if (B.last && B.last.includes(s) && !B.badge) k += ' last'; if (B.badge && B.badge.sq === s) k += ' rvt'; else if (B.badge && B.badge.from === s) k += ' rvf'; if (p && p.type === 'k' && p.color === ck) k += ' chk';
      if (B.marks.includes(s)) k += ' red'; if (B.pre.some(m => m.from === s || m.to === s)) k += ' pre';
      h += `<div class="${k}" data-s="${s}"${B.badge && (B.badge.sq === s || B.badge.from === s) ? ` style="--rc:${B.badge.col}"` : ''}>${tg.includes(s) ? `<i class="${p ? 'cap' : 'dot'}"></i>` : ''}${p ? `<b class="${p.color}">${pieceImg(p.color, p.type)}</b>` : ''}${B.badge && B.badge.sq === s ? `<img class="bdg" src="reviews/${B.badge.k}.png" alt="">` : ''}</div>`;
    }
    el.innerHTML = h + B.svg(); B.fx();
  };
  B.fx = () => {   // natural piece motion: the piece glides from its old square, captured pieces shrink away, checks pulse
    const bd = B.g.board(), cur = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = bd[r][c]; cur.push(p ? p.color + p.type : null); }
    const key = B.last ? B.last.join('') : '', pv = B.pv, pl = B.pl; B.pv = cur; B.pl = key;
    if (!key || key === pl || !pv) return;
    const f = sqi(B.last[0]), t = sqi(B.last[1]), pf = pv[f], ct = cur[t]; if (!pf || !ct || ct[0] !== pf[0] || cur[f]) return;
    let cap = pv[t] && pv[t][0] !== pf[0] ? pv[t] : null;
    if (!cap && pf[1] === 'p' && (f & 7) !== (t & 7) && !pv[t]) { const q = pv[(f >> 3) * 8 + (t & 7)]; if (q && q[0] !== pf[0]) cap = q; }
    const sz = el.getBoundingClientRect().width / 8, sqEl = s => el.querySelector(`[data-s="${nameOf(s)}"]`),
      pos = s => { let c = s & 7, r = s >> 3; if (B.flip) { c = 7 - c; r = 7 - r; } return [c, r]; },
      ring = (e, col, delay) => { const i = document.createElement('i'); i.className = 'fx'; i.style.borderColor = col; e.appendChild(i); i.animate([{ transform: 'scale(.3)', opacity: .9 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 420, delay, easing: 'ease-out' }).onfinish = () => i.remove(); },
      slide = (a, b) => {
        const e = sqEl(b), pc = e && e.querySelector('b'); if (!pc) return; const [ac, ar] = pos(a), [bc, br] = pos(b), dx = (ac - bc) * sz, dy = (ar - br) * sz;
        e.style.overflow = 'visible'; e.style.zIndex = 6;
        pc.animate([{ transform: `translate(${dx}px,${dy}px) scale(1.1)` }, { transform: 'translate(0,0) scale(1.1)', offset: .8 }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.25,.8,.25,1)' }).onfinish = () => { e.style.overflow = ''; e.style.zIndex = ''; };
      };
    if (!B.skip) { slide(f, t); if (pf[1] === 'k' && Math.abs((t & 7) - (f & 7)) === 2) { const rr = f >> 3, right = (t & 7) > (f & 7); slide(rr * 8 + (right ? 7 : 0), rr * 8 + (right ? 5 : 3)); } }
    const dEl = sqEl(t);
    if (cap && dEl) {
      const gh = document.createElement('b'); gh.className = cap[0]; gh.innerHTML = pieceImg(cap[0], cap[1]); gh.style.cssText = 'position:absolute;inset:4%;width:auto;height:auto;z-index:0;pointer-events:none'; dEl.appendChild(gh);
      gh.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.4) rotate(25deg)', opacity: 0 }], { duration: 300, delay: B.skip ? 0 : 120, easing: 'ease-in', fill: 'both' }).onfinish = () => gh.remove(); ring(dEl, '#ff7a18', B.skip ? 0 : 140);
    }
    if (B.g.in_check()) { const k = cur.indexOf(B.g.turn() + 'k'), ke = k >= 0 && sqEl(k); if (ke) { ring(ke, '#e11d1d', B.skip ? 0 : 200); const kp = ke.querySelector('b'); kp && kp.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 340, delay: B.skip ? 0 : 220 }); } }
  };
  B.play = mv => { B.last = [mv.from, mv.to]; B.sel = null; B.draw(); sound(mv, B.g); };
  B.askPromo = (f, t, color) => {   // pawn reached the last rank: let the player choose the new piece (like chess.com)
    const rect = el.getBoundingClientRect(), sz = rect.width / 8, [cx, cy] = B.ctr(t), dir = cy < 4 ? 1 : -1, els = [];
    const close = () => els.forEach(x => x.remove());
    const back = document.createElement('div'); back.className = 'promo-back'; back.onclick = () => { close(); B.sel = null; B.draw(); };
    document.body.appendChild(back); els.push(back);
    ['q', 'n', 'r', 'b'].forEach((pc, i) => {
      const d = document.createElement('div'); d.className = 'sq pp'; d.title = { q: 'Queen', n: 'Knight', r: 'Rook', b: 'Bishop' }[pc];
      d.style.cssText = `left:${rect.left + (cx - .5) * sz}px;top:${rect.top + (cy - .5 + i * dir) * sz}px;width:${sz}px;height:${sz}px`;
      d.innerHTML = `<b class="${color}">${pieceImg(color, pc)}</b>`;
      d.onclick = () => { close(); B.try(f, t, pc); }; document.body.appendChild(d); els.push(d);
    });
    B.draw();
  };
  B.try = (f, t, promo) => {
    if (!B.targets(f).includes(t)) return false;
    const pm = B.pm(), [r, c] = rc(f), pc = (pm ? B.vb() : B.g.board())[r][c];
    if (!promo && pc && pc.type === 'p' && t[1] === (pc.color === 'w' ? '8' : '1')) { B.askPromo(f, t, pc.color); return true; }
    if (pm) { if (B.pre.length < 10) B.pre.push({ from: f, to: t, promo }); B.sel = null; B.draw(); return true; }
    const mv = B.g.move({ from: f, to: t, promotion: promo || 'q' }); if (!mv) return false; B.pre = []; B.play(mv); o.onMove && o.onMove(mv); return true;
  };
  B.autoPre = () => {   // opponent has moved: play the next premove if it is legal now (a capture of my own piece only works if it was captured)
    const m = o.me && o.me(); if (!m || !B.pre.length || B.g.turn() !== m || B.g.game_over()) return;
    const p = B.pre.shift(), mv = B.g.move({ from: p.from, to: p.to, promotion: p.promo || 'q' });
    if (!mv) { B.pre = []; B.draw(); return; } B.play(mv); o.onMove && o.onMove(mv);
  };
  const at = (x, y) => { const t = document.elementFromPoint(x, y), s = t && t.closest && t.closest('.sq'); return s && el.contains(s) ? s.dataset.s : null; };
  let Dg = null;
  el.oncontextmenu = e => e.preventDefault();
  el.addEventListener('mousedown', e => { if (e.button === 2) B.rs = at(e.clientX, e.clientY); });
  el.addEventListener('mouseup', e => {   // right click: arrow (drag) or light-red square (single click), any time
    if (e.button !== 2 || !B.rs) return; const s = at(e.clientX, e.clientY), a = B.rs; B.rs = null; if (!s) return;
    if (s === a) { const i = B.marks.indexOf(s); i < 0 ? B.marks.push(s) : B.marks.splice(i, 1); }
    else { const i = B.arrows.findIndex(x => x[0] === a && x[1] === s); i < 0 ? B.arrows.push([a, s]) : B.arrows.splice(i, 1); }
    B.draw();
  });
  el.onpointerdown = e => {
    if (e.button !== 0) return; const s = at(e.clientX, e.clientY); if (!s) return; B.marks = []; B.arrows = [];   // left click erases arrows and red squares
    Dg = { s, x: e.clientX, y: e.clientY, moved: false, piece: false, was: false };
    if (!(B.sel && B.targets(B.sel).includes(s)) && B.mine(s)) { Dg.piece = true; Dg.was = B.sel === s; B.sel = s; B.draw(); }
    try { el.setPointerCapture(e.pointerId); } catch (x) {}
  };
  el.onpointermove = e => {
    if (!Dg || !Dg.piece) return;
    if (!Dg.moved) {
      if (Math.hypot(e.clientX - Dg.x, e.clientY - Dg.y) < 6) return; Dg.moved = true;
      const pc = el.querySelector(`[data-s="${Dg.s}"] b`);
      if (pc) { const w = el.getBoundingClientRect().width / 8 * 1.15, gh = document.createElement('div'); gh.className = 'sq'; gh.style.cssText = `position:fixed;left:0;top:0;z-index:99;pointer-events:none;width:${w}px;height:${w}px;overflow:visible`; gh.appendChild(pc.cloneNode(true)); document.body.appendChild(gh); Dg.gh = gh; Dg.w = w; pc.style.opacity = '.3'; }
    }
    if (Dg.gh) Dg.gh.style.transform = `translate(${e.clientX - Dg.w / 2}px,${e.clientY - Dg.w / 2}px)`;
  };
  el.onpointerup = e => {
    if (!Dg || e.button !== 0) return; const d = Dg; Dg = null; if (d.gh) d.gh.remove();
    try { el.releasePointerCapture(e.pointerId); } catch (x) {}
    const s = at(e.clientX, e.clientY);
    if (d.moved) { if (s && s !== d.s) { B.skip = true; const ok = B.try(d.s, s); B.skip = false; if (ok) return; } B.draw(); return; }          // dragged a piece onto a square
    if (d.piece) { if (d.was) { B.sel = null; B.draw(); } return; }
    if (B.sel && B.try(B.sel, d.s)) return; B.sel = B.mine(d.s) ? d.s : null; B.draw();       // normal click
  };
  el.onpointercancel = () => { if (Dg && Dg.gh) Dg.gh.remove(); Dg = null; B.draw(); };
  B.draw(); return B;
}
addEventListener('keydown', e => { if (e.key === 'Escape') [typeof P !== 'undefined' && P.B, typeof OLN !== 'undefined' && OLN.B].forEach(b => { if (b && b.pre.length) { b.pre = []; b.draw(); } }); });   // Esc cancels premoves
const layout = () => '<div class="wrap two"><div><div id="bd" class="board"></div></div><div class="card" id="pn"></div></div>';

/* ---------- Engine and bots ---------- */
const V = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
/* ---------- The chess engine (runs inside a Web Worker): bitless 0x88 board, fast move generation, alpha-beta search with
   iterative deepening, transposition table, null-move pruning, late-move reductions, killer/history ordering,
   quiescence search and a hand-tuned evaluation. Verified against standard perft counts. ---------- */
function engineMain() {
  const INF = 30000, MATE = 29000, VAL = [0, 100, 320, 330, 500, 900, 0];
  let OPT = {}; const NC = new Int8Array(16), NR = new Int8Array(16), NF = new Int8Array(16), NT = new Int8Array(16);   // OPT = the bot's skill settings
  const bd = new Int8Array(128), ksq = [4, 116];
  let side = 0, castle = 15, ep = -1, half = 0, h1 = 0, h2 = 0, sp = 0, nodes = 0, stop = false, deadline = 0, tt = new Map();
  const sCap = new Int8Array(1200), sCas = new Int8Array(1200), sEp = new Int16Array(1200), sHalf = new Int16Array(1200), sH1 = new Int32Array(1200), sH2 = new Int32Array(1200), sMv = new Int32Array(1200);
  let seed = 0x9E3779B9; const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(2048), Z2 = new Int32Array(2048), C1 = new Int32Array(16), C2 = new Int32Array(16), E1 = new Int32Array(128), E2 = new Int32Array(128);
  for (let i = 0; i < 2048; i++) { Z1[i] = rnd32(); Z2[i] = rnd32(); } for (let i = 0; i < 16; i++) { C1[i] = rnd32(); C2[i] = rnd32(); } for (let i = 0; i < 128; i++) { E1[i] = rnd32(); E2[i] = rnd32(); }
  const S1 = rnd32(), S2 = rnd32();
  const NO = [31, 33, 14, 18, -31, -33, -14, -18], KO = [1, -1, 16, -16, 15, 17, -15, -17], BO = [15, 17, -15, -17], RO = [1, -1, 16, -16];
  const CM = new Int8Array(128).fill(15); CM[0] = 13; CM[4] = 12; CM[7] = 14; CM[112] = 7; CM[116] = 3; CM[119] = 11;
  const killers = [], hist = new Int32Array(2 * 128 * 128);
  function calcHash() { h1 = h2 = 0; for (let s = 0; s < 128; s++) { if (s & 0x88) continue; const p = bd[s]; if (p) { h1 ^= Z1[p * 128 + s]; h2 ^= Z2[p * 128 + s]; } } h1 ^= C1[castle]; h2 ^= C2[castle]; if (ep >= 0) { h1 ^= E1[ep]; h2 ^= E2[ep]; } if (side) { h1 ^= S1; h2 ^= S2; } }
  function setFen(fen) {
    bd.fill(0); const [pp, sd, cs, es, hm] = fen.split(' '); let r = 7, f = 0; const map = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
    for (const ch of pp) { if (ch === '/') { r--; f = 0; } else if (ch >= '1' && ch <= '8') f += +ch; else { const lo = ch.toLowerCase(), p = map[lo] | (ch === lo ? 8 : 0), s = r * 16 + f; bd[s] = p; if ((p & 7) === 6) ksq[p >> 3] = s; f++; } }
    side = sd === 'b' ? 1 : 0; castle = 0; for (const ch of cs) castle |= { K: 1, Q: 2, k: 4, q: 8 }[ch] || 0;
    ep = es && es !== '-' ? (+es[1] - 1) * 16 + 'abcdefgh'.indexOf(es[0]) : -1; half = +hm || 0; sp = 0; calcHash();
  }
  function attacked(sq, c) {
    const pw = 1 | (c << 3), a = c ? sq + 15 : sq - 15, b = c ? sq + 17 : sq - 17;
    if (!(a & 0x88) && bd[a] === pw) return true; if (!(b & 0x88) && bd[b] === pw) return true;
    const kn = 2 | (c << 3), kg = 6 | (c << 3), bi = 3 | (c << 3), ro = 4 | (c << 3), qu = 5 | (c << 3);
    for (let i = 0; i < 8; i++) { let s = sq + NO[i]; if (!(s & 0x88) && bd[s] === kn) return true; s = sq + KO[i]; if (!(s & 0x88) && bd[s] === kg) return true; }
    for (let i = 0; i < 4; i++) {
      let o = BO[i], s = sq + o; while (!(s & 0x88)) { const p = bd[s]; if (p) { if (p === bi || p === qu) return true; break; } s += o; }
      o = RO[i]; s = sq + o; while (!(s & 0x88)) { const p = bd[s]; if (p) { if (p === ro || p === qu) return true; break; } s += o; }
    }
    return false;
  }
  function gen(caps) {
    const ml = [], us = side, them = side ^ 1, up = us ? -16 : 16, sr = us ? 6 : 1, pr = us ? 1 : 6;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const s = r * 16 + f, p = bd[s]; if (!p || (p >> 3) !== us) continue; const t = p & 7;
      if (t === 1) {
        const one = s + up;
        if (!bd[one]) { if (r === pr) for (let q = 5; q >= 2; q--) ml.push(s | one << 8 | q << 16); else if (!caps) { ml.push(s | one << 8); const two = one + up; if (r === sr && !bd[two]) ml.push(s | two << 8 | 2 << 20); } }
        for (let k = -1; k <= 1; k += 2) { const to = s + up + k; if (to & 0x88) continue; const q = bd[to];
          if (q && (q >> 3) === them) { if (r === pr) for (let z = 5; z >= 2; z--) ml.push(s | to << 8 | z << 16); else ml.push(s | to << 8); }
          else if (to === ep) ml.push(s | to << 8 | 1 << 20); }
      } else if (t === 2 || t === 6) {
        const os = t === 2 ? NO : KO;
        for (let i = 0; i < 8; i++) { const to = s + os[i]; if (to & 0x88) continue; const q = bd[to]; if (!q) { if (!caps) ml.push(s | to << 8); } else if ((q >> 3) === them) ml.push(s | to << 8); }
      } else {
        const os = t === 3 ? BO : t === 4 ? RO : KO, n = t === 5 ? 8 : 4;
        for (let i = 0; i < n; i++) { const o = os[i]; let to = s + o; while (!(to & 0x88)) { const q = bd[to]; if (!q) { if (!caps) ml.push(s | to << 8); } else { if ((q >> 3) === them) ml.push(s | to << 8); break; } to += o; } }
      }
    }
    if (!caps) { const k = us ? 116 : 4;
      if (bd[k] === (6 | us << 3) && !attacked(k, them)) {
        if ((castle & (us ? 4 : 1)) && !bd[k + 1] && !bd[k + 2] && bd[k + 3] === (4 | us << 3) && !attacked(k + 1, them) && !attacked(k + 2, them)) ml.push(k | (k + 2) << 8 | 4 << 20);
        if ((castle & (us ? 8 : 2)) && !bd[k - 1] && !bd[k - 2] && !bd[k - 3] && bd[k - 4] === (4 | us << 3) && !attacked(k - 1, them) && !attacked(k - 2, them)) ml.push(k | (k - 2) << 8 | 4 << 20);
      } }
    return ml;
  }
  const hx = (p, s) => { h1 ^= Z1[p * 128 + s]; h2 ^= Z2[p * 128 + s]; };
  function make(m) {
    const f = m & 255, t = (m >> 8) & 255, pr = (m >> 16) & 15, fl = m >> 20, p = bd[f], us = side, capSq = fl & 1 ? t + (us ? 16 : -16) : t, cap = bd[capSq];
    sCap[sp] = cap; sCas[sp] = castle; sEp[sp] = ep; sHalf[sp] = half; sH1[sp] = h1; sH2[sp] = h2; sMv[sp] = m; sp++;
    h1 ^= C1[castle]; h2 ^= C2[castle]; if (ep >= 0) { h1 ^= E1[ep]; h2 ^= E2[ep]; } ep = -1; half++;
    if (cap) { hx(cap, capSq); bd[capSq] = 0; half = 0; }
    hx(p, f); bd[f] = 0; const np = pr ? (pr | us << 3) : p; bd[t] = np; hx(np, t); if ((p & 7) === 1) half = 0;
    if (fl & 4) { const rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1, rp = bd[rf]; hx(rp, rf); bd[rf] = 0; bd[rt] = rp; hx(rp, rt); }
    if (fl & 2) { ep = (f + t) >> 1; h1 ^= E1[ep]; h2 ^= E2[ep]; }
    if ((p & 7) === 6) ksq[us] = t;
    castle &= CM[f] & CM[t]; h1 ^= C1[castle]; h2 ^= C2[castle]; side ^= 1; h1 ^= S1; h2 ^= S2;
  }
  function unmake() {
    sp--; const m = sMv[sp], f = m & 255, t = (m >> 8) & 255, pr = (m >> 16) & 15, fl = m >> 20; side ^= 1; const us = side;
    let p = bd[t]; if (pr) p = 1 | us << 3; bd[f] = p;
    if (fl & 1) { bd[t] = 0; bd[t + (us ? 16 : -16)] = sCap[sp]; } else bd[t] = sCap[sp];
    if (fl & 4) { const rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1; bd[rf] = bd[rt]; bd[rt] = 0; }
    if ((p & 7) === 6) ksq[us] = f;
    castle = sCas[sp]; ep = sEp[sp]; half = sHalf[sp]; h1 = sH1[sp]; h2 = sH2[sp];
  }
  function makeNull() { sCas[sp] = castle; sEp[sp] = ep; sHalf[sp] = half; sH1[sp] = h1; sH2[sp] = h2; sMv[sp] = 0; sp++; if (ep >= 0) { h1 ^= E1[ep]; h2 ^= E2[ep]; } ep = -1; side ^= 1; h1 ^= S1; h2 ^= S2; half++; }
  function unmakeNull() { sp--; side ^= 1; castle = sCas[sp]; ep = sEp[sp]; half = sHalf[sp]; h1 = sH1[sp]; h2 = sH2[sp]; }
  function perft(d) { if (!d) return 1; let n = 0; for (const m of gen(false)) { make(m); if (!attacked(ksq[side ^ 1], side)) n += perft(d - 1); unmake(); } return n; }
  const PASS = [0, 10, 15, 25, 45, 80, 130, 0], PF = [new Int8Array(8), new Int8Array(8)], PC = new Int8Array(16), PR = new Int8Array(16), PFi = new Int8Array(16), RK = new Int8Array(16), KG = [0, 0, 0, 0, 0, 0];
  function evaluate() {
    let s = 0, ph = 0, np = 0, nr = 0, nn = 0, b0 = 0, b1 = 0; PF[0].fill(0); PF[1].fill(0); let k0r = -1, k0f = 0, k1r = -1, k1f = 0;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const p = bd[r * 16 + f]; if (!p) continue; const c = p >> 3, t = p & 7, rank = c ? 7 - r : r; let v = VAL[t];
      if (t === 1) { PF[c][f]++; if (np < 16) { PC[np] = c; PR[np] = rank; PFi[np++] = f; } v += rank * 6 + (f === 3 || f === 4 ? rank * 3 : 0); }
      else if (t === 2) { v += (4 - Math.abs(f - 3.5) - Math.abs(r - 3.5)) * 11; ph++; }
      else if (t === 3) { v += (4 - Math.abs(f - 3.5) - Math.abs(r - 3.5)) * 6; ph++; if (c) b1++; else b0++; }
      else if (t === 4) { RK[nr++] = c * 64 + f * 8 + rank; ph += 2; }
      else if (t === 5) { v += (4 - Math.abs(f - 3.5) - Math.abs(r - 3.5)) * 2; ph += 4; }
      else if (c) { k1r = r; k1f = f; } else { k0r = r; k0f = f; }
      if (OPT.pr) { if ((t === 2 || t === 3) && rank > 0) v += 14; else if (t === 5 && rank > 0 && sp < 16) v -= 10; else if (t === 1 && (f === 3 || f === 4) && rank >= 3 && rank <= 4) v += 16; }   // opening principles: develop, don't rush the queen, take the centre
      if (t > 1 && t < 6 && nn < 16) { NC[nn] = c; NR[nn] = r; NF[nn] = f; NT[nn++] = t; }
      s += c ? -v : v;
    }
    if (OPT.adv) {   // positional knowledge (Advanced and above)
    for (let i = 0; i < nr; i++) { const c = RK[i] >> 6, f = (RK[i] >> 3) & 7, rank = RK[i] & 7, sg = c ? -1 : 1; if (!PF[c][f]) s += sg * (PF[1 - c][f] ? 12 : 25); if (rank === 6) s += sg * 15; }
    if (b0 > 1) s += 30; if (b1 > 1) s -= 30;
    for (let c = 0; c < 2; c++) { const sg = c ? -1 : 1, pf = PF[c]; for (let f = 0; f < 8; f++) { const n = pf[f]; if (n > 1) s -= sg * 12 * (n - 1); if (n && !(f > 0 && pf[f - 1]) && !(f < 7 && pf[f + 1])) s -= sg * 10; } }
    for (let i = 0; i < np; i++) { const c = PC[i], rank = PR[i], f = PFi[i]; let pass = true; for (let j = 0; j < np; j++) if (PC[j] !== c && Math.abs(PFi[j] - f) < 2 && 7 - PR[j] > rank) { pass = false; break; } if (pass) s += (c ? -1 : 1) * PASS[rank]; }
    }
    const mgw = Math.min(ph, 24) / 24;
    for (let c = 0; c < 2; c++) { const r = c ? k1r : k0r, f = c ? k1f : k0f; if (r < 0) continue; const sg = c ? -1 : 1, rank = c ? 7 - r : r; let sh = 0;
      if (OPT.adv && rank < 2) for (let d = -1; d <= 1; d++) { const ff = f + d; if (ff < 0 || ff > 7) continue; if (bd[(c ? r - 1 : r + 1) * 16 + ff] === (1 | c << 3)) sh += 10; }
      s += sg * (mgw * (sh + (rank === 0 && (f <= 2 || f >= 6) ? 25 : 0) - rank * 12) + (1 - mgw) * (4 - (Math.abs(f - 3.5) + Math.abs(r - 3.5))) * 12); }
    if (OPT.atk) for (let i = 0; i < nn; i++) {   // pieces swarming the enemy king (this is what makes sacrifices attractive)
      const c = NC[i], kr = c ? k0r : k1r, kf = c ? k0f : k1f, dist = Math.max(Math.abs(NR[i] - kr), Math.abs(NF[i] - kf));
      if (dist < 4) s += (c ? -1 : 1) * (4 - dist) * OPT.atk * (NT[i] === 5 ? 6 : NT[i] === 4 ? 4 : 3);
    }
    return (side ? -s : s) + 8;
  }
  const isRep = () => { for (let i = sp - 2; i >= 0 && i >= sp - half; i -= 2) if (sH1[i] === h1 && sH2[i] === h2) return true; return false; };
  const hasNP = c => { for (let s = 0; s < 128; s++) { if (s & 0x88) continue; const p = bd[s]; if (p && (p >> 3) === c && (p & 7) > 1 && (p & 7) < 6) return true; } return false; };
  const order = (ml, ttm, ply) => ml.map(m => { const t = (m >> 8) & 255, f = m & 255; if (m === ttm) return 1e7; const v = bd[t]; if (v || (m >> 20) & 1) return 1e6 + 16 * (v & 7 || 1) - (bd[f] & 7) + ((m >> 16) & 15) * 50; const k = killers[ply]; if (k && (k[0] === m)) return 9e5; if (k && k[1] === m) return 8e5; return hist[side * 16384 + f * 128 + t]; });
  function qs(alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) stop = true; if (stop) return 0;
    const st = evaluate(); if (st >= beta || ply > 60) return st; if (st > alpha) alpha = st;
    const ml = gen(true), sc = order(ml, 0, ply);
    for (let i = 0; i < ml.length; i++) { let bi = i; for (let j = i + 1; j < ml.length; j++) if (sc[j] > sc[bi]) bi = j; [ml[i], ml[bi]] = [ml[bi], ml[i]]; [sc[i], sc[bi]] = [sc[bi], sc[i]];
      make(ml[i]); if (attacked(ksq[side ^ 1], side)) { unmake(); continue; } const s = -qs(-beta, -alpha, ply + 1); unmake(); if (stop) return 0; if (s >= beta) return s; if (s > alpha) alpha = s; }
    return alpha;
  }
  function search(d, alpha, beta, ply, nullOk) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) stop = true; if (stop) return 0;
    if (ply > 0 && (half >= 100 || isRep())) return 0;
    const inChk = attacked(ksq[side], side ^ 1); if (inChk && OPT.adv) d++; if (d <= 0) return OPT.noqs ? evaluate() : qs(alpha, beta, ply);
    const key = (h1 >>> 0) * 2097152 + (h2 & 2097151), e = tt.get(key); let ttm = 0;
    if (e) { ttm = e.m; if (e.d >= d && ply > 0) { if (e.f === 0 || (e.f === 1 && e.s >= beta) || (e.f === 2 && e.s <= alpha)) return e.s; } }
    if (nullOk && !inChk && d >= 3 && ply > 0 && hasNP(side)) { makeNull(); const s = -search(d - 3, -beta, -beta + 1, ply + 1, false); unmakeNull(); if (stop) return 0; if (s >= beta) return beta; }
    const ml = gen(false), sc = order(ml, ttm, ply), a0 = alpha; let best = -INF, bm = 0, n = 0;
    for (let i = 0; i < ml.length; i++) {
      let bi = i; for (let j = i + 1; j < ml.length; j++) if (sc[j] > sc[bi]) bi = j; [ml[i], ml[bi]] = [ml[bi], ml[i]]; [sc[i], sc[bi]] = [sc[bi], sc[i]];
      const m = ml[i], cap = bd[(m >> 8) & 255] || (m >> 20) & 1, promo = (m >> 16) & 15; make(m); if (attacked(ksq[side ^ 1], side)) { unmake(); continue; } n++; let s;
      if (n === 1) s = -search(d - 1, -beta, -alpha, ply + 1, true);
      else { const red = n > 4 && d >= 3 && !cap && !promo && !inChk ? 1 : 0; s = -search(d - 1 - red, -alpha - 1, -alpha, ply + 1, true); if (s > alpha && red) s = -search(d - 1, -alpha - 1, -alpha, ply + 1, true); if (s > alpha && s < beta) s = -search(d - 1, -beta, -alpha, ply + 1, true); }
      unmake(); if (stop) return 0;
      if (s > best) { best = s; bm = m; if (s > alpha) { alpha = s; if (alpha >= beta) { if (!cap) { const k = killers[ply] || (killers[ply] = [0, 0]); if (k[0] !== m) { k[1] = k[0]; k[0] = m; } hist[(side) * 16384 + (m & 255) * 128 + ((m >> 8) & 255)] += d * d; } break; } } }
    }
    if (!n) return inChk ? -MATE + ply : 0;
    tt.set(key, { d, s: best, f: best >= beta ? 1 : best > a0 ? 0 : 2, m: bm }); return best;
  }
  const legal = () => { const out = []; for (const m of gen(false)) { make(m); if (!attacked(ksq[side ^ 1], side)) out.push(m); unmake(); } return out; };
  const sqName = s => 'abcdefgh'[s & 7] + ((s >> 4) + 1), uci = m => sqName(m & 255) + sqName((m >> 8) & 255) + ((m >> 16) & 15 ? '  nbrq'[(m >> 16) & 15] : '');
  function think(moves, o, fen) {
    setFen(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    for (const u of moves) { const f = 'abcdefgh'.indexOf(u[0]) + ((+u[1] - 1) << 4), t = 'abcdefgh'.indexOf(u[2]) + ((+u[3] - 1) << 4), pr = u[4] ? { n: 2, b: 3, r: 4, q: 5 }[u[4]] : 0;
      const m = gen(false).find(x => (x & 255) === f && ((x >> 8) & 255) === t && ((x >> 16) & 15) === pr); if (!m) break; make(m); }
    const lm = legal(); if (!lm.length) return null;
    if (Math.random() < (o.blun || 0)) return uci(lm[Math.random() * lm.length | 0]);
    OPT = o; tt = new Map(); killers.length = 0; hist.fill(0); nodes = 0; stop = false; deadline = Date.now() + (o.t || 1e9); let bm = lm[0];
    if (o.noise > 0) { let bs = -INF; for (const m of lm) { make(m); const s = -search(Math.max(0, o.d - 1), -INF, INF, 1, true); unmake(); if (stop) break; const v = s + (Math.random() - .5) * 2 * o.noise; if (v > bs) { bs = v; bm = m; } } return uci(bm); }
    const ord = lm.slice();
    for (let d = 1; d <= (o.d || 1); d++) {
      let cur = 0, cs = -INF, alpha = -INF;
      for (let i = 0; i < ord.length; i++) { const m = ord[i]; make(m); let s; if (i === 0) s = -search(d - 1, -INF, -alpha, 1, true); else { s = -search(d - 1, -alpha - 1, -alpha, 1, true); if (s > alpha) s = -search(d - 1, -INF, -alpha, 1, true); } unmake(); if (stop) break; if (s > cs) { cs = s; cur = m; alpha = s; } }
      if (stop) break; bm = cur; ord.splice(ord.indexOf(cur), 1); ord.unshift(cur); if (Math.abs(cs) > MATE - 100) break;
    }
    return uci(bm);
  }
  self.onmessage = e => { const { id, moves, bot, fen } = e.data; postMessage({ id, m: think(moves, bot, fen) }); };
}

const SOLID = {   // solid repertoires (names from the Openings tab) that the bots play while their opening book lasts
  i: { plies: 6, w: ['Queen’s Gambit', 'London System', 'Italian Game'], b: ['Caro-Kann', 'Queen’s Gambit'] },
  a: { plies: 12, w: ['Queen’s Gambit', 'London System', 'Italian Game', 'Ruy Lopez', 'Catalan'], b: ['Caro-Kann', 'Queen’s Gambit', 'French Defense', 'Petrov Defense'] },
  m: { plies: 20, w: ['Queen’s Gambit', 'London System', 'Italian Game', 'Ruy Lopez', 'Catalan', 'English Opening', 'Réti Opening'], b: ['Caro-Kann', 'Queen’s Gambit', 'French Defense', 'Petrov Defense', 'Nimzo-Indian', 'Scandinavian'] },
  x: { plies: 24, w: null, b: null }
};
// Witty_Alien (CM Volen Dyulgerov): the streamer who invented the Alien Gambit and the Martian Gambit. He plays sharp gambits and always answers the Caro-Kann with one of them.
// Edit these lines (written in standard notation) to change his openings.
const ALIEN_LINES = {
  w: [   // when he has the white pieces (he always opens 1.e4)
    'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 c5 Bc4+ e6 dxc5',          // Alien Gambit (1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Nf6 5.Ng5 h6 6.Nxf7)
    'e4 c6 d4 d5 Nd2 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 c5 Bc4+ e6 dxc5',          // Alien Gambit with 3.Nd2 (his favourite move order)
    'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 Bf5 Ne5+ Kg8 Bc4+ e6 g4',  // Alien Gambit, 7...Bf5
    'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 e6',                       // Alien Gambit, 7...e6
    'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6',                            // Martian Gambit (against 4...Bf5)
    'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O',                              // Evans Gambit
    'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6',                                            // King's Gambit
    'e4 e5 Nf3 Nc6 d4 exd4 Bc4 Nf6 O-O Nxe4 Re1 d5 Bxd5 Qxd5 Nc3 Qa5',               // Scotch Gambit
    'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7',                                   // Winawer
    'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6'                    // Dragon, Yugoslav Attack
  ],
  b: [   // when he has the black pieces
    'e4 e5 Nf3 d5 exd5 e4 Qe2 Nf6',                                                  // Elephant Gambit
    'e4 e5 Nf3 d5 Nxe5 dxe4',                                                        // Elephant Gambit, 3.Nxe5
    'd4 d5 c4 e5 dxe5 d4 Nf3 Nc6 g3 Be6'                                             // Albin Counter-Gambit
  ]
};
const ALIEN_SAY = {
  start: ['Welcome to the Spaceship, Earthling! Like, subscribe, and prepare to lose your king.', 'Greetings from the Witty Aliens club. Today I will beam your pieces off the board.', 'As I always say, chess is a practical game. It is played by humans, not computers.', 'The pony goes to the center, and the Earthling goes home.'],
  move: ['Calculated in three dimensions.', 'On my home planet, this move is called Tuesday.', 'Fascinating. Your pieces look nervous.', 'Do not worry, this is all part of the plan. I think.', 'The pony likes this square. Do not ask me why.', 'My ship computer says this is winning. It also says it wants snacks.'],
  cap: ['Delicious. Tastes like pawn.', 'Thank you for the free sample, Earthling.', 'I will be taking that, for science.', 'Chess is a practical game, and practically, that piece is mine.'],
  check: ['Check! Even my tentacles can see that one.', 'Your king appears to be in the spotlight.', 'Knock knock. It is your king\'s evil landlord.'],
  win: ['Another victory for the Alien Gambit. Do not forget to subscribe on your way out!', 'Good game, Earthling. I will edit this into a highlight reel.', 'Resistance was futile, but entertaining.'],
  lose: ['Impossible! Fine, you win this round. I blame Earth gravity.', 'Well played. I will cut this from the video.', 'My ship computer demands a rematch.'],
  draw: ['A draw. Peace between our planets, for now.', 'Equal on both planets. I will take it.']
};
const BOTS = [
  { n: 'Starter', r: 100, rand: 1 },                                   // random moves
  { n: 'Beginner', r: 500, rand: 2 },                                  // random moves (likes a capture now and then)
  { n: 'Intermediate', r: 1000, d: 2, noise: 60, blun: .06, t: 600, pr: 1, noqs: 1, book: SOLID.i },                          // opening principles, no tactics
  { n: 'Advanced', r: 1500, d: 4, noise: 20, blun: .025, t: 1500, pr: 1, adv: 1, book: SOLID.a },                            // sees tactical patterns
  { n: 'Master', r: 2000, d: 6, blun: .008, t: 2000, pr: 1, adv: 1, atk: 1, book: SOLID.m },                                  // solid openings, sees sacrifices
  { n: 'International Master', r: 2500, d: 8, blun: .002, t: 3000, pr: 1, adv: 1, atk: 1.5, book: SOLID.x },                  // deep calculation
  { n: 'Witty_Alien', title: 'CM', r: 2200, d: 9, blun: .004, t: 3500, pr: 1, adv: 1, atk: 2.6, lines: ALIEN_LINES, say: ALIEN_SAY },   // witty, aggressive, accurate, rarely blunders
  { n: 'Grandmaster', r: 3000, d: 30, blun: .0003, t: 5000, pr: 1, adv: 1, atk: 2, book: SOLID.x },
  // title-challenge opponents (not shown in the normal bot list)
  { n: 'Candidate Master Bot', chal: 1, title: 'CM', r: 2200, d: 7, blun: .005, t: 2500, pr: 1, adv: 1, atk: 1, book: SOLID.m },
  { n: 'Terra Master Bot', chal: 1, title: 'TM', r: 2400, d: 9, blun: .003, t: 3200, pr: 1, adv: 1, atk: 1.3, book: SOLID.x },
  { n: 'International Master Bot', chal: 1, title: 'IM', r: 2500, d: 10, blun: .002, t: 3800, pr: 1, adv: 1, atk: 1.5, book: SOLID.x },
  { n: 'Grandmaster Bot', chal: 1, title: 'GM', r: 2800, d: 30, blun: .0004, t: 5000, pr: 1, adv: 1, atk: 2, book: SOLID.x }                             // deepest calculation, almost never blunders
];
const TCS = [[1, 0], [2, 0], [3, 0], [3, 2], [5, 0], [5, 3], [10, 0], [10, 5], [15, 0], [15, 10], [30, 0]]
  .map(a => ({ m: a[0], inc: a[1], l: a[1] ? `${a[0]} + ${a[1]} Minute` : `${a[0]} Minute` }));
const fmt = ms => { ms = Math.max(0, ms); if (ms < 10000) return '0:' + (ms / 1000).toFixed(1).padStart(4, '0'); const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- Opening name + move table shown during games ---------- */
const stripCk = s => s.replace(/[+#]/g, ''), OPL = [];
function openingOf(hist) {   // finds which opening from the Openings list the game follows (keeps the best match even after the game leaves theory)
  if (!OPL.length) OP.forEach(o => o[2].forEach(v => OPL.push({ o: o[0], v: v[0], m: v[1].split(' ').map(stripCk) })));
  const h = hist.map(stripCk); let best = 0, c = [];
  for (const l of OPL) { let n = 0; while (n < h.length && n < l.m.length && l.m[n] === h[n]) n++; if (n > best) { best = n; c = [l]; } else if (n === best && n > 0) c.push(l); }
  if (!best) return null; const names = [...new Set(c.map(x => x.o))]; if (names.length > 1) return null;
  if (c.length > 1) return names[0];
  const v = c[0].v; return `${c[0].o}: ${v}${/Gambit|Attack|Variation|Line|System|Defen[cs]e|Opening|Game|Defence/i.test(v) ? '' : ' Variation'}`;
}
const openingBox = n => n ? `<div class="obox">Opening: ${esc(n)}</div>` : '';
function movesHtml(hs) {
  let r = ''; for (let i = 0; i < hs.length; i += 2) r += `<tr><td class="mn">${i / 2 + 1}.</td><td${i === hs.length - 1 ? ' class="cur"' : ''}>${hs[i]}</td><td${i + 1 === hs.length - 1 ? ' class="cur"' : ''}>${hs[i + 1] || ''}</td></tr>`;
  return `<table class="mvt">${r || '<tr><td class="mut">No moves yet.</td></tr>'}</table>`;
}

/* ---------- Play ---------- */
let P = { g: new Chess(), me: 'w', pick: 'w', bot: 2, tcI: 6, on: false, over: false, think: false, msg: '' };
function playView() {
  if (P.mode === 'person') { personView(); return; }
  $('#app').innerHTML = layout();
  P.B = Board($('#bd'), { g: P.g, can: c => P.on && !P.think && c === P.me, me: () => P.on ? P.me : null, onMove: () => { clockMove(P.me); if (!endCheck()) { status(); botMove(); } } });
  P.B.flip = P.me === 'b'; P.B.draw(); panel(); if (P.auto) { P.auto = false; startGame(); }
}
const rem = c => P.clk ? Math.max(0, P.clk[c] - (P.on && P.g.turn() === c ? Date.now() - P.ts : 0)) : 0;
const tt = t => t ? `<span class="tt">${t}</span>` : '';
const clockBox = (c, name) => `<div class="clk ${P.on && P.g.turn() === c ? 'act' : ''}" id="k${c}"><span>${name}</span><b>${fmt(rem(c))}</b></div>`;
function panel() {
  const el = $('#pn'); if (!el) return;
  if (!P.on && !P.over) {
    el.innerHTML = `<h2>Play</h2><div class="chips" style="margin:0 0 8px"><button class="chip on">Play a bot</button><button class="chip" onclick="P.mode='person';playView()">Play in person</button></div><p class="mut">Your Elo: <b>${D().rating}</b></p>` +
      BOTS.map((b, i) => b.chal ? '' : `<button class="opt ${P.bot == i ? 'on' : ''}" onclick="P.bot=${i};panel()"><b>${tt(b.title)}${b.n}</b><span>${b.r} Elo</span></button>`).join('') +
      `<div class="row">${['w', 'r', 'b'].map(c => `<button class="chip ${P.pick == c ? 'on' : ''}" onclick="P.pick='${c}';panel()">${{ w: 'White', r: 'Random', b: 'Black' }[c]}</button>`).join('')}</div>
      <h3>Time control</h3><div class="chips">${TCS.map((t, i) => `<button class="chip ${P.tcI == i ? 'on' : ''}" onclick="P.tcI=${i};panel()">${t.l}</button>`).join('')}</div>
      <button class="btn" onclick="startGame()">Start game</button>`;
    return;
  }
  const opp = P.me === 'w' ? 'b' : 'w', hs = P.g.history(); let mv = '';
  for (let i = 0; i < hs.length; i += 2) mv += `<span class="mut">${i / 2 + 1}.</span> ${hs[i]} ${hs[i + 1] || ''} `;
  el.innerHTML = `<h2>vs ${tt(BOTS[P.bot].title)}${BOTS[P.bot].n} <span class="mut" style="font-size:16px">${P.tc.l}</span></h2>${clockBox(opp, tt(BOTS[P.bot].title) + esc(BOTS[P.bot].n))}${clockBox(P.me, tt(titleOf(D())) + esc(CUR.u))}
    <div class="stat">${P.msg}</div>${P.say ? `<div class="say"><b>${esc(BOTS[P.bot].n.split(' ')[0])}:</b> ${esc(P.say)}</div>` : ''}${openingBox((P.openName = openingOf(hs) || P.openName))}<div class="mv">${movesHtml(hs)}</div>
    <div class="row"><button class="chip" onclick="P.B.flip=!P.B.flip;P.B.draw()">Flip board</button>
    ${P.on ? `<button class="chip" onclick="finish('${opp}')">Resign</button>` : `<button class="btn" style="margin:0" onclick="P.over=false;panel()">New game</button>`}</div>`;
}
function startGame() {
  killWorker();
  P.me = P.pick === 'r' ? (Math.random() < .5 ? 'w' : 'b') : P.pick; P.g = new Chess(); P.B.g = P.g; P.B.last = null; P.B.pre = []; P.B.marks = []; P.B.arrows = []; P.B.flip = P.me === 'b';
  P.tc = TCS[P.tcI]; P.say = BOTS[P.bot].say ? pick(BOTS[P.bot].say.start) : ''; P.earned = null; P.openName = null; P.tl = []; P.clk = { w: P.tc.m * 60000, b: P.tc.m * 60000 }; P.ts = Date.now(); P.on = true; P.over = false; P.think = false; P.tok = (P.tok || 0) + 1;
  clearInterval(P.iv); P.iv = setInterval(tick, 200); P.B.draw(); status(); if (P.me === 'b') botMove();
}
function status() { P.msg = (P.g.in_check() ? 'Check! ' : '') + (P.g.turn() === P.me ? 'Your move.' : 'Thinking…'); panel(); }
function clockMove(c) { const now = Date.now(); P.clk[c] = Math.max(0, P.clk[c] - (now - P.ts)) + P.tc.inc * 1000; P.ts = now; (P.tl = P.tl || []).push(Math.round(P.clk[c])); }
function tick() {
  if (!P.on) return clearInterval(P.iv);
  const t = P.g.turn();
  for (const c of ['w', 'b']) { const e = $('#k' + c); if (e) { e.querySelector('b').textContent = fmt(rem(c)); e.classList.toggle('act', t === c); } }
  if (P.clk[t] - (Date.now() - P.ts) <= 0) { P.clk[t] = 0; finish(t === 'w' ? 'b' : 'w', 'on time'); }
}
/* ---------- Bot thinking runs in a Web Worker, so the board stays usable while the bot thinks ---------- */
let W = null, wid = 0; const wait = {};
function worker() {
  if (W) return W;
  try {
    W = new Worker(URL.createObjectURL(new Blob(['(' + engineMain.toString() + ')()'], { type: 'text/javascript' })));
    W.onmessage = e => { const f = wait[e.data.id]; delete wait[e.data.id]; f && f(e.data.m); };
    W.onerror = () => { W = null; Object.keys(wait).forEach(k => { wait[k](null); delete wait[k]; }); };
  } catch (e) { W = null; }
  return W;
}
function killWorker() { if (W) { W.terminate(); W = null; } }
function askBot(moves, bot) {
  return new Promise(res => {
    const w = worker();
    if (!w) { let out = null; const S = {}; new Function('self', 'postMessage', '(' + engineMain.toString() + ')()')(S, r => { out = r; }); S.onmessage({ data: { id: 0, moves, bot } }); return res(out && out.m); }   // no worker support: think on the page itself
    const id = ++wid; wait[id] = res; w.postMessage({ id, moves, bot });
  });
}
function quip(b, mv) {   // the alien's running commentary
  if (!b.say || P.g.in_checkmate()) return; const r = Math.random();
  if (P.g.in_check() && r < .7) P.say = pick(b.say.check); else if (mv.captured && r < .45) P.say = pick(b.say.cap); else if (r < .2) P.say = pick(b.say.move);
}
function bookMove(bot) {   // plays the bot's solid opening lines while the game follows them
  const h = P.g.history().map(stripCk);
  if (bot.lines) {   // the bot's own repertoire
    const c = []; for (const ln of bot.lines[h.length % 2 ? 'b' : 'w']) { const a = ln.split(' '); if (a.length > h.length && h.every((s, i) => s === a[i])) c.push(a[h.length]); }
    if (c.length) { const s = c[Math.random() * c.length | 0], m = P.g.moves({ verbose: true }).find(x => stripCk(x.san) === s); if (m) return m.from + m.to + (m.promotion || ''); }
  }
  const bk = bot.book; if (!bk || h.length >= bk.plies) return null; openingOf([]);
  const names = bk[h.length % 2 ? 'b' : 'w'], c = [];
  for (const l of OPL) if ((!names || names.includes(l.o)) && l.m.length > h.length && h.every((s, i) => s === l.m[i])) c.push(l.m[h.length]);
  if (!c.length) return null; const s = c[Math.random() * c.length | 0], m = P.g.moves({ verbose: true }).find(x => stripCk(x.san) === s);
  return m ? m.from + m.to + (m.promotion || '') : null;
}
function botMove() {
  P.think = true; const tk = P.tok = (P.tok || 0) + 1, t0 = Date.now(), bc = P.me === 'w' ? 'b' : 'w', left = Math.max(300, P.clk[bc] - (Date.now() - P.ts)),
    B0 = BOTS[P.bot], bot = { ...B0, t: Math.min(B0.t || 1e9, Math.max(60, left / 25)) }, moves = P.g.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || '')), bk = bookMove(B0);
  (bk ? Promise.resolve(bk) : B0.rand ? Promise.resolve(null) : askBot(moves, bot)).then(m => setTimeout(() => {
    if (!P.on || tk !== P.tok) return; const ms = P.g.moves({ verbose: true }); if (!ms.length) return;
    P.think = false; let pick = ms.find(x => x.from + x.to + (x.promotion || '') === m);
    if (!pick) { const caps = ms.filter(x => x.captured); pick = B0.rand === 2 && caps.length && Math.random() < .35 ? caps[Math.random() * caps.length | 0] : ms[Math.random() * ms.length | 0]; }
    const mv = P.g.move(pick);
    clockMove(bc); P.B.play(mv); quip(B0, mv); if (!endCheck()) { status(); setTimeout(() => P.B.autoPre(), 150); }       // then play your premove, if any
  }, Math.max(0, Math.min(1000, left / 30) - (Date.now() - t0))));
}
function endCheck() { if (P.g.game_over()) { finish(P.g.in_checkmate() ? (P.g.turn() === 'w' ? 'b' : 'w') : 'd'); return true; } return false; }
function finish(w, why) {
  if (!P.on) return; P.on = false; P.over = true; P.think = false; killWorker(); P.tok++; clearInterval(P.iv); P.B.pre = [];
  const bt = BOTS[P.bot], d = D(), sc = w === 'd' ? .5 : w === P.me ? 1 : 0, E = 1 / (1 + 10 ** ((bt.r - d.rating) / 400)), delta = Math.round(32 * (sc - E));
  d.rating += delta; d.peak = Math.max(d.peak || 0, d.rating); if (sc === 1 && bt.chal) { d.tw = d.tw || {}; d.titles = d.titles || []; d.tw[bt.title] = (d.tw[bt.title] || 0) + 1; if (d.tw[bt.title] >= 3 && !d.titles.includes(bt.title)) { d.titles.push(bt.title); P.earned = bt.title; setMyTitle(bt.title); } }
  if (sc === 1) { d.w = (d.w || 0) + 1; d.beat = d.beat || {}; d.beat[bt.n] = (d.beat[bt.n] || 0) + 1; } d.games.unshift({ s: sc, b: bt.n, d: delta, n: P.g.history().length }); d.games = d.games.slice(0, 40);
  saveGame({ mode: 'Bot', opp: bt.n, oppR: bt.r, me: P.me, res: w, why: why || '', tc: P.tc.l, mv: P.g.history().join(' '), tl: (P.tl || []).join(' '), op: P.openName || '', delta }); persist();
  P.msg = (sc === 1 ? 'You won' : sc === .5 ? 'Draw' : 'You lost') + (why ? ' ' + why : '') + `. Elo ${delta >= 0 ? '+' : ''}${delta} → ${d.rating}`;
  if (bt.chal && sc === 1) P.msg += P.earned ? ` You earned the ${P.earned} title!` : ` Progress: ${d.tw[bt.title]}/3.`; P.earned = null;
  if (BOTS[P.bot].say) P.say = pick(BOTS[P.bot].say[sc === 1 ? 'lose' : sc === .5 ? 'draw' : 'win']);
  panel();
}

/* ---------- Puzzles ---------- */
const PZ = [
  ['6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'mate', 'Mate in one: the back rank.'],
  ['r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'mate', 'Mate in one: Scholar’s mate.'],
  ['k7/8/1K6/8/8/8/8/7R w - - 0 1', 'mate', 'Mate in one: rook and king.'],
  ['6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', 'mate', 'Mate in one: the smothered mate.'],
  ['7k/3R4/5N2/8/8/8/8/6K1 w - - 0 1', 'mate', 'Mate in one: the Arabian mate.'],
  ['8/4N1pk/8/8/8/8/8/K2R4 w - - 0 1', 'mate', 'Mate in one: Anastasia’s mate.'],
  ['1bkr4/3p4/8/1B6/5B2/8/8/6K1 w - - 0 1', 'mate', 'Mate in one: Boden’s mate.'],
  ['4k3/1q6/8/8/4N3/8/8/4K3 w - - 0 1', 'e4d6', 'Win the queen: find the knight fork.']
];
let Z = { i: 0, done: false };
/* ---------- 100 more puzzles (generated with the chess rules, so every one is legal and has a checked answer) ---------- */
const BASE = PZ.length, TARGET = 100, PAT = ['mate', 'win', 'mate', 'fork', 'mate', 'win', 'mate', 'fork', 'mate', 'win'];
const TT = { mate: 'Mate in one: find the checkmate.', win: 'Win material: take the piece that can’t be recaptured.', fork: 'Win material: find the knight fork.' };
let seed = 20260, GEN = { n: 0, att: 0, run: false, done: false };
function rnd() { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const ri = n => rnd() * n | 0, pick = a => a[ri(a.length)], nameOf = s => 'abcdefgh'[s & 7] + (8 - (s >> 3)), sqi = n => (8 - n[1]) * 8 + 'abcdefgh'.indexOf(n[0]);
const EDGE = [...Array(64).keys()].filter(s => { const r = s >> 3, c = s & 7; return !r || r == 7 || !c || c == 7; });
const knSq = s => { const r = s >> 3, c = s & 7, o = []; for (const [a, b] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) { const R = r + a, C = c + b; if (R >= 0 && R < 8 && C >= 0 && C < 8) o.push(R * 8 + C); } return o; };
const shuf = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rep = (n, f) => Array.from({ length: n }, f);
function build(sp) {
  const b = Array(64).fill(null); for (const [p, s] of sp) if (s != null) { if (b[s]) return null; b[s] = p; }
  for (const [p, s] of sp) { if (s != null) continue; let q, n = 0; const bad = () => b[q] || ((p === 'p' || p === 'P') && (q < 8 || q > 55)); do { q = ri(64); n++; } while (n < 100 && bad()); if (bad()) return null; b[q] = p; }
  return b;
}
function fenOf(b, t) { let f = ''; for (let r = 0; r < 8; r++) { let e = 0; for (let c = 0; c < 8; c++) { const p = b[r * 8 + c]; if (p) { f += (e || '') + p; e = 0; } else e++; } f += (e || '') + (r < 7 ? '/' : ''); } return f + ' ' + t + ' - - 0 1'; }
function legal(b) {
  const K = b.indexOf('K'), k = b.indexOf('k'); if (Math.abs((K >> 3) - (k >> 3)) < 2 && Math.abs((K & 7) - (k & 7)) < 2) return null;
  if (new Chess(fenOf(b, 'b')).in_check()) return null; const g = new Chess(fenOf(b, 'w')); return g.in_check() ? null : g;
}
function genMate() {
  const b = build([['k', ri(4) ? pick(EDGE) : ri(64)], ['K', null], ...pick([['Q'], ['R', 'R'], ['Q', 'R'], ['R', 'B'], ['Q', 'B'], ['Q', 'N'], ['R', 'N']]).map(p => [p, null]), ...rep(ri(3), () => ['P', null]), ...rep(ri(4), () => [pick(['p', 'p', 'p', 'r', 'b', 'n']), null])]);
  const g = b && legal(b); return g && g.moves({ verbose: true }).some(m => m.san.endsWith('#')) ? [fenOf(b, 'w'), 'mate'] : null;
}
function genWin() {
  const b = build([['k', null], ['K', null], ...pick([['R'], ['Q'], ['B', 'N'], ['R', 'B'], ['Q', 'N']]).map(p => [p, null]), ...rep(ri(2), () => ['P', null]), [pick(['q', 'r', 'b', 'n', 'r', 'b']), null], ...rep(ri(3), () => [pick(['p', 'p', 'r', 'b', 'n']), null])]);
  const g = b && legal(b); if (!g) return null; const ms = g.moves({ verbose: true }); if (ms.some(m => m.san.endsWith('#'))) return null;
  const safe = []; for (const m of ms) { if (!m.captured || V[m.captured] < 300) continue; g.move(m); const bad = g.moves({ verbose: true }).some(x => x.to === m.to); g.undo(); if (!bad) safe.push(m); }
  return safe.length === 1 ? [fenOf(b, 'w'), safe[0].from + safe[0].to] : null;
}
function genFork() {
  const F = ri(64), n = shuf(knSq(F)); if (n.length < 3) return null; const [ks, rs, ns] = n;
  const b = build([['k', ks], [pick(['r', 'r', 'q']), rs], ['N', ns], ['K', null], ...rep(ri(2), () => [pick(['B', 'P', 'R']), null]), ...rep(ri(3), () => [pick(['p', 'p', 'b', 'n']), null])]);
  const g = b && legal(b); if (!g) return null; const ms = g.moves({ verbose: true }); if (ms.some(m => m.san.endsWith('#'))) return null;
  const ok = []; for (const m of ms) { if (m.piece !== 'n' || !m.san.includes('+')) continue; g.move(m); const bad = g.moves({ verbose: true }).some(x => x.to === m.to); g.undo(); if (!bad && knSq(sqi(m.to)).some(s => b[s] === 'r' || b[s] === 'q')) ok.push(m); }
  return ok.length === 1 && ok[0].from === nameOf(ns) && ok[0].to === nameOf(F) ? [fenOf(b, 'w'), ok[0].from + ok[0].to] : null;
}
const GF = { mate: genMate, win: genWin, fork: genFork };
try { const c = JSON.parse(localStorage.getItem('tc_pz1') || 'null'); if (c && c.length >= 90) { PZ.push(...c); GEN.n = TARGET; GEN.done = true; } } catch (e) {}
function genStart() { if (!GEN.run && !GEN.done) { GEN.run = true; setTimeout(genTick, 30); } }
function genTick() {
  if (location.hash !== '#puzzles') { GEN.run = false; return; }
  const t0 = Date.now();
  while (Date.now() - t0 < 30 && GEN.n < TARGET) {
    const ty = PAT[GEN.n % PAT.length]; let p = null; try { p = GF[ty](); } catch (e) {} GEN.att++;
    if (p && !PZ.some(x => x[0] === p[0])) { PZ.push([p[0], p[1], TT[ty]]); GEN.n++; GEN.att = 0; } else if (GEN.att > 5000) { GEN.n++; GEN.att = 0; }
  }
  if (GEN.n >= TARGET) { GEN.done = true; GEN.run = false; try { localStorage.setItem('tc_pz1', JSON.stringify(PZ.slice(BASE))); } catch (e) {} }
  const e = $('#gp'); if (e) e.textContent = GEN.done ? '' : ' (loading more…)'; const g = $('#pg'); if (g) g.innerHTML = grid();
  if (!GEN.done) setTimeout(genTick, 25);
}
const grid = () => PZ.map((_, k) => `<button class="chip ${k == Z.i ? 'on' : ''}" style="padding:3px 9px" onclick="puzzleGo(${k})">${D().pz.includes(k) ? '✓' : k + 1}</button>`).join('');
function puzzleView() { genStart(); $('#app').innerHTML = layout(); Z.B = Board($('#bd'), { g: new Chess(PZ[Z.i][0]), can: c => !Z.done && c === 'w', onMove: puzzleMove }); puzzlePanel(''); }
function puzzlePanel(m) {
  const solved = D().pz;
  $('#pn').innerHTML = `<h2>Puzzles</h2><p class="mut">Puzzle ${Z.i + 1} of ${PZ.length}<span id="gp">${GEN.done ? '' : ' (loading more…)'}</span> · ${solved.length} solved</p><h3>${PZ[Z.i][2]}</h3><p>White to move.</p>
  <div class="stat">${m || 'Find the best move.'}</div>
  <div class="row"><button class="chip" onclick="puzzleGo(Z.i)">Restart</button><button class="btn" style="margin:0" onclick="puzzleGo((Z.i+1)%PZ.length)">Next puzzle</button></div>
  <div class="chips" id="pg" style="max-height:200px;overflow:auto">${grid()}</div>`;
}
function puzzleGo(i) { Z.i = i; Z.done = false; Z.B.g = new Chess(PZ[i][0]); Z.B.last = null; Z.B.sel = null; Z.B.draw(); puzzlePanel(''); }
function puzzleMove(mv) {
  const goal = PZ[Z.i][1], g = Z.B.g;
  if (goal === 'mate' ? g.in_checkmate() : mv.from + mv.to === goal) {
    Z.done = true; if (!D().pz.includes(Z.i)) { D().pz.push(Z.i); persist(); } puzzlePanel('Correct! ' + mv.san);
  } else { puzzlePanel('Not quite. Try again.'); setTimeout(() => { g.undo(); Z.B.last = null; Z.B.draw(); }, 700); }
}

/* ---------- Openings ---------- */
/* ---------- Openings: 20 openings x 6 variations (lines are checked with the chess rules when the page loads) ---------- */
const o = (n, side, idea, ...v) => [n, idea, v.map(x => x.split('|')), side];
const OP = [
  o('Italian Game', 'w', 'White develops fast and eyes the weak f7 square.',
    'Giuoco Piano|e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6', 'Evans Gambit|e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O', 'Two Knights|e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6',
    'Giuoco Pianissimo|e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 O-O d6 c3 a6', 'Fried Liver Attack|e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3 Ncb4', 'Max Lange Attack|e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d4 exd4 e5 d5 exf6 dxc4 Re1+ Be6'),
  o('Ruy Lopez', 'w', 'White pressures the knight that defends e5 and builds lasting pressure.',
    'Closed|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6', 'Berlin|e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8', 'Exchange|e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5',
    'Marshall Attack|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5 Nxe5 Nxe5 Rxe5 c6', 'Anti-Marshall|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O h3 Bb7 d3 d6 c3 Na5 Bc2 c5', 'Open Defence|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4 d4 b5 Bb3 d5 dxe5 Be6'),
  o('Scotch Game', 'w', 'White opens the centre at once for quick, open play.',
    'Main line|e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7', 'Scotch Gambit|e4 e5 Nf3 Nc6 d4 exd4 Bc4 Nf6 O-O Nxe4 Re1 d5 Bxd5 Qxd5 Nc3 Qa5', 'Four Knights|e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nc3 Bb4 Nxc6 bxc6 Bd3 d5 exd5 cxd5 O-O O-O',
    'Mieses Variation|e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6', 'Classical|e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7 Bc4 Ne5', 'Goring Gambit|e4 e5 Nf3 Nc6 d4 exd4 c3 dxc3 Nxc3 Nf6 Bc4 Bb4 O-O Bxc3 bxc3 Nxe4'),
  o('King’s Gambit', 'w', 'White offers the f-pawn to open the f-file and the centre.',
    'Kieseritzky|e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6', 'Cunningham|e4 e5 f4 exf4 Nf3 Be7 Bc4 Nf6 e5 Ng4 O-O Nc6', 'Falkbeer Countergambit|e4 e5 f4 d5 exd5 e4 d3 Nf6 dxe4 Nxe4 Nf3 Bc5',
    'Fischer Defence|e4 e5 f4 exf4 Nf3 d6 d4 g5 h4 g4 Ng1 Nf6', 'Bishop’s Gambit|e4 e5 f4 exf4 Bc4 Qh4+ Kf1 Bc5 Nf3 Qh6 d4 Bb6', 'Muzio Gambit|e4 e5 f4 exf4 Nf3 g5 Bc4 g4 O-O gxf3 Qxf3 Qf6 e5 Qxe5 d3'),
  o('Vienna Game', 'w', 'White develops the knight first and keeps f4 in reserve.',
    'Vienna Gambit|e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7 d3 Nxc3 bxc3', 'Frankenstein-Dracula|e4 e5 Nc3 Nf6 Bc4 Nxe4 Qh5 Nd6 Bb3 Nc6 Nb5 g6 Qf3 f5 Qd5 Qe7 Nxc7+ Kd8 Nxa8 b6', 'Bc4 Line|e4 e5 Nc3 Nf6 Bc4 Nxe4 Nxe4 d5 Bxd5 Qxd5 Nc3 Qa5',
    'Mieses Variation|e4 e5 Nc3 Nc6 Bc4 Nf6 d3 Na5 Bb3 Nxb3 axb3 d6', 'Bc5 Line|e4 e5 Nc3 Bc5 Nf3 d6 Na4 Bb6 Nxb6 axb6 d4 exd4 Nxd4 Nf6', 'Vienna with g3|e4 e5 Nc3 Nf6 g3 d5 exd5 Nxd5 Bg2 Nxc3 bxc3 Bd6'),
  o('Queen’s Gambit', 'w', 'White offers a pawn to pull Black’s central pawn away.',
    'Declined|d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O', 'Accepted|d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6', 'Slav Defense|d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4',
    'Semi-Slav|d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5', 'Tarrasch Defence|d4 d5 c4 e6 Nc3 c5 cxd5 exd5 Nf3 Nc6 g3 Nf6 Bg2 Be7', 'Albin Counter-Gambit|d4 d5 c4 e5 dxe5 d4 Nf3 Nc6 g3 Be6'),
  o('London System', 'w', 'A reliable setup you can play against almost anything.',
    'Versus d5|d4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6', 'Versus King’s Indian setup|d4 Nf6 Bf4 g6 Nf3 Bg7 e3 d6 h3 O-O', 'Jobava London|d4 d5 Nc3 Nf6 Bf4 e6 e3 c5 Nb5 Na6',
    'Versus …c5|d4 d5 Bf4 c5 e3 Nc6 c3 Qb6 Qb3 c4 Qc2 Bf5', 'Versus …g6|d4 d5 Bf4 Nf6 e3 g6 Nf3 Bg7 Be2 O-O h3 Bf5', 'Versus Queen’s Indian setup|d4 Nf6 Bf4 e6 e3 c5 c3 b6 Nd2 Bb7 Ngf3'),
  o('English Opening', 'w', 'A flexible flank opening that controls d5 from the side.',
    'Reversed Sicilian|c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5', 'Symmetrical|c4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 Nf6 O-O O-O', 'Four Knights English|c4 e5 Nc3 Nf6 Nf3 Nc6 e3 Bb4 Qc2 Bxc3 bxc3 d6 Be2 O-O',
    'Botvinnik System|c4 e5 Nc3 Nc6 g3 g6 Bg2 Bg7 e4 d6 Nge2 Nge7 O-O O-O d3', 'Flohr-Mikenas Attack|c4 Nf6 Nc3 e6 e4 d5 e5 d4 exf6 dxc3 bxc3 Qxf6', 'Slav-style (…c6)|c4 c6 Nf3 d5 e3 Nf6 Nc3 e6 d4 Nbd7 Qc2 Bd6'),
  o('Réti Opening', 'w', 'White controls the centre with pieces instead of pawns.',
    'King’s Indian Attack|Nf3 d5 g3 Nf6 Bg2 c6 O-O Bg4 d3 Nbd7 Nbd2 e5 e4 Bd6', 'Queenside Fianchetto|Nf3 Nf6 c4 g6 b4 Bg7 Bb2 O-O e3 d6 Be2 Nbd7', 'Slav setup|Nf3 d5 c4 c6 b3 Nf6 g3 Bf5 Bb2 e6 Bg2 Nbd7',
    'Advance Variation|Nf3 d5 c4 d4 e3 Nc6 exd4 Nxd4 Nxd4 Qxd4 Nc3', 'Classical Réti|Nf3 d5 c4 e6 g3 Nf6 Bg2 Be7 O-O O-O b3', 'Réti vs …c5|Nf3 d5 g3 c5 Bg2 Nc6 O-O e5 d3 Nf6'),
  o('Catalan', 'w', 'The bishop on g2 pressures the long diagonal against Black’s queenside.',
    'Open Catalan|d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4', 'Closed Catalan|d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O Nbd7 Qc2 c6 Nbd2 b6', 'With …Bb4+|d4 Nf6 c4 e6 g3 Bb4+ Bd2 Be7 Bg2 d5 Nf3 O-O O-O',
    'With Qa4+|d4 Nf6 c4 e6 g3 d5 Bg2 dxc4 Qa4+ Nbd7 Qxc4 a6 Nf3 b5 Qc2 Bb7', 'Reversed order|d4 d5 c4 e6 g3 Nf6 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6 Qxc4 b5 Qc2 Bb7 Bd2', 'Catalan with …c6|d4 Nf6 c4 e6 g3 d5 Bg2 Bb4+ Bd2 Be7 Nf3 O-O O-O c6'),
  o('Polish Opening', 'w', '1.b4, also called the Sokolsky or Orangutan: White grabs queenside space and aims the bishop down the long diagonal.',
    'Main line (2…Bxb4)|b4 e5 Bb2 Bxb4 Bxe5 Nf6 Nf3 O-O e3 d6 Bb2 Nc6', 'Reply 1…d5|b4 d5 Bb2 Nf6 b5 e6 e3 Bd6 Nf3 O-O', 'Birmingham Gambit|b4 c5 bxc5 e6 Bb2 Bxc5 e3 Nf6 Nf3 d5',
    'Orangutan (1…Nf6)|b4 Nf6 Bb2 g6 b5 Bg7 Nf3 O-O e3 d6 c4 Nbd7', 'Schiffler-Sokolsky|b4 e5 Bb2 f6 e4 Bxb4 Bc4 Nc6 f4 d5', 'Bishop trade|b4 e5 Bb2 Bxb4 Bxe5 Nf6 Bxf6 Qxf6 c3 Bd6'),
  o('Sicilian Defense', 'b', 'Black’s most combative reply to 1.e4: a flank pawn trades for a central one.',
    'Najdorf|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6', 'Dragon|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6', 'Sveshnikov|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5',
    'Alapin|e4 c5 c3 d5 exd5 Qxd5 d4 Nf6 Nf3 e6 Be2 Nc6', 'Closed Sicilian|e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6', 'Taimanov|e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6'),
  o('French Defense', 'b', 'Black builds a solid pawn chain and hits back at White’s centre.',
    'Classical|e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7', 'Advance|e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 Nh6', 'Tarrasch|e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6 Ne2 cxd4 cxd4 f6',
    'Winawer|e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7', 'Exchange|e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O', 'Steinitz|e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 cxd4'),
  o('Caro-Kann', 'b', 'A very solid reply: Black prepares d5 with c6 and keeps a healthy structure.',
    'Classical|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6', 'Advance|e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 O-O Nc6', 'Panov Attack|e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7',
    'Exchange|e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4', 'Two Knights|e4 c6 Nc3 d5 Nf3 dxe4 Nxe4 Bg4 h3 Bxf3 Qxf3 e6', 'Fantasy|e4 c6 f3 d5 exd5 cxd5 c4 Nf6 Nc3 e6 d4 Be7'),
  o('Scandinavian', 'b', 'Black strikes at e4 on move one with the d-pawn.',
    'Main line|e4 d5 exd5 Qxd5 Nc3 Qa5 d4 c6 Nf3 Nf6', 'Modern|e4 d5 exd5 Nf6 d4 Nxd5 Nf3 g6 Be2 Bg7', 'Portuguese|e4 d5 exd5 Nf6 d4 Bg4 Nf3 Nxd5 Be2 e6 O-O Nc6',
    'Icelandic-Palme Gambit|e4 d5 exd5 Nf6 c4 e6 dxe6 Bxe6 d4 Bb4+ Nc3 O-O', '3…Qd6|e4 d5 exd5 Qxd5 Nc3 Qd6 d4 Nf6 Nf3 a6 g3 Bg4 Bg2 Nc6', '3…Qd8|e4 d5 exd5 Qxd5 Nc3 Qd8 d4 Nf6 Nf3 c6 Bc4 Bf5'),
  o('Pirc Defense', 'b', 'Black lets White build a big centre, then attacks it.',
    'Austrian Attack|e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 O-O', 'Classical|e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6', '150 Attack|e4 d6 d4 Nf6 Nc3 g6 Be3 Bg7 Qd2 c6 f3 b5',
    'Byrne Variation|e4 d6 d4 Nf6 Nc3 g6 Bg5 Bg7 Qd2 h6 Bh4 g5 Bg3 Nh5', 'Fianchetto|e4 d6 d4 Nf6 Nc3 g6 g3 Bg7 Bg2 O-O Nge2 c6 O-O Nbd7', 'Bc4 Line|e4 d6 d4 Nf6 Nc3 g6 Bc4 Bg7 Qe2 O-O Bg5 c6'),
  o('Alekhine Defense', 'b', 'Black invites White’s pawns forward so they can become targets.',
    'Classical (4.Nf3)|e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7', 'Modern|e4 Nf6 e5 Nd5 d4 d6 Nf3 g6 Bc4 Nb6 Bb3 Bg7', 'Exchange|e4 Nf6 e5 Nd5 d4 d6 c4 Nb6 exd6 cxd6 Nc3 g6 Be3 Bg7',
    'Chase Variation|e4 Nf6 e5 Nd5 c4 Nb6 c5 Nd5 Bc4 e6 Qb3 Nb4', 'Four Pawns Attack|e4 Nf6 e5 Nd5 c4 Nb6 d4 d6 f4 dxe5 fxe5 Nc6 Be3 Bf5', 'Modern with …dxe5|e4 Nf6 e5 Nd5 d4 d6 Nf3 dxe5 Nxe5 c6 Be2 Nd7 Nxd7 Bxd7'),
  o('Petrov Defense', 'b', 'Black copies White’s knight move and counterattacks e4.',
    'Classical|e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7', 'Steinitz Attack|e4 e5 Nf3 Nf6 d4 Nxe4 Bd3 d5 Nxe5 Nd7 Nxd7 Bxd7 O-O Bd6', 'Cochrane Gambit|e4 e5 Nf3 Nf6 Nxe5 d6 Nxf7 Kxf7 d4 Nxe4 Bd3 Nf6',
    'Nimzowitsch Attack|e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 Nc3 Nxc3 dxc3 Be7 Be3 Nc6', 'Kaufmann Attack|e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 Qe2 Qe7 Qxe4 d5 Qe2 Qxe2+ Bxe2 Be7', 'Three Knights|e4 e5 Nf3 Nf6 Nc3 Nc6 Bb5 Bb4 O-O O-O d3 Bxc3 bxc3 d6'),
  o('King’s Indian', 'b', 'Black lets White take the centre, then attacks it with pieces and pawns.',
    'Classical|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7', 'Sämisch|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 e5 d5 Nh5', 'Fianchetto|d4 Nf6 c4 g6 g3 Bg7 Bg2 O-O Nc3 d6 Nf3 Nbd7 O-O e5',
    'Four Pawns Attack|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4 O-O Nf3 c5 d5 e6', 'Averbakh|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Be2 O-O Bg5 c5 d5 e6', 'Petrosian|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 d5 a5 Bg5 h6'),
  o('Nimzo-Indian', 'b', 'Black pins the knight on c3 to fight for control of e4.',
    'Rubinstein|d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6', 'Classical (4.Qc2)|d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6 Bg5 Bb7', 'Sämisch|d4 Nf6 c4 e6 Nc3 Bb4 a3 Bxc3+ bxc3 c5 e3 Nc6 Bd3 O-O',
    'Leningrad|d4 Nf6 c4 e6 Nc3 Bb4 Bg5 h6 Bh4 c5 d5 d6 e3 exd5 cxd5 g5', 'Kasparov (4.Nf3)|d4 Nf6 c4 e6 Nc3 Bb4 Nf3 c5 e3 Nc6 Bd3 Bxc3+ bxc3 d6', 'Hübner|d4 Nf6 c4 e6 Nc3 Bb4 e3 c5 Bd3 Nc6 Nf3 Bxc3+ bxc3 d6'),
  o('Alien Gambit', 'w', 'Invented by streamer Witty_Alien: against the Caro-Kann, White sacrifices a knight on f7 to drag the black king out and wreck the kingside.',
    'Main line (7…c5)|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 c5 Bc4+ e6 dxc5', '3.Nd2 move order|e4 c6 d4 d5 Nd2 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 c5 Bc4+ e6 dxc5', '7…Bf5|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 Bf5 Ne5+ Kg8 Bc4+ e6 g4',
    '7…e6|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 e6 Ne5+ Kg7 Bc4', '7…Bg4|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 Bg4 Ne5+ Kg8 Bc4+ e6 Nxg4 Nxg4'),
  o('Martian Gambit', 'w', 'Another Witty_Alien invention against the Caro-Kann: after 4…Bf5 White throws the knights forward to attack the weak light squares around the black king.',
    'Main line|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6', '…Qd7|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6 Qd7 Nxf8 Kxf8 Bd3 Bxd3 Qxd3', '…fxe6|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 h6 Ne6 fxe6 Bc4 Nf6 Bxe6 Qd7',
    '6…Nd7|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 Nd7 Bc4 e6 Qe2 Ngf6', '6…e6|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng5 Bg6 N1f3 e6 Bd3 Bxd3 Qxd3 h6 Ne4'),
  o('Elephant Gambit', 'b', 'Black answers 1.e4 e5 2.Nf3 with the pawn thrust 2…d5, challenging the centre at once and accepting a messy fight.',
    'Main line|e4 e5 Nf3 d5 exd5 e4 Qe2 Nf6 d3 Bd6', '3.Nxe5|e4 e5 Nf3 d5 Nxe5 dxe4 Nc3 Nf6 Nxe4 Bd6', '3.Nxe5 Nc6|e4 e5 Nf3 d5 Nxe5 Nc6 Nxc6 bxc6 d3 Nf6',
    '3.Nc3|e4 e5 Nf3 d5 Nc3 dxe4 Nxe5 Nf6 Bc4 Bd6', '4.Nd4|e4 e5 Nf3 d5 exd5 e4 Nd4 Qxd5 Nc3 Qe5 Qe2 Nf6'),
  o('Danish Gambit', 'w', 'White gives up two pawns for a huge lead in development and a strong pair of bishops aimed at the black king.',
    'Accepted|e4 e5 d4 exd4 c3 dxc3 Bc4 cxb2 Bxb2', 'Declined (3…d5)|e4 e5 d4 exd4 c3 d5 exd5 Qxd5 cxd4 Nc6', '3…Nf6|e4 e5 d4 exd4 c3 Nf6 e5 Ne4 Bd3 d5 exd6 Nxd6 cxd4 Bf5',
    '4…Nc6|e4 e5 d4 exd4 c3 dxc3 Nxc3 Nc6 Bc4 Bb4 Nge2 Nf6', 'Queen trap|e4 e5 d4 exd4 c3 dxc3 Bc4 cxb2 Bxb2 d5 Bxd5 Nf6 Bxf7+ Kxf7 Qxd8 Bb4+'),
  o('Blackmar-Diemer Gambit', 'w', 'White offers the e-pawn for rapid development and a fast kingside attack down the half-open f-file.',
    'Ryder|d4 d5 e4 dxe4 Nc3 Nf6 f3 exf3 Nxf3 Bg4 h3 Bxf3 Qxf3 e6 Bd3', 'Euwe (4…e5)|d4 d5 e4 dxe4 Nc3 Nf6 f3 e5 dxe5 Qxd1+ Kxd1 Ng4 Bf4 Nc6', 'Bg5 Variation|d4 d5 e4 dxe4 Nc3 Nf6 Bg5 Bf5 g4 Bg6 Nge2 Nbd7',
    'Main line|d4 d5 e4 dxe4 Nc3 Nf6 f3 exf3 Qxf3 e6 Bg5 Be7 O-O-O O-O', 'Teichmann|d4 d5 e4 dxe4 Nc3 Nf6 Bg5 Nbd7 f3 exf3 Qxf3 e6 O-O-O'),
  o('Smith-Morra Gambit', 'w', 'Against the Sicilian, White sacrifices the c-pawn for fast development and open lines against the black king.',
    'Main line|e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 d6 Bc4 e6 O-O Nf6 Qe2 Be7 Rd1 e5', 'With Qb3|e4 c5 d4 cxd4 c3 dxc3 Nxc3 d6 Bc4 Nf6 Qb3 e6 Nf3 Nc6', '3…Nf6|e4 c5 d4 cxd4 c3 Nf6 e5 Nd5 cxd4 e6 Nf3 Nc6 Bc4 Nb6',
    '3…d5|e4 c5 d4 cxd4 c3 d5 exd5 Qxd5 cxd4 Nf6 Nc3 Qd8 Nf3 e6', 'Nc6 line|e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 e6 Bc4 a6 O-O Nge7 Qe2 Ng6'),
  o('Budapest Gambit', 'b', 'Black answers 1.d4 Nf6 2.c4 with 2…e5, giving a pawn for quick piece play and attacking chances.',
    'Adler|d4 Nf6 c4 e5 dxe5 Ng4 Bf4 Nc6 Nf3 Bb4+ Nbd2 Qe7 e3 Ngxe5', 'Main line (Qd5)|d4 Nf6 c4 e5 dxe5 Ng4 Nf3 Nc6 Bf4 Bb4+ Nc3 Qe7 Qd5 Bxc3+ bxc3 f6', 'Rubinstein|d4 Nf6 c4 e5 dxe5 Ng4 Bf4 Nc6 Nf3 Bb4+ Nbd2 Qe7 a3 Ngxe5 axb4 Nxf3+ gxf3 Qxb4',
    'Fajarowicz|d4 Nf6 c4 e5 dxe5 Ne4 Nf3 d6 exd6 Bxd6 Nc3 Nxc3 bxc3 O-O', 'Bf4 line|d4 Nf6 c4 e5 dxe5 Ng4 Bf4 Bb4+ Nd2 Nc6 a3 Ngxe5 axb4 Nxc4'),
  o('Englund Gambit', 'b', 'A tricky pawn sacrifice against 1.d4: Black plays 1…e5 hoping White falls into the many traps that follow.',
    'Main line|d4 e5 dxe5 Nc6 Nf3 Qe7 Bf4 Qb4+ Bd2 Qxb2 Bc3 Bb4', 'Soller Gambit|d4 e5 dxe5 Nc6 Nf3 Qe7 Qd5 f6 exf6 Nxf6 Qb5 Qb4+', 'Hartlaub|d4 e5 dxe5 d6 exd6 Bxd6 Nf3 Nf6 Nc3 O-O',
    'Nbd2 line|d4 e5 dxe5 Nc6 Nf3 Qe7 Bf4 Qb4+ Nbd2 Nxe5 a3 Nxf3+ Nxf3 Qxb2', '…g5 line|d4 e5 dxe5 Nc6 Nf3 Qe7 Bf4 g5 Bg3 Bg7 Nc3 Nxe5'),
  o('Latvian Gambit', 'b', 'After 1.e4 e5 2.Nf3 Black plays the aggressive 2…f5, trading solidity for a wild attack on the white king.',
    'Main line|e4 e5 Nf3 f5 Nxe5 Qf6 d4 d6 Nc4 fxe4 Nc3 Qg6 Ne3 Nf6 Be2 Be7', 'Greco|e4 e5 Nf3 f5 Bc4 fxe4 Nxe5 Qg5 Nxf7 Qxg2 Rf1 Qxe4+ Be2 Nf6 Nxh8 d5', '3.Nxe5 Nc6|e4 e5 Nf3 f5 Nxe5 Nc6 Nxc6 dxc6 d3 Nf6 Be2 Bd6',
    '3.d4|e4 e5 Nf3 f5 d4 fxe4 Nxe5 Nf6 Bg5 Be7', '3.Nc3|e4 e5 Nf3 f5 Nc3 fxe4 Nxe4 Qe7 Ng3 Nf6 d4 d6')
];
OP.forEach(p => { p[2] = p[2].map(v => { const g = new Chess(), ok = []; for (const s of v[1].split(' ')) { const m = g.move(s, { sloppy: true }); if (!m) break; ok.push(m.san); } return [v[0], ok.join(' ')]; }).filter(v => v[1].split(' ').length >= 4); });
let O = { i: 0, v: 0, n: 0 };
function openingsView() { $('#app').innerHTML = layout(); O.B = Board($('#bd'), { g: new Chess(), can: () => false }); showOpening(O.i, O.v, 0); }
function showOpening(i, v, n) {
  if (!O.narr) stopVoice();
  O.i = i; O.v = v; const op = OP[i], line = op[2][v], mv = line[1].split(' '); O.n = Math.max(0, Math.min(mv.length, n));
  const g = new Chess(); let last = null; for (let k = 0; k < O.n; k++) { const m = g.move(mv[k], { sloppy: true }); last = m && [m.from, m.to]; }
  O.B.g = g; O.B.last = last; O.B.flip = op[3] === 'b'; O.B.draw();
  $('#pn').innerHTML = `<h2>Openings</h2><div class="chips">${OP.map((x, k) => `<button class="chip ${k == i ? 'on' : ''}" onclick="showOpening(${k},0,0)">${x[0]}</button>`).join('')}</div>
  <h3>${op[0]}</h3><p>${op[1]}</p><div class="chips">${op[2].map((x, k) => `<button class="chip ${k == v ? 'on' : ''}" onclick="showOpening(${i},${k},0)">${x[0]}</button>`).join('')}</div>
  <div class="mv">${mv.map((x, k) => (k % 2 ? '' : `<span class="mut">${k / 2 + 1}.</span> `) + x).join(' ')}</div>${O.n > 0 ? `<p style="background:var(--tint);padding:10px 12px;border-radius:10px;font-size:15px;margin:10px 0 0">${explain(i, v, O.n)}</p>` : ''}
  <div class="row"><button class="chip" onclick="showOpening(${i},${v},0)">|&lt;</button><button class="chip" onclick="showOpening(${i},${v},O.n-1)">&lt; Back</button><button class="chip" onclick="showOpening(${i},${v},O.n+1)">Next &gt;</button>
  <button class="btn" style="margin:0" onclick="narrate(${i},${v})">Explain with voice</button><button class="chip" onclick="stopVoice()">Stop voice</button></div>`;
}
/* ---------- Opening commentary ---------- */
const PN={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};
const sqn=(r,c)=>'abcdefgh'[c]+(8-r),rcOf=s=>[8-s[1],'abcdefgh'.indexOf(s[0])];
function atkSet(bd,r,c){const p=bd[r][c];if(!p)return[];const out=[],add=(a,b)=>{if(a>=0&&a<8&&b>=0&&b<8)out.push([a,b])},t=p.type;
 if(t==='n')for(const[a,b]of[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]])add(r+a,c+b);
 else if(t==='k'){for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)if(a||b)add(r+a,c+b)}
 else if(t==='p'){const d=p.color==='w'?-1:1;add(r+d,c-1);add(r+d,c+1)}
 else for(const[a,b]of t==='b'?DR:t==='r'?OR:DR.concat(OR)){let rr=r+a,cc=c+b;while(rr>=0&&rr<8&&cc>=0&&cc<8){out.push([rr,cc]);if(bd[rr][cc])break;rr+=a;cc+=b}}
 return out}
function pinsFrom(bd,r,c){const p=bd[r][c];if(!p||'bqr'.indexOf(p.type)<0)return[];const out=[];
 for(const[a,b]of p.type==='b'?DR:p.type==='r'?OR:DR.concat(OR)){let rr=r+a,cc=c+b,f=null;
  while(rr>=0&&rr<8&&cc>=0&&cc<8){const q=bd[rr][cc];if(q){if(!f){if(q.color===p.color||q.type==='k')break;f=[q,rr,cc]}else{if(q.color!==p.color&&(q.type==='k'||V[q.type]>V[f[0].type]))out.push([f,[q,rr,cc]]);break}}rr+=a;cc+=b}}
 return out}
function defended(bd,r,c,col){for(let a=0;a<8;a++)for(let b=0;b<8;b++){const q=bd[a][b];if(q&&q.color===col&&(a!==r||b!==c)&&atkSet(bd,a,b).some(x=>x[0]===r&&x[1]===c))return true}return false}
function mvInfo(i,vi,n){const mv=OP[i][2][vi][1].split(' '),g=new Chess(),cnt={};
 for(let k=0;k<n;k++){const bd0=g.board(),m=g.move(mv[k],{sloppy:true});if(!m)return null;const prior=cnt[m.from]||0;delete cnt[m.from];cnt[m.to]=prior+1;if(k===n-1)return{g,bd0,m,prior}}
 return null}
function explain(i,vi,n){const I=mvInfo(i,vi,n);if(!I)return'';const{g,bd0,m,prior}=I,bd=g.board(),w=m.color==='w',C=w?'White':'Black',E=w?'Black':'White',e=E.toLowerCase(),
 [r,c]=rcOf(m.to),[fr]=rcOf(m.from),pt=PN[m.piece],cap=!!m.captured,cast=m.flags.includes('k')||m.flags.includes('q'),home=w?7:0,dev=(m.piece==='n'||m.piece==='b')&&fr===home&&!cap,why=[],tac=[],ext=[];
 let L;
 if(cast)L=`${C} castles ${m.flags.includes('k')?'kingside':'queenside'}.`;
 else if(cap)L=`${C} captures the ${PN[m.captured]} on ${m.to} with the ${pt} from ${m.from}${m.flags.includes('e')?', en passant':''}.`;
 else if(m.piece==='p')L=`${C} pushes the pawn from ${m.from} to ${m.to}${Math.abs(r-fr)===2?', two squares forward':''}.`;
 else if(dev)L=`${C} develops the ${pt} from ${m.from} to ${m.to}.`;
 else L=`${C} moves the ${pt} from ${m.from} to ${m.to}.`;
 const cen=[[3,3],[3,4],[4,3],[4,4]],at=cast?[]:atkSet(bd,r,c),cs=at.filter(x=>cen.some(y=>y[0]===x[0]&&y[1]===x[1])).map(x=>sqn(x[0],x[1]));
 if(cast)why.push('This tucks the king safely behind its pawns and brings the rook toward the centre, so the king is protected and the rooks can start working together.');
 else if(m.piece==='p'){
  if(!cap&&(c===3||c===4)&&(r===3||r===4))why.push('This pawn claims space in the centre, the most important part of the board, and it opens lines for the bishop and the queen.');
  else if(cap)why.push(`The capture changes the pawn structure and opens a line, so ${C} gets more active play.`);
  else if(c<=1||c>=6)why.push(`A flank pawn move like this gains space on the ${c<=2?'queenside':'kingside'} and can prepare play there.`);
  else why.push('This supports the centre and prepares to bring more pieces out.');
  const sup=at.map(x=>[bd[x[0]][x[1]],x]).filter(y=>y[0]&&y[0].color===m.color);
  if(sup.length&&!cap)why.push(`It also protects the ${PN[sup[0][0].type]} on ${sqn(sup[0][1][0],sup[0][1][1])}.`)}
 else if(dev)why.push('Developing a minor piece early is a basic opening principle, because it brings a new attacker into the game.');
 if((m.piece==='n'||m.piece==='b'||m.piece==='q')&&cs.length)why.push(`From ${m.to} it controls ${cs.join(' and ')} in the centre.`);
 if(m.piece==='r'&&!cast){let own=0,en=0;for(let a=0;a<8;a++){const q=bd[a][c];if(q&&q.type==='p')q.color===m.color?own++:en++}
  why.push(own===0&&en===0?'The rook lands on a fully open file, where it has plenty of room to work.':own===0?'The rook takes a semi-open file, which points it straight at the enemy pawns.':'The rook joins the action and prepares to use the files that open up later.')}
 if(m.piece==='q'&&n<=10&&!cap)why.push('Bringing the queen out this early is risky, because the opponent can attack her and gain time. It only makes sense when it creates a real threat.');
 if(m.piece==='k'&&!cast)why.push('Moving the king like this gives up castling, so it should have a concrete reason.');
 if((m.piece==='n'||m.piece==='b')&&prior>=1&&!cap)why.push('This piece has already moved before, which costs time in the opening unless it creates a threat.');
 if(!cast){const tg=at.map(x=>[bd[x[0]][x[1]],x]).filter(y=>y[0]&&y[0].color!==m.color&&y[0].type!=='k').sort((a,b)=>V[b[0].type]-V[a[0].type]);
  if(tg.length){const y=tg[0],nm2=`${PN[y[0].type]} on ${sqn(y[1][0],y[1][1])}`;
   tac.push(defended(bd,y[1][0],y[1][1],y[0].color)?`It now attacks the ${e} ${nm2}, which is protected for the moment.`:`It now attacks the ${e} ${nm2}, and nothing is defending it, so that is a real threat.`)}
  const pn=pinsFrom(bd,r,c)[0];
  if(pn){const[f,q]=pn;tac.push(q[0].type==='k'?`It pins the ${PN[f[0].type]} on ${sqn(f[1],f[2])} to the king, so that piece can’t move without exposing the king.`:`It lines up the ${PN[f[0].type]} on ${sqn(f[1],f[2])} in front of the ${PN[q[0].type]} on ${sqn(q[1],q[2])}, so moving it would expose the more valuable piece.`)}}
 if(g.in_checkmate())tac.unshift('That is checkmate!');else if(g.in_check())tac.unshift(`This gives check, so ${E} has to answer it immediately.`);
 if(cap){const rec=g.moves({verbose:true}).some(x=>x.to===m.to&&x.captured);ext.push(rec?`${E} can recapture, so this is an exchange of pieces.`:`${E} has no way to recapture, so ${C} wins material.`)}
 if(!cast&&!'brq'.includes(m.piece)){const nb=[];
  for(let a=0;a<8;a++)for(let b=0;b<8;b++){const q=bd[a][b],q0=bd0[a][b];if(q&&q0&&q.color===m.color&&'brq'.includes(q.type)&&(a!==r||b!==c)&&atkSet(bd,a,b).length>=atkSet(bd0,a,b).length+2)nb.push(`${PN[q.type]} on ${sqn(a,b)}`)}
  if(nb.length)ext.push(`It also opens a line for the ${nb.slice(0,2).join(' and the ')}.`)}
 return[L].concat(why.slice(0,2),tac.slice(0,2),ext.slice(0,1)).join(' ')}
function summary(i,vi){const g=new Chess();OP[i][2][vi][1].split(' ').forEach(s=>g.move(s,{sloppy:true}));const bd=g.board(),st={w:{dev:0,cas:'',ctr:[]},b:{dev:0,cas:'',ctr:[]}};
 for(let r=0;r<8;r++)for(let c=0;c<8;c++){const p=bd[r][c];if(!p)continue;const s=st[p.color],home=p.color==='w'?7:0;
  if((p.type==='n'||p.type==='b')&&r!==home)s.dev++;if(p.type==='k'&&r===home&&(c===6||c===2))s.cas=c===6?'kingside':'queenside';
  if(p.type==='p'&&(c===3||c===4)&&(r===3||r===4))s.ctr.push(sqn(r,c))}
 const f=(C,s)=>`${C} has ${s.dev} minor piece${s.dev==1?'':'s'} developed, ${s.cas?'has castled '+s.cas:'has not castled yet'}${s.ctr.length?', and has pawns on '+s.ctr.join(' and ')+' in the centre':''}.`;
 return`That is the end of this line. Let’s take stock of the final position. ${f('White',st.w)} ${f('Black',st.b)} The main idea to remember: ${OP[i][1]}`}

let ONARR = 0;   // narration token: bumping it stops the voice
function stopVoice() { ONARR++; try { speechSynthesis.cancel(); } catch (e) {} }
const speakText = t => t.replace(/\b([a-h])([1-8])\b/g, '$1 $2');
function sayText(t, cb) {
  const s = window.speechSynthesis; if (!s || !window.SpeechSynthesisUtterance) { setTimeout(cb || (() => {}), 1500); return; }
  const u = new SpeechSynthesisUtterance(speakText(t)); u.rate = .93; u.onend = cb || null; u.onerror = cb || null; s.speak(u);
}
function narrate(i, v) {   // reads the idea, then plays the line move by move, explaining what each move does
  stopVoice(); const tok = ONARR, op = OP[i], line = op[2][v], mv = line[1].split(' ');
  O.narr = true; showOpening(i, v, 0); O.narr = false;
  const step = k => {
    if (tok !== ONARR) return;
    if (k >= mv.length) { sayText(summary(i, v) + ' Press Explain again to hear it once more, or pick another variation.'); return; }
    O.narr = true; showOpening(i, v, k + 1); O.narr = false;
    sayText((k % 2 ? '' : `Move ${k / 2 + 1}. `) + explain(i, v, k + 1), () => setTimeout(() => step(k + 1), 600));
  };
  sayText(`${op[0]}, ${line[0]}. ${op[1]} Now let us go through the moves one at a time, and look at what each one actually does.`, () => step(0));
}

/* ---------- Online play (uses the same free Firebase database as accounts: set DB_URL) ---------- */
const api = (p, m = 'GET', b) => fetch(`${cloud}/${p}.json`, { method: m, body: b === undefined ? undefined : JSON.stringify(b) }).then(r => { if (!r.ok) throw 0; return r.json(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let OFF = 0, OLN = { tcI: 6, q: null, g: null };
const snow = () => Date.now() + OFF;                       // server time, so players' clocks can't disagree
const plies = d => (d.mv || '').split(' ').filter(Boolean);
function stopOnline() { clearInterval(OLN.poll); clearInterval(OLN.gp); clearInterval(OLN.ck); if (OLN.q) { api('queue/' + ME, 'DELETE').catch(() => {}); OLN.q = null; } OLN.g = null; }
function onlineView() {
  if (!cloud) { $('#app').innerHTML = '<div class="wrap" style="max-width:640px"><div class="card"><h2>Online play</h2><p>Online games need a shared database. Set <b>DB_URL</b> at the top of the accounts section in script.js (the same free Firebase Realtime Database used for accounts), then reload.</p></div></div>'; return; }
  $('#app').innerHTML = `<div class="wrap" style="max-width:640px"><div class="card"><h2>Online play</h2><p class="mut">Choose a time control, then press Play. You’ll be paired with another player who is searching for the same time control. Your Elo: <b>${D().rating}</b></p>
  <div class="chips">${TCS.map((t, i) => `<button class="chip ${OLN.tcI == i ? 'on' : ''}" onclick="if(!OLN.q){OLN.tcI=${i};onlineView()}">${t.l}</button>`).join('')}</div>
  <div id="qs"></div><button class="btn" id="pq" onclick="queueUp()">Play</button></div></div>`;
}
const renderQ = () => { $('#qs').innerHTML = `<div class="stat">Searching for an opponent… <b>${TCS[OLN.q.tc].l}</b> <button class="chip" style="margin-left:8px" onclick="cancelQ()">Cancel</button></div>`; $('#pq').disabled = true; };
function cancelQ() { clearInterval(OLN.poll); api('queue/' + ME, 'DELETE').catch(() => {}); OLN.q = null; onlineView(); }
async function queueUp() {
  if (OLN.q) return; OLN.q = { tc: OLN.tcI };
  try { await api('queue/' + ME, 'PUT', { u: ME, n: CUR.u, ti: titleOf(D()), r: D().rating, tc: OLN.tcI, t: { '.sv': 'timestamp' }, hb: { '.sv': 'timestamp' }, game: null }); }
  catch (e) { OLN.q = null; $('#qs').innerHTML = '<div class="stat">Could not reach the online database.</div>'; return; }
  renderQ(); OLN.poll = setInterval(qTick, 1000); qTick();
}
async function qTick() {   // every second: refresh my heartbeat, look for a game, or pair up the waiting players
  const q = OLN.q; if (!q || OLN.busy) return; OLN.busy = true;
  try {
    const now = await api('queue/' + ME + '/hb', 'PUT', { '.sv': 'timestamp' }); OFF = now - Date.now();
    const all = (await api('queue')) || {}, me = all[ME]; if (!OLN.q || !me) return;
    if (me.game) { await joinGame(me.game); return; }
    // everyone looking for the same time control is sorted by arrival; players are paired 1+2, 3+4, ... and the earlier one creates the game
    const list = Object.values(all).filter(x => x && !x.game && x.tc === q.tc && now - x.hb < 15000).sort((a, b) => a.t - b.t || (a.u < b.u ? -1 : 1));
    const i = list.findIndex(x => x.u === ME);
    if (i >= 0 && i % 2 === 0 && list[i + 1]) await makeGame(list[i], list[i + 1]);
  } catch (e) {} finally { OLN.busy = false; }
}
async function makeGame(a, b) {
  const cur = await api('queue/' + b.u); if (!cur || cur.game) return;
  const w = (a.t + b.t) % 2 ? a : b, k = w === a ? b : a, gid = a.t + '_' + a.u + '_' + b.u, tc = TCS[a.tc];
  await api('games/' + gid, 'PUT', { w: w.u, b: k.u, wn: w.n, bn: k.n, wt: w.ti || '', bt: k.ti || '', wr: w.r, br: k.r, tc: a.tc, fen: new Chess().fen(), mv: '', tl: '', last: '', st: 'live', res: '', why: '', cw: tc.m * 60000, cb: tc.m * 60000, ts: { '.sv': 'timestamp' } });
  await api('queue/' + a.u + '/game', 'PUT', gid); await api('queue/' + b.u + '/game', 'PUT', gid);
}
async function joinGame(gid) {
  clearInterval(OLN.poll); let d = null;
  for (let i = 0; i < 8 && !d; i++) { d = await api('games/' + gid); if (!d) await sleep(500); }
  if (!d) { await api('queue/' + ME + '/game', 'PUT', null); OLN.poll = setInterval(qTick, 1000); return; }   // pairing fell through: keep searching
  OLN.q = null; api('queue/' + ME, 'DELETE').catch(() => {}); startOnline(gid, d);
}
function startOnline(gid, d) {
  const my = d.w === ME ? 'w' : 'b'; OLN.g = { id: gid, d, my, n: -1, done: false }; $('#app').innerHTML = layout();
  OLN.B = Board($('#bd'), { g: new Chess(), can: c => c === my && OLN.g.d.st === 'live' && OLN.B.g.turn() === c, me: () => OLN.g.d.st === 'live' ? my : null, onMove: sendMove, onPre: () => {} });
  OLN.B.flip = my === 'b'; applyOnline(d, true); OLN.gp = setInterval(pollGame, 800); OLN.ck = setInterval(tickOnline, 200);
}
function applyOnline(d, first) {
  const G = OLN.g, B = OLN.B, ps = plies(d); G.d = d; G.n = ps.length;
  B.g = new Chess(d.fen); B.sel = null; B.last = d.last ? [d.last.slice(0, 2), d.last.slice(2, 4)] : null; B.draw();
  if (!first && ps.length) { const s = ps[ps.length - 1]; sound({ captured: /x/.test(s) }, { in_check: () => /[+#]/.test(s), in_checkmate: () => /#/.test(s) }); }
  onlinePanel(); if (d.st === 'live') setTimeout(() => OLN.B && OLN.B.autoPre(), 150);   // your next premove plays now
  if (d.st === 'done') endOnline(d);
}
async function pollGame() {
  const G = OLN.g; if (!G || G.busy) return; G.busy = true;
  try { const d = await api('games/' + G.id); if (d && OLN.g && (plies(d).length > G.n || d.st !== G.d.st)) applyOnline(d); } catch (e) {}
  if (OLN.g) OLN.g.busy = false;
}
async function sendMove(mv) {
  const G = OLN.g, d = G.d, key = G.my === 'w' ? 'cw' : 'cb', left = d[key] - (snow() - d.ts), g = OLN.B.g, ps = plies(d).concat(mv.san); G.n = ps.length;
  const upd = { fen: g.fen(), mv: ps.join(' '), last: mv.from + mv.to, [key]: Math.max(0, left) + TCS[d.tc].inc * 1000, ts: { '.sv': 'timestamp' } }; upd.tl = (d.tl ? d.tl + ' ' : '') + Math.round(upd[key]);
  if (left <= 0) Object.assign(upd, { st: 'done', res: G.my === 'w' ? 'b' : 'w', why: 'on time' });
  else if (g.game_over()) Object.assign(upd, { st: 'done', res: g.in_checkmate() ? G.my : 'd', why: g.in_checkmate() ? 'checkmate' : 'a draw' });
  Object.assign(d, upd, { ts: snow() }); onlinePanel();
  try { await api('games/' + G.id, 'PATCH', upd); } catch (e) {}
  if (upd.st === 'done') applyOnline(d);
}
async function resignOnline() {
  const G = OLN.g; if (!G || G.d.st !== 'live') return; const upd = { st: 'done', res: G.my === 'w' ? 'b' : 'w', why: 'resignation' };
  try { await api('games/' + G.id, 'PATCH', upd); } catch (e) {} Object.assign(G.d, upd); applyOnline(G.d);
}
function tickOnline() {
  const G = OLN.g; if (!G) return; const d = G.d, turn = d.fen.split(' ')[1], now = snow();
  for (const c of ['w', 'b']) {
    const base = c === 'w' ? d.cw : d.cb, act = d.st === 'live' && turn === c, raw = act ? base - (now - d.ts) : base, e = $('#ok' + c);
    if (e) { e.querySelector('b').textContent = fmt(raw); e.classList.toggle('act', act); }
    if (act && !G.flag && ((c === G.my && raw <= 0) || raw <= -1500)) { G.flag = 1; api('games/' + G.id, 'PATCH', { st: 'done', res: c === 'w' ? 'b' : 'w', why: 'on time', [c === 'w' ? 'cw' : 'cb']: 0 }).catch(() => {}); }
  }
}
function endOnline(d) {
  const G = OLN.g; if (G.done) return; G.done = true; clearInterval(OLN.gp); clearInterval(OLN.ck);
  const dd = D(), my = G.my, opp = my === 'w' ? d.br : d.wr, sc = d.res === 'd' ? .5 : d.res === my ? 1 : 0; dd.done = dd.done || [];
  if (dd.done.includes(G.id)) return;
  const delta = Math.round(32 * (sc - 1 / (1 + 10 ** ((opp - dd.rating) / 400)))); dd.done = dd.done.concat(G.id).slice(-50); dd.rating += delta; dd.peak = Math.max(dd.peak || 0, dd.rating); if (sc === 1) dd.w = (dd.w || 0) + 1;
  dd.games.unshift({ s: sc, b: (my === 'w' ? d.bn : d.wn) + ' (online)', d: delta, n: plies(d).length }); dd.games = dd.games.slice(0, 40); saveGame({ mode: 'Online', opp: my === 'w' ? d.bn : d.wn, oppR: opp, me: my, res: d.res, why: d.why, tc: TCS[d.tc].l, mv: plies(d).join(' '), tl: d.tl || '', op: G.openName || '', delta }); persist(); G.delta = delta; onlinePanel();
}
function onlinePanel() {
  const G = OLN.g, d = G.d, my = G.my, opp = my === 'w' ? 'b' : 'w', ps = plies(d), turn = d.fen.split(' ')[1], now = snow(); let mv = '';
  for (let i = 0; i < ps.length; i += 2) mv += `<span class="mut">${i / 2 + 1}.</span> ${ps[i]} ${ps[i + 1] || ''} `;
  const box = c => { const act = d.st === 'live' && turn === c; return `<div class="clk ${act ? 'act' : ''}" id="ok${c}"><span>${tt(c === 'w' ? d.wt : d.bt)}${esc(c === 'w' ? d.wn : d.bn)} <span class="mut">${c === 'w' ? d.wr : d.br}</span></span><b>${fmt((c === 'w' ? d.cw : d.cb) - (act ? now - d.ts : 0))}</b></div>`; };
  const st = d.st === 'live' ? (OLN.B.g.in_check() ? 'Check! ' : '') + (turn === my ? 'Your move.' : 'Opponent’s move.')
    : (d.res === 'd' ? 'Draw' : d.res === my ? 'You won' : 'You lost') + ` (${d.why}).` + (G.delta != null ? ` Elo ${G.delta >= 0 ? '+' : ''}${G.delta} → ${D().rating}` : '');
  $('#pn').innerHTML = `<h2>Online game <span class="mut" style="font-size:16px">${TCS[d.tc].l}</span></h2>${box(opp)}${box(my)}<div class="stat">${st}</div>${openingBox((G.openName = openingOf(ps) || G.openName))}<div class="mv">${movesHtml(ps)}</div>
  <div class="row"><button class="chip" onclick="OLN.B.flip=!OLN.B.flip;OLN.B.draw()">Flip board</button>${d.st === 'live' ? '<button class="chip" onclick="resignOnline()">Resign</button>' : '<button class="btn" style="margin:0" onclick="stopOnline();onlineView()">Back to Online</button>'}</div>`;
}

/* ---------- Game history + game review ---------- */
function saveGame(r) { const d = D(); d.hist = d.hist || []; r.id = Date.now() + ''; r.date = Date.now(); d.hist.unshift(r); d.hist = d.hist.slice(0, 50); }
function historyView() {
  const hs = D().hist || [];
  $('#app').innerHTML = `<div class="wrap"><h2>Game history</h2><div class="card" style="overflow-x:auto">${hs.length ? `<table class="ht">${hs.map(g => {
    const r = g.res === 'd' ? 'Draw' : g.res === g.me ? 'Win' : 'Loss', n = Math.ceil(g.mv.split(' ').filter(Boolean).length / 2);
    return `<tr onclick="location.hash='#game/${g.id}'"><td><b class="${r}">${r}</b></td><td>${g.me === 'w' ? 'White' : 'Black'} vs ${esc(g.opp)} <span class="mut">${g.oppR || ''}</span></td><td class="mut">${esc(g.op || '')}</td><td>${n} moves</td><td class="mut">${g.mode} · ${g.tc}</td><td>${g.delta >= 0 ? '+' : ''}${g.delta}</td><td class="mut">${new Date(g.date).toLocaleDateString()}</td><td><a class="chip" onclick="event.stopPropagation();location.hash='#review/${g.id}'">Review</a></td></tr>`;
  }).join('')}</table>` : '<span class="mut">No games yet. Finish a game and it will show up here.</span>'}</div></div>`;
}
let GV = null;
function gameView(id, rec, who, back) {
  const g = rec || (D().hist || []).find(x => x.id === id); if (!g) { location.hash = '#history'; return; }
  GV = { who, back: back || '#history', g, mv: g.mv.split(' ').filter(Boolean), tl: (g.tl || '').split(' ').filter(Boolean).map(Number), n: 0 };
  $('#app').innerHTML = layout(); GV.B = Board($('#bd'), { g: new Chess(), can: () => false }); GV.B.flip = g.me === 'b'; gvShow(GV.mv.length);
}
function gvShow(n) {
  const G = GV, g = G.g, you = G.who ? esc(G.who) : 'You'; G.n = Math.max(0, Math.min(G.mv.length, n)); const ch = new Chess(); let last = null;
  for (let k = 0; k < G.n; k++) { const m = ch.move(G.mv[k], { sloppy: true }); last = m && [m.from, m.to]; }
  G.B.g = ch; G.B.last = last; G.B.sel = null; G.B.draw(); if (G.n) sound({ captured: /x/.test(G.mv[G.n - 1]) }, { in_check: () => /[+#]/.test(G.mv[G.n - 1]), in_checkmate: () => /#/.test(G.mv[G.n - 1]) });
  const cell = k => k < G.mv.length ? `<td class="gm ${k === G.n - 1 ? 'cur' : ''}" onclick="gvShow(${k + 1})">${G.mv[k]} <span class="tm">${G.tl[k] != null ? fmt(G.tl[k]) : ''}</span></td>` : '<td></td>';
  let rows = ''; for (let i = 0; i < G.mv.length; i += 2) rows += `<tr><td class="mn">${i / 2 + 1}.</td>${cell(i)}${cell(i + 1)}</tr>`;
  $('#pn').innerHTML = `<p style="margin:0"><a href="${G.back}">← ${G.who ? 'Back to ' + esc(G.who) : 'Game history'}</a></p><h2>${g.me === 'w' ? you : esc(g.opp)} vs ${g.me === 'w' ? esc(g.opp) : you}</h2>
  <div class="stat">${g.res === 'd' ? 'Draw' : g.res === g.me ? you + ' won' : (G.who ? esc(g.opp) + ' won' : 'You lost')}${g.why ? ' (' + esc(g.why) + ')' : ''} · ${g.mode} · ${g.tc}<br><span class="mut" style="font-weight:400">${new Date(g.date).toLocaleString()}</span></div>
  ${openingBox(g.op)}<div class="mv" style="max-height:300px"><table class="mvt">${rows}</table></div>
  <p class="mut" style="font-size:13px;margin:6px 0 0">The small number next to each move is the time that player had left after making it.</p>
  <div class="row"><button class="chip" onclick="gvShow(0)">|&lt;</button><button class="chip" onclick="gvShow(GV.n-1)">&lt;</button><button class="chip" onclick="gvShow(GV.n+1)">&gt;</button><button class="chip" onclick="gvShow(GV.mv.length)">&gt;|</button><button class="chip" onclick="GV.B.flip=!GV.B.flip;GV.B.draw()">Flip board</button>${G.who ? '' : `<a class="btn" style="margin:0;padding:8px 14px" href="#review/${g.id}">Review</a>`}</div>`;
}
addEventListener('keydown', e => { if (GV && location.hash.startsWith('#game/')) { if (e.key === 'ArrowLeft') gvShow(GV.n - 1); if (e.key === 'ArrowRight') gvShow(GV.n + 1); } });

/* ---------- Titles: reach the Elo, then beat the title holder 3 times ---------- */
const TITLES = [
  { k: 'CM', n: 'Candidate Master', elo: 2200 }, { k: 'TM', n: 'Terra Master', elo: 2400 },
  { k: 'IM', n: 'International Master', elo: 2500 }, { k: 'GM', n: 'Grandmaster', elo: 2800 }
];
// A player's title is the word stored in the database under  titles / <username>  :  Nill, CM, TM, IM or GM.
// Change that word in the Firebase console and the title changes on the site (no code needed).
let MYT = '';   // my current title: '' (Nill), 'CM', 'TM', 'IM' or 'GM'
const normT = w => { w = String(w == null ? '' : w).trim().toUpperCase(); return ['CM', 'TM', 'IM', 'GM'].includes(w) ? w : ''; };
const legacyTitle = d => { let k = ''; for (const t of TITLES) if ((d.titles || []).includes(t.k)) k = t.k; return k; };
const titleOf = d => (CUR && d === CUR.d) ? MYT : legacyTitle(d);
async function loadMyTitle() {
  if (!ME) return; if (!cloud) { MYT = legacyTitle(D()); return; }
  try { let w = await api('titles/' + ME); if (w == null) { w = legacyTitle(D()) || 'Nill'; await api('titles/' + ME, 'PUT', w); } MYT = normT(w); } catch (e) {}
}
function setMyTitle(k) { MYT = k; if (cloud && ME) api('titles/' + ME, 'PUT', k).catch(() => {}); }
let TM = {};
function challenge(k) {
  const t = TITLES.find(x => x.k === k), d = D(); TM = {};
  if (d.rating < t.elo) TM[k] = "You don't have enough Elo to get this title.";
  else if (P.on) TM[k] = 'Finish your current game first.';
  else { P.bot = BOTS.findIndex(b => b.chal && b.title === k); P.pick = 'r'; P.tcI = 6; P.over = false; P.auto = true; location.hash = '#play'; return; }
  titlesView();
}
function titlesView() {
  const d = D();
  $('#app').innerHTML = `<div class="wrap"><h2>Titles</h2><p class="mut">Reach the Elo, then take on the title holder. Defeat the bot 3 times to earn the title. Your Elo: <b>${d.rating}</b></p><div class="grid">${TITLES.map(t => {
    const have = (d.titles || []).includes(t.k) || MYT === t.k, w = Math.min((d.tw || {})[t.k] || 0, 3), ok = d.rating >= t.elo, bot = BOTS.find(b => b.chal && b.title === t.k);
    return `<div class="card"><h3>${tt(t.k)}${t.n}</h3><p class="mut">Opponent: ${tt(t.k)}${esc(bot.n)} · ${bot.r} Elo</p>
    <div style="display:flex;justify-content:space-between"><span>${ok ? '✓' : '○'} Reach ${t.elo} Elo</span><span class="mut">${d.rating}/${t.elo}</span></div><div class="bar"><i style="width:${Math.min(100, d.rating / t.elo * 100)}%"></i></div>
    <div style="display:flex;justify-content:space-between;margin-top:10px"><span>${w >= 3 ? '✓' : '○'} Defeat the bot 3 times</span><span class="mut">${w}/3</span></div><div class="bar"><i style="width:${w / 3 * 100}%"></i></div>
    ${TM[t.k] ? `<div class="stat">${TM[t.k]}</div>` : ''}${have ? '<div class="stat">Title earned!</div>' : `<button class="btn" onclick="challenge('${t.k}')">Play the ${t.k} challenge</button>`}</div>`;
  }).join('')}</div></div>`;
}

/* ---------- Search: online players, all players, and player profiles (public data lives in the shared database) ---------- */
let SR = null, PRES = null;
function pubPush() {   // publish my public profile (rating, title, recent games) so other players can look me up
  if (!cloud || !ME || !CUR) return; const d = D(), t = titleOf(d);
  api('roster/' + ME, 'PATCH', { u: CUR.u, r: d.rating, t, seen: { '.sv': 'timestamp' } }).catch(() => {});
  api('players/' + ME, 'PUT', { u: CUR.u, r: d.rating, t, ti: d.titles || [], w: d.w || 0, peak: d.peak || d.rating, h: (d.hist || []).slice(0, 15), br: (d.brill || []).slice(0, 20), jn: CUR.joined || 0 }).catch(() => {});
}
function startPresence() {   // heartbeat: a player counts as online if seen in the last minute
  if (!cloud || PRES || !ME) return; pubPush();
  const beat = () => { if (ME) { api('roster/' + ME + '/seen', 'PUT', { '.sv': 'timestamp' }).then(v => { OFF = v - Date.now(); }).catch(() => {}); loadMyTitle(); } };
  beat(); PRES = setInterval(beat, 20000);
}
function stopPresence() { clearInterval(PRES); PRES = null; if (cloud && ME) api('roster/' + ME + '/seen', 'PUT', 0).catch(() => {}); }
async function roster() {
  if (cloud) {   // the roster only has players who have logged in since this feature existed, so also read the account list and fill in anyone missing
    const [r, keys] = await Promise.all([api('roster'), fetch(`${cloud}/accounts.json?shallow=true`).then(x => x.json())]), out = r || {};
    await Promise.all(Object.keys(keys || {}).filter(id => !out[id] || !out[id].u).map(async id => {
      const [u, rt, ti] = await Promise.all([api(`accounts/${id}/u`), api(`accounts/${id}/d/rating`), api(`accounts/${id}/d/titles`)]), t = titleOf({ titles: ti || [] });
      out[id] = Object.assign(out[id] || {}, { u: u || id, r: rt || 800, t, seen: (out[id] || {}).seen || 0 });
      api('roster/' + id, 'PATCH', { u: u || id, r: rt || 800, t }).catch(() => {});
    }));
    const tmap = (await api('titles')) || {};
    Object.keys(keys || {}).forEach(id => { if (tmap[id] == null) { tmap[id] = 'Nill'; api('titles/' + id, 'PUT', 'Nill').catch(() => {}); } });
    Object.keys(out).forEach(id => { if (tmap[id] != null) out[id].t = normT(tmap[id]); });
    return out;
  }
  const o = {}; for (const id in ACC) { const d = ACC[id].d || {}; o[id] = { u: ACC[id].u, r: d.rating || 800, t: titleOf(d), seen: id === ME ? snow() : 0 }; } return o;
}
async function getPlayer(id) {
  if (cloud) {
    let p = await api('players/' + id);
    if (!p) { const [u, d] = await Promise.all([api(`accounts/${id}/u`), api(`accounts/${id}/d`)]); if (!u) return null; p = { u, br: (d || {}).brill || [], r: (d || {}).rating || 800, t: titleOf(d || {}), ti: (d || {}).titles || [], w: (d || {}).w || 0, peak: (d || {}).peak || (d || {}).rating || 800, h: ((d || {}).hist || []).slice(0, 15) }; }
    const tw = await api('titles/' + id); if (tw != null) p.t = normT(tw);
    p.h = p.h || []; p.br = p.br || []; return p;
  }
  const a = ACC[id]; if (!a) return null; const d = a.d || {};
  return { u: a.u, r: d.rating || 800, t: titleOf(d), ti: d.titles || [], w: d.w || 0, peak: d.peak || d.rating || 800, h: (d.hist || []).slice(0, 15) };
}
async function searchView(tab) {
  tab = tab === 'all' ? 'all' : tab === 'find' ? 'find' : 'online'; clearInterval(SR);
  $('#app').innerHTML = `<div class="wrap"><div class="chips" style="margin:0 0 14px"><a class="chip ${tab === 'online' ? 'on' : ''}" href="#search">Online</a><a class="chip ${tab === 'all' ? 'on' : ''}" href="#search/all">All players</a><a class="chip ${tab === 'find' ? 'on' : ''}" href="#search/find">Search</a></div>
  <div class="card" style="overflow-x:auto" id="sr"><span class="mut">Loading…</span></div>${cloud ? '' : '<p class="mut" style="font-size:14px">Without a shared database (DB_URL) you only see accounts made in this browser.</p>'}</div>`;
  if (tab === 'find') {   // type a name, see every player whose name contains it
    $('#sr').innerHTML = '<input id="q" class="fi" placeholder="Search players by name…" autocomplete="off" style="margin-bottom:12px"><div id="qr"><span class="mut">Type a name to search.</span></div>';
    let all = []; const show = () => {
      const q = $('#q').value.trim().toLowerCase(), out = $('#qr'); if (!out) return;
      if (!q) { out.innerHTML = '<span class="mut">Type a name to search.</span>'; return; }
      const rows = all.filter(x => x.u.toLowerCase().includes(q)).sort((a, b) => (b.u.toLowerCase().startsWith(q) - a.u.toLowerCase().startsWith(q)) || b.r - a.r);
      out.innerHTML = rows.length ? `<table class="ht">${rows.map(x => `<tr onclick="location.hash='#player/${x.id}'"><td><i class="dot ${x.on ? 'on' : ''}"></i>${tt(x.t)}<b>${esc(x.u)}</b>${x.id === ME ? ' <span class="mut">(you)</span>' : ''}</td><td>${x.r || 800} Elo</td><td class="mut">${x.on ? 'Online' : 'Offline'}</td></tr>`).join('')}</table>` : `<span class="mut">No players match “${esc($('#q').value.trim())}”.</span>`;
    };
    roster().then(r => { const now = snow(); all = Object.entries(r).filter(([, x]) => x && x.u).map(([id, x]) => ({ id, ...x, on: id === ME || (x.seen && now - x.seen < 60000) })); show(); }).catch(() => { $('#qr').innerHTML = '<span class="mut">Could not load players. Please try again.</span>'; });
    $('#q').addEventListener('input', show); $('#q').focus(); return;
  }
  const load = async () => {
    const box = $('#sr'); if (!box) return;
    try {
      const r = await roster(), now = snow(), all = Object.entries(r).filter(([, x]) => x && x.u).map(([id, x]) => ({ id, ...x, on: id === ME || (x.seen && now - x.seen < 60000) }));
      const rows = (tab === 'online' ? all.filter(x => x.on) : all).sort((a, b) => b.r - a.r);
      box.innerHTML = rows.length ? `<h3 style="margin-top:0">${tab === 'online' ? 'Players online now' : 'All players'} <span class="mut">(${rows.length})</span></h3><table class="ht">${rows.map(x => `<tr onclick="location.hash='#player/${x.id}'"><td><i class="dot ${x.on ? 'on' : ''}"></i>${tt(x.t)}<b>${esc(x.u)}</b>${x.id === ME ? ' <span class="mut">(you)</span>' : ''}</td><td>${x.r || 800} Elo</td><td class="mut">${x.on ? 'Online' : 'Offline'}</td></tr>`).join('')}</table>` : '<span class="mut">Nobody is online right now.</span>';
    } catch (e) { box.innerHTML = '<span class="mut">Could not load players. Please try again.</span>'; }
  };
  load(); if (tab === 'online') SR = setInterval(() => { if (location.hash.startsWith('#search')) load(); }, 10000);
}
async function pgameView(arg) {
  const [id, gid] = arg.split('/'); let p = null; try { p = await getPlayer(id); } catch (e) {}
  const g = p && (p.h || []).find(x => x.id === gid); if (!g) { location.hash = '#player/' + id; return; }
  gameView(gid, g, p.u, '#player/' + id);
}

/* ---------- Profiles, friends, requests, challenges and settings (these need the shared database) ---------- */
const needDb = () => '<div class="wrap"><div class="card">This feature needs the shared database (DB_URL).</div></div>';
const ago = ms => { const s = Math.max(0, (snow() - ms) / 1000); return s < 90 ? 'a minute ago' : s < 3600 ? Math.round(s / 60) + ' minutes ago' : s < 86400 ? Math.round(s / 3600) + ' hours ago' : Math.round(s / 86400) + ' days ago'; };
let REQN = 0;
function renderNav() {
  const e = $('#nav'); if (!e) return; const hk = location.hash.slice(1).split('/')[0], act = { game: 'history', review: 'history', player: 'search', pgame: 'search', brill: 'search' }[hk] || hk;
  e.innerHTML = NAV.map(([k, l]) => `<a href="#${k}" class="${act === k ? 'on' : ''}">${l}${k === 'requests' && REQN ? ` <span class="tt" style="margin:0 0 0 4px">${REQN}</span>` : ''}</a>`).join('');
}
async function countReq() {
  if (!cloud || !ME) return;
  try { const [r, c] = await Promise.all([api('requests/' + ME), api('challenges/' + ME)]), now = snow(); REQN = Object.keys(r || {}).length + Object.values(c || {}).filter(x => x && x.st === 'pending' && now - x.t < 180000).length; renderNav(); } catch (e) {}
}
async function rel(id) { const [f, s, i] = await Promise.all([api(`friends/${ME}/${id}`), api(`requests/${id}/${ME}`), api(`requests/${ME}/${id}`)]); return { friend: !!f, sent: !!s, incoming: !!i }; }
const sendFriend = async id => { await api(`requests/${id}/${ME}`, 'PUT', { u: CUR.u, t: { '.sv': 'timestamp' } }); route(); };
async function acceptFriend(id) { await Promise.all([api(`friends/${ME}/${id}`, 'PUT', true), api(`friends/${id}/${ME}`, 'PUT', true), api(`requests/${ME}/${id}`, 'DELETE')]); countReq(); route(); }
async function declineFriend(id) { await api(`requests/${ME}/${id}`, 'DELETE'); countReq(); route(); }
async function unfriend(id) { await Promise.all([api(`friends/${ME}/${id}`, 'DELETE'), api(`friends/${id}/${ME}`, 'DELETE')]); route(); }

async function friendsView() {
  if (!cloud) { $('#app').innerHTML = needDb(); return; }
  $('#app').innerHTML = '<div class="wrap"><h2>Friends</h2><div class="card" id="fr"><span class="mut">Loading…</span></div></div>';
  try {
    const f = (await api('friends/' + ME)) || {}, r = await roster(), now = snow(), ids = Object.keys(f);
    $('#fr').innerHTML = ids.length ? `<table class="ht">${ids.map(id => { const x = r[id] || { u: id, r: 800 }, on = x.seen && now - x.seen < 60000;
      return `<tr onclick="location.hash='#player/${id}'"><td><i class="dot ${on ? 'on' : ''}"></i>${tt(x.t)}<b>${esc(x.u)}</b></td><td>${x.r || 800} Elo</td><td class="mut">${on ? 'Online' : 'Offline'}</td><td><a class="chip" onclick="event.stopPropagation();unfriend('${id}')">Remove</a></td></tr>`; }).join('')}</table>` : '<span class="mut">No friends yet. Find players in Search and send them a friend request.</span>';
  } catch (e) { $('#fr').innerHTML = 'Could not load friends.'; }
}
async function requestsView() {
  if (!cloud) { $('#app').innerHTML = needDb(); return; }
  clearInterval(SR); $('#app').innerHTML = '<div class="wrap"><h2>Requests</h2><div id="rq" class="card"><span class="mut">Loading…</span></div></div>';
  const load = async () => {
    const box = $('#rq'); if (!box) return;
    try {
      const [fr, ch] = await Promise.all([api('requests/' + ME), api('challenges/' + ME)]), now = snow(), cs = Object.entries(ch || {}).filter(([, x]) => x && x.st === 'pending' && now - x.t < 180000), fs = Object.entries(fr || {});
      box.innerHTML = `<h3 style="margin-top:0">Challenges</h3>${cs.length ? `<table class="ht">${cs.map(([id, x]) => `<tr style="cursor:default"><td><b>${esc(x.u)}</b> challenges you to a ${TCS[x.tc].l} game</td><td><button class="btn" style="margin:0;padding:6px 14px" onclick="acceptChallenge('${id}')">Accept</button> <button class="chip" onclick="declineChallenge('${id}')">Decline</button></td></tr>`).join('')}</table>` : '<span class="mut">No challenges.</span>'}
      <h3>Friend requests</h3>${fs.length ? `<table class="ht">${fs.map(([id, x]) => `<tr style="cursor:default"><td><a href="#player/${id}"><b>${esc(x.u)}</b></a> wants to be your friend</td><td><button class="btn" style="margin:0;padding:6px 14px" onclick="acceptFriend('${id}')">Accept</button> <button class="chip" onclick="declineFriend('${id}')">Decline</button></td></tr>`).join('')}</table>` : '<span class="mut">No friend requests.</span>'}`;
    } catch (e) { box.innerHTML = 'Could not load requests.'; }
  };
  load(); SR = setInterval(() => { if (location.hash === '#requests') load(); }, 5000);
}
async function declineChallenge(id) { await api(`challenges/${ME}/${id}`, 'PATCH', { st: 'declined' }); countReq(); requestsView(); }
async function acceptChallenge(id) {
  try {
    const c = await api(`challenges/${ME}/${id}`); if (!c || c.st !== 'pending') { requestsView(); return; }
    const rr = (await api('roster/' + id)) || {}, tc = TCS[c.tc], meW = Math.random() < .5, a = { u: ME, n: CUR.u, r: D().rating, ti: titleOf(D()) }, b = { u: id, n: c.u, r: rr.r || 800, ti: rr.t || '' }, w = meW ? a : b, k = meW ? b : a, gid = Date.now() + '_' + ME + '_' + id;
    await api('games/' + gid, 'PUT', { w: w.u, b: k.u, wn: w.n, bn: k.n, wr: w.r, br: k.r, wt: w.ti || '', bt: k.ti || '', tc: c.tc, fen: new Chess().fen(), mv: '', tl: '', last: '', st: 'live', res: '', why: '', cw: tc.m * 60000, cb: tc.m * 60000, ts: { '.sv': 'timestamp' } });
    await api(`challenges/${ME}/${id}`, 'PATCH', { st: 'accepted', gid }); clearInterval(SR); startOnline(gid, await api('games/' + gid));
  } catch (e) { requestsView(); }
}
async function settingsView() {
  if (!cloud) { $('#app').innerHTML = needDb(); return; }
  let cur = 'anyone'; try { const s = await api('settings/' + ME); if (s && s.challenge) cur = s.challenge; } catch (e) {}
  $('#app').innerHTML = `<div class="wrap" style="max-width:640px"><h2>Settings</h2><div class="card"><h3 style="margin-top:0">Who can challenge me</h3><div class="chips">${[['friends', 'Only friends'], ['anyone', 'Anyone'], ['none', 'No one']].map(([v, l]) => `<button class="chip ${cur === v ? 'on' : ''}" onclick="setChal('${v}')">${l}</button>`).join('')}</div></div></div>`;
}
async function setChal(v) { await api('settings/' + ME, 'PUT', { challenge: v }); settingsView(); }

async function openChallenge(id) {   // asks the player's settings first, then lets you pick a time control and send the challenge
  const box = $('#chp'); box.innerHTML = '<span class="mut">Checking…</span>';
  try {
    const s = (await api('settings/' + id)) || {}, mode = s.challenge || 'anyone', friend = !!(await api(`friends/${ME}/${id}`));
    if (mode === 'none') { box.innerHTML = '<div class="stat">This player is not accepting challenges.</div>'; return; }
    if (mode === 'friends' && !friend) { box.innerHTML = '<div class="stat">This player only accepts challenges from friends.</div>'; return; }
    box.innerHTML = `<div class="stat">Choose a time control:<div class="chips">${TCS.map((t, i) => `<button class="chip ${OLN.tcI == i ? 'on' : ''}" onclick="OLN.tcI=${i};openChallenge('${id}')">${t.l}</button>`).join('')}</div><button class="btn" onclick="sendChallenge('${id}')">Send challenge</button></div>`;
  } catch (e) { box.innerHTML = '<div class="stat">Could not reach the database.</div>'; }
}
async function sendChallenge(id) {
  try { await api(`challenges/${id}/${ME}`, 'PUT', { u: CUR.u, tc: OLN.tcI, t: { '.sv': 'timestamp' }, st: 'pending' }); } catch (e) { return; }
  $('#chp').innerHTML = `<div class="stat">Challenge sent. Waiting for them to accept… <button class="chip" onclick="cancelChallenge('${id}')">Cancel</button></div>`;
  clearInterval(OLN.poll); const t0 = Date.now(), end = m => { clearInterval(OLN.poll); api(`challenges/${id}/${ME}`, 'DELETE').catch(() => {}); if (m && $('#chp')) $('#chp').innerHTML = `<div class="stat">${m}</div>`; };
  OLN.poll = setInterval(async () => {
    try {
      const c = await api(`challenges/${id}/${ME}`); if (!c) { clearInterval(OLN.poll); return; }
      if (c.st === 'accepted') { end(); const d = await api('games/' + c.gid); if (d) startOnline(c.gid, d); }
      else if (c.st === 'declined') end('They declined your challenge.'); else if (Date.now() - t0 > 180000) end('No response. The challenge expired.');
    } catch (e) {}
  }, 2000);
}
function cancelChallenge(id) { clearInterval(OLN.poll); api(`challenges/${id}/${ME}`, 'DELETE').catch(() => {}); $('#chp').innerHTML = ''; }

async function playerView(arg) {
  const [id, tr] = String(arg).split('/'), tab = ['games', 'status'].includes(tr) ? tr : 'overview'; let p = null;
  $('#app').innerHTML = '<div class="wrap"><span class="mut">Loading…</span></div>';
  try { p = await getPlayer(id); } catch (e) {}
  if (!p) { $('#app').innerHTML = '<div class="wrap"><p><a href="#search/all">Back to players</a></p><div class="card">This player could not be found.</div></div>'; return; }
  const me = id === ME; let rl = { friend: false, sent: false, incoming: false }, seen = 0, nf = 0;
  if (cloud) { try { if (!me) rl = await rel(id); seen = ((await api('roster/' + id)) || {}).seen || 0; nf = Object.keys((await api('friends/' + id)) || {}).length; } catch (e) {} }
  const on = me || (seen && snow() - seen < 60000), h = p.h || [], br = p.br || [];
  const btns = me ? '' : `${rl.friend ? '<button class="chip" disabled>Friends</button>' : rl.sent ? '<button class="chip" disabled>Request sent</button>' : rl.incoming ? `<button class="btn" style="margin:0" onclick="acceptFriend('${id}')">Accept request</button>` : `<button class="btn" style="margin:0" onclick="sendFriend('${id}')">Add Friend</button>`}<button class="chip" onclick="openChallenge('${id}')">Challenge</button>`;
  const tabs = [['overview', 'Overview'], ['games', 'Games'], ['status', 'Status']].map(([k, l]) => `<a href="#player/${id}${k === 'overview' ? '' : '/' + k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('');
  let body = '';
  if (tab === 'overview') body = `<div class="card"><div style="font:700 54px Georgia,serif;color:var(--deep)">${p.r}</div><span class="mut">Elo rating</span><p>Peak ${p.peak || p.r} · ${p.w || 0} wins${(p.ti || []).length ? ' · Titles: ' + p.ti.map(tt).join('') : ''}</p></div>`;
  else if (tab === 'games') body = `<div class="card" style="overflow-x:auto">${h.length ? `<table class="ht">${h.map(g => { const r = g.res === 'd' ? 'Draw' : g.res === g.me ? 'Win' : 'Loss';
    return `<tr onclick="location.hash='#pgame/${id}/${g.id}'"><td><b class="${r}">${r}</b></td><td>${g.me === 'w' ? 'White' : 'Black'} vs ${esc(g.opp)} <span class="mut">${g.oppR || ''}</span></td><td class="mut">${esc(g.op || '')}</td><td>${Math.ceil(g.mv.split(' ').filter(Boolean).length / 2)} moves</td><td class="mut">${g.mode} · ${g.tc}</td><td>${g.delta >= 0 ? '+' : ''}${g.delta}</td><td class="mut">${new Date(g.date).toLocaleDateString()}</td><td><a class="chip" onclick="event.stopPropagation();location.hash='#review/${id}/${g.id}'">Analyse</a></td></tr>`; }).join('')}</table>` : '<span class="mut">No games to show yet.</span>'}</div>`;
  else body = `<div class="card"><h3 style="margin-top:0">Brilliant moves</h3>${br.length ? `<table class="ht">${br.map(b => `<tr onclick="location.hash='#brill/${id}/${encodeURIComponent(b.k)}'"><td><img class="mi" style="margin:0 8px 0 0;width:20px;height:20px" src="reviews/brilliant.png" alt=""><b>${esc(b.san)}</b></td><td>vs ${esc(b.opp)}</td><td class="mut">${new Date(b.date).toLocaleDateString()}</td></tr>`).join('')}</table>` : '<span class="mut">No brilliant moves yet. They appear here when a game review finds one.</span>'}</div>`;
  $('#app').innerHTML = `<div class="wrap"><p><a href="#search/all">Back to players</a></p>
  <div class="card prof"><img class="avatar" src="image/wp.png" alt=""><div class="pinfo"><h2 style="margin:0">${tt(p.t)}${esc(p.u)}</h2><div class="mut" style="margin-top:10px">${p.jn ? 'Joined <b>' + new Date(p.jn).toLocaleDateString() + '</b> · ' : ''}<b>${nf}</b> Friends · ${on ? '<b>Online now</b>' : seen ? 'Last online <b>' + ago(seen) + '</b>' : 'Offline'}</div></div><div class="pact">${btns}</div></div>
  <div id="chp"></div><div class="ptabs">${tabs}</div>${body}</div>`;
}
async function brillView(arg) {
  const [id, k] = arg.split('/'), key = decodeURIComponent(k); let p = null; try { p = await getPlayer(id); } catch (e) {}
  const b = p && (p.br || []).find(x => x.k === key); if (!b) { location.hash = '#player/' + id + '/status'; return; }
  $('#app').innerHTML = layout(); const B = Board($('#bd'), { g: new Chess(b.fen), can: () => false }); B.flip = b.fen.split(' ')[1] === 'b'; B.arrows = [[b.from, b.to]]; B.draw();
  $('#pn').innerHTML = `<p style="margin:0"><a href="#player/${id}/status">Back to ${esc(p.u)}</a></p><h2><img class="mi" style="margin:0 8px 0 0;width:28px;height:28px" src="reviews/brilliant.png" alt="">Brilliant move</h2><div class="stat">${esc(p.u)} played <b>${esc(b.san)}</b> against ${esc(b.opp)}.</div><p>The arrow shows the move in the position before it was played. A brilliant move is a strong move, often a sacrifice, that the engine confirms is still best.</p>`;
}
function recordBrilliants(rec, data) {
  const d = D(); d.brill = d.brill || []; let add = false;
  data.cls.forEach((k, i) => {
    if (k !== 'brilliant' || (i % 2 ? 'b' : 'w') !== rec.me) return; const key = rec.id + ':' + i; if (d.brill.some(x => x.k === key)) return;
    const g = new Chess(data.fens[i]), m = g.move(data.sans[i], { sloppy: true }); if (!m) return;
    d.brill.unshift({ k: key, san: m.san, from: m.from, to: m.to, fen: data.fens[i], opp: rec.opp, date: rec.date }); add = true;
  });
  if (add) { d.brill = d.brill.slice(0, 30); persist(); }
}

/* ---------- Play in person: two players share this device; Stockfish rates every move after 1 second ---------- */
let PI = null;
function stopPerson() { if (PI) { PI.tok = (PI.tok || 0) + 1; clearInterval(PI.iv); } if (SFW) { try { SFW.postMessage('stop'); } catch (e) {} } }
function rateMove(sg, evB, evA, isBest, secEv, fenB, san, sansTo) {   // same rating rules as the game review
  const before = wp(sg * evB), after = wp(sg * evA), l = Math.max(0, before - after), sw = secEv == null ? null : wp(sg * secEv); let k;
  if (inBook(sansTo)) k = 'book';
  else if (isBest || l <= .5) { k = 'best'; if (isBest && sw != null && before - sw >= 15 && before < 90) k = 'great'; if ((isBest || l <= 1.5) && after >= 45 && before < 92 && isSac(fenB, san)) k = 'brilliant'; }
  else if (l <= 2) k = 'excellent'; else if (l <= 5) k = 'good'; else if (l <= 10) k = 'inaccuracy';
  else if (l <= 20) k = before >= 70 && after >= 35 ? 'miss' : 'mistake'; else k = before >= 75 && after >= 35 ? 'miss' : 'blunder';
  return k;
}
function personView() {
  stopPerson(); const keep = PI || {}; PI = { tcI: keep.tcI == null ? 6 : keep.tcI, rot: !!keep.rot, tok: 0 };
  $('#app').innerHTML = layout(); PI.B = Board($('#bd'), { g: new Chess(), can: c => PI.on && c === PI.g.turn(), onMove: piMove }); piPanel();
}
function piStart() {
  PI.g = new Chess(); PI.B.g = PI.g; PI.B.last = null; PI.B.badge = null; PI.B.flip = false; PI.B.arrows = []; PI.B.marks = []; PI.B.draw();
  PI.tc = TCS[PI.tcI]; PI.clk = { w: PI.tc.m * 60000, b: PI.tc.m * 60000 }; PI.ts = Date.now(); PI.on = true; PI.over = false; PI.msg = 'White to move.';
  PI.sans = []; PI.played = []; PI.fens = [PI.g.fen()]; PI.ev = []; PI.best = []; PI.sec = []; PI.cls = []; PI.queue = [0]; PI.tok++; PI.running = false; PI.noSf = false;
  clearInterval(PI.iv); PI.iv = setInterval(piTick, 200); piRun(); piPanel();
}
function piMove(mv) {
  const mover = PI.g.turn() === 'w' ? 'b' : 'w', now = Date.now();
  PI.clk[mover] = Math.max(0, PI.clk[mover] - (now - PI.ts)) + PI.tc.inc * 1000; PI.ts = now;
  PI.sans.push(mv.san); PI.played.push(mv.from + mv.to + (mv.promotion || '')); PI.fens.push(PI.g.fen()); PI.last = mv; PI.B.badge = null; PI.queue.push(PI.fens.length - 1);
  if (PI.g.game_over()) piEnd(PI.g.in_checkmate() ? (mover === 'w' ? 'White' : 'Black') + ' wins by checkmate.' : 'Draw.');
  else { PI.msg = (PI.g.turn() === 'w' ? 'White' : 'Black') + ' to move.' + (PI.g.in_check() ? ' Check!' : ''); if (PI.rot) PI.B.flip = PI.g.turn() === 'b'; }
  piRun(); piPanel();
}
function piEnd(msg) { PI.on = false; PI.over = true; PI.msg = msg; clearInterval(PI.iv); }
function piResign(c) { if (PI.on) { piEnd((c === 'w' ? 'White' : 'Black') + ' resigns. ' + (c === 'w' ? 'Black' : 'White') + ' wins.'); piPanel(); } }
function piTick() {
  if (!PI.on) return; const t = PI.g.turn(), now = Date.now();
  for (const c of ['w', 'b']) { const ms = Math.max(0, PI.clk[c] - (t === c ? now - PI.ts : 0)), e = $('#pk' + c); if (e) { e.querySelector('b').textContent = fmt(ms); e.classList.toggle('act', t === c); } }
  if (PI.clk[t] - (now - PI.ts) <= 0) { PI.clk[t] = 0; piEnd((t === 'w' ? 'White' : 'Black') + ' ran out of time. ' + (t === 'w' ? 'Black' : 'White') + ' wins.'); piPanel(); }
}
async function piRun() {   // analyses each new position for 1 second, one after another
  if (PI.running) return; PI.running = true; const tok = PI.tok;
  try {
    const w = await sfGet(); if (!w) { PI.noSf = true; return; }
    while (PI && PI.tok === tok && PI.queue.length) {
      const i = PI.queue.shift(), fen = PI.fens[i], c = new Chess(fen), sg = c.turn() === 'w' ? 1 : -1; let cp = 0, b = null, s2 = null;
      if (c.in_checkmate()) cp = -sg * 10000; else if (!c.game_over()) { const r = await sfEval(w, fen, 1000); cp = r.lines[1] ? sg * r.lines[1].cp : 0; b = r.best; s2 = r.lines[2] ? sg * r.lines[2].cp : null; }
      if (PI.tok !== tok) break; PI.ev[i] = cp; PI.best[i] = b; PI.sec[i] = s2;
      if (i > 0) PI.cls[i - 1] = rateMove(i % 2 ? 1 : -1, PI.ev[i - 1], cp, PI.played[i - 1] === PI.best[i - 1], PI.sec[i - 1], PI.fens[i - 1], PI.sans[i - 1], PI.sans.slice(0, i));
      piPanel();
    }
  } catch (e) {} finally { if (PI && PI.tok === tok) PI.running = false; }
}
function piPanel() {
  const el = $('#pn'); if (!el || !PI) return;
  if (!PI.on && !PI.over) {
    el.innerHTML = `<h2>Play in person</h2><div class="chips"><button class="chip" onclick="P.mode='bot';playView()">Play a bot</button><button class="chip on">Play in person</button></div>
    <p class="mut">Two players share this device and move on the on-screen board, like a real game. Stockfish rates every move after 1 second.</p>
    <h3>Time control</h3><div class="chips">${TCS.map((t, i) => `<button class="chip ${PI.tcI == i ? 'on' : ''}" onclick="PI.tcI=${i};piPanel()">${t.l}</button>`).join('')}</div>
    <div class="chips"><button class="chip ${PI.rot ? 'on' : ''}" onclick="PI.rot=!PI.rot;piPanel()">Turn the board after each move: ${PI.rot ? 'On' : 'Off'}</button></div>
    <button class="btn" onclick="piStart()">Start game</button>`; return;
  }
  const B = PI.B, n = PI.sans.length, k = PI.cls[n - 1], mvs = PI.last;
  if (n && k && mvs) B.badge = { sq: mvs.to, from: mvs.from, k, col: RV_COL[k] }; else B.badge = null; B.draw();
  const box = (c, name) => `<div class="clk ${PI.on && PI.g.turn() === c ? 'act' : ''}" id="pk${c}"><span>${name}</span><b>${fmt(Math.max(0, PI.clk[c] - (PI.on && PI.g.turn() === c ? Date.now() - PI.ts : 0)))}</b></div>`;
  let card = ''; if (n) {
    if (k) { let bs = ''; try { const bu = PI.best[n - 1], gg = new Chess(PI.fens[n - 1]), m = gg.move({ from: bu.slice(0, 2), to: bu.slice(2, 4), promotion: bu[4] }); bs = m ? m.san : ''; } catch (e) {}
      card = `<div class="stat"><img class="mi" style="width:26px;height:26px" src="reviews/${k}.png" alt=""> ${esc(PI.sans[n - 1])} is ${RV_TXT[k]}.${['inaccuracy', 'mistake', 'miss', 'blunder'].includes(k) && bs ? `<br><span style="font-weight:400">Best was <b>${esc(bs)}</b>.</span>` : ''}</div>`; }
    else card = `<div class="stat">${PI.noSf ? 'Stockfish could not be loaded, so moves cannot be rated. See the review instructions for installing it.' : 'Stockfish is analysing the move…'}</div>`; }
  let rows = ''; for (let i = 0; i < n; i += 2) rows += `<tr><td class="mn">${i / 2 + 1}.</td>${[i, i + 1].map(j => j < n ? `<td class="${j === n - 1 ? 'cur' : ''}">${esc(PI.sans[j])}${PI.cls[j] ? `<img class="mi" src="reviews/${PI.cls[j]}.png" alt="">` : ''}</td>` : '<td></td>').join('')}</tr>`;
  el.innerHTML = `<h2>Play in person <span class="mut" style="font-size:16px">${PI.tc.l}</span></h2>${box('b', 'Black')}${box('w', 'White')}<div class="stat">${PI.msg}</div>${card}
  <div class="mv"><table class="mvt">${rows || '<tr><td class="mut">No moves yet.</td></tr>'}</table></div>
  <div class="row"><button class="chip" onclick="PI.B.flip=!PI.B.flip;PI.B.draw()">Flip board</button><button class="chip ${PI.rot ? 'on' : ''}" onclick="PI.rot=!PI.rot;piPanel()">Turn each move</button>
  ${PI.on ? `<button class="chip" onclick="piResign('w')">White resigns</button><button class="chip" onclick="piResign('b')">Black resigns</button><button class="chip" onclick="piEnd('Draw agreed.');piPanel()">Draw</button>` : `<button class="btn" style="margin:0" onclick="personView()">New game</button>`}</div>`;
}

/* ---------- Game review with Stockfish (like chess.com's review) ---------- */
// Stockfish is loaded in a Web Worker. It tries your own copy first (stockfish/stockfish.js next to index.html), then public CDNs.
const SF_URLS = ['stockfish/stockfish.js', 'https://cdn.jsdelivr.net/npm/stockfish@10.0.2/src/stockfish.js', 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js', 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js'];
// the square of a reviewed move is tinted with the colour of its rating (same colours as chess.com)
const RV_COL = { brilliant: '#26c2a3', great: '#5c8bb0', best: '#96bc4b', excellent: '#96bc4b', good: '#97af8b', book: '#a88865', inaccuracy: '#f7c631', mistake: '#e6912c', miss: '#ca3431', blunder: '#ca3431' };
const RV_CLS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
const RV_TXT = { brilliant: 'a brilliant move', great: 'a great move', best: 'the best move', excellent: 'an excellent move', good: 'a good move', book: 'a book move', inaccuracy: 'an inaccuracy', mistake: 'a mistake', miss: 'a miss', blunder: 'a blunder' };
const wp = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);   // win chance (%) from a centipawn score
let SFW = null;
function sfTry(u) {
  return new Promise((res, rej) => {
    let w; try { w = /^https?:/.test(u) ? new Worker(URL.createObjectURL(new Blob([`importScripts('${u}')`], { type: 'text/javascript' }))) : new Worker(u); } catch (e) { return rej(); }
    const t = setTimeout(() => { w.terminate(); rej(); }, 20000);
    w.onmessage = e => { if (String(e.data).includes('uciok')) { clearTimeout(t); w.onmessage = null; res(w); } };
    w.onerror = () => { clearTimeout(t); w.terminate(); rej(); };
    w.postMessage('uci');
  });
}
async function sfGet() {
  if (SFW) return SFW;
  for (const u of SF_URLS) { try { SFW = await sfTry(u); SFW.postMessage('setoption name MultiPV value 2'); SFW.postMessage('isready'); return SFW; } catch (e) {} }
  return null;
}
function sfEval(w, fen, ms) {   // returns Stockfish's top two lines (scores from the side to move) and its best move
  return new Promise(res => {
    const lines = {};
    w.onmessage = e => {
      const s = String(e.data);
      if (s.startsWith('info') && s.includes(' score ')) {
        const mp = +((s.match(/multipv (\d+)/) || [0, 1])[1]), sc = s.match(/score (cp|mate) (-?\d+)/), d = +((s.match(/depth (\d+)/) || [0, 0])[1]);
        if (sc) lines[mp] = { d, cp: sc[1] === 'cp' ? +sc[2] : (+sc[2] > 0 ? 1 : -1) * (10000 - Math.min(Math.abs(+sc[2]), 100)) };
      } else if (s.startsWith('bestmove')) res({ lines, best: s.split(' ')[1] });
    };
    w.postMessage('position fen ' + fen); w.postMessage('go movetime ' + ms);
  });
}
function isSac(fen, san) {   // did the move give up material on purpose (a piece left to be captured for less than it is worth)?
  const g = new Chess(fen), m = g.move(san, { sloppy: true }); if (!m || V[m.piece] < 300) return false;
  const cv = m.captured ? V[m.captured] : 0; if (cv >= V[m.piece] - 50) return false;
  const caps = g.moves({ verbose: true }).filter(x => x.to === m.to && x.captured); if (!caps.length) return false;
  const x = caps.sort((a, b) => V[a.piece] - V[b.piece])[0]; g.move(x); const rec = g.moves({ verbose: true }).some(y => y.to === m.to && y.captured);
  return cv - V[m.piece] + (rec ? V[x.piece] : 0) <= -200;
}
function inBook(sans) { openingOf([]); const h = sans.map(stripCk); return OPL.some(l => l.m.length >= h.length && h.every((s, i) => s === l.m[i])); }
async function analyzeGame(rec, progress) {
  const mv = rec.mv.split(' ').filter(Boolean), g = new Chess(), fens = [g.fen()], sans = [], played = [];
  for (const s of mv) { const m = g.move(s, { sloppy: true }); if (!m) break; sans.push(m.san); played.push(m.from + m.to + (m.promotion || '')); fens.push(g.fen()); }
  const w = await sfGet(); if (!w) throw 'nosf';
  const ev = [], bestU = [], sec = [];
  for (let i = 0; i < fens.length; i++) {
    const c = new Chess(fens[i]), sg = c.turn() === 'w' ? 1 : -1; let cp = 0, b = null, s2 = null;
    if (c.in_checkmate()) cp = -sg * 10000; else if (!c.game_over()) { const r = await sfEval(w, fens[i], 450); cp = r.lines[1] ? sg * r.lines[1].cp : 0; b = r.best; s2 = r.lines[2] ? sg * r.lines[2].cp : null; }
    ev.push(cp); bestU.push(b); sec.push(s2); progress(i + 1, fens.length);
  }
  const cls = [], loss = [];
  for (let i = 1; i <= sans.length; i++) {
    const sg = i % 2 ? 1 : -1, before = wp(sg * ev[i - 1]), after = wp(sg * ev[i]), l = Math.max(0, before - after), isBest = played[i - 1] === bestU[i - 1], sw = sec[i - 1] == null ? null : wp(sg * sec[i - 1]); let k;
    if (inBook(sans.slice(0, i))) k = 'book';
    else if (isBest || l <= .5) {
      k = 'best'; if (isBest && sw != null && before - sw >= 15 && before < 90) k = 'great';
      if ((isBest || l <= 1.5) && after >= 45 && before < 92 && isSac(fens[i - 1], sans[i - 1])) k = 'brilliant';
    } else if (l <= 2) k = 'excellent'; else if (l <= 5) k = 'good'; else if (l <= 10) k = 'inaccuracy';
    else if (l <= 20) k = before >= 70 && after >= 35 ? 'miss' : 'mistake'; else k = before >= 75 && after >= 35 ? 'miss' : 'blunder';
    cls.push(k); loss.push(l);
  }
  return { sans, fens, ev, bestU, cls, loss };
}
const accOf = (loss, par) => { const a = loss.filter((_, i) => i % 2 === par).map(l => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * l) - 3.1669))); return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : 0; };
let RV = null;
async function reviewView(arg) {
  let rec, who = null, back = '#history', id = arg;
  if (arg.includes('/')) { const [pid, gid] = arg.split('/'); let p = null; try { p = await getPlayer(pid); } catch (e) {} rec = p && (p.h || []).find(x => x.id === gid); who = p && p.u; back = '#player/' + pid + '/games'; id = pid + '_' + gid; }
  else rec = (D().hist || []).find(x => x.id === arg);
  if (!rec) { location.hash = '#history'; return; }
  $('#app').innerHTML = layout(); const tok = RV = { rec, who, back, n: 0, data: null }; RV.B = Board($('#bd'), { g: new Chess(), can: () => false }); RV.B.flip = rec.me === 'b';
  $('#pn').innerHTML = `<p style="margin:0"><a href="${back}">Back</a></p><h2>Game review</h2><div class="stat" id="rvs">Starting Stockfish…</div><div class="bar"><i id="rvb" style="width:0"></i></div>`;
  try {
    let data = null; try { data = JSON.parse(localStorage.getItem('tc_rv_' + id) || 'null'); } catch (e) {}
    if (!data) { data = await analyzeGame(rec, (i, n) => { if (RV === tok && $('#rvs')) { $('#rvs').textContent = `Stockfish is analysing the game… move ${i} of ${n}`; $('#rvb').style.width = i / n * 100 + '%'; } }); try { localStorage.setItem('tc_rv_' + id, JSON.stringify(data)); } catch (e) {} }
    if (RV !== tok) return; RV.data = data; if (!who) recordBrilliants(rec, data); rvShow(data.sans.length);
  } catch (e) {
    if (RV === tok) $('#pn').innerHTML = `<p style="margin:0"><a href="${back}">Back</a></p><h2>Game review</h2><div class="stat">Stockfish could not be loaded.</div><p>Download <b>stockfish.js</b> (for example from github.com/nmrugg/stockfish.js) and save it as <b>stockfish/stockfish.js</b> next to index.html, then reload this page.</p>`;
  }
}
function rvShow(n, allow) {
  const R = RV, d = R.data, rec = R.rec; if (!d) return; R.allow = !!allow; R.n = Math.max(0, Math.min(d.sans.length, n)); n = R.n;
  const g = new Chess(); let last = null; for (let k = 0; k < n; k++) { const m = g.move(d.sans[k], { sloppy: true }); last = m; }
  const B = R.B; B.g = g; B.last = last && [last.from, last.to]; B.sel = null; B.marks = []; B.badge = n ? { sq: last.to, from: last.from, k: d.cls[n - 1], col: RV_COL[d.cls[n - 1]] } : null; B.arrows = [];
  if (n && ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(d.cls[n - 1]) && d.bestU[n - 1]) B.arrows = [[d.bestU[n - 1].slice(0, 2), d.bestU[n - 1].slice(2, 4)]];
  B.draw(); if (n) sound(last, g);
  const names = { w: rec.me === 'w' ? (R.who || CUR.u) : rec.opp, b: rec.me === 'b' ? (R.who || CUR.u) : rec.opp }, cnt = { w: {}, b: {} };
  d.cls.forEach((k, i) => { const c = i % 2 ? 'b' : 'w'; cnt[c][k] = (cnt[c][k] || 0) + 1; });
  let fb = ''; if (n) { const k = d.cls[n - 1], bu = d.bestU[n - 1]; let bs = ''; try { const gg = new Chess(d.fens[n - 1]), m = gg.move({ from: bu.slice(0, 2), to: bu.slice(2, 4), promotion: bu[4] }); bs = m ? m.san : ''; } catch (e) {}
    fb = `<div class="stat"><img class="mi" style="width:26px;height:26px" src="reviews/${k}.png" alt=""> ${esc(d.sans[n - 1])} is ${RV_TXT[k]}.${['inaccuracy', 'mistake', 'miss', 'blunder'].includes(k) && bs ? `<br><span style="font-weight:400">Best was <b>${esc(bs)}</b>.</span>` : ''}</div>`; }
  if (n && ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(d.cls[n - 1])) {   // "Show": what did this move allow the opponent to do?
    const mine = (n % 2 ? 'w' : 'b') === rec.me; let extra = '';
    if (R.allow && d.bestU[n]) {
      const u = d.bestU[n], gg = new Chess(g.fen()), m = gg.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (m) {
        const e2 = d.ev[n], more = [m.captured ? `capturing ${mine ? 'your' : 'the'} ${PN[m.captured]}` : '', gg.in_checkmate() ? 'with checkmate' : gg.in_check() ? 'with check' : ''].filter(Boolean).join(' ');
        extra = `<div style="font-weight:400;margin-top:6px">After ${esc(d.sans[n - 1])}, ${mine ? 'your opponent' : 'you'} could play <b>${esc(m.san)}</b>${more ? ', ' + more : ''}. The evaluation becomes ${Math.abs(e2) >= 9000 ? 'a forced mate' : (e2 >= 0 ? '+' : '') + (e2 / 100).toFixed(2)}.</div><button class="chip" style="margin-top:6px" onclick="rvShow(${n})">Hide</button>`;
        setTimeout(() => { if (RV === R && R.n === n && R.allow) { B.g = gg; B.last = [m.from, m.to]; B.badge = null; B.arrows = []; B.draw(); sound(m, gg); } }, 350);
      }
    } else extra = `<button class="chip" style="margin-top:6px" onclick="rvShow(${n}, true)">Show</button>`;
    fb = fb.slice(0, -6) + extra + '</div>';
  }
  const ev = d.ev[n], wpw = wp(ev), evTxt = Math.abs(ev) >= 9000 ? 'Mate' : (ev >= 0 ? '+' : '') + (ev / 100).toFixed(2);
  let rows = ''; for (let i = 0; i < d.sans.length; i += 2) rows += `<tr><td class="mn">${i / 2 + 1}.</td>${[i, i + 1].map(k => k < d.sans.length ? `<td class="gm ${k === n - 1 ? 'cur' : ''}" onclick="rvShow(${k + 1})">${esc(d.sans[k])}<img class="mi" src="reviews/${d.cls[k]}.png" alt=""></td>` : '<td></td>').join('')}</tr>`;
  $('#pn').innerHTML = `<p style="margin:0"><a href="${R.back}">Back</a></p><h2>Game review</h2>
  <div class="row" style="margin:6px 0"><div class="stat" style="flex:1;margin:0">White ${esc(names.w)}<br><span style="font-size:22px">${accOf(d.loss, 0)}%</span> <span class="mut" style="font-weight:400;font-size:13px">accuracy</span></div><div class="stat" style="flex:1;margin:0">Black ${esc(names.b)}<br><span style="font-size:22px">${accOf(d.loss, 1)}%</span> <span class="mut" style="font-weight:400;font-size:13px">accuracy</span></div></div>
  <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;border:1px solid var(--line);margin:8px 0 2px"><div style="width:${wpw}%;background:#fff"></div><div style="flex:1;background:#2b3a5c"></div></div><div class="mut" style="font-size:13px">Evaluation: ${evTxt}</div>
  ${fb}<div class="mv" style="max-height:230px"><table class="mvt">${rows}</table></div>
  <div class="row"><button class="chip" onclick="rvShow(0)">|&lt;</button><button class="chip" onclick="rvShow(RV.n-1)">&lt;</button><button class="chip" onclick="rvShow(RV.n+1)">&gt;</button><button class="chip" onclick="rvShow(RV.data.sans.length)">&gt;|</button><button class="chip" onclick="RV.B.flip=!RV.B.flip;RV.B.draw()">Flip board</button></div>
  <table class="ht" style="margin-top:12px"><tr><td></td><td class="mut">White</td><td class="mut">Black</td></tr>${RV_CLS.filter(k => cnt.w[k] || cnt.b[k]).map(k => `<tr style="cursor:default"><td><img class="mi" style="margin:0 8px 0 0;width:20px;height:20px" src="reviews/${k}.png" alt="">${k[0].toUpperCase() + k.slice(1)}</td><td>${cnt.w[k] || 0}</td><td>${cnt.b[k] || 0}</td></tr>`).join('')}</table>`;
}
addEventListener('keydown', e => { if (RV && RV.data && location.hash.startsWith('#review/')) { if (e.key === 'ArrowLeft') rvShow(RV.n - 1); if (e.key === 'ArrowRight') rvShow(RV.n + 1); } });

/* ---------- Home, profile, router ---------- */
function homeView() {
  $('#app').innerHTML = `<div class="wrap"><h1 style="font-size:46px;color:var(--deep)">Learn chess. Play like a grandmaster.</h1>
  <p class="mut" style="font-size:18px">Play seven bots, solve puzzles and study openings.</p>
  <div class="grid"><a class="card" href="#play"><h3>Play</h3>Seven bots, 11 time controls, live Elo.</a><a class="card" href="#puzzles"><h3>Puzzles</h3>Mates and tactics.</a><a class="card" href="#openings"><h3>Openings</h3>Lines you can step through.</a></div></div>`;
}
function profileView() {
  const d = D(), w = d.games.filter(g => g.s === 1).length, dr = d.games.filter(g => g.s === .5).length;
  $('#app').innerHTML = `<div class="wrap"><h2>${tt(titleOf(d))}${esc(CUR.u)}</h2><div class="card"><div style="font:700 54px Georgia,serif;color:var(--deep)">${d.rating}</div><span class="mut">Elo rating</span>
  <p>${w} wins · ${dr} draws · ${d.games.length - w - dr} losses · ${d.pz.length}/${PZ.length} puzzles</p></div>
  <h3>Recent games</h3><div class="card">${d.games.length ? '<table>' + d.games.slice(0, 10).map(g => `<tr><td>${g.s === 1 ? 'Win' : g.s === .5 ? 'Draw' : 'Loss'}</td><td>vs ${g.b}</td><td>${Math.ceil(g.n / 2)} moves</td><td>${g.d >= 0 ? '+' : ''}${g.d}</td></tr>`).join('') + '</table>' : '<span class="mut">No games yet.</span>'}</div></div>`;
}
const VIEWS = { home: homeView, play: playView, puzzles: puzzleView, openings: openingsView, profile: profileView, online: onlineView, titles: titlesView, history: historyView, game: gameView, review: reviewView, friends: friendsView, requests: requestsView, settings: settingsView, brill: brillView, search: searchView, player: playerView, pgame: pgameView, login: () => authView(false), signup: () => authView(true) };
const NAV = [['play', 'Play'], ['online', 'Online'], ['puzzles', 'Puzzles'], ['openings', 'Openings'], ['history', 'History'], ['titles', 'Titles'], ['search', 'Search'], ['friends', 'Friends'], ['requests', 'Requests'], ['profile', 'Profile'], ['settings', 'Settings']];
function route() {
  stopVoice(); stopOnline(); stopPerson(); clearInterval(SR);
  renderNav();   // the menu is built by the script, so it always matches the pages
  document.body.classList.toggle('out', !ME);
  $('#acc').innerHTML = ME ? `<span class="chip">${tt(titleOf(D()))}${esc(CUR.u)} · ${D().rating}</span><button class="chip" onclick="logout()">Log out</button>` : '<a class="chip" href="#login">Log in</a><a class="btn" style="margin:0;padding:7px 14px" href="#signup">Sign up</a>';
  let k = location.hash.slice(1), arg = null; const sl = k.indexOf('/'); if (sl > 0) { arg = k.slice(sl + 1); k = k.slice(0, sl); } if (!VIEWS[k]) k = 'home';
  if (!ME && k !== 'login' && k !== 'signup') { location.hash = '#login'; return; }   // everything needs an account
  if (ME && !CUR) return logout();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + (k === 'game' || k === 'review' ? 'history' : ['search', 'player', 'pgame', 'brill'].includes(k) ? 'search' : k)));
  startPresence(); countReq(); VIEWS[k](arg); scrollTo(0, 0);
}
addEventListener('hashchange', route);
(async () => { if (ME) { try { CUR = await getAcc(ME); } catch (e) {} if (!CUR) ME = null; else await loadMyTitle(); } route(); })();
