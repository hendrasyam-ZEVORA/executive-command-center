/* Football Hub (panel kanan Beranda) — pengganti panel berita umum.
   Data: ESPN public API (gratis, tanpa key, CORS terbuka) untuk hasil, statistik, klasemen & jadwal;
         berita klub dari ESPN + RSS Antara Sepakbola (via rss2json).
   Fokus klub: FC Barcelona & AS Roma. Liga: LaLiga, Premier League, Serie A, Bundesliga.
   Cache ringkas di localStorage → tetap tampil saat offline. */
(function () {
  const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
  const STAND = 'https://site.api.espn.com/apis/v2/sports/soccer/';
  const LEAGUES = [
    { id: 'esp.1', label: 'LaLiga', flag: '🇪🇸' },
    { id: 'eng.1', label: 'Premier League', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
    { id: 'ita.1', label: 'Serie A', flag: '🇮🇹' },
    { id: 'ger.1', label: 'Bundesliga', flag: '🇩🇪' },
  ];
  const CUPS = { 'uefa.champions': 'Liga Champions', 'uefa.europa': 'Liga Europa', 'uefa.europa.conf': 'Conference League', 'esp.copa_del_rey': 'Copa del Rey', 'ita.coppa_italia': 'Coppa Italia' };
  const LABEL = Object.assign(Object.fromEntries(LEAGUES.map((l) => [l.id, l.label])), CUPS);
  const CLUBS = [
    { id: '83', name: 'FC Barcelona', short: 'Barcelona', league: 'esp.1', cups: ['uefa.champions', 'esp.copa_del_rey'], color: '#a50044' },
    { id: '104', name: 'AS Roma', short: 'Roma', league: 'ita.1', cups: ['uefa.europa', 'uefa.champions', 'uefa.europa.conf', 'ita.coppa_italia'], color: '#8e1f2f' },
  ];
  const NEWS_FEEDS = [
    { club: '', name: 'Antara Sepakbola', url: 'https://www.antaranews.com/rss/sepakbola.xml' },
  ];
  const STAT_ROWS = [
    ['possessionPct', 'Penguasaan bola', (v) => v + '%'], ['totalShots', 'Tembakan'], ['shotsOnTarget', 'Tepat sasaran'],
    ['wonCorners', 'Tendangan sudut'], ['passPct', 'Akurasi umpan', (v) => Math.round(v * 100) + '%'], ['totalPasses', 'Total umpan'],
    ['foulsCommitted', 'Pelanggaran'], ['offsides', 'Offside'], ['yellowCards', 'Kartu kuning'], ['redCards', 'Kartu merah'], ['saves', 'Penyelamatan'],
  ];

  /* ---------- fetch + cache ---------- */
  const mem = {};
  async function get(url, ttlMin, transform, { persist = true } = {}) {
    const key = 'edcc-fb:' + url;
    let cached = mem[key];
    if (!cached && persist) { try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch { cached = null; } }
    if (cached && Date.now() - cached.at < ttlMin * 60e3) return cached.data;
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000);
      const r = await fetch(url, { signal: ctl.signal }); clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = transform(await r.json());
      mem[key] = { at: Date.now(), data };
      if (persist) { try { localStorage.setItem(key, JSON.stringify(mem[key])); } catch { /* penuh: abaikan */ } }
      return data;
    } catch (e) {
      if (cached) { cached.stale = true; return cached.data; }
      throw e;
    }
  }
  const score = (s) => (s == null ? '' : typeof s === 'object' ? (s.displayValue ?? s.value ?? '') : String(s));
  const logo = (t) => (t && ((t.logos && t.logos[0] && t.logos[0].href) || t.logo)) || '';
  function mapEvent(e, league) {
    const c = e.competitions && e.competitions[0]; if (!c) return null;
    const side = (h) => { const x = c.competitors.find((k) => k.homeAway === h) || {}; const t = x.team || {}; return { id: String(t.id || ''), name: t.displayName || '', short: t.shortDisplayName || t.abbreviation || t.displayName || '', logo: logo(t), score: score(x.score), winner: !!x.winner }; };
    const st = (c.status || e.status || {}).type || {};
    return { id: String(e.id), league, date: e.date, state: st.state || 'pre', done: !!st.completed, detail: st.shortDetail || st.detail || '', clock: (c.status || {}).displayClock || '', home: side('home'), away: side('away') };
  }
  const mapEvents = (league) => (j) => (j.events || []).map((e) => mapEvent(e, league)).filter(Boolean);

  const Football = {
    tab: 'focus', league: 'esp.1', root: null, timer: null,
    data: { clubs: {}, results: {}, table: {}, news: null },
    status: {},

    mount(root) {
      this.root = root;
      try { const s = JSON.parse(localStorage.getItem('edcc-fb-ui') || '{}'); if (s.tab) this.tab = s.tab; if (s.league) this.league = s.league; } catch {}
      root.innerHTML = `
        <div class="card-h"><div class="card-t">${icon('football', 16)}Football Hub</div>
          <button class="icon-btn sm" data-fbr title="Muat ulang data">${icon('refresh', 14)}</button></div>
        <div class="news-tabs"><div class="chips" data-fbtabs></div><div class="chips" data-fbleagues style="margin-top:6px"></div></div>
        <div class="news-list" data-fblist></div>
        <div class="news-foot" data-fbfoot></div>`;
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-fbtab]'); if (t) { this.tab = t.dataset.fbtab; this.saveUi(); this.load(); U.$('[data-fblist]', root).scrollTop = 0; return; }
        const l = e.target.closest('[data-fbleague]'); if (l) { this.league = l.dataset.fbleague; this.saveUi(); this.load(); return; }
        if (e.target.closest('[data-fbr]')) { Object.keys(mem).forEach((k) => (mem[k].at = 0)); Object.keys(localStorage).filter((k) => k.startsWith('edcc-fb:')).forEach((k) => { try { const v = JSON.parse(localStorage.getItem(k)); v.at = 0; localStorage.setItem(k, JSON.stringify(v)); } catch {} }); this.load(true); return; }
        const m = e.target.closest('[data-match]'); if (m && !e.target.closest('a')) this.openMatch(m.dataset.match, m.dataset.league);
      });
      window.addEventListener('online', () => this.load(true));
      this.load();
      this.loop();
    },
    saveUi() { localStorage.setItem('edcc-fb-ui', JSON.stringify({ tab: this.tab, league: this.league })); },
    loop() {
      clearTimeout(this.timer);
      const live = Object.values(this.data.clubs).some((c) => c && c.events && c.events.some((e) => e.state === 'in')) || (this.data.results[this.league] || []).some((e) => e.state === 'in');
      this.timer = setTimeout(() => { if (document.visibilityState === 'visible') this.load(true); this.loop(); }, live ? 60e3 : 10 * 60e3);
    },

    async load(force) {
      this.paintChrome();
      const list = U.$('[data-fblist]', this.root);
      if (!list.innerHTML.trim() || force) list.innerHTML = this.skeleton();
      try {
        if (this.tab === 'focus') await this.loadClubs(force);
        if (this.tab === 'results') await this.loadResults(this.league, force);
        if (this.tab === 'table') await this.loadTable(this.league);
        if (this.tab === 'news') await this.loadNews();
        this.status = { ok: true, at: Date.now() };
      } catch (e) { console.warn(e); this.status = { ok: false, err: e.message }; }
      this.paint();
    },

    /* ---------- loaders ---------- */
    async loadClubs(force) {
      await Promise.all(CLUBS.map(async (club) => {
        const leagues = [club.league, ...club.cups];
        const ttl = force ? 1 : 15;
        const sets = await Promise.all(leagues.flatMap((lg) => [
          get(`${API}${lg}/teams/${club.id}/schedule`, ttl, mapEvents(lg)).catch(() => []),
          get(`${API}${lg}/teams/${club.id}/schedule?fixture=true`, 60, mapEvents(lg)).catch(() => []),
        ]));
        const byId = {}; sets.flat().forEach((e) => { byId[e.id] = e; });
        const events = Object.values(byId).sort((a, b) => (a.date < b.date ? -1 : 1));
        const table = await this.loadTable(club.league).catch(() => null);
        this.data.clubs[club.id] = { events, row: table && table.find((r) => r.id === club.id), table };
      }));
    },
    async loadResults(league, force) {
      const days = Array.from({ length: 8 }, (_, i) => U.addDays(new Date(), -i)).map((d) => `${d.getFullYear()}${U.p2(d.getMonth() + 1)}${U.p2(d.getDate())}`);
      const sets = await Promise.all(days.map((d, i) => get(`${API}${league}/scoreboard?dates=${d}`, i === 0 || force ? 2 : 180, mapEvents(league)).catch(() => [])));
      const upcoming = await get(`${API}${league}/scoreboard`, force ? 1 : 10, mapEvents(league)).catch(() => []);
      const byId = {}; [...sets.flat(), ...upcoming].forEach((e) => { byId[e.id] = e; });
      this.data.results[league] = Object.values(byId).sort((a, b) => (a.date > b.date ? -1 : 1));
    },
    async loadTable(league) {
      const rows = await get(`${STAND}${league}/standings`, 30, (j) => {
        const ent = (j.children && j.children[0] && j.children[0].standings && j.children[0].standings.entries) || [];
        return ent.map((e) => {
          const s = Object.fromEntries((e.stats || []).map((x) => [x.name, x.value ?? x.displayValue]));
          return { id: String(e.team.id), name: e.team.displayName, short: e.team.shortDisplayName || e.team.displayName, logo: logo(e.team), rank: +s.rank || 0, gp: s.gamesPlayed, w: s.wins, d: s.ties, l: s.losses, gd: s.pointDifferential, gf: s.pointsFor, ga: s.pointsAgainst, pts: s.points, note: e.note ? { color: e.note.color, desc: e.note.description } : null };
        }).sort((a, b) => a.rank - b.rank);
      });
      this.data.table[league] = rows;
      return rows;
    },
    async loadNews() {
      const strip = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
      const sets = await Promise.all(NEWS_FEEDS.map((f) => get('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(f.url), 30, (j) => {
        if (j.status !== 'ok') throw new Error(j.message || 'feed error');
        return (j.items || []).slice(0, 12).map((it) => {
          let thumb = it.thumbnail || (it.enclosure && it.enclosure.link) || ((it.description || '').match(/<img[^>]+src=["']([^"']+)/i) || [])[1] || '';
          if (thumb && !/^https?:/.test(thumb)) thumb = '';
          let title = strip(it.title), src = f.name;
          const m = title.match(/^(.*) - ([^-]{2,40})$/); if (/news\.google/.test(f.url) && m) { title = m[1]; src = m[2]; }
          return { club: f.club, title, desc: /news\.google/.test(f.url) ? '' : strip(it.description).slice(0, 200), link: it.link, src, thumb, at: Date.parse((it.pubDate || '').replace(' ', 'T') + 'Z') || Date.now() };
        });
      }).catch(() => [])));
      // Berita klub fokus dari ESPN (bahasa Inggris), disaring per klub
      const espn = await Promise.all(CLUBS.map((club) => get(`${API}${club.league}/news?limit=50`, 30, (j) => (j.articles || [])
        .filter((a) => (a.categories || []).some((c) => String(c.teamId || (c.team && c.team.id)) === club.id))
        .slice(0, 8).map((a) => ({ club: club.id, title: a.headline, desc: (a.description || '').slice(0, 200), link: (a.links && a.links.web && a.links.web.href) || '', src: 'ESPN (EN)', thumb: (a.images && a.images[0] && a.images[0].url) || '', at: Date.parse(a.published) || Date.now() }))).catch(() => [])));
      sets.push(...espn);
      const seen = new Set();
      this.data.news = sets.flat().filter((n) => { const k = n.title.toLowerCase().slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.at - a.at).slice(0, 20);
    },

    /* ---------- render ---------- */
    paintChrome() {
      const T = [['focus', 'Klub Fokus'], ['results', 'Hasil'], ['table', 'Klasemen'], ['news', 'Berita']];
      U.$('[data-fbtabs]', this.root).innerHTML = T.map(([k, l]) => `<button class="chip ${this.tab === k ? 'active' : ''}" data-fbtab="${k}">${l}</button>`).join('');
      const lg = U.$('[data-fbleagues]', this.root);
      lg.style.display = this.tab === 'results' || this.tab === 'table' ? '' : 'none';
      lg.innerHTML = LEAGUES.map((l) => `<button class="chip ${this.league === l.id ? 'active' : ''}" data-fbleague="${l.id}" style="font-size:12px">${l.flag} ${l.label}</button>`).join('');
    },
    skeleton() { return Array.from({ length: 3 }, () => `<div class="fb-card" style="height:92px;background:var(--surface-2);border:0"></div>`).join(''); },
    paint() {
      this.paintChrome();
      const list = U.$('[data-fblist]', this.root);
      let html = '';
      if (this.tab === 'focus') html = CLUBS.map((c) => this.clubHTML(c)).join('');
      if (this.tab === 'results') html = this.resultsHTML(this.data.results[this.league] || []);
      if (this.tab === 'table') html = this.tableHTML(this.data.table[this.league] || []);
      if (this.tab === 'news') html = this.newsHTML(this.data.news || []);
      list.innerHTML = html || `<div class="empty">${icon('wifiOff', 22)}<b>Data belum tersedia</b>${navigator.onLine ? 'Coba muat ulang.' : 'Sedang offline — data tampil lagi saat online.'}</div>`;
      U.$$('img[data-fallback]', list).forEach((im) => { im.onerror = () => { im.style.visibility = 'hidden'; }; });
      const st = { ...this.status, ok: this.status.ok && !!html };
      U.$('[data-fbfoot]', this.root).innerHTML = `<span><span class="dot ${st.ok && navigator.onLine ? 'live' : 'off'}"></span> ${st.ok ? (navigator.onLine ? 'Live' : 'Offline · cache') : 'Gagal memuat'} · ${U.fmtTime(new Date())}</span><span>ESPN${this.tab === 'news' ? ' · Antara' : ''}</span>`;
      this.loop();
    },

    teamCell(t, focus) { return `<span class="fb-team ${CLUBS.some((c) => c.id === t.id) ? 'focus' : ''} ${t.winner ? 'win' : ''}"><img src="${U.esc(t.logo)}" alt="" data-fallback loading="lazy"/><span>${U.esc(focus ? t.name : t.short)}</span></span>`; },
    when(e) { const d = new Date(e.date); return `${U.HARI3[d.getDay()]}, ${d.getDate()} ${U.BULAN3[d.getMonth()]} · ${U.fmtTime(d)}`; },
    stateBadge(e) {
      if (e.state === 'in') return `<span class="badge bad fb-live">● ${U.esc(e.clock || e.detail)}</span>`;
      if (e.done) return `<span class="badge">${/AET|Pen/i.test(e.detail) ? U.esc(e.detail) : 'Selesai'}</span>`;
      if (/postp|canc/i.test(e.detail)) return `<span class="badge warn">Ditunda</span>`;
      return `<span class="badge accent">${U.fmtTime(new Date(e.date))}</span>`;
    },
    matchRow(e, opts = {}) {
      const showScore = e.state !== 'pre';
      return `<div class="fb-match" data-match="${e.id}" data-league="${e.league}" title="${showScore ? 'Klik untuk statistik pertandingan' : ''}">
        ${opts.meta ? `<div class="fb-meta"><span>${U.esc(LABEL[e.league] || e.league)}</span><span>${this.when(e)}</span></div>` : ''}
        <div class="fb-line">${this.teamCell(e.home)}<span class="fb-score ${showScore ? '' : 'pre'}">${showScore ? `${U.esc(e.home.score)}<i>–</i>${U.esc(e.away.score)}` : 'vs'}</span>${this.teamCell(e.away)}</div>
        <div class="fb-sub">${this.stateBadge(e)}${showScore ? `<span class="fb-stat-link">${icon('activity', 11)} Statistik</span>` : ''}</div></div>`;
    },

    clubHTML(club) {
      const d = this.data.clubs[club.id];
      if (!d) return '';
      const ev = d.events;
      const past = ev.filter((e) => e.done).reverse();
      const live = ev.find((e) => e.state === 'in');
      const next = ev.find((e) => e.state === 'pre' && !/postp|canc/i.test(e.detail));
      const last = past[0];
      const form = past.slice(0, 5).map((e) => { const home = e.home.id === club.id; const me = home ? e.home : e.away, op = home ? e.away : e.home; const r = +me.score > +op.score ? 'W' : +me.score < +op.score ? 'L' : 'D'; return `<span class="fb-form ${r}" title="${U.esc(op.short)} ${me.score}-${op.score}">${r === 'W' ? 'M' : r === 'L' ? 'K' : 'S'}</span>`; }).join('');
      const r = d.row;
      const days = next ? Math.ceil((new Date(next.date) - Date.now()) / 864e5) : null;
      return `<div class="fb-card fb-club" style="--club:${club.color}">
        <div class="fb-club-h"><img src="https://a.espncdn.com/i/teamlogos/soccer/500/${club.id}.png" alt="" data-fallback/>
          <div style="min-width:0;flex:1"><div class="fb-club-n">${club.name}</div>
            <div class="fb-club-s">${r ? `<b>#${r.rank}</b> ${LABEL[club.league]} · ${r.pts} poin · ${r.gp} main · ${r.w}M ${r.d}S ${r.l}K` : LABEL[club.league]}</div></div></div>
        ${form ? `<div class="fb-formrow"><span class="hint">5 laga terakhir</span><div>${form}</div></div>` : ''}
        ${live ? `<div class="fb-label" style="color:var(--bad)">● Sedang berlangsung</div>${this.matchRow(live, { meta: true })}` : ''}
        ${last ? `<div class="fb-label">Hasil terakhir</div>${this.matchRow(last, { meta: true })}` : ''}
        ${next ? `<div class="fb-label">Laga berikutnya ${days != null ? `<span class="badge ${days <= 1 ? 'warn' : ''}">${days <= 0 ? 'hari ini' : days === 1 ? 'besok' : days + ' hari lagi'}</span>` : ''}</div>${this.matchRow(next, { meta: true })}` : ''}
      </div>`;
    },

    resultsHTML(evs) {
      if (!evs.length) return '';
      const groups = {};
      evs.forEach((e) => { const k = U.ymd(new Date(e.date)); (groups[k] = groups[k] || []).push(e); });
      const today = U.today();
      const keys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
      // tampilkan: hari ini & yang sudah selesai dulu, jadwal mendatang di akhir
      const order = [...keys.filter((k) => k <= today), ...keys.filter((k) => k > today).reverse()];
      return order.map((k) => `<div class="fb-label" style="margin-top:6px">${U.fmtLong(U.parse(k))}${k === today ? ' <span class="badge accent">Hari ini</span>' : k === U.ymd(U.addDays(new Date(), -1)) ? ' <span class="badge">Tadi malam / subuh</span>' : ''}</div>
        <div class="fb-card" style="padding:4px 8px">${groups[k].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => this.matchRow(e)).join('')}</div>`).join('');
    },

    tableHTML(rows) {
      if (!rows.length) return '';
      return `<div class="fb-card" style="padding:0;overflow:hidden"><table class="fb-table">
        <thead><tr><th>#</th><th class="l">Klub</th><th title="Main">M</th><th title="Menang-Seri-Kalah">M-S-K</th><th title="Selisih gol">SG</th><th>Poin</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${CLUBS.some((c) => c.id === r.id) ? 'focus' : ''}">
          <td><span class="fb-rank" style="${r.note && r.note.color ? `box-shadow:inset 3px 0 0 ${r.note.color}` : ''}" title="${U.esc(r.note ? r.note.desc : '')}">${r.rank}</span></td>
          <td class="l"><span class="fb-team"><img src="${U.esc(r.logo)}" alt="" data-fallback loading="lazy"/><span>${U.esc(r.short)}</span></span></td>
          <td>${r.gp}</td><td class="muted">${r.w}-${r.d}-${r.l}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td></tr>`).join('')}</tbody></table></div>
        ${[...new Map(rows.filter((r) => r.note).map((r) => [r.note.desc, r.note.color])).entries()].map(([d, c]) => `<span class="hint" style="display:inline-flex;align-items:center;gap:5px;margin-right:10px"><i style="width:8px;height:8px;border-radius:2px;background:${c};display:inline-block"></i>${U.esc(d)}</span>`).join('')}`;
    },

    newsHTML(items) {
      if (!items.length) return '';
      return items.map((n) => {
        const club = CLUBS.find((c) => c.id === n.club);
        const ph = `<div class="news-ph" style="background:linear-gradient(135deg, ${club ? club.color : '#059669'}, ${club ? club.color : '#059669'}aa)">${club ? `<img src="https://a.espncdn.com/i/teamlogos/soccer/500/${club.id}.png" alt="" style="width:46px;height:46px" data-fallback/>` : icon('football', 30)}</div>`;
        return `<article class="news-item">${n.thumb ? `<img class="news-thumb" src="${U.esc(n.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='${ph.replace(/'/g, '&#39;').replace(/"/g, '&quot;')}'"/>` : ph}
          <div class="news-meta">${club ? `<span class="badge" style="background:${club.color}1f;color:${club.color}">${club.short}</span>` : '<span class="badge good">Sepakbola</span>'}<span>${U.esc(n.src)}</span>·<span>${U.timeAgo(n.at)}</span></div>
          <div class="news-title">${U.esc(n.title)}</div>${n.desc ? `<div class="news-sum">${U.esc(n.desc)}</div>` : ''}
          <a class="news-more" href="${U.esc(n.link)}" target="_blank" rel="noopener">Baca selengkapnya ${icon('external', 12)}</a></article>`;
      }).join('');
    },

    /* ---------- statistik pertandingan ---------- */
    async openMatch(id, league) {
      const ctx = U.modal({ title: 'Statistik Pertandingan', icon: 'activity', body: `<div class="empty">${icon('refresh', 22)}<b>Memuat statistik…</b></div>`, buttons: [{ label: 'Tutup', cls: 'primary' }] });
      let s;
      try {
        s = await get(`${API}${league}/summary?event=${id}`, 2, (j) => {
          const comp = j.header && j.header.competitions && j.header.competitions[0];
          const teams = (j.boxscore && j.boxscore.teams) || [];
          const side = (h) => { const c = comp.competitors.find((x) => x.homeAway === h); const bt = teams.find((t) => String(t.team.id) === String(c.team.id)); return { id: String(c.team.id), name: c.team.displayName, logo: logo(c.team), score: score(c.score), stats: Object.fromEntries(((bt && bt.statistics) || []).map((x) => [x.name, +x.displayValue])) }; };
          const st = comp.status && comp.status.type;
          return {
            home: side('home'), away: side('away'), date: comp.date, status: st ? st.shortDetail : '', state: st ? st.state : '',
            venue: j.gameInfo && j.gameInfo.venue && j.gameInfo.venue.fullName, att: j.gameInfo && j.gameInfo.attendance,
            events: (j.keyEvents || []).filter((k) => k.type && /goal|penalty - scored|card|own goal/i.test(k.type.text) && !/missed|saved/i.test(k.type.text))
              .map((k) => ({ type: k.type.text, min: k.clock && k.clock.displayValue, team: k.team && String(k.team.id), who: ((k.participants || [])[0] && k.participants[0].athlete && k.participants[0].athlete.displayName) || (k.shortText || '').replace(/ Goal.*$/, '') })),
          };
        }, { persist: false });
      } catch (e) { ctx.body.innerHTML = `<div class="empty">${icon('wifiOff', 22)}<b>Statistik belum tersedia</b>${U.esc(e.message)}</div>`; return; }
      const { home: h, away: a } = s;
      const has = Object.keys(h.stats).length;
      const ev = (k) => { const ic = /red/i.test(k.type) ? '🟥' : /yellow/i.test(k.type) ? '🟨' : '⚽'; return `<div class="fb-ev ${k.team === h.id ? 'h' : 'a'}"><span class="mono">${U.esc(k.min || '')}</span> ${ic} ${U.esc(k.who || k.type)}${/own/i.test(k.type) ? ' (bunuh diri)' : /penalty/i.test(k.type) ? ' (pen)' : ''}</div>`; };
      ctx.el.querySelector('.modal-t').innerHTML = `${icon('activity', 18)}${U.esc(LABEL[league] || league)}`;
      ctx.body.innerHTML = `
        <div class="fb-hero">
          <div class="fb-hero-t"><img src="${U.esc(h.logo)}" alt="" data-fallback/><b>${U.esc(h.name)}</b></div>
          <div class="fb-hero-s"><div class="fb-big">${U.esc(h.score)} – ${U.esc(a.score)}</div><div class="hint">${U.esc(s.status)} · ${this.when({ date: s.date })}</div></div>
          <div class="fb-hero-t"><img src="${U.esc(a.logo)}" alt="" data-fallback/><b>${U.esc(a.name)}</b></div>
        </div>
        ${s.events.length ? `<div class="fb-evs">${s.events.map(ev).join('')}</div>` : ''}
        ${has ? `<div class="fb-stats">${STAT_ROWS.filter(([k]) => k in h.stats || k in a.stats).map(([k, l, f]) => {
          const hv = h.stats[k] || 0, av = a.stats[k] || 0, tot = hv + av || 1, fmt = f || ((v) => U.fmtNum(v));
          return `<div class="fb-srow"><div class="fb-sv">${fmt(hv)}</div><div class="fb-sl">${l}<div class="fb-sbar"><span class="h" style="width:${(hv / tot) * 100}%;opacity:${hv >= av ? 1 : .45}"></span><span class="a" style="width:${(av / tot) * 100}%;opacity:${av >= hv ? 1 : .45}"></span></div></div><div class="fb-sv">${fmt(av)}</div></div>`;
        }).join('')}</div>` : `<div class="empty">Statistik detail belum tersedia untuk laga ini.</div>`}
        <div class="hint" style="text-align:center">${s.venue ? `${icon('mapPin', 11)} ${U.esc(s.venue)}` : ''}${s.att ? ` · ${U.fmtNum(s.att)} penonton` : ''} · Sumber: ESPN</div>`;
      U.$$('img[data-fallback]', ctx.body).forEach((im) => { im.onerror = () => { im.style.visibility = 'hidden'; }; });
    },
  };

  window.Football = Football;
})();
