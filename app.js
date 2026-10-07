(() => {
'use strict';
const KEY = 'tj.trades.v1';
const EMOTIONS = ['', 'Calm', 'Confident', 'Disciplined', 'Patient', 'Excited', 'Anxious', 'Fearful', 'Greedy', 'FOMO', 'Frustrated', 'Revenge', 'Hesitant', 'Bored', 'Relieved'];
const RATING_HINT = ['', 'Ignored the plan', 'Mostly off-plan', 'Half and half', 'Mostly on-plan', 'Followed it perfectly'];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
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
  if (cloudUser) cloudLib.removeMany(ids).catch(syncFail);
  else { trades = trades.filter(t => !ids.includes(t.id)); save(); renderAll(); }
  return true;
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }

// ---- derived values ----
function autoPnl(t) {
  if (t.entry == null || t.exit == null) return null;
  const d = t.direction === 'short' ? -1 : 1;
  return (t.exit - t.entry) * d * (t.size ?? 1);
}
function rMultiple(t) {
  if (t.entry == null || t.exit == null || t.stop == null) return null;
  const risk = Math.abs(t.entry - t.stop);
  if (!risk) return null;
  const d = t.direction === 'short' ? -1 : 1;
  return (t.exit - t.entry) * d / risk;
}
const result = t => t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : 'be';
const closed = () => trades.filter(t => t.pnl != null);

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
  const s = computeStats(closed());
  const wl = s.avgLoss ? Math.abs(s.avgWin / s.avgLoss) : null;
  const card = (k, v, sub = '', cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${sub}</div></div>`;
  $('#stats').innerHTML = [
    card('Net P&L', money(s.net), `${s.n} closed trades`, sgn(s.net)),
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
  const L = trades.filter(t => t.learned).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('#lessons').innerHTML = L.length ? L.map(t => `<p><b>${esc(t.date)} · ${esc(t.instrument)}</b><br>${esc(t.learned)}</p>`).join('') : '<div class="empty">Lessons you write will show up here.</div>';
}

// ---- journal list ----
function renderList() {
  const q = $('#search').value.toLowerCase(), fr = $('#fResult').value, fd = $('#fDir').value;
  const list = trades.slice().sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created).filter(t =>
    (!fr || result(t) === fr) && (!fd || t.direction === fd) &&
    (!q || [t.date, t.instrument, t.signal, t.emoNotes, t.better, t.learned, t.trail].join(' ').toLowerCase().includes(q)));
  if (!list.length) { $('#list').innerHTML = `<div class="empty">${trades.length ? 'No trades match your filters.' : 'No trades yet. Click “+ New trade” to log your first one, or load demo data in the Data tab.'}</div>`; return; }
  $('#list').innerHTML = list.map(t => {
    const r = rMultiple(t), pnl = t.pnl;
    const f = (k, v) => v ? `<div class="txt"><b>${k}:</b> ${esc(v)}</div>` : '';
    const lv = [['Entry', t.entry], ['Stop', t.stop], ['Target', t.target], ['Exit', t.exit]].filter(x => x[1] != null).map(x => `${x[0]} ${x[1]}`).join(' · ');
    const emo = [['entry', t.emoEntry], ['losers', t.emoLoser], ['winners', t.emoWinner], ['exit', t.emoExit]].filter(x => x[1]).map(x => `${x[1]} (${x[0]})`).join(', ');
    return `<article class="trade ${result(t)}" data-id="${t.id}" tabindex="0">
      <div class="h"><span class="sym">${esc(t.instrument)}</span><span class="tag ${t.direction}">${t.direction}</span><span class="muted small">${esc(t.date)}</span>${t.plan ? `<span class="tag">plan ${t.plan}/5</span>` : ''}${r != null ? `<span class="tag">${r.toFixed(2)}R</span>` : ''}<span class="pl ${sgn(pnl)}">${pnl == null ? 'open' : money(pnl)}</span></div>
      <div class="meta">${esc(lv)}${t.trail ? ' · trail: ' + esc(t.trail) : ''}</div>
      ${f('Signal', t.signal)}${emo ? `<div class="txt"><b>Emotions:</b> ${esc(emo)}${t.emoNotes ? ' — ' + esc(t.emoNotes) : ''}</div>` : ''}${f('Do better', t.better)}${f('Learned', t.learned)}</article>`;
  }).join('');
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

function renderAll() { renderCalendar(); renderStats(); renderEquity(); renderAdherence(); renderEmotionBars('#emoEntry', 'emoEntry'); renderEmotionBars('#emoExit', 'emoExit'); renderLessons(); renderList(); }

// ---- form ----
const dlg = $('#dlg'), form = $('#form');
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
  f.date.value = t?.date || date || ymd(now0.getFullYear(), now0.getMonth(), now0.getDate());
  if (t) for (const k of ['instrument', 'direction', 'size', 'entry', 'exit', 'stop', 'target', 'trail', 'pnl', 'signal', 'emoEntry', 'emoLoser', 'emoWinner', 'emoExit', 'emoNotes', 'better', 'learned']) f[k].value = t[k] ?? '';
  setRating(t?.plan || 0);
  $('#dlgTitle').textContent = t ? 'Edit trade' : 'New trade';
  $('#delBtn').hidden = !t;
  dlg.showModal();
}
form.addEventListener('submit', e => {
  e.preventDefault();
  const f = form.elements, id = f.id.value;
  const t = {
    id: id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    created: id ? (trades.find(x => x.id === id)?.created ?? Date.now()) : Date.now(),
    date: f.date.value, instrument: f.instrument.value.trim().toUpperCase(), direction: f.direction.value,
    size: num(f.size.value), entry: num(f.entry.value), exit: num(f.exit.value), stop: num(f.stop.value), target: num(f.target.value),
    trail: f.trail.value.trim(), pnl: num(f.pnl.value), signal: f.signal.value.trim(),
    emoEntry: f.emoEntry.value, emoLoser: f.emoLoser.value, emoWinner: f.emoWinner.value, emoExit: f.emoExit.value,
    emoNotes: f.emoNotes.value.trim(), plan: rating || null, better: f.better.value.trim(), learned: f.learned.value.trim(),
  };
  // P&L follows the prices unless you typed your own number (pnlManual). Editing prices on an auto trade recomputes it.
  const prev = trades.find(x => x.id === t.id), auto = autoPnl(t), typed = num(f.pnl.value);
  if (auto != null && (typed == null || (prev && !prev.pnlManual && typed === prev.pnl))) { t.pnl = +auto.toFixed(2); t.pnlManual = false; }
  else { t.pnl = typed; t.pnlManual = typed != null; }
  if (upsertTrades([t])) { dlg.close(); toast('Trade saved'); }
});
form.addEventListener('input', () => {
  const f = form.elements, p = autoPnl({ entry: num(f.entry.value), exit: num(f.exit.value), size: num(f.size.value), direction: f.direction.value });
  f.pnl.placeholder = p == null ? 'auto from entry & exit' : 'auto: ' + +p.toFixed(2);
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
$('#exportJson').onclick = () => download('trading-journal.json', JSON.stringify(trades, null, 2), 'application/json');
$('#exportCsv').onclick = () => {
  const cols = ['date', 'instrument', 'direction', 'size', 'entry', 'exit', 'stop', 'target', 'trail', 'pnl', 'signal', 'emoEntry', 'emoLoser', 'emoWinner', 'emoExit', 'emoNotes', 'plan', 'better', 'learned'];
  const cell = v => { v = v ?? ''; v = String(v); if (/^[=+\-@]/.test(v) && isNaN(+v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  download('trading-journal.csv', [cols.join(','), ...trades.map(t => cols.map(c => cell(t[c])).join(','))].join('\n'), 'text/csv');
};
$('#importFile').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw 0;
    const have = new Set(trades.map(t => t.id));
    const fresh = data.filter(t => t && t.id && t.date && t.instrument && !have.has(t.id));
    if (upsertTrades(fresh)) toast(`Imported ${fresh.length} trades`);
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
      id: 'demo' + i + today, created: today + i, date: new Date(today - (24 - i) * 86400000 * 1.5).toISOString().slice(0, 10),
      instrument: syms[i % 4], direction: dir, size: 1, entry, stop: entry - d * risk, target: entry + d * risk * 2, exit: +(entry + d * risk * r).toFixed(2), trail: i % 3 ? '' : 'Trail 1R under swing',
      pnl: +(r * 100).toFixed(2), signal: win ? 'H1 EMA bounce with LTF break of structure' : 'Early entry before confirmation',
      emoEntry: plan > 3 ? 'Calm' : 'FOMO', emoLoser: win ? '' : 'Anxious', emoWinner: win ? 'Greedy' : '', emoExit: win ? 'Relieved' : 'Frustrated', emoNotes: '',
      plan, better: plan < 4 ? 'Wait for confirmation candle' : '', learned: plan < 3 ? 'Off-plan trades cost me. Skip when unsure.' : '',
    });
  }
  if (upsertTrades(demo)) toast('Demo data loaded');
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
  const local = load(KEY), flag = 'tj.migrated.' + u.uid;
  if (!local.length || lsGet(flag)) return;
  setTimeout(() => {
    if (!confirm(`Upload the ${local.length} trade(s) saved on this device to ${u.email}?`)) { lsSet(flag, '1'); return; }
    cloudLib.saveMany(local).then(() => { lsSet(flag, '1'); toast('Uploaded to your account'); }).catch(syncFail);
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
    cloudUser = u; syncErr = ''; syncState = 'Connecting…';
    if (u) { uid = u.uid; lsSet('tj.lastUid', uid); trades = load(storeKey()); renderAll(); unsub = cloudLib.subscribe(onSnap, syncFail); offerMigration(u); }
    else { uid = null; lsSet('tj.lastUid', null); trades = load(KEY); renderAll(); }
    updateAcct();
  });
}
updateAcct();
renderAll();
})();
