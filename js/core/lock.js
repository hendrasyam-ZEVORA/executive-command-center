/* Kunci Data — password + enkripsi AES-256-GCM untuk semua data di browser.
   Skema kunci:
     DEK (kunci data, acak 256-bit) mengenkripsi setiap record di IndexedDB (lihat db.js).
     DEK dibungkus 2x: (1) dengan kunci turunan PASSWORD, (2) dengan kunci turunan KODE PEMULIHAN.
     Turunan kunci: PBKDF2-SHA256, 310.000 iterasi, salt acak. Password & kode tidak pernah disimpan.
   Kunci otomatis: layar terkunci setelah N menit tanpa aktivitas (data tetap terenkripsi di disk;
   alarm tetap berjalan). "Kunci sekarang" memuat ulang halaman → kunci data hilang dari memori. */
(function () {
  const ITER = 310000;
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O/1/I
  const enc = new TextEncoder();

  async function kek(secret, salt, iter = ITER) {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  }
  async function wrap(dek, k) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv, w: new Uint8Array(await crypto.subtle.wrapKey('raw', dek, k, { name: 'AES-GCM', iv })) }; }
  async function unwrap(w, iv, k) { return crypto.subtle.unwrapKey('raw', w, k, { name: 'AES-GCM', iv }, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']); }
  const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function genCode() { const r = crypto.getRandomValues(new Uint8Array(20)); const s = Array.from(r, (b) => ALPHA[b % 32]).join(''); return s.match(/.{4}/g).join('-'); }

  async function withPassword(meta, pw) { try { return await unwrap(meta.wrapPw, meta.ivPw, await kek(pw, meta.saltPw, meta.iter)); } catch { return null; } }
  async function withCode(meta, code) { try { return await unwrap(meta.wrapRc, meta.ivRc, await kek(normCode(code), meta.saltRc, meta.iter)); } catch { return null; } }
  async function buildMeta(dek, pw, code, prev = {}) {
    const saltPw = crypto.getRandomValues(new Uint8Array(16)), saltRc = crypto.getRandomValues(new Uint8Array(16));
    const p = await wrap(dek, await kek(pw, saltPw)); const r = await wrap(dek, await kek(normCode(code), saltRc));
    return { v: 1, iter: ITER, saltPw, ivPw: p.iv, wrapPw: p.w, saltRc, ivRc: r.iv, wrapRc: r.w, createdAt: prev.createdAt || Date.now(), changedAt: Date.now(), autoLock: prev.autoLock ?? 15 };
  }
  const pwOk = (pw) => pw.length >= 6;

  const Lock = {
    meta: null, soft: false, last: Date.now(), fails: 0, waitUntil: 0,
    enabled() { return !!this.meta; },

    /* Dipanggil App.boot sebelum modul memuat data */
    async gate() {
      this.meta = await DB.lockMeta();
      if (!this.meta) { this.paintSidebar(); return; }
      const dek = await this.screen('unlock');
      DB.key = dek;
      this.paintSidebar();
      this.watchIdle();
    },

    /* ---------- Layar kunci (overlay) ---------- */
    screen(mode) {
      return new Promise((resolve) => {
        const el = document.createElement('div'); el.className = 'lockscreen'; el.id = 'lockscreen';
        let view = 'pw';
        const now = () => { const d = new Date(); return `<div class="ls-time">${U.p2(d.getHours())}:${U.p2(d.getMinutes())}</div><div class="ls-date">${U.fmtLong(d)}</div>`; };
        const paint = (err = '') => {
          el.innerHTML = `<div class="ls-box">
            <div class="ls-clock">${now()}</div>
            <div class="ls-card">
              <div class="ls-ic">${icon('lock', 22)}</div>
              <div class="ls-t">${view === 'pw' ? (mode === 'unlock' ? 'Dashboard terkunci' : 'Terkunci otomatis') : 'Pemulihan dengan kode'}</div>
              <div class="ls-s">${view === 'pw' ? 'Masukkan password untuk membuka data Anda.' : 'Masukkan kode pemulihan, lalu buat password baru.'}</div>
              <form class="ls-form" autocomplete="off">
                ${view === 'pw'
                  ? `<input class="input" type="password" id="lsPw" placeholder="Password" autocomplete="current-password" autofocus />`
                  : `<input class="input mono" id="lsCode" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" style="text-transform:uppercase" />
                     <input class="input" type="password" id="lsNew" placeholder="Password baru (min. 6 karakter)" autocomplete="new-password" />
                     <input class="input" type="password" id="lsNew2" placeholder="Ulangi password baru" autocomplete="new-password" />`}
                <div class="ls-err">${U.esc(err)}</div>
                <button class="btn primary" type="submit" style="justify-content:center;height:38px">${icon('unlock', 15)}${view === 'pw' ? 'Buka' : 'Pulihkan & buka'}</button>
              </form>
              <button class="btn ghost sm" data-ls-switch style="align-self:center">${view === 'pw' ? 'Lupa password? Pakai kode pemulihan' : '← Kembali ke password'}</button>
            </div>
            <div class="ls-foot">${icon('shield', 12)} Data terenkripsi AES-256 di perangkat ini</div></div>`;
          setTimeout(() => { const f = U.$('#lsPw, #lsCode', el); f && f.focus(); }, 30);
        };
        const tick = setInterval(() => { const c = U.$('.ls-clock', el); if (c) c.innerHTML = now(); }, 15000);
        const done = (dek) => { clearInterval(tick); el.classList.add('out'); setTimeout(() => el.remove(), 220); this.fails = 0; this.last = Date.now(); resolve(dek); };
        el.addEventListener('click', (e) => { if (e.target.closest('[data-ls-switch]')) { view = view === 'pw' ? 'rc' : 'pw'; paint(); } });
        el.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = U.$('button[type=submit]', el);
          if (Date.now() < this.waitUntil) return paint(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((this.waitUntil - Date.now()) / 1000)} detik.`);
          btn.disabled = true; btn.innerHTML = 'Memeriksa…';
          if (view === 'pw') {
            const dek = await withPassword(this.meta, U.$('#lsPw', el).value);
            if (dek) return done(dek);
            this.fails++; if (this.fails >= 5) { this.waitUntil = Date.now() + 30000; this.fails = 0; }
            paint('Password salah.'); U.$('.ls-card', el).classList.add('shake');
          } else {
            const code = U.$('#lsCode', el).value, n1 = U.$('#lsNew', el).value, n2 = U.$('#lsNew2', el).value;
            if (!pwOk(n1)) return paint('Password baru minimal 6 karakter.');
            if (n1 !== n2) return paint('Ulangi password tidak sama.');
            const dek = await withCode(this.meta, code);
            if (!dek) { this.fails++; return paint('Kode pemulihan salah.'); }
            const m = await buildMeta(dek, n1, code, this.meta); // kode pemulihan tetap sama
            await DB.setLockMeta(m); this.meta = m;
            U.toast('Password baru disimpan', 'good', 3500);
            done(dek);
          }
        });
        paint(); document.body.appendChild(el);
      });
    },

    /* ---------- Kunci otomatis ---------- */
    watchIdle() {
      if (this._watching) return; this._watching = true;
      const bump = () => { this.last = Date.now(); };
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => document.addEventListener(ev, bump, { passive: true, capture: true }));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.checkIdle(); });
      setInterval(() => this.checkIdle(), 20000);
    },
    async checkIdle() {
      const min = this.meta && this.meta.autoLock;
      if (!min || this.soft || document.getElementById('lockscreen')) return;
      if (Date.now() - this.last >= min * 60000) {
        this.soft = true;
        document.querySelectorAll('.modal-back').forEach((m) => m.remove()); // tutup modal agar isi tidak terlihat
        await this.screen('idle');
        this.soft = false;
      }
    },
    lockNow() { if (this.enabled()) location.reload(); },

    /* ---------- Sidebar ---------- */
    paintSidebar() {
      const el = document.getElementById('sbLock'); if (!el) return;
      el.innerHTML = this.enabled()
        ? `<div class="sb-row"><button class="sb-item" data-lk="now" title="Kunci sekarang (data hilang dari memori sampai password dimasukkan)">${icon('lock', 14)}<span class="sb-label">Kunci</span></button>
            <button class="sb-item" data-lk="cfg" title="Pengaturan keamanan">${icon('shield', 14)}<span class="sb-label">Keamanan</span></button></div>`
        : `<button class="sb-item sb-warn" data-lk="cfg" title="Aktifkan password & enkripsi data">${icon('unlock', 16)}<span class="sb-label">Aktifkan kunci data</span></button>`;
    },
    init() {
      const foot = document.querySelector('.sb-foot');
      const box = document.createElement('div'); box.id = 'sbLock';
      foot.insertBefore(box, document.getElementById('sbBackup') || document.getElementById('themeToggle'));
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-lk]'); if (!b) return; b.dataset.lk === 'now' ? this.lockNow() : this.settings(); });
    },

    /* ---------- Pengaturan ---------- */
    settings() { this.enabled() ? this.manage() : this.setup(); },

    setup() {
      U.modal({
        title: 'Aktifkan Kunci Data', icon: 'shield', sticky: true,
        body: `<div class="callout">${icon('shield', 15)}<div>Semua data dashboard di perangkat ini (tugas, account, sales, gambar, PDF) akan <b>dienkripsi AES-256</b>.
            Tanpa password, data tidak bisa dibaca — termasuk lewat file backup. Password tidak disimpan di mana pun.</div></div>
          <div class="field"><label>Password baru (min. 6 karakter)</label><input class="input" type="password" id="lkPw" autocomplete="new-password" autofocus/></div>
          <div class="field"><label>Ulangi password</label><input class="input" type="password" id="lkPw2" autocomplete="new-password"/></div>
          <div class="field"><label>Kunci otomatis bila tidak ada aktivitas</label>
            <select class="select" id="lkAuto">${[[5, '5 menit'], [15, '15 menit'], [30, '30 menit'], [60, '1 jam'], [0, 'Tidak pernah']].map(([v, l]) => `<option value="${v}" ${v === 15 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`,
        buttons: [{ label: 'Batal', cls: 'ghost' }, {
          label: 'Lanjut', cls: 'primary', onClick: (ctx) => {
            const pw = U.$('#lkPw', ctx.el).value, pw2 = U.$('#lkPw2', ctx.el).value;
            if (!pwOk(pw)) { U.toast('Password minimal 6 karakter', 'warn'); return false; }
            if (pw !== pw2) { U.toast('Ulangi password tidak sama', 'warn'); return false; }
            setTimeout(() => this.showCode(pw, +U.$('#lkAuto', ctx.el).value), 50);
          },
        }],
      });
    },

    showCode(pw, autoLock) {
      const code = genCode();
      U.modal({
        title: 'Simpan Kode Pemulihan', icon: 'key', sticky: true,
        body: `<div>Kode ini satu-satunya cara membuka data bila Anda <b>lupa password</b>. Simpan di tempat aman (catatan HP, kertas, password manager) — <b>bukan</b> di dashboard ini.</div>
          <div class="rc-code mono" id="rcCode">${code}</div>
          <div style="display:flex;gap:8px;justify-content:center"><button class="btn sm" data-rc="copy">${icon('copy', 13)}Salin</button><button class="btn sm" data-rc="dl">${icon('download', 13)}Unduh .txt</button></div>
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer"><input type="checkbox" class="chk" id="rcOk"/>Saya sudah menyimpan kode pemulihan ini</label>`,
        buttons: [{ label: 'Batal', cls: 'ghost' }, {
          label: 'Aktifkan & Enkripsi', cls: 'primary', icon: 'lock', onClick: async (ctx) => {
            if (!U.$('#rcOk', ctx.el).checked) { U.toast('Centang konfirmasi setelah kode disimpan', 'warn'); return false; }
            const btn = ctx.el.querySelector('.modal-f .btn.primary'); btn.disabled = true; btn.textContent = 'Mengenkripsi data…';
            try {
              const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
              const meta = await buildMeta(dek, pw, code, { autoLock });
              await DB.reseal(null, dek);
              await DB.setLockMeta(meta); this.meta = meta;
              this.paintSidebar(); this.watchIdle();
              U.toast('Kunci data aktif — semua data sudah terenkripsi', 'good', 4500);
            } catch (e) { U.toast('Gagal mengaktifkan: ' + e.message, 'bad', 6000); btn.disabled = false; return false; }
          },
        }],
        onMount: (el) => {
          el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-rc]'); if (!b) return;
            if (b.dataset.rc === 'copy') U.copy(code);
            else U.download(new Blob([`Kode Pemulihan — Executive Daily Command Center\n\n${code}\n\nDibuat: ${new Date().toLocaleString('id-ID')}\nGunakan di layar kunci → "Lupa password? Pakai kode pemulihan".\n`], { type: 'text/plain' }), 'kode-pemulihan-command-center.txt');
          });
        },
      });
    },

    manage() {
      const m = this.meta;
      const modal = U.modal({
        title: 'Keamanan', icon: 'shield',
        body: `<div class="callout" style="background:var(--good-soft)">${icon('shield', 15)}<div><b>Kunci data aktif.</b> Data terenkripsi AES-256-GCM sejak ${U.fmtDate(new Date(m.createdAt))}${m.changedAt && m.changedAt !== m.createdAt ? ` · password terakhir diubah ${U.fmtDate(new Date(m.changedAt))}` : ''}.</div></div>
          <div class="field"><label>Kunci otomatis bila tidak ada aktivitas</label>
            <select class="select" id="lkAuto">${[[5, '5 menit'], [15, '15 menit'], [30, '30 menit'], [60, '1 jam'], [0, 'Tidak pernah']].map(([v, l]) => `<option value="${v}" ${v === (m.autoLock ?? 15) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Password saat ini (diperlukan untuk perubahan di bawah)</label><input class="input" type="password" id="lkCur" autocomplete="current-password"/></div>
          <div class="field-row"><div class="field"><label>Password baru</label><input class="input" type="password" id="lkNew" autocomplete="new-password"/></div>
            <div class="field"><label>Ulangi password baru</label><input class="input" type="password" id="lkNew2" autocomplete="new-password"/></div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-mg="pw">${icon('key', 13)}Ganti password</button>
            <button class="btn" data-mg="rc">${icon('refresh', 13)}Buat kode pemulihan baru</button>
            <button class="btn danger" data-mg="off" style="margin-left:auto">${icon('unlock', 13)}Matikan enkripsi</button></div>`,
        buttons: [{ label: 'Kunci sekarang', cls: 'ghost', icon: 'lock', onClick: () => { this.lockNow(); } }, {
          label: 'Simpan', cls: 'primary', onClick: async (ctx) => { m.autoLock = +U.$('#lkAuto', ctx.el).value; await DB.setLockMeta(m); U.toast('Pengaturan disimpan'); },
        }],
        onMount: (el, ctx) => {
          el.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-mg]'); if (!b) return;
            const cur = U.$('#lkCur', el).value;
            const dek = await withPassword(m, cur);
            if (!dek) { U.toast('Password saat ini salah', 'bad'); U.$('#lkCur', el).focus(); return; }
            if (b.dataset.mg === 'pw') {
              const n1 = U.$('#lkNew', el).value, n2 = U.$('#lkNew2', el).value;
              if (!pwOk(n1)) return U.toast('Password baru minimal 6 karakter', 'warn');
              if (n1 !== n2) return U.toast('Ulangi password tidak sama', 'warn');
              // bungkus ulang DEK dengan password baru; kode pemulihan lama tetap berlaku
              const saltPw = crypto.getRandomValues(new Uint8Array(16)); const p = await wrap(dek, await kek(n1, saltPw));
              Object.assign(m, { saltPw, ivPw: p.iv, wrapPw: p.w, changedAt: Date.now() }); await DB.setLockMeta(m);
              U.toast('Password diganti. Backup lama tetap memakai password lama.', 'good', 5000); ctx.close();
            }
            if (b.dataset.mg === 'rc') {
              const code = genCode(); const saltRc = crypto.getRandomValues(new Uint8Array(16)); const r = await wrap(dek, await kek(normCode(code), saltRc));
              Object.assign(m, { saltRc, ivRc: r.iv, wrapRc: r.w }); await DB.setLockMeta(m); ctx.close();
              U.modal({ title: 'Kode Pemulihan Baru', icon: 'key', body: `<div>Kode lama <b>tidak berlaku lagi</b>. Simpan kode baru ini:</div><div class="rc-code mono">${code}</div>`,
                buttons: [{ label: 'Salin', cls: 'ghost', onClick: () => { U.copy(code); return false; } }, { label: 'Sudah disimpan', cls: 'primary' }] });
            }
            if (b.dataset.mg === 'off') {
              if (!(await U.confirm('Matikan enkripsi? Semua data akan disimpan tanpa enkripsi di perangkat ini.', { ok: 'Matikan', title: 'Matikan Kunci Data' }))) return;
              await DB.reseal(dek, null); await DB.setLockMeta(null); this.meta = null; this.paintSidebar(); ctx.close();
              U.toast('Enkripsi dimatikan', 'warn', 4000);
            }
          });
        },
      });
      return modal;
    },

    /* Dipakai Restore: buka kunci file backup terenkripsi */
    async unlockBackup(json) {
      const meta = DB.unb64obj(json.lock);
      return new Promise((resolve) => {
        let ok = false;
        U.modal({
          title: 'Backup Terenkripsi', icon: 'lock', sticky: true,
          body: `<div>File ini dikunci. Masukkan <b>password saat backup dibuat</b>, atau kode pemulihan.</div>
            <div class="field"><label>Password atau kode pemulihan</label><input class="input" type="password" id="bkPw" autofocus/></div>`,
          buttons: [{ label: 'Batal', cls: 'ghost' }, {
            label: 'Buka', cls: 'primary', onClick: async (ctx) => {
              const v = U.$('#bkPw', ctx.el).value;
              const dek = (await withPassword(meta, v)) || (await withCode(meta, v));
              if (!dek) { U.toast('Password / kode salah', 'bad'); return false; }
              ok = true; resolve({ dek, meta });
            },
          }],
          onClose: () => { if (!ok) resolve(null); },
        });
      });
    },
  };

  window.Lock = Lock;
  Lock.init();
})();
