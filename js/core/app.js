/* Kerangka aplikasi: menu, router (hash), sidebar collapsible, tema, jam global.
   Modul mendaftar dengan:
     App.register('daily', {
       title, icon,
       load: async () => {},        // dipanggil sekali saat boot (ambil data dari DB)
       render: (el) => {},          // dipanggil saat halaman pertama kali dibuka
       onShow: (el) => {},          // dipanggil setiap kali halaman ditampilkan
     })
*/
(function () {
  const MENUS = [
    { group: 'Workspace' },
    { id: 'beranda', label: 'Beranda Utama', icon: 'dashboard' },
    { id: 'daily', label: 'Daily Task', icon: 'calendarCheck', badge: () => window.Daily && Daily.openTodayCount() },
    { id: 'monthly', label: 'Monthly Task', icon: 'stickyNote', badge: () => window.Monthly && Monthly.dueTodayCount() },
    { id: 'account', label: 'Account Management', icon: 'building' },
    { id: 'kalender', label: 'Kalender & MS Teams', icon: 'calendarDays', badge: () => window.Kalender && Kalender.todayCount() },
    { group: 'Monitoring' },
    { id: 'program', label: 'Program Monitoring', icon: 'target' },
    { id: 'promo', label: 'Promo & Diskon', icon: 'tag' },
    { id: 'event', label: 'Event Monthly', icon: 'flag' },
    { group: 'Personal' },
    { id: 'projek', label: 'Projek Luar', icon: 'rocket' },
    { id: 'gallery', label: 'Screenshot Gallery', icon: 'image' },
    { id: 'kontak', label: 'Kontak & Bank Email', icon: 'users' },
    { id: 'shop', label: 'SHOP', icon: 'bag' },
  ];

  const App = {
    MENUS,
    modules: {},
    current: null,
    rendered: {},

    register(id, mod) { this.modules[id] = mod; },

    async boot() {
      this.renderSidebar();
      this.bindChrome();
      try {
        await DB.open();
        await Lock.gate(); // minta password bila kunci data aktif (sebelum data dibaca)
        for (const [id, m] of Object.entries(this.modules)) {
          if (m.load) { try { await m.load(); } catch (e) { console.error('load ' + id, e); } }
        }
      } catch (e) {
        U.toast('Penyimpanan offline tidak tersedia: ' + e.message, 'bad', 6000);
      }
      window.addEventListener('hashchange', () => this.route());
      this.route();
      this.startClock();
      U.on('data', () => this.refreshBadges());
      this.refreshBadges();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    },

    renderSidebar() {
      const nav = U.$('#sbNav');
      nav.innerHTML = MENUS.map((m) => {
        if (m.group) return `<div class="sb-group">${m.group}</div>`;
        const n = MENUS.filter((x) => x.id).indexOf(m) + 1;
        return `<a class="sb-item" href="#/${m.id}" data-id="${m.id}" title="${n}. ${m.label}">
          <span class="sb-ic">${icon(m.icon, 17)}</span><span class="sb-label">${m.label}</span>
          <span class="sb-badge hidden" data-badge="${m.id}"></span></a>`;
      }).join('');
      U.$('#sbCollapse').innerHTML = icon('panel', 16);
      U.$('#sbOpen').innerHTML = icon('menu', 18);
      this.renderThemeBtn();
    },

    refreshBadges() {
      MENUS.forEach((m) => {
        if (!m.badge) return;
        const el = U.$(`[data-badge="${m.id}"]`); if (!el) return;
        const v = m.badge();
        el.textContent = v || ''; el.classList.toggle('hidden', !v);
      });
    },

    bindChrome() {
      U.$('#sbCollapse').onclick = () => {
        const c = document.documentElement.classList.toggle('sb-collapsed');
        localStorage.setItem('edcc-sidebar', c ? 'collapsed' : 'open');
        setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
      };
      U.$('#sbOpen').onclick = () => document.body.classList.add('sb-open');
      U.$('#sbOverlay').onclick = () => document.body.classList.remove('sb-open');
      U.$('#themeToggle').onclick = () => this.toggleTheme();
      U.$('#sbAlarm').onclick = () => { location.hash = '#/daily'; };
      document.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea, [contenteditable="true"], select')) return;
        if (e.altKey && /^[1-9]$/.test(e.key)) { const ids = MENUS.filter((m) => m.id); const m = ids[+e.key - 1]; if (m) location.hash = '#/' + m.id; }
      });
    },

    theme() { return document.documentElement.getAttribute('data-theme'); },
    toggleTheme() {
      const t = this.theme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('edcc-theme', t);
      this.renderThemeBtn();
      U.emit('theme', t);
    },
    renderThemeBtn() {
      const dark = this.theme() === 'dark';
      U.$('#themeToggle').innerHTML = `<span class="sb-ic">${icon(dark ? 'sun' : 'moon', 17)}</span><span class="sb-label">${dark ? 'Mode Terang' : 'Mode Gelap'}</span>`;
    },

    route() {
      let id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'beranda';
      if (!MENUS.some((m) => m.id === id)) id = 'beranda';
      this.current = id;
      U.$$('.sb-item[data-id]').forEach((a) => a.classList.toggle('active', a.dataset.id === id));
      U.$$('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === id));
      const menu = MENUS.find((m) => m.id === id);
      U.$('#mobileTitle').textContent = menu.label;
      document.title = `${menu.label} · Command Center`;
      document.body.classList.remove('sb-open');
      const el = U.$('#page-' + id);
      const mod = this.modules[id];
      if (!mod) { el.innerHTML = `<div class="empty">Modul "${id}" belum terdaftar.</div>`; return; }
      if (!this.rendered[id]) { mod.render && mod.render(el); this.rendered[id] = true; }
      mod.onShow && mod.onShow(el);
      window.scrollTo(0, 0);
    },

    /* Header standar halaman */
    pageHead({ title, icon: ic, sub = '', actions = '' }) {
      return `<div class="page-head"><div><h1 class="page-title">${ic ? icon(ic, 24, 'muted') : ''}${U.esc(title)}</h1>${sub ? `<div class="page-sub">${sub}</div>` : ''}</div><div class="page-actions">${actions}</div></div>`;
    },

    startClock() {
      let lastDay = U.today();
      const tick = () => {
        const now = new Date();
        U.emit('tick', now);
        const d = U.ymd(now);
        if (d !== lastDay) { lastDay = d; U.emit('daychange', d); U.emit('data'); }
      };
      tick();
      // selaraskan ke detik penuh agar jam tidak "melompat"
      setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
    },
  };

  window.App = App;
})();
