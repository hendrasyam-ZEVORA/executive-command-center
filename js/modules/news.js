/* Live News Feed — RSS portal berita Indonesia via api.rss2json.com (gratis, tanpa API key, mendukung CORS).
   - Cache 30 menit di localStorage → hemat kuota & tetap tampil saat offline.
   - Cuaca Makassar via Open-Meteo (gratis, tanpa key).
   - Daftar feed bisa diubah lewat tombol ⚙ di panel berita (tersimpan di IndexedDB). */
(function () {
  const CATS = [
    { id: 'all', label: 'Semua' },
    { id: 'bola', label: 'Sepakbola', color: '#059669' },
    { id: 'ekopol', label: 'Ekonomi & Politik', color: '#4f46e5' },
    { id: 'lokal', label: 'Makassar & Cuaca', color: '#d97706' },
  ];
  const DEFAULT_FEEDS = [
    { cat: 'bola', name: 'Antara Sepakbola', url: 'https://www.antaranews.com/rss/sepakbola.xml' },
    { cat: 'bola', name: 'CNN Indonesia Olahraga', url: 'https://www.cnnindonesia.com/olahraga/rss' },
    { cat: 'ekopol', name: 'CNN Indonesia Ekonomi', url: 'https://www.cnnindonesia.com/ekonomi/rss' },
    { cat: 'ekopol', name: 'CNN Indonesia Nasional', url: 'https://www.cnnindonesia.com/nasional/rss' },
    { cat: 'ekopol', name: 'CNBC Indonesia Market', url: 'https://www.cnbcindonesia.com/market/rss' },
    { cat: 'lokal', name: 'Antara Makassar', url: 'https://makassar.antaranews.com/rss/terkini.xml' },
    { cat: 'lokal', name: 'Google News Makassar', url: 'https://news.google.com/rss/search?q=Makassar&hl=id&gl=ID&ceid=ID:id' },
  ];
  const MAKASSAR = { lat: -5.1477, lon: 119.4327 };
  const CACHE_KEY = 'edcc-news-cache';
  const TTL = 30 * 60 * 1000;
  const RESULT_RE = /\b(hasil|skor|menang|kalah|imbang|tumbang|bungkam|hajar|tekuk|libas|gol|klasemen|vs)\b/i;

  /* Contoh tampilan saat 100% offline — jelas ditandai CONTOH, bukan berita sungguhan */
  const SAMPLE = [
    ['bola', 'Hasil pertandingan Liga Inggris tadi malam akan tampil di sini', 'Saat online, panel ini menarik skor & ulasan laga terbaru dari Antara Sepakbola dan CNN Indonesia Olahraga, diurutkan dari hasil pertandingan paling baru.'],
    ['bola', 'Rekap skor Liga Champions dini hari & klasemen sementara', 'Berita berlabel hasil/skor/klasemen diprioritaskan di tab Sepakbola agar Anda langsung melihat hasil laga subuh tadi.'],
    ['bola', 'Kabar PSM Makassar dan Liga 1 Indonesia', 'Tambahkan feed klub atau portal bola favorit lewat tombol pengaturan feed.'],
    ['ekopol', 'Pergerakan IHSG & nilai tukar rupiah hari ini', 'Ringkasan ekonomi harian dari CNN Indonesia Ekonomi dan CNBC Indonesia akan muncul di sini saat terhubung internet.'],
    ['ekopol', 'Kebijakan harga & daya beli: dampaknya ke penjualan FMCG', 'Berita ekonomi makro yang relevan untuk memantau tren konsumsi ritel modern.'],
    ['ekopol', 'Agenda pemerintah dan kebijakan nasional terbaru', 'Feed nasional CNN Indonesia — klik "Baca selengkapnya" untuk membuka artikel di tab baru.'],
    ['lokal', 'Berita terkini Kota Makassar dari Antara Makassar', 'Lalu lintas, pembangunan kota, dan peristiwa lokal Sulawesi Selatan.'],
    ['lokal', 'Prakiraan cuaca Makassar hari ini', 'Kartu cuaca di atas tab ini diperbarui otomatis dari Open-Meteo saat online.'],
    ['ekopol', 'Update ritel modern: Indomaret, Alfamart & hypermarket', 'Tips: tambahkan feed Google News dengan kata kunci account Anda melalui pengaturan feed.'],
    ['lokal', 'Kegiatan & event di Makassar akhir pekan ini', 'Informasi lokal untuk perencanaan kunjungan toko dan event.'],
  ].map(([cat, title, desc], i) => ({ cat, title, desc, link: '', source: 'Contoh offline', pubDate: Date.now() - i * 37 * 60000, thumb: '', sample: true }));

  const WMO = { 0: 'Cerah', 1: 'Cerah berawan', 2: 'Berawan sebagian', 3: 'Berawan', 45: 'Berkabut', 48: 'Berkabut', 51: 'Gerimis ringan', 53: 'Gerimis', 55: 'Gerimis lebat', 61: 'Hujan ringan', 63: 'Hujan sedang', 65: 'Hujan lebat', 80: 'Hujan lokal', 81: 'Hujan lokal sedang', 82: 'Hujan lokal lebat', 95: 'Badai petir', 96: 'Badai petir', 99: 'Badai petir' };

  const News = {
    items: [],
    feeds: DEFAULT_FEEDS,
    tab: 'all',
    status: 'idle', // idle | loading | live | cache | sample
    fetchedAt: 0,
    weather: null,
    root: null,

    async load() {
      this.feeds = (await DB.kv.get('newsFeeds', null)) || DEFAULT_FEEDS;
      try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (c && c.items && c.items.length) { this.items = c.items; this.weather = c.weather; this.fetchedAt = c.at; this.status = 'cache'; }
      } catch {}
    },

    mount(root) {
      this.root = root;
      root.innerHTML = `
        <div class="card-h"><div class="card-t">${icon('newspaper', 16)}Berita Terkini</div>
          <div style="display:flex"><button class="icon-btn sm" data-nfeeds title="Atur sumber feed">${icon('settings', 14)}</button>
          <button class="icon-btn sm" data-nrefresh title="Muat ulang berita">${icon('refresh', 14)}</button></div></div>
        <div class="news-tabs"><div class="chips" data-ntabs></div></div>
        <div class="news-list" data-nlist></div>
        <div class="news-foot" data-nfoot></div>`;
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-ntab]'); if (t) { this.tab = t.dataset.ntab; this.paint(); U.$('[data-nlist]', root).scrollTop = 0; }
        if (e.target.closest('[data-nrefresh]')) this.refresh(true);
        if (e.target.closest('[data-nfeeds]')) this.editFeeds();
      });
      window.addEventListener('online', () => this.refresh(true));
      this.paint();
      this.refresh(false);
      setInterval(() => { if (document.visibilityState === 'visible') this.refresh(false); }, TTL);
    },

    async refresh(force) {
      if (!force && this.fetchedAt && Date.now() - this.fetchedAt < TTL && this.status !== 'sample') return this.paint();
      if (!navigator.onLine) { if (!this.items.length) this.status = 'sample'; return this.paint(); }
      this.status = 'loading'; this.paint();
      const results = await Promise.allSettled(this.feeds.map((f) => this.fetchFeed(f)));
      const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      const okFeeds = results.filter((r) => r.status === 'fulfilled' && r.value.length).length;
      this.fetchWeather();
      if (items.length) {
        const seen = new Set();
        this.items = items.filter((it) => { const k = it.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
          .sort((a, b) => b.pubDate - a.pubDate);
        this.fetchedAt = Date.now(); this.status = 'live'; this.okFeeds = okFeeds;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: this.fetchedAt, items: this.items.slice(0, 80), weather: this.weather })); } catch {}
      } else this.status = this.items.length ? 'cache' : 'sample';
      this.paint();
    },

    async fetchFeed(f) {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(f.url), { signal: ctl.signal });
        const j = await r.json();
        if (j.status !== 'ok') throw new Error(j.message || 'feed error');
        return (j.items || []).map((it) => {
          const desc = this.strip(it.description || it.content || '');
          let thumb = it.thumbnail || (it.enclosure && (it.enclosure.link || it.enclosure.url)) || '';
          if (!thumb) { const m = (it.description || it.content || '').match(/<img[^>]+src=["']([^"']+)/i); if (m) thumb = m[1]; }
          if (thumb && !/^https?:/.test(thumb)) thumb = '';
          if (thumb && /\.(mp3|mp4)$/i.test(thumb)) thumb = '';
          return { cat: f.cat, title: this.strip(it.title || ''), desc, link: it.link, source: f.name, pubDate: Date.parse((it.pubDate || '').replace(' ', 'T') + (/(Z|[+-]\d\d:?\d\d)$/.test(it.pubDate || '') ? '' : 'Z')) || Date.now(), thumb };
        });
      } finally { clearTimeout(to); }
    },
    strip(html) { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\s+/g, ' ').trim(); },

    async fetchWeather() {
      try {
        const u = `https://api.open-meteo.com/v1/forecast?latitude=${MAKASSAR.lat}&longitude=${MAKASSAR.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FMakassar&forecast_days=1`;
        const j = await (await fetch(u)).json();
        this.weather = { t: j.current.temperature_2m, rh: j.current.relative_humidity_2m, code: j.current.weather_code, wind: j.current.wind_speed_10m, max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0], rain: j.daily.precipitation_probability_max[0], at: Date.now() };
        if (this.tab === 'lokal') this.paint();
      } catch { /* abaikan */ }
    },

    list() {
      let pool = this.status === 'sample' || !this.items.length ? SAMPLE : this.items;
      if (this.tab !== 'all') pool = pool.filter((i) => i.cat === this.tab);
      if (this.tab === 'bola') {
        const now = Date.now();
        pool = [...pool].sort((a, b) => {
          const sa = (RESULT_RE.test(a.title) && now - a.pubDate < 18 * 3600e3) ? 1 : 0;
          const sb = (RESULT_RE.test(b.title) && now - b.pubDate < 18 * 3600e3) ? 1 : 0;
          return sb - sa || b.pubDate - a.pubDate;
        });
      }
      if (this.tab === 'all') { // seimbangkan kategori: ambil bergiliran
        const by = { bola: [], ekopol: [], lokal: [] }; pool.forEach((i) => (by[i.cat] || (by[i.cat] = [])).push(i));
        const out = []; let k = 0;
        while (out.length < 10 && k < 40) { for (const c of Object.keys(by)) if (by[c][k] && out.length < 10) out.push(by[c][k]); k++; }
        return out.sort((a, b) => b.pubDate - a.pubDate);
      }
      return pool.slice(0, 10);
    },

    paint() {
      const root = this.root; if (!root) return;
      const pool = this.status === 'sample' || !this.items.length ? SAMPLE : this.items;
      U.$('[data-ntabs]', root).innerHTML = CATS.map((c) => `<button class="chip ${this.tab === c.id ? 'active' : ''}" data-ntab="${c.id}">${c.label}${c.id !== 'all' ? `<span class="c">${pool.filter((i) => i.cat === c.id).length}</span>` : ''}</button>`).join('');
      const list = this.list();
      const weather = this.tab === 'lokal' && this.weather ? `<div class="weather">${icon(this.weather.code >= 51 ? 'cloudRain' : this.weather.code <= 1 ? 'sun' : 'cloud', 30)}
          <div><div class="w-temp">${Math.round(this.weather.t)}°C</div><div class="w-desc">${WMO[this.weather.code] || 'Cuaca'} · Makassar</div></div>
          <div style="margin-left:auto;text-align:right;font-size:12px" class="muted">${Math.round(this.weather.min)}°–${Math.round(this.weather.max)}°<br>Hujan ${this.weather.rain ?? '–'}% · RH ${this.weather.rh}%</div></div>` : '';
      U.$('[data-nlist]', root).innerHTML = weather + (this.status === 'loading' && !this.items.length
        ? Array.from({ length: 3 }, () => `<div class="news-item"><div class="news-ph" style="background:var(--surface-3)"></div><div style="height:14px;background:var(--surface-3);border-radius:4px;width:80%"></div></div>`).join('')
        : list.map((it) => this.itemHTML(it)).join('') || `<div class="empty">Tidak ada berita di kategori ini.</div>`);
      U.$$('img.news-thumb', root).forEach((img) => { img.onerror = () => { img.replaceWith(this.ph(img.dataset.cat)); }; });

      const foot = { loading: `<span><span class="dot"></span> Memuat berita…</span>`,
        live: `<span><span class="dot live"></span> Live · ${this.okFeeds || ''} sumber · ${U.fmtTime(new Date(this.fetchedAt))}</span>`,
        cache: `<span><span class="dot off"></span> ${navigator.onLine ? 'Cache' : 'Offline'} · ${this.fetchedAt ? U.timeAgo(this.fetchedAt) : ''}</span>`,
        sample: `<span><span class="dot off"></span> ${icon('wifiOff', 12)} Offline · menampilkan contoh</span>`,
        idle: '' }[this.status];
      U.$('[data-nfoot]', root).innerHTML = foot + `<span>${list.length} berita</span>`;
    },
    ph(cat) {
      const c = CATS.find((x) => x.id === cat) || CATS[2];
      const el = document.createElement('div'); el.className = 'news-ph';
      el.style.background = `linear-gradient(135deg, ${c.color}, ${c.color}99)`;
      el.innerHTML = icon(cat === 'bola' ? 'football' : cat === 'lokal' ? 'mapPin' : 'trendUp', 30);
      return el;
    },
    itemHTML(it) {
      const c = CATS.find((x) => x.id === it.cat) || CATS[2];
      const thumb = it.thumb ? `<img class="news-thumb" src="${U.esc(it.thumb)}" data-cat="${it.cat}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : this.ph(it.cat).outerHTML;
      return `<article class="news-item">
        ${thumb}
        <div class="news-meta"><span class="badge" style="background:${c.color}1f;color:${c.color}">${c.label}</span>
          ${it.sample ? '<span class="badge warn">CONTOH</span>' : ''}
          <span>${U.esc(it.source)}</span>·<span>${U.timeAgo(it.pubDate)}</span></div>
        <div class="news-title">${U.esc(it.title)}</div>
        <div class="news-sum">${U.esc(it.desc.slice(0, 220))}</div>
        ${it.link ? `<a class="news-more" href="${U.esc(it.link)}" target="_blank" rel="noopener">Baca selengkapnya ${icon('external', 12)}</a>` : ''}
      </article>`;
    },

    editFeeds() {
      const rows = this.feeds.map((f) => `${f.cat} | ${f.name} | ${f.url}`).join('\n');
      U.modal({
        title: 'Sumber Feed Berita', icon: 'settings', size: 'lg',
        body: `<div class="hint">Satu feed per baris: <code>kategori | nama | URL RSS</code>. Kategori: <b>bola</b>, <b>ekopol</b>, <b>lokal</b>.
          Tips: Google News RSS juga bisa, mis. <code>lokal | Google News PSM | https://news.google.com/rss/search?q=PSM+Makassar&hl=id&gl=ID&ceid=ID:id</code></div>
          <textarea class="textarea mono" id="nFeeds" rows="10" style="font-size:12px">${U.esc(rows)}</textarea>`,
        buttons: [
          { label: 'Kembalikan default', cls: 'ghost', onClick: async () => { this.feeds = DEFAULT_FEEDS; await DB.kv.set('newsFeeds', null); this.refresh(true); } },
          { label: 'Batal', cls: 'ghost' },
          {
            label: 'Simpan', cls: 'primary', onClick: async (ctx) => {
              const feeds = U.$('#nFeeds', ctx.el).value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length >= 3 && /^https?:/.test(p[2]))
                .map(([cat, name, url]) => ({ cat: ['bola', 'ekopol', 'lokal'].includes(cat) ? cat : 'ekopol', name, url }));
              if (!feeds.length) { U.toast('Tidak ada feed valid', 'warn'); return false; }
              this.feeds = feeds; await DB.kv.set('newsFeeds', feeds); this.refresh(true);
            },
          },
        ],
      });
    },
  };

  window.News = News;
  App.register('_news', { load: () => News.load() });
})();
