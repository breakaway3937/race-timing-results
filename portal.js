/* Runner results portal — a static single-page app.
 * Reads data/races.json and data/race-<id>.json (published to GitHub Pages, or served at /r/ by Race Timer).
 * Routes: #/  ·  #/race/<id>  ·  #/race/<id>/<bib>  ·  #/cert/<id>/<bib>
 */
(() => {
  const app = document.getElementById('app');
  const cache = {};
  let index = null, refreshTimer = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const niceDate = d => /^\d{4}-\d\d-\d\d$/.test(d || '') ? `${LONG[+d.slice(5, 7) - 1]} ${+d.slice(8)}, ${d.slice(0, 4)}` : (d || '');
  let XCMODE = false;
  const gName = g => (XCMODE ? { F: 'Girls', M: 'Boys' } : { F: 'Women', M: 'Men', X: 'Non-binary' })[g] || '';
  const gOne = g => ({ F: 'Female', M: 'Male', X: 'Non-binary' }[g] || '');
  const SEARCH_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

  async function getJSON(path, fresh) {
    if (!fresh && cache[path]) return cache[path];
    const r = await fetch(`data/${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return (cache[path] = await r.json());
  }
  const loadIndex = async fresh => (index = await getJSON('races.json', fresh));
  const loadRace = (id, fresh) => getJSON(`race-${id}.json`, fresh).then(r => { XCMODE = !!r.xc; return r; });

  function top(title, sub, back) {
    return `<header class="top"><div class="wrap" style="padding-bottom:${back === null ? 22 : 36}px">
      ${back ? `<a class="back" href="${back.href}">‹ ${esc(back.label)}</a>` : `<div class="brand"><span class="dot"></span>RACE RESULTS</div>`}
      <h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div></header>`;
  }
  const updated = ts => ts ? `Updated ${new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';

  // ---------- home ----------
  async function home() {
    await loadIndex(true);
    app.innerHTML = top('Find your result', 'Search any race by your name or bib number.', null) + `
      <main><div class="search">${SEARCH_ICON}<input id="q" type="search" placeholder="Your name or bib #" autocomplete="off" enterkeyhint="search"></div>
      <div id="found"></div><h2>Races</h2><div class="list">${index.races.map(r => {
        const d = r.date || '';
        return `<a class="race" href="#/race/${r.id}"><div class="cal">${d.length === 10 ? `<span>${MONTHS[+d.slice(5, 7) - 1]}</span><b>${+d.slice(8)}</b>` : '<b>·</b>'}</div>
          <div style="flex:1;min-width:0"><div class="nm">${esc(r.name)}</div><div class="sub">${d.slice(0, 4)}${d ? ' · ' : ''}${r.distance ? esc(r.distance) + ' · ' : ''}${r.finishers} finishers</div></div>
          <span style="color:var(--ink-3);font-size:22px">›</span></a>`;
      }).join('') || '<div class="empty">No results have been posted yet. Check back after the race!</div>'}</div>
      <div class="foot">${updated(index.updated)}</div></main>`;
    let t;
    document.getElementById('q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => searchAll(e.target.value), 250); });
  }

  async function searchAll(v) {
    const box = document.getElementById('found');
    v = v.trim().toLowerCase();
    if (v.length < 2) { box.innerHTML = ''; return; }
    const races = await Promise.all(index.races.map(r => loadRace(r.id).catch(() => null)));
    const rows = [];
    races.forEach(race => race && race.events.forEach(ev => [...ev.results, ...ev.others].forEach(p => {
      if (`${p.name} ${p.bib}`.toLowerCase().includes(v)) rows.push({ race, ev, p });
    })));
    box.innerHTML = `<h2>${rows.length ? 'Matches' : 'No matches'}</h2>` + (rows.length ? `<div class="list">${rows.slice(0, 60).map(({ race, ev, p }) => `
      <a class="item" href="#/race/${race.id}/${encodeURIComponent(p.bib)}"><div class="pl">${p.place ?? '–'}</div>
        <div><div class="nm">${esc(p.name)}</div><div class="sub">${esc(race.name)}${race.multi_event ? ' · ' + esc(ev.label) : ''} · bib ${esc(p.bib)}</div></div>
        <div class="tm">${esc(p.time || p.status || '')}</div></a>`).join('')}</div>` : '<div class="empty">Try your last name, or your bib number.</div>');
  }

  // ---------- race ----------
  const state = { g: '', ag: '', ev: 0, tab: 'results', q: '' };
  async function racePage(id, fresh) {
    clearInterval(refreshTimer);
    let race;
    try { race = await loadRace(id, fresh); } catch (e) { return notFound('That race isn’t posted yet.'); }
    const multi = race.events.length > 1;
    if (state.raceId !== id) Object.assign(state, { raceId: id, g: '', ag: '', ev: 0, tab: 'results', q: '' });
    const ev = race.events[state.ev] || race.events[0];
    const groups = [...new Set(ev.results.map(r => r.age_group).filter(Boolean))].sort();
    const sub = [niceDate(race.date), race.distance, `${ev.results.length} finishers`].filter(Boolean).map(esc).join(' · ');
    app.innerHTML = top(race.name, sub, { href: '#/', label: 'All races' }) + `<main>
      <div class="search">${SEARCH_ICON}<input id="q" type="search" placeholder="Search name or bib #" value="${esc(state.q)}" autocomplete="off" enterkeyhint="search"></div>
      ${multi ? `<div class="chips">${race.events.map((e, i) => `<button class="chip ${i === state.ev ? 'on' : ''}" data-ev="${i}">${esc(e.label)}</button>`).join('')}</div>` : ''}
      <div class="tabs">${['results', 'awards', ...(ev.teams.length ? ['teams'] : [])].map(t => `<button data-tab="${t}" class="${state.tab === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      ${state.tab === 'results' ? `<div class="chips">
          ${['', 'F', 'M'].map(g => `<button class="chip ${state.g === g ? 'on' : ''}" data-g="${g}">${g ? gName(g) : 'Everyone'}</button>`).join('')}
          <select class="chip" id="ag"><option value="">All age groups</option>${groups.map(a => `<option ${a === state.ag ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>` : ''}
      <div id="body"></div><div class="foot">${updated(race.updated)} · <a href="#/race/${id}" id="reload">refresh</a></div></main>`;
    const body = document.getElementById('body');
    const link = p => `#/race/${id}/${encodeURIComponent(p.bib)}`;
    const draw = () => {
      if (state.tab === 'results') {
        const q = state.q.trim().toLowerCase();
        const match = p => (!state.g || p.gender === state.g) && (!state.ag || p.age_group === state.ag) && (!q || `${p.name} ${p.bib} ${p.location || ''} ${p.team || ''}`.toLowerCase().includes(q));
        const list = ev.results.filter(match), others = ev.others.filter(match);
        body.innerHTML = (list.length || others.length) ? `<div class="list" style="margin-top:10px">${list.map(p => `
          <a class="item" href="${link(p)}"><div class="pl">${p.place}</div>
            <div><div class="nm">${esc(p.name)}</div><div class="sub">${(race.xc ? [p.team, p.grade ? 'Gr ' + p.grade : ''] : [p.age_group, p.location]).filter(Boolean).map(esc).join(' · ')}</div></div>
            <div class="tm">${esc(p.time)}${p.pace ? `<small>${esc(p.pace)}</small>` : ''}</div></a>`).join('')}
          ${others.map(p => `<a class="item" href="${link(p)}"><div class="pl"><span class="badge bad">${esc(p.status)}</span></div>
            <div><div class="nm" style="color:var(--ink-3)">${esc(p.name)}</div><div class="sub">${esc(p.location || '')}</div></div><div class="tm">${esc(p.status)}</div></a>`).join('')}</div>`
          : `<div class="empty">${ev.results.length ? 'No one matches that search.' : 'No finishers yet.'}</div>`;
      } else if (state.tab === 'awards') {
        const by = Object.fromEntries(ev.results.map(p => [p.bib, p]));
        const rec = ev.records.filter(r => r.broken).map(r => `<div class="list" style="margin-top:10px;padding:12px 14px;border-color:var(--gold)">★ <b>New course record</b> · ${esc(r.label || '')}: ${esc((by[r.by] || {}).name || '')} ${esc((by[r.by] || {}).time || '')} <span style="color:var(--ink-3)">(old ${esc(r.time)})</span></div>`).join('');
        body.innerHTML = rec + (ev.awards.map(a => `<h2>${esc(a.title)}</h2><div class="list">${a.bibs.map((b, i) => by[b]).filter(Boolean).map((p, i) => `
          <a class="item" href="${link(p)}"><div class="pl"><span class="medal ${i < 3 ? 'm' + (i + 1) : ''}">${i + 1}</span></div>
          <div><div class="nm">${esc(p.name)}</div><div class="sub">${[race.xc ? p.team : p.location, race.xc ? (p.grade ? `Grade ${p.grade}` : '') : (p.age != null ? `Age ${p.age}` : '')].filter(Boolean).map(esc).join(' · ')}</div></div><div class="tm">${esc(p.time)}</div></a>`).join('')}</div>`).join('')
          || '<div class="empty">Awards appear once runners finish.</div>');
      } else {
        const by = Object.fromEntries(ev.results.map(p => [p.bib, p]));
        const gn = { F: race.xc ? 'Girls' : 'Women', M: race.xc ? 'Boys' : 'Men' };
        body.innerHTML = ev.teams.filter(t => t.complete || !race.xc).map(t => `<h2>${t.rank ? ord(t.rank) + ' · ' : ''}${esc(t.team)}${t.gender ? ' · ' + (gn[t.gender] || '') : ''} <span style="float:right">${t.complete ? esc(t.score) + (race.xc ? ' pts' : '') : 'incomplete'}</span></h2>
          ${race.xc && t.summary ? `<div class="sub" style="margin:-4px 0 6px;color:var(--ink-3)">Team places ${esc(t.summary)}</div>` : ''}
          <div class="list">${[...t.scorers, ...(t.displacers || [])].map(b => by[b]).filter(Boolean).map(p => `<a class="item" href="${link(p)}"><div class="pl">${race.xc ? p.team_place : p.place}</div><div><div class="nm">${esc(p.name)}${(t.displacers || []).includes(p.bib) ? ' <span class="badge">displacer</span>' : ''}</div><div class="sub">${race.xc ? ord(p.place) + ' overall' : ''}</div></div><div class="tm">${esc(p.time)}</div></a>`).join('')}</div>`).join('')
          + (race.xc && ev.teams.some(t => !t.complete) ? `<div class="foot" style="text-align:left">Incomplete teams (not scored): ${ev.teams.filter(t => !t.complete).map(t => esc(t.team)).join(', ')}</div>` : '');
      }
    };
    draw();
    const q = document.getElementById('q');
    q.addEventListener('input', () => { state.q = q.value; if (state.tab !== 'results') { state.tab = 'results'; racePage(id); setTimeout(() => { const n = document.getElementById('q'); n.focus(); n.setSelectionRange(99, 99); }); } else draw(); });
    app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { state.g = b.dataset.g; racePage(id); });
    app.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => { state.ev = +b.dataset.ev; state.ag = ''; racePage(id); });
    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; racePage(id); });
    const ag = document.getElementById('ag'); if (ag) ag.onchange = () => { state.ag = ag.value; racePage(id); };
    document.getElementById('reload').onclick = e => { e.preventDefault(); racePage(id, true); };
    refreshTimer = setInterval(() => { if (!document.hidden && document.activeElement?.id !== 'q') racePage(id, true); }, 30000);
  }

  // ---------- runner ----------
  function findRunner(race, bib) {
    for (const ev of race.events) {
      const p = [...ev.results, ...ev.others].find(x => String(x.bib) === String(bib));
      if (p) return { ev, p };
    }
    return {};
  }

  async function runnerPage(id, bib) {
    let race;
    try { race = await loadRace(id, true); } catch (e) { return notFound('That race isn’t posted yet.'); }
    const { ev, p } = findRunner(race, bib);
    if (!p) return notFound(`Bib ${bib} isn’t in these results.`, `#/race/${id}`);
    const n = ev.results.length;
    const gN = ev.results.filter(x => x.gender === p.gender).length;
    const agN = ev.results.filter(x => x.age_group === p.age_group).length;
    const awards = ev.awards.flatMap(a => a.bibs.map((b, i) => b === p.bib ? `${ord(i + 1)} ${a.title}` : null)).filter(Boolean);
    const rec = ev.records.find(r => r.broken && r.by === p.bib);
    const team = ev.teams.find(t => p.team && t.team === p.team && (!t.gender || t.gender === p.gender));
    const share = location.href;
    const tile = (big, small) => `<div class="tile"><b>${big}</b><span>${small}</span></div>`;
    app.innerHTML = top(p.name, [`Bib ${esc(p.bib)}`, esc(race.name)].join(' · '), { href: `#/race/${id}`, label: race.multi_event ? `${race.name} · ${ev.label}` : race.name }) + `
      <main><div class="card" style="margin-top:-28px">
        <div class="who">${(race.xc ? [p.team, p.grade ? `Grade ${p.grade}` : ''] : [p.location, p.age != null ? `Age ${p.age}` : '', p.age_group, p.team]).filter(Boolean).map(esc).join(' · ')}</div>
        ${p.status ? `<div class="bigtime" style="color:var(--bad)">${esc(p.status)}</div><div class="who">${{ DNF: 'Did not finish', DQ: 'Disqualified', DNS: 'Did not start' }[p.status] || ''}</div>` : `
        <div class="bigtime">${esc(p.time)}</div>
        ${awards.map(a => `<div class="award">🏅 ${esc(a)}</div>`).join('')}
        ${rec ? `<div class="award gold">★ New course record!</div>` : ''}
        <div class="tiles">${tile(`${p.place}<small>/${n}</small>`, 'Overall')}
          ${p.gender_place ? tile(`${p.gender_place}<small>/${gN}</small>`, gName(p.gender) || 'Gender') : ''}
          ${!race.xc && p.ag_place ? tile(`${p.ag_place}<small>/${agN}</small>`, esc(p.age_group)) : ''}
          ${race.xc && p.team_place ? tile(String(p.team_place), 'Team place') : ''}
          ${p.pace ? tile(esc(p.pace.split('/')[0]), 'Pace per ' + (p.pace.endsWith('km') ? 'km' : 'mile')) : ''}
          ${p.age_grade ? tile(p.age_grade.toFixed(1) + '%', 'Age grade') : ''}
          ${team ? tile(team.rank ? ord(team.rank) : '–', esc(team.team) + (race.xc && team.complete ? ` · ${esc(team.score)} pts` : '')) : ''}</div>`}
        <div class="actions">
          <button class="btn primary" id="share">Share my result</button>
          ${p.place ? `<a class="btn" href="#/cert/${id}/${encodeURIComponent(p.bib)}">Certificate</a>` : ''}
        </div></div>
        <div id="hist"></div>
        <div class="foot"><a href="#/race/${id}">See all results</a> · <a href="#/">All races</a></div></main>`;
    document.getElementById('share').onclick = async () => {
      const text = p.status ? `${p.name} · ${race.name}` : `${p.name} finished ${race.name} in ${p.time} (${ord(p.place)} overall)!`;
      try { if (navigator.share) return await navigator.share({ title: race.name, text, url: share }); } catch (e) { return; }
      try { await navigator.clipboard.writeText(`${text} ${share}`); toast('Link copied'); } catch (e) { linkSheet(share); }
    };
    // other races by the same name
    if (index || await loadIndex().catch(() => null)) {
      const others = await Promise.all(index.races.filter(r => r.id !== +id).map(r => loadRace(r.id).catch(() => null)));
      const hits = [];
      others.forEach(r => r && r.events.forEach(e => [...e.results, ...e.others].forEach(x => {
        if (x.name.toLowerCase() === p.name.toLowerCase()) hits.push({ r, x });
      })));
      if (hits.length) document.getElementById('hist').innerHTML = `<h2>Your other races</h2><div class="list">${hits.map(({ r, x }) => `
        <a class="item" href="#/race/${r.id}/${encodeURIComponent(x.bib)}"><div class="pl">${x.place ?? '–'}</div>
        <div><div class="nm">${esc(r.name)}</div><div class="sub">${esc(niceDate(r.date))}</div></div><div class="tm">${esc(x.time || x.status || '')}</div></a>`).join('')}</div>`;
    }
  }

  // ---------- certificate (print / save as PDF) ----------
  async function certPage(id, bib) {
    let race;
    try { race = await loadRace(id); } catch (e) { return notFound('That race isn’t posted yet.'); }
    const { ev, p } = findRunner(race, bib);
    if (!p || !p.place) return notFound('No certificate for this bib.', `#/race/${id}`);
    const awards = ev.awards.flatMap(a => a.bibs.map((b, i) => b === p.bib ? `${ord(i + 1)} Place · ${a.title}` : null)).filter(Boolean);
    const line = awards[0] || `Finisher · ${ord(p.place)} overall`;
    app.innerHTML = `<div class="noprint certbar"><a href="#/race/${id}/${encodeURIComponent(p.bib)}">‹ Back</a>
        <button class="btn primary" onclick="print()">Print or save as PDF</button></div>
      <div class="cert"><div class="inner">
        <div class="cr">${esc(race.name)}</div><div class="cd">${esc(niceDate(race.date))}</div>
        <div class="ca">CERTIFICATE OF ACHIEVEMENT</div><div class="cp">presented to</div>
        <div class="cn">${esc(p.name)}</div><div class="cl">${esc(line)}</div>
        <div class="ct">Time ${esc(p.time)}${p.pace ? ' · Pace ' + esc(p.pace) : ''}${p.location ? ' · ' + esc(p.location) : ''}</div>
      </div></div>`;
  }

  function notFound(msg, back) {
    app.innerHTML = top('Not found', '', { href: back || '#/', label: back ? 'Back to results' : 'All races' }) + `<main><div class="empty" style="margin-top:20px">${esc(msg)}</div></main>`;
  }
  function linkSheet(url) {
    // themed pop-up with the link selected, for browsers that can't copy automatically
    const d = document.createElement('dialog'); d.className = 'sheet';
    d.innerHTML = `<div class="bar"></div><h3>Copy your result link</h3><p>Press and hold the link to copy it.</p>
      <input readonly value="${esc(url)}"><button class="btn primary">Done</button>`;
    d.querySelector('button').onclick = () => { d.close(); d.remove(); };
    d.addEventListener('cancel', () => d.remove());
    document.body.appendChild(d); d.showModal(); d.querySelector('input').select();
  }
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  async function route() {
    clearInterval(refreshTimer);
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    window.scrollTo(0, 0);
    try {
      if (parts[0] === 'race' && parts[2]) await runnerPage(parts[1], parts[2]);
      else if (parts[0] === 'race' && parts[1]) await racePage(parts[1]);
      else if (parts[0] === 'cert') await certPage(parts[1], parts[2]);
      else await home();
    } catch (e) {
      app.innerHTML = top('Results', '', null) + `<main><div class="empty" style="margin-top:20px">Results couldn’t be loaded. Check your connection and try again.</div></main>`;
    }
  }
  window.addEventListener('hashchange', route);
  route();
})();
