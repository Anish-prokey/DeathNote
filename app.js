(() => {
'use strict';
const KEY = 'tj.trades.v1';
const EMOTIONS = ['', 'Calm', 'Confident', 'Disciplined', 'Patient', 'Excited', 'Anxious', 'Fearful', 'Greedy', 'FOMO', 'Frustrated', 'Revenge', 'Hesitant', 'Bored', 'Relieved'];
const RATING_HINT = ['', 'Ignored the plan', 'Mostly off-plan', 'Half and half', 'Mostly on-plan', 'Followed it perfectly'];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { if (v === '' || v == null) return null; const n = +String(v).trim().replace(',', '.'); return isNaN(n) ? null : n; };
const money = n => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0 });
const sgn = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';

const cloudLib = window.TJCloudLib && window.TJCloudLib.TJCloud;
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
let uid = cloudLib ? lsGet('tj.lastUid') : null;   // last signed-in user, so their cached journal shows instantly
let cloudUser = null, unsub = null, syncState = 'Offline', syncErr = '';
const storeKey = () => uid ? 'tj.cloud.' + uid : KEY;
let trades = load(storeKey());
let rating = 0;
// trading (prop firm) accounts: each trade has t.acct; trades saved before this feature have none and belong to 'main'
const ACCT_KEY = 'tj.accounts.v1';
const acctStoreKey = () => uid ? 'tj.cloudacct.' + uid : ACCT_KEY;
let tAccts = load(acctStoreKey()), activeAcct = lsGet('tj.activeAcct') || 'all', unsubA = null;
const acctOf = t => t.acct || 'main';
function allAccts() {
  const list = tAccts.slice();
  if (!list.some(a => a.id === 'main') && (trades.some(t => acctOf(t) === 'main') || !list.length)) list.unshift({ id: 'main', name: 'Main account', type: 'Personal', status: 'active', virtual: true });
  return list;
}
const acctById = id => allAccts().find(a => a.id === id);
const acctName = id => (acctById(id) || {}).name || 'Deleted account';
const visibleAccts = () => allAccts().filter(a => a.status !== 'archived');
const inScope = () => activeAcct === 'all' ? trades : trades.filter(t => acctOf(t) === activeAcct);
function saveAccts() { try { localStorage.setItem(acctStoreKey(), JSON.stringify(tAccts)); } catch {} }
function cleanAcct(a) {
  const n = v => (v === '' || v == null || isNaN(+v)) ? null : +v, s = (v, m) => String(v ?? '').slice(0, m);
  return {
    id: s(a.id, 80), name: s(a.name, 60) || 'Account', firm: s(a.firm, 40), type: ['Evaluation', 'Funded', 'Live', 'Demo', 'Personal'].includes(a.type) ? a.type : 'Personal',
    status: ['active', 'passed', 'failed', 'archived'].includes(a.status) ? a.status : 'active', startBalance: n(a.startBalance), targetPct: n(a.targetPct),
    dailyPct: n(a.dailyPct), ddPct: n(a.ddPct), ddType: a.ddType === 'trailing' ? 'trailing' : 'static', created: n(a.created) || Date.now(),
  };
}
function upsertAcct(a) {
  if (!writable()) return false;
  if (cloudUser) cloudLib.saveAccount(a).catch(syncFail);
  else { const i = tAccts.findIndex(x => x.id === a.id); i >= 0 ? tAccts[i] = a : tAccts.push(a); saveAccts(); renderAll(); }
  return true;
}
function removeAcct(id) {
  if (!writable()) return false;
  if (cloudUser) cloudLib.removeAccount(id).catch(syncFail);
  else { tAccts = tAccts.filter(a => a.id !== id); saveAccts(); renderAll(); }
  return true;
}
const now0 = new Date();
let calY = now0.getFullYear(), calM = now0.getMonth();
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function load(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } }
function save() { try { localStorage.setItem(storeKey(), JSON.stringify(trades)); } catch { toast('Could not save (storage blocked)'); } }
function syncFail(e) {
  syncErr = e && e.code === 'permission-denied' ? 'Cloud blocked this: publish firestore.rules in the Firebase console.' :
    /not been used in project/.test(e && e.message) ? 'Firestore is not enabled yet in the Firebase console.' : (e && e.message) || 'Sync problem';
  toast(syncErr); updateAcct();
}
// All writes go through these. Signed in: Firestore (its snapshot updates `trades`). Signed out: this browser only.
function writable() { if (uid && !cloudUser) { toast('Reconnecting to your account… try again in a moment'); return false; } return true; }
function upsertTrades(list) {
  if (!writable()) return false;
  if (cloudUser) cloudLib.saveMany(list).catch(syncFail);
  else { list.forEach(t => { const i = trades.findIndex(x => x.id === t.id); i >= 0 ? trades[i] = t : trades.push(t); }); save(); renderAll(); }
  return true;
}
function removeTrades(ids) {
  if (!writable()) return false;
  ids.forEach(id => shotCache.delete(id));
  if (cloudUser) cloudLib.removeMany(ids).catch(syncFail);
  else { trades = trades.filter(t => !ids.includes(t.id)); const m = localShots(); ids.forEach(id => delete m[id]); try { localStorage.setItem(SHOTS_KEY, JSON.stringify(m)); } catch {} save(); renderAll(); }
  return true;
}

// ---- screenshots: separate store (Firestore `shots` docs when signed in, localStorage when not) ----
const SHOTS_KEY = 'tj.shots.v1', MAX_SHOTS = 4, MAX_CHARS = 230000, shotCache = new Map();
function localShots() { try { return JSON.parse(localStorage.getItem(SHOTS_KEY)) || {}; } catch { return {}; } }
async function getShots(id) {
  if (shotCache.has(id)) return shotCache.get(id);
  try { const v = cloudUser ? await cloudLib.getShots(id) : (localShots()[id] || []); shotCache.set(id, v); return v; } catch { return []; }
}
function putShots(id, arr) {
  shotCache.set(id, arr);
  if (cloudUser) return cloudLib.saveShots(id, arr).catch(syncFail);
  const m = localShots(); arr.length ? m[id] = arr : delete m[id];
  try { localStorage.setItem(SHOTS_KEY, JSON.stringify(m)); } catch { toast('Browser storage is full. Sign in to keep images in the cloud.'); }
}
async function compress(file) {
  const bmp = await createImageBitmap(file);
  let max = 1280, q = 0.72, out = '';
  for (let i = 0; i < 10; i++) {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height)), cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
    out = cv.toDataURL('image/jpeg', q);
    if (out.length <= MAX_CHARS) break;
    if (q > 0.5) q -= 0.1; else max *= 0.8;
  }
  bmp.close && bmp.close();
  return out;
}
let pendingShots = [], shotsDirty = false, shotsLoaded = true;
function renderShotGrid() {
  const g = $('#shotGrid'); g.innerHTML = '';
  pendingShots.forEach((src, i) => {
    const w = document.createElement('div'); w.className = 'sh';
    const im = document.createElement('img'); im.src = src; im.alt = 'screenshot ' + (i + 1); im.onclick = () => openLightbox(src);
    const x = document.createElement('button'); x.type = 'button'; x.className = 'rm'; x.textContent = '×'; x.title = 'Remove'; x.onclick = () => { pendingShots.splice(i, 1); shotsDirty = true; renderShotGrid(); };
    w.append(im, x); g.append(w);
  });
  $('#shotAdd').hidden = $('#shotCam').hidden = pendingShots.length >= MAX_SHOTS;
}
async function addFiles(files) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  if (!shotsLoaded) return toast('Still loading this trade’s images…');
  for (const f of imgs) {
    if (pendingShots.length >= MAX_SHOTS) { toast(`Max ${MAX_SHOTS} images per trade`); break; }
    try { pendingShots.push(await compress(f)); shotsDirty = true; } catch { toast('Could not read that image'); }
  }
  renderShotGrid();
}
function openLightbox(src) { $('#lbImg').src = src; $('#lightbox').showModal(); }
function hydrateThumbs() {
  $$('.thumbs').forEach(async el => {
    const arr = await getShots(el.dataset.id); el.textContent = '';
    arr.forEach(src => { const im = document.createElement('img'); im.src = src; im.alt = 'chart'; im.onclick = e => { e.stopPropagation(); openLightbox(src); }; el.append(im); });
  });
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }

// ---- derived values ----
// Auto P&L in account currency (assumed USD). FX and metals sizes are LOTS; everything else is units/shares.
// FX crosses need a rate to convert the quote currency to USD: the form asks for it (t.fxRate).
const CCY = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'], USD_BASE = ['JPY', 'CHF', 'CAD'];
function contract(instr) {
  const s = String(instr || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s === 'XAUUSD') return { mult: 100, unit: 'lots · 1 lot = 100 oz' };
  if (s === 'XAGUSD') return { mult: 5000, unit: 'lots · 1 lot = 5,000 oz' };
  if (/^[A-Z]{6}$/.test(s) && CCY.includes(s.slice(0, 3)) && CCY.includes(s.slice(3))) {
    const base = s.slice(0, 3), quote = s.slice(3), c = { mult: 100000, unit: 'lots · 1 lot = 100,000' };
    if (quote === 'USD') return c;
    if (base === 'USD') return { ...c, perExit: true };   // quote currency -> USD at the exit price
    return { ...c, cross: true, quote };
  }
  return { mult: 1, unit: 'units / shares' };
}
function autoPnl(t) {
  if (t.entry == null || t.exit == null) return null;
  const c = contract(t.instrument);
  const raw = (t.exit - t.entry) * (t.direction === 'short' ? -1 : 1) * (t.size ?? 1) * c.mult;
  if (c.perExit) return raw / t.exit;
  if (c.cross) return t.fxRate ? (USD_BASE.includes(c.quote) ? raw / t.fxRate : raw * t.fxRate) : null;
  return raw;
}
// Exchange rate to convert a cross pair's quote currency to USD, fetched for the trade's date (ECB reference rates via
// frankfurter.dev, cached). Offline: rough fallback, and the trade is flagged as an estimate (~).
const FX_APPROX = { EUR: 0.92, GBP: 0.75, AUD: 1.53, NZD: 1.7, JPY: 150, CHF: 0.88, CAD: 1.4 };   // quote currency per 1 USD
async function getFxRate(quote, date) {
  const d = new Date(), today = ymd(d.getFullYear(), d.getMonth(), d.getDate()), day = !date || date > today ? 'latest' : date, key = `tj.fx.${day}.${quote}`;
  let perUsd = num(lsGet(key)), est = false;
  if (!perUsd) {
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 4000);
      const j = await (await fetch(`https://api.frankfurter.dev/v1/${day}?base=USD&symbols=${quote}`, { signal: ctl.signal })).json();
      clearTimeout(timer); perUsd = j.rates && j.rates[quote];
      if (perUsd) lsSet(key, String(perUsd));
    } catch {}
  }
  if (!perUsd) { perUsd = FX_APPROX[quote]; est = true; }
  return { rate: USD_BASE.includes(quote) ? perUsd : 1 / perUsd, est };   // stored in the same convention the form always used
}
function rMultiple(t) {
  if (t.entry == null || t.exit == null || t.stop == null) return null;
  const risk = Math.abs(t.entry - t.stop);
  if (!risk) return null;
  const d = t.direction === 'short' ? -1 : 1;
  return (t.exit - t.entry) * d / risk;
}
const result = t => t.pnl == null ? 'open' : t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : 'be';
const closed = () => inScope().filter(t => t.pnl != null);

// ---- stats ----
function computeStats(list) {
  const wins = list.filter(t => t.pnl > 0), losses = list.filter(t => t.pnl < 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const n = list.length;
  const rs = list.map(rMultiple).filter(r => r != null);
  const plans = list.map(t => t.plan).filter(Boolean);
  return {
    n, wins: wins.length, losses: losses.length,
    winRate: n ? wins.length / n : 0,
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: losses.length ? -gl / losses.length : 0,
    net: gw - gl,
    pf: gl ? gw / gl : (gw ? Infinity : 0),
    expectancy: n ? (gw - gl) / n : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    avgPlan: plans.length ? plans.reduce((a, b) => a + b, 0) / plans.length : null,
  };
}

function renderStats() {
  const s = computeStats(closed()), openN = inScope().filter(t => t.pnl == null).length;
  const wl = s.avgLoss ? Math.abs(s.avgWin / s.avgLoss) : null;
  const card = (k, v, sub = '', cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${sub}</div></div>`;
  $('#stats').innerHTML = [
    card('Net P&L', money(s.net), `${s.n} closed${openN ? ' · ' + openN + ' open' : ''}`, sgn(s.net)),
    card('Win rate', s.n ? (s.winRate * 100).toFixed(1) + '%' : '–', `${s.wins}W / ${s.losses}L`),
    card('Avg win', s.wins ? money(s.avgWin) : '–', 'win size', 'pos'),
    card('Avg loss', s.losses ? money(s.avgLoss) : '–', 'loss size', 'neg'),
    card('Win/loss ratio', wl ? wl.toFixed(2) : '–', 'avg win ÷ avg loss'),
    card('Expectancy', s.n ? money(s.expectancy) : '–', 'per trade', sgn(s.expectancy)),
    card('Profit factor', s.pf === Infinity ? '∞' : s.n ? s.pf.toFixed(2) : '–', 'gross win ÷ gross loss'),
    card('Avg R', s.avgR == null ? '–' : s.avgR.toFixed(2) + 'R', 'needs stop + exit', s.avgR == null ? '' : sgn(s.avgR)),
    card('Plan score', s.avgPlan == null ? '–' : s.avgPlan.toFixed(1) + ' / 5', 'avg adherence'),
  ].join('');
}

function renderEquity() {
  const list = closed().slice().sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  const el = $('#equity');
  if (list.length < 2) { el.innerHTML = '<div class="empty">Log at least 2 closed trades to see your curve.</div>'; return; }
  let c = 0; const pts = [0, ...list.map(t => (c += t.pnl))];
  const W = 560, H = 240, p = { l: 48, r: 12, t: 12, b: 24 };
  const lo = Math.min(...pts), hi = Math.max(...pts), span = (hi - lo) || 1;
  const x = i => p.l + i * (W - p.l - p.r) / (pts.length - 1);
  const y = v => p.t + (hi - v) * (H - p.t - p.b) / span;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const up = pts[pts.length - 1] >= 0, col = up ? 'var(--win)' : 'var(--loss)';
  const grid = [0, .5, 1].map(f => { const v = lo + span * f; return `<line x1="${p.l}" x2="${W - p.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${p.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(v)}</text>`; }).join('');
  const zero = lo < 0 && hi > 0 ? `<line x1="${p.l}" x2="${W - p.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-dasharray="4 3"/>` : '';
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Equity curve">${grid}${zero}<path d="${d}L${x(pts.length - 1)},${y(lo)}L${x(0)},${y(lo)}Z" fill="${col}" opacity=".1"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/><text x="${p.l}" y="${H - 6}" font-size="11" fill="var(--muted)">trade 0</text><text x="${W - p.r}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--muted)">trade ${list.length}</text></svg>`;
}

function renderAdherence() {
  const el = $('#adherence'), list = closed().filter(t => t.plan);
  if (!list.length) { el.innerHTML = '<div class="empty">Rate your trades 1–5 to see this.</div>'; return; }
  const rows = [1, 2, 3, 4, 5].map(r => { const g = list.filter(t => t.plan === r); return { r, n: g.length, avg: g.length ? g.reduce((a, t) => a + t.pnl, 0) / g.length : null }; });
  const m = Math.max(...rows.map(x => Math.abs(x.avg || 0)), 1);
  const W = 560, H = 240, p = { l: 12, r: 12, t: 20, b: 40 }, bw = (W - p.l - p.r) / 5, mid = p.t + (H - p.t - p.b) / 2, half = (H - p.t - p.b) / 2 - 14;
  const bars = rows.map((x, i) => {
    const cx = p.l + i * bw + bw / 2;
    if (x.avg == null) return `<text x="${cx}" y="${H - 22}" text-anchor="middle" font-size="12" fill="var(--muted)">${x.r}</text><text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">n=0</text>`;
    const h = Math.abs(x.avg) / m * half, up = x.avg >= 0;
    return `<rect x="${cx - bw * .3}" width="${bw * .6}" y="${up ? mid - h : mid}" height="${Math.max(h, 1)}" rx="4" fill="${up ? 'var(--win)' : 'var(--loss)'}"/><text x="${cx}" y="${up ? mid - h - 5 : mid + h + 13}" text-anchor="middle" font-size="11" fill="var(--ink)">${money(x.avg)}</text><text x="${cx}" y="${H - 22}" text-anchor="middle" font-size="12" fill="var(--ink)">${x.r}</text><text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">n=${x.n}</text>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Average P&L by plan rating"><line x1="${p.l}" x2="${W - p.r}" y1="${mid}" y2="${mid}" stroke="var(--muted)"/>${bars}</svg>`;
}

function renderEmotionBars(sel, field) {
  const el = $(sel), by = {};
  closed().forEach(t => { const e = t[field]; if (e) (by[e] ||= []).push(t.pnl); });
  const rows = Object.entries(by).map(([e, a]) => ({ e, n: a.length, avg: a.reduce((x, y) => x + y, 0) / a.length })).sort((a, b) => b.avg - a.avg);
  if (!rows.length) { el.innerHTML = '<div class="empty">Tag your emotions to see patterns.</div>'; return; }
  const m = Math.max(...rows.map(r => Math.abs(r.avg)), 1);
  el.innerHTML = rows.map(r => {
    const w = Math.abs(r.avg) / m * 50, up = r.avg >= 0;
    return `<div class="b"><span>${esc(r.e)} <span class="muted">(${r.n})</span></span><div class="track"><div class="zero"></div><div class="fill" style="${up ? 'left:50%' : `left:${50 - w}%`};width:${w}%;background:var(--${up ? 'win' : 'loss'})"></div></div><span class="n ${sgn(r.avg)}">${money(r.avg)}</span></div>`;
  }).join('');
}

function renderLessons() {
  const L = inScope().filter(t => t.learned).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('#lessons').innerHTML = L.length ? L.map(t => `<p><b>${esc(t.date)} · ${esc(t.instrument)}</b><br>${esc(t.learned)}</p>`).join('') : '<div class="empty">Lessons you write will show up here.</div>';
}

// ---- journal list ----
function renderList() {
  const q = $('#search').value.toLowerCase(), fr = $('#fResult').value, fd = $('#fDir').value;
  const list = inScope().slice().sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created).filter(t =>
    (!fr || result(t) === fr) && (!fd || t.direction === fd) &&
    (!q || [t.date, t.instrument, t.signal, t.emoNotes, t.better, t.learned, t.trail].join(' ').toLowerCase().includes(q)));
  if (!list.length) { $('#list').innerHTML = `<div class="empty">${inScope().length ? 'No trades match your filters.' : 'No trades yet. Click “+ New trade” to log your first one, or load demo data in the Data tab.'}</div>`; return; }
  const multi = activeAcct === 'all' && allAccts().length > 1;
  $('#list').innerHTML = list.map(t => {
    const r = rMultiple(t), pnl = t.pnl;
    const f = (k, v) => v ? `<div class="txt"><b>${k}:</b> ${esc(v)}</div>` : '';
    const lv = [['Entry', t.entry], ['Stop', t.stop], ['Target', t.target], ['Exit', t.exit]].filter(x => x[1] != null).map(x => `${x[0]} ${x[1]}`).join(' · ');
    const emo = [['entry', t.emoEntry], ['losers', t.emoLoser], ['winners', t.emoWinner], ['exit', t.emoExit]].filter(x => x[1]).map(x => `${x[1]} (${x[0]})`).join(', ');
    return `<article class="trade ${result(t)}" data-id="${esc(t.id)}" tabindex="0">
      <div class="h"><span class="sym">${esc(t.instrument)}</span><span class="tag ${t.direction}">${t.direction}</span><span class="muted small">${esc(t.date)}</span>${multi ? `<span class="tag">${esc(acctName(acctOf(t)))}</span>` : ''}${t.plan ? `<span class="tag">plan ${t.plan}/5</span>` : ''}${t.imgCount ? `<span class="tag">📷 ${t.imgCount}</span>` : ''}${r != null ? `<span class="tag">${r.toFixed(2)}R</span>` : ''}<span class="pl ${sgn(pnl)}">${pnl == null ? (t.exit != null ? 'set P&amp;L' : 'open') : (t.pnlEst ? '~' : '') + money(pnl)}</span></div>
      <div class="meta">${esc(lv)}${t.trail ? ' · trail: ' + esc(t.trail) : ''}</div>
      ${f('Signal', t.signal)}${emo ? `<div class="txt"><b>Emotions:</b> ${esc(emo)}${t.emoNotes ? ' — ' + esc(t.emoNotes) : ''}</div>` : ''}${f('Do better', t.better)}${f('Learned', t.learned)}${t.imgCount ? `<div class="thumbs" data-id="${esc(t.id)}"></div>` : ''}</article>`;
  }).join('');
  hydrateThumbs();
}

// ---- calendar ----
function renderCalendar() {
  $('#calTitle').textContent = new Date(calY, calM, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const prefix = `${calY}-${pad(calM + 1)}-`, byDay = {};
  closed().filter(t => t.date.startsWith(prefix)).forEach(t => (byDay[t.date] ||= []).push(t));
  const all = Object.values(byDay).flat(), s = computeStats(all);
  const days = Object.entries(byDay).map(([d, a]) => ({ d, pnl: a.reduce((x, t) => x + t.pnl, 0) }));
  const best = days.length ? days.reduce((a, b) => b.pnl > a.pnl ? b : a) : null, worst = days.length ? days.reduce((a, b) => b.pnl < a.pnl ? b : a) : null;
  const lbl = d => d ? new Date(d.d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) : '';
  const card = (k, v, cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  $('#calStats').innerHTML = card('Total trades', s.n) + card('P&L', money(s.net), sgn(s.net)) +
    card(`Best day ${lbl(best)}`, best ? money(best.pnl) : '–', best ? sgn(best.pnl) : '') +
    card(`Worst day ${lbl(worst)}`, worst ? money(worst.pnl) : '–', worst ? sgn(worst.pnl) : '') +
    card('Win rate', s.n ? (s.winRate * 100).toFixed(2) + '%' : '–');
  const first = new Date(calY, calM, 1), lead = (first.getDay() + 6) % 7, start = new Date(calY, calM, 1 - lead);
  const total = Math.ceil((lead + new Date(calY, calM + 1, 0).getDate()) / 7) * 7, today = ymd(now0.getFullYear(), now0.getMonth(), now0.getDate());
  let h = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < total; i++) {
    const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), key = ymd(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const a = byDay[key], pnl = a ? a.reduce((x, t) => x + t.pnl, 0) : 0;
    h += `<div class="day ${dt.getMonth() !== calM ? 'out' : ''} ${key === today ? 'today' : ''} ${a ? (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : '') : ''}" data-date="${key}" data-n="${a ? a.length : 0}" tabindex="0"><span class="dn">${pad(dt.getDate())}</span>${a ? `<span class="dp ${sgn(pnl)}">${money(pnl)}</span><span class="dt">${a.length} trade${a.length > 1 ? 's' : ''}</span>` : ''}</div>`;
  }
  $('#cal').innerHTML = h;
}
const calMove = d => { const t = new Date(calY, calM + d, 1); calY = t.getFullYear(); calM = t.getMonth(); renderCalendar(); };
$('#calPrev').onclick = () => calMove(-1);
$('#calNext').onclick = () => calMove(1);
$('#calToday').onclick = () => { calY = now0.getFullYear(); calM = now0.getMonth(); renderCalendar(); };
$('#cal').addEventListener('click', e => {
  const d = e.target.closest('.day'); if (!d) return;
  if (+d.dataset.n) { $('#search').value = d.dataset.date; $('#fResult').value = ''; $('#fDir').value = ''; renderList(); show('journal'); }
  else openForm(null, d.dataset.date);
});
$('#cal').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.click?.(); });

function renderAll() { renderAcctSel(); renderAcctPanel(); if (taDlg.open) renderTaList(); renderCalendar(); renderStats(); renderEquity(); renderAdherence(); renderEmotionBars('#emoEntry', 'emoEntry'); renderEmotionBars('#emoExit', 'emoExit'); renderLessons(); renderList(); }

// ---- form ----
const dlg = $('#dlg'), form = $('#form');

// screenshots: lightbox, file picker, paste and drag-drop
$('#lightbox').addEventListener('click', () => $('#lightbox').close());
$('#shotFile').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

// camera: phones / the APK use the native camera app (capture input); desktops with a webcam get a live preview
$('#shotCapture').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
const cam = { stream: null, facing: 'environment' };
function camStop() { cam.stream?.getTracks().forEach(t => t.stop()); cam.stream = null; $('#camVideo').srcObject = null; }
async function camStart() {
  camStop();
  cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cam.facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  $('#camVideo').srcObject = cam.stream;
}
$('#shotCam').addEventListener('click', async () => {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch || !navigator.mediaDevices?.getUserMedia) return $('#shotCapture').click();
  try {
    await camStart();
    const vids = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    $('#camFlip').hidden = vids.length < 2;
    $('#camDlg').showModal();
  } catch (err) {
    camStop();
    if (err?.name === 'NotAllowedError') toast('Camera permission was denied');
    else if (err?.name === 'NotFoundError') { toast('No camera found, choose a file instead'); $('#shotCapture').click(); }
    else toast('Could not open the camera');
  }
});
$('#camFlip').addEventListener('click', () => { cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; camStart().catch(() => toast('Could not switch camera')); });
$('#camCancel').addEventListener('click', () => $('#camDlg').close());
$('#camDlg').addEventListener('close', camStop);
$('#camSnap').addEventListener('click', () => {
  const v = $('#camVideo');
  if (!v.videoWidth) return toast('Camera is still starting…');
  const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
  cv.getContext('2d').drawImage(v, 0, 0);
  cv.toBlob(b => {
    $('#camDlg').close();
    if (b) addFiles([new File([b], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
  }, 'image/jpeg', 0.92);
});
dlg.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.some(f => f.type.startsWith('image/'))) { e.preventDefault(); addFiles(fs); } });
dlg.addEventListener('dragover', e => { e.preventDefault(); dlg.classList.add('drop'); });
dlg.addEventListener('dragleave', () => dlg.classList.remove('drop'));
dlg.addEventListener('drop', e => { e.preventDefault(); dlg.classList.remove('drop'); addFiles(e.dataTransfer.files); });
$$('[data-emo]').forEach(s => s.innerHTML = EMOTIONS.map(e => `<option value="${e}">${e || '—'}</option>`).join(''));
$('#rating').innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-n="${n}" aria-checked="false">${n}</button>`).join('');
function setRating(n) {
  rating = n;
  $$('#rating button').forEach(b => { const on = +b.dataset.n === n; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('#ratingHint').textContent = RATING_HINT[n] || '';
}
$('#rating').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setRating(+b.dataset.n === rating ? 0 : +b.dataset.n); });

function openForm(t, date) {
  form.reset();
  const f = form.elements;
  f.id.value = t?.id || '';
  fillAcctSelect(f.acct, t ? acctOf(t) : (activeAcct !== 'all' ? activeAcct : lsGet('tj.lastAcct')));
  f.date.value = t?.date || date || ymd(now0.getFullYear(), now0.getMonth(), now0.getDate());
  if (t) for (const k of ['instrument', 'direction', 'size', 'entry', 'exit', 'stop', 'target', 'trail', 'pnl', 'signal', 'emoEntry', 'emoLoser', 'emoWinner', 'emoExit', 'emoNotes', 'better', 'learned']) f[k].value = t[k] ?? '';
  f.fxRate.value = t && t.fxManual ? t.fxRate : '';   // auto rates are re-fetched on save; only a rate you typed is kept
  setRating(t?.plan || 0);
  pendingShots = []; shotsDirty = false; shotsLoaded = !(t && t.imgCount); renderShotGrid();
  if (t && t.imgCount) getShots(t.id).then(arr => { if (form.elements.id.value === t.id && !shotsDirty) { pendingShots = arr.slice(); shotsLoaded = true; renderShotGrid(); } });
  updateInstr();
  $('#dlgTitle').textContent = t ? 'Edit trade' : 'New trade';
  $('#delBtn').hidden = !t;
  dlg.showModal();
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const f = form.elements, id = f.id.value;
  const LBL = { size: 'Size', entry: 'Entry price', exit: 'Exit price', stop: 'Stop loss', target: 'Profit target', pnl: 'Result P&L', fxRate: 'Conversion rate' };
  for (const k of Object.keys(LBL)) if (f[k].value.trim() !== '' && num(f[k].value) == null) { toast(`${LBL[k]} "${f[k].value}" is not a valid number`); f[k].focus(); return; }
  const cx = contract(f.instrument.value.trim()), typedFx = num(f.fxRate.value);
  let fxRate = cx.cross ? typedFx : null, pnlEst = false;
  if (cx.cross && fxRate == null && num(f.exit.value) != null && num(f.pnl.value) == null) {   // convert to USD automatically
    const sb = $('#form button[type=submit]'); sb.disabled = true; toast('Getting the exchange rate…');
    try { const r = await getFxRate(cx.quote, f.date.value); fxRate = r.rate; pnlEst = r.est; } finally { sb.disabled = false; }
    if (pnlEst) toast('Offline: P&L is an estimate (~). Edit the trade later to refresh it.');
  }
  const t = {
    id: id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    created: id ? (trades.find(x => x.id === id)?.created ?? Date.now()) : Date.now(),
    acct: f.acct.value || 'main', date: f.date.value, instrument: f.instrument.value.trim().toUpperCase(), direction: f.direction.value,
    size: num(f.size.value), entry: num(f.entry.value), exit: num(f.exit.value), stop: num(f.stop.value), target: num(f.target.value),
    trail: f.trail.value.trim(), pnl: num(f.pnl.value), fxRate, fxManual: cx.cross && typedFx != null, pnlEst, signal: f.signal.value.trim(),
    emoEntry: f.emoEntry.value, emoLoser: f.emoLoser.value, emoWinner: f.emoWinner.value, emoExit: f.emoExit.value,
    emoNotes: f.emoNotes.value.trim(), plan: rating || null, better: f.better.value.trim(), learned: f.learned.value.trim(),
  };
  // P&L follows the prices unless you typed your own number (pnlManual). Editing prices on an auto trade recomputes it.
  const prev = trades.find(x => x.id === t.id), auto = autoPnl(t), typed = num(f.pnl.value);
  if (auto != null && (typed == null || (prev && !prev.pnlManual && typed === prev.pnl))) { t.pnl = +auto.toFixed(2); t.pnlManual = false; }
  else { t.pnl = typed; t.pnlManual = typed != null; t.pnlEst = false; }
  if (t.exit != null && t.pnl == null) { toast('Could not calculate the P&L: type it in Result P&L'); f.pnl.focus(); return; }
  t.imgCount = shotsDirty ? pendingShots.length : (prev ? prev.imgCount || 0 : 0);
  if (shotsDirty && writable()) putShots(t.id, pendingShots.slice());   // before upsert: the list re-renders (and reads the image cache) inside it
  if (upsertTrades([t])) { lsSet('tj.lastAcct', t.acct); dlg.close(); toast('Trade saved'); }
});
function updateInstr() {
  const f = form.elements, c = contract(f.instrument.value);
  $('#sizeUnit').textContent = '(' + c.unit + ')';
  $('#fxWrap').hidden = !c.cross;
  if (c.cross) $('#fxLabel').textContent = (USD_BASE.includes(c.quote) ? `USD${c.quote}` : `${c.quote}USD`) + ' rate (optional: filled in automatically if blank)';
  const p = autoPnl({ instrument: f.instrument.value, entry: num(f.entry.value), exit: num(f.exit.value), size: num(f.size.value), direction: f.direction.value, fxRate: num(f.fxRate.value) });
  f.pnl.placeholder = p != null ? 'auto: ' + +p.toFixed(2) : c.cross && f.exit.value ? 'auto: exchange rate added on save' : 'auto from entry & exit';
}
form.addEventListener('input', updateInstr);
$('#qres').addEventListener('click', e => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  const f = form.elements, src = { target: 'target', stop: 'stop', be: 'entry' }[b.dataset.q];
  if (!f[src].value.trim()) { toast(`Enter the ${src === 'entry' ? 'entry' : src} price first`); f[src].focus(); return; }
  f.exit.value = f[src].value; updateInstr();
});
$('#newTradeBtn').onclick = () => openForm();
$('#cancelBtn').onclick = $('#closeDlg').onclick = () => dlg.close();
$('#delBtn').onclick = () => { if (confirm('Delete this trade?') && removeTrades([form.elements.id.value])) { dlg.close(); toast('Deleted'); } };
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
$('#list').addEventListener('click', e => { const a = e.target.closest('.trade'); if (a) openForm(trades.find(t => t.id === a.dataset.id)); });
$('#list').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.click?.(); });
['#search', '#fResult', '#fDir'].forEach(s => $(s).addEventListener('input', renderList));

// ---- tabs ----
function show(v) { $$('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + v)); $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.view === v)); }
$$('.tab').forEach(b => b.onclick = () => show(b.dataset.view));

// ---- data ----
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
$('#exportJson').onclick = async () => {
  const out = [];
  for (const t of trades) out.push(t.imgCount ? { ...t, images: await getShots(t.id) } : t);
  download('trading-journal.json', JSON.stringify({ app: 'trading-journal', version: 2, accounts: allAccts().filter(a => !a.virtual), trades: out }, null, 2), 'application/json');
};
$('#exportCsv').onclick = () => {
  const cols = ['date', 'account', 'instrument', 'direction', 'size', 'entry', 'exit', 'stop', 'target', 'trail', 'pnl', 'signal', 'emoEntry', 'emoLoser', 'emoWinner', 'emoExit', 'emoNotes', 'plan', 'better', 'learned'];
  const cell = v => { v = v ?? ''; v = String(v); if (/^[=+\-@]/.test(v) && isNaN(+v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  download('trading-journal.csv', [cols.join(','), ...trades.map(t => cols.map(c => cell(c === 'account' ? acctName(acctOf(t)) : t[c])).join(','))].join('\n'), 'text/csv');
};
$('#importFile').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const data = Array.isArray(raw) ? raw : raw && raw.trades;
    if (!Array.isArray(data)) throw 0;
    const haveA = new Set(tAccts.map(a => a.id));
    (raw && Array.isArray(raw.accounts) ? raw.accounts : []).forEach(a => { if (a && a.id && a.name && !haveA.has(a.id)) upsertAcct(cleanAcct(a)); });
    const have = new Set(trades.map(t => t.id));
    const fresh = data.filter(t => t && t.id && t.date && t.instrument && !have.has(t.id));
    const imgs = new Map();
    fresh.forEach(t => {
      const ok = Array.isArray(t.images) ? t.images.filter(x => typeof x === 'string' && x.startsWith('data:image/')).slice(0, MAX_SHOTS) : [];
      delete t.images; t.imgCount = ok.length; if (ok.length) imgs.set(t.id, ok);
    });
    if (upsertTrades(fresh)) { imgs.forEach((v, id) => putShots(id, v)); toast(`Imported ${fresh.length} trades`); }
  } catch { toast('Not a valid journal file'); }
  e.target.value = '';
};
$('#wipe').onclick = () => { if (confirm(cloudUser ? 'Delete ALL trades from your cloud account (every device)? Export a backup first.' : 'Delete ALL trades? Export a backup first.') && removeTrades(trades.map(t => t.id))) toast('All data deleted'); };
$('#loadDemo').onclick = () => {
  if (trades.length && !confirm('Add demo trades to your existing journal?')) return;
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const syms = ['XAUUSD', 'EURUSD', 'USDJPY', 'NIFTY'], today = Date.now(), demo = [];
  for (let i = 0; i < 24; i++) {
    const plan = 1 + Math.floor(rnd() * 5), win = rnd() < 0.3 + plan * 0.08, r = win ? 1 + rnd() * 2 : -(0.6 + rnd() * 0.6);
    const dir = rnd() < .6 ? 'long' : 'short', entry = 100, risk = 2, d = dir === 'long' ? 1 : -1;
    demo.push({
      id: 'demo' + i + today, acct: i % 2 ? 'demoB' : 'demoA', created: today + i, date: new Date(today - (24 - i) * 86400000 * 1.5).toISOString().slice(0, 10),
      instrument: syms[i % 4], direction: dir, size: 1, entry, stop: entry - d * risk, target: entry + d * risk * 2, exit: +(entry + d * risk * r).toFixed(2), trail: i % 3 ? '' : 'Trail 1R under swing',
      pnl: +(r * (i % 2 ? 400 : 800)).toFixed(2), pnlManual: true, signal: win ? 'H1 EMA bounce with LTF break of structure' : 'Early entry before confirmation',
      emoEntry: plan > 3 ? 'Calm' : 'FOMO', emoLoser: win ? '' : 'Anxious', emoWinner: win ? 'Greedy' : '', emoExit: win ? 'Relieved' : 'Frustrated', emoNotes: '',
      plan, better: plan < 4 ? 'Wait for confirmation candle' : '', learned: plan < 3 ? 'Off-plan trades cost me. Skip when unsure.' : '',
    });
  }
  [
    { id: 'demoA', name: 'Demo Challenge 100k', firm: 'Demo Prop Firm', type: 'Evaluation', status: 'active', startBalance: 100000, targetPct: 8, dailyPct: 5, ddPct: 10, ddType: 'static' },
    { id: 'demoB', name: 'Demo Funded 50k', firm: 'Demo Prop Firm', type: 'Funded', status: 'active', startBalance: 50000, targetPct: null, dailyPct: 4, ddPct: 6, ddType: 'trailing' },
  ].forEach(a => { if (!tAccts.some(x => x.id === a.id)) upsertAcct({ ...a, created: Date.now() }); });
  if (upsertTrades(demo)) toast('Demo data loaded');
};

// ---- trading accounts: switcher, health panel, manager ----
const taDlg = $('#taDlg'), taForm = $('#taForm');
let pendingActive = null;   // new account to switch to once its cloud snapshot arrives
function fillAcctSelect(sel, want) {
  const vis = visibleAccts(), cur = want && acctById(want);
  const opts = cur && cur.status === 'archived' ? [...vis, cur] : vis;
  sel.innerHTML = opts.map(a => `<option value="${esc(a.id)}">${esc(a.name)}${a.status === 'archived' ? ' (archived)' : ''}</option>`).join('');
  sel.value = opts.some(a => a.id === want) ? want : (opts[0] ? opts[0].id : 'main');
}
function renderAcctSel() {
  const s = $('#taSel'), vis = visibleAccts();
  if (activeAcct !== 'all' && !vis.some(a => a.id === activeAcct)) activeAcct = 'all';
  s.innerHTML = '<option value="all">All accounts</option>' + vis.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  s.value = activeAcct;
}
$('#taSel').onchange = e => { activeAcct = e.target.value; lsSet('tj.activeAcct', activeAcct); renderAll(); };
function acctHealth(a) {
  const list = trades.filter(t => acctOf(t) === a.id && t.pnl != null).sort((x, y) => x.date.localeCompare(y.date) || x.created - y.created);
  const start = a.startBalance > 0 ? +a.startBalance : null, net = list.reduce((s, t) => s + t.pnl, 0), h = { n: list.length, net, start };
  if (start == null) return h;
  let run = 0, peak = 0; list.forEach(t => { run += t.pnl; if (run > peak) peak = run; });
  h.balance = start + net;
  if (a.targetPct > 0) { h.targetAmt = start * a.targetPct / 100; h.targetProg = net / h.targetAmt; }
  if (a.ddPct > 0) {
    h.ddAmt = start * a.ddPct / 100;
    h.floor = a.ddType === 'trailing' ? Math.min(start + peak - h.ddAmt, start) : start - h.ddAmt;   // trailing locks at the start balance
    h.ddRemain = h.balance - h.floor; h.ddUsed = 1 - h.ddRemain / h.ddAmt;
  }
  if (a.dailyPct > 0) {
    const d = new Date(), today = ymd(d.getFullYear(), d.getMonth(), d.getDate());
    h.todayPnl = list.filter(t => t.date === today).reduce((s, t) => s + t.pnl, 0);
    h.dailyAmt = start * a.dailyPct / 100; h.dailyUsed = Math.max(0, -h.todayPnl) / h.dailyAmt;
  }
  return h;
}
const usedCls = u => u >= 1 ? 'bad' : u >= 0.8 ? 'warn' : '';
function meter(k, v, frac, cls, sub) {
  const bar = frac == null ? '' : `<div class="bar"><i class="${cls}" style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></i></div>`;
  return `<div class="meter"><div class="k">${k}</div><div class="v">${v}</div>${bar}<div class="s">${sub}</div></div>`;
}
function renderAcctPanel() {
  const el = $('#acctPanel'), vis = visibleAccts();
  if (activeAcct === 'all') {
    if (vis.length < 2) { el.innerHTML = ''; return; }
    const rows = vis.map(a => {
      const s = computeStats(trades.filter(t => acctOf(t) === a.id && t.pnl != null)), h = acctHealth(a);
      return `<tr data-id="${esc(a.id)}"><td><b>${esc(a.name)}</b><div class="muted small">${esc([a.firm, a.type].filter(Boolean).join(' · '))}</div></td><td><span class="chip ${esc(a.status)}">${esc(a.status)}</span></td><td>${s.n}</td><td>${s.n ? (s.winRate * 100).toFixed(0) + '%' : '–'}</td><td class="${sgn(s.net)}">${money(s.net)}</td><td>${h.balance != null ? money(h.balance) : '–'}</td></tr>`;
    }).join('');
    el.innerHTML = `<div class="card"><h2>Your accounts</h2><div class="tbl-wrap"><table class="acct-table"><thead><tr><th>Account</th><th>Status</th><th>Trades</th><th>Win rate</th><th>Net P&amp;L</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted small">Click an account to open it. Totals below are across all accounts.</p></div>`;
    return;
  }
  const a = acctById(activeAcct); if (!a) { el.innerHTML = ''; return; }
  const h = acctHealth(a), flags = [];
  if (h.ddRemain != null && h.ddRemain <= 0) flags.push('<span class="chip bad">Max drawdown breached</span>');
  if (h.targetProg != null && h.targetProg >= 1) flags.push('<span class="chip good">Profit target reached</span>');
  let body;
  if (h.balance == null) body = '<p class="muted small">Add a starting balance, profit target and drawdown limits (Edit) to see balance, target progress and risk meters for this account.</p>';
  else {
    const m = [meter('Balance', money(h.balance), null, '', `start ${money(h.start)} · net <span class="${sgn(h.net)}">${money(h.net)}</span>`)];
    if (h.targetAmt != null) m.push(meter('Profit target', Math.max(0, h.targetProg * 100).toFixed(0) + '%', h.targetProg, '', `${money(h.net)} of ${money(h.targetAmt)}`));
    if (h.ddAmt != null) m.push(meter('Drawdown room', money(Math.max(0, h.ddRemain)), 1 - h.ddUsed, usedCls(h.ddUsed), `limit ${money(h.ddAmt)} · floor ${money(h.floor)}${a.ddType === 'trailing' ? ' (trailing)' : ''}`));
    if (h.dailyAmt != null) m.push(meter('Today’s loss limit', money(Math.max(0, h.dailyAmt + Math.min(0, h.todayPnl))), 1 - h.dailyUsed, usedCls(h.dailyUsed), `today ${money(h.todayPnl)} · limit ${money(h.dailyAmt)}`));
    body = `<div class="meters">${m.join('')}</div>`;
  }
  el.innerHTML = `<div class="card"><div class="acct-head"><div><b>${esc(a.name)}</b> <span class="chip ${esc(a.status)}">${esc(a.status)}</span> ${flags.join(' ')}<div class="muted small">${esc([a.firm, a.type].filter(Boolean).join(' · '))}</div></div><button class="btn" id="taEditCur">Edit</button></div>${body}</div>`;
}
$('#acctPanel').addEventListener('click', e => {
  const r = e.target.closest('tr[data-id]');
  if (r) { activeAcct = r.dataset.id; lsSet('tj.activeAcct', activeAcct); renderAll(); return; }
  if (e.target.closest('#taEditCur')) { taDlg.showModal(); renderTaList(); openAcctForm(acctById(activeAcct)); }
});
function renderTaList() {
  $('#taList').innerHTML = allAccts().map(a => {
    const n = trades.filter(t => acctOf(t) === a.id).length;
    return `<div class="ta-row" data-id="${esc(a.id)}"><div><b>${esc(a.name)}</b> <span class="chip ${esc(a.status)}">${esc(a.status)}</span><div class="muted small">${esc([a.firm, a.type, a.startBalance ? money(a.startBalance) : ''].filter(Boolean).join(' · '))} · ${n} trade${n === 1 ? '' : 's'}</div></div><button type="button" class="btn" data-act="edit">Edit</button></div>`;
  }).join('');
}
function openAcctForm(a) {
  const f = taForm.elements; taForm.reset(); taForm.hidden = false;
  f.id.value = a ? a.id : '';
  for (const k of ['name', 'firm', 'type', 'status', 'startBalance', 'targetPct', 'dailyPct', 'ddPct', 'ddType']) f[k].value = a && a[k] != null ? a[k] : (k === 'status' ? 'active' : k === 'type' ? 'Evaluation' : k === 'ddType' ? 'static' : '');
  $('#taFormTitle').textContent = a ? 'Edit account' : 'New account';
  $('#taDelete').hidden = !a || !!(a && a.virtual); $('#taArchive').hidden = !a;
  $('#taArchive').textContent = a && a.status === 'archived' ? 'Unarchive' : 'Archive';
}
$('#taMgr').onclick = () => { taForm.hidden = true; renderTaList(); taDlg.showModal(); };
$('#taClose').onclick = () => taDlg.close();
taDlg.addEventListener('click', e => { if (e.target === taDlg) taDlg.close(); });
$('#taNew').onclick = () => openAcctForm(null);
$('#taCancel').onclick = () => { taForm.hidden = true; };
$('#taList').addEventListener('click', e => { const r = e.target.closest('.ta-row'); if (r && e.target.closest('[data-act=edit]')) openAcctForm(acctById(r.dataset.id)); });
taForm.elements.preset.addEventListener('change', e => {
  const P = { challenge: { targetPct: 8, dailyPct: 5, ddPct: 10, ddType: 'static' }, funded: { targetPct: '', dailyPct: 5, ddPct: 10, ddType: 'static' } }[e.target.value];
  if (P) Object.entries(P).forEach(([k, v]) => { taForm.elements[k].value = v; });
});
taForm.addEventListener('submit', e => {
  e.preventDefault();
  const f = taForm.elements, old = f.id.value ? acctById(f.id.value) : null;
  const a = cleanAcct({
    id: f.id.value || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())), name: f.name.value.trim(), firm: f.firm.value.trim(), type: f.type.value,
    status: f.status.value, startBalance: f.startBalance.value, targetPct: f.targetPct.value, dailyPct: f.dailyPct.value, ddPct: f.ddPct.value, ddType: f.ddType.value, created: old && old.created,
  });
  if (!a.name) return;
  if (!old) { if (cloudUser) pendingActive = a.id; else { activeAcct = a.id; lsSet('tj.activeAcct', a.id); } }   // set before upsert: its render must see it
  if (upsertAcct(a)) { taForm.hidden = true; toast('Account saved'); }
});
$('#taArchive').onclick = () => {
  const id = taForm.elements.id.value, a = acctById(id); if (!a) return;
  if (upsertAcct({ ...cleanAcct(a), status: a.status === 'archived' ? 'active' : 'archived' })) { taForm.hidden = true; toast(a.status === 'archived' ? 'Account restored' : 'Account archived'); }
};
$('#taDelete').onclick = () => {
  const id = taForm.elements.id.value, n = trades.filter(t => acctOf(t) === id).length;
  if (n) return toast(`This account has ${n} trade(s). Archive it, or move/delete its trades first.`);
  if (confirm('Delete this account?') && removeAcct(id)) { taForm.hidden = true; toast('Account deleted'); }
};

// ---- account / sync ----
const AUTH_ERR = {
  'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'Wrong email or password.',
  'auth/email-already-in-use': 'That email already has an account. Use Sign in.', 'auth/weak-password': 'Password needs at least 6 characters.',
  'auth/invalid-email': 'That email address looks wrong.', 'auth/network-request-failed': 'No connection. Try again when online.',
  'auth/too-many-requests': 'Too many attempts. Wait a bit and retry.', 'auth/operation-not-allowed': 'Email/password sign-in is not enabled in the Firebase console.',
  'auth/configuration-not-found': 'Authentication is not set up: Firebase console > Authentication > Get started > Email/Password > Enable.', 'auth/missing-password': 'Enter your password.', 'auth/missing-email': 'Enter your email.',
};
const authDlg = $('#authDlg'), authMsg = $('#authMsg');
function updateAcct() {
  const b = $('#acctBtn');
  if (!cloudLib) { b.hidden = true; return; }
  if (!uid) { b.textContent = 'Sign in'; b.dataset.s = ''; }
  else { const s = !navigator.onLine ? 'Offline' : syncErr ? 'Error' : syncState; b.textContent = '☁ ' + s; b.dataset.s = s; }
  $('#authOut').hidden = !!uid; $('#authIn').hidden = !uid;
  $('#authWho').textContent = cloudUser ? cloudUser.email : '';
  $('#authSync').textContent = !uid ? '' : syncErr || (!navigator.onLine ? 'Offline: changes are saved on this device and will sync when you reconnect.' : syncState === 'Synced' ? 'All changes synced.' : 'Syncing…');
}
function say(m, bad = true) { authMsg.textContent = m; authMsg.className = 'small ' + (bad ? 'neg' : 'pos'); }
async function doAuth(kind) {
  const e = $('#authEmail').value.trim(), p = $('#authPass').value;
  say('Working…', false);
  try { await cloudLib[kind](e, p); authMsg.textContent = ''; $('#authPass').value = ''; authDlg.close(); toast(kind === 'signUp' ? 'Account created' : 'Signed in'); }
  catch (err) { say(AUTH_ERR[err.code] || err.message); }
}
function onSnap(list, meta) {
  syncErr = ''; syncState = meta.pending ? 'Syncing…' : meta.fromCache && navigator.onLine ? 'Connecting…' : 'Synced';
  trades = list; save(); renderAll(); updateAcct();
}
function offerMigration(u) {
  const local = load(KEY), localA = load(ACCT_KEY), flag = 'tj.migrated.' + u.uid;
  if ((!local.length && !localA.length) || lsGet(flag)) return;
  setTimeout(() => {
    if (!confirm(`Upload the ${local.length} trade(s) and ${localA.length} trading account(s) saved on this device to ${u.email}?`)) { lsSet(flag, '1'); return; }
    cloudLib.saveMany(local).then(() => { localA.forEach(a => cloudLib.saveAccount(a).catch(syncFail)); const m = localShots(); local.forEach(t => { if (m[t.id]) cloudLib.saveShots(t.id, m[t.id]).catch(syncFail); }); lsSet(flag, '1'); toast('Uploaded to your account'); }).catch(syncFail);
  }, 700);
}
if (cloudLib) {
  $('#acctBtn').onclick = () => { say('', false); updateAcct(); authDlg.showModal(); };
  $('#authClose').onclick = () => authDlg.close();
  authDlg.addEventListener('click', e => { if (e.target === authDlg) authDlg.close(); });
  $('#authForm').addEventListener('submit', e => { e.preventDefault(); doAuth('signIn'); });
  $('#authSignUp').onclick = () => doAuth('signUp');
  $('#authReset').onclick = async () => { const e = $('#authEmail').value.trim(); if (!e) return say('Enter your email first.'); try { await cloudLib.reset(e); say('Password reset email sent.', false); } catch (err) { say(AUTH_ERR[err.code] || err.message); } };
  $('#authSignOut').onclick = async () => { await cloudLib.signOut(); authDlg.close(); toast('Signed out'); };
  window.addEventListener('online', updateAcct); window.addEventListener('offline', updateAcct);
  cloudLib.onAuth(u => {
    if (unsub) { unsub(); unsub = null; }
    if (unsubA) { unsubA(); unsubA = null; }
    cloudUser = u; syncErr = ''; syncState = 'Connecting…'; shotCache.clear();
    if (u) { uid = u.uid; lsSet('tj.lastUid', uid); trades = load(storeKey()); tAccts = load(acctStoreKey()); renderAll(); unsub = cloudLib.subscribe(onSnap, syncFail); unsubA = cloudLib.subscribeAccounts(l => { tAccts = l; saveAccts(); if (pendingActive && l.some(x => x.id === pendingActive)) { activeAcct = pendingActive; lsSet('tj.activeAcct', activeAcct); pendingActive = null; } renderAll(); }, syncFail); offerMigration(u); }
    else { uid = null; lsSet('tj.lastUid', null); trades = load(KEY); tAccts = load(ACCT_KEY); renderAll(); }
    updateAcct();
  });
}
updateAcct();
renderAll();

// ---- APK update check ----
// The installed APK knows its CI build number (version.js). GitHub's "latest" release is titled "... (build N)";
// a bigger N means a newer APK, so offer to download it. Web visitors already get updates on deploy, so this only runs in the app.
const REL_API = 'https://api.github.com/repos/Anish-prokey/DeathNote/releases/tags/latest';
const APK_URL = 'https://github.com/Anish-prokey/DeathNote/releases/download/latest/TradingJournal.apk';
let updDismissed = false, updLastCheck = 0;
async function checkForUpdate() {
  const mine = window.TJ_BUILD, native = window.Capacitor?.isNativePlatform?.();
  if (!mine || !native || updDismissed || !navigator.onLine || Date.now() - updLastCheck < 30 * 60e3) return;
  updLastCheck = Date.now();
  try {
    const r = await fetch(REL_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) return;                                   // offline, rate-limited (60/h per IP) or no release: try again later
    const rel = await r.json(), latest = Number(/build (\d+)/.exec(rel.name || '')?.[1]);
    if (!(latest > mine)) return;
    $('#updVer').textContent = `build ${mine} → ${latest}`;
    $('#updNotes').textContent = (rel.body || '').split('\n').find(l => l.startsWith('What’s new:'))?.slice(11).trim() || '';
    $('#updBar').hidden = false;
  } catch { /* network error: try again on next resume */ }
}
$('#updLater').onclick = () => { updDismissed = true; $('#updBar').hidden = true; };   // ask again next app launch
// Leaving the app's own origin hands the URL to Android, which opens it in the browser and downloads the APK.
$('#updGo').onclick = () => { $('#updBar').hidden = true; toast('Downloading… open the file when it finishes to install'); location.href = APK_URL; };
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
setTimeout(checkForUpdate, 1500);
})();
