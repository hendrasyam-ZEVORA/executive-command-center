/* Sinkron Google Drive — data sama di laptop & HP, terenkripsi ujung-ke-ujung.
   - Disimpan di folder aplikasi tersembunyi (appDataFolder) Google Drive milik pengguna; scope hanya drive.appdata.
   - Isi dienkripsi dengan kunci data Kunci Data (AES-256-GCM) SEBELUM diunggah → Google tidak bisa membaca.
     Karena itu Sinkron mensyaratkan Kunci Data aktif. Perangkat baru membuka data dengan password yang sama.
   - File Drive:
       edcc-data.json   → { v, meta (kunci terbungkus, aman), savedAt, device, iv, c }  (c = semua record + tombstone)
       f_<id>.bin       → satu file lampiran/gambar (record terenkripsi apa adanya)
   - Penggabungan per record: updatedAt terbaru menang; hapusan dicatat sebagai tombstone.
   - Login: Google Identity Services (token 1 jam). Client ID OAuth dibuat pengguna sendiri di Google Cloud. */
(function () {
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const API = 'https://www.googleapis.com/drive/v3';
  const UP = 'https://www.googleapis.com/upload/drive/v3';
  const DATA_NAME = 'edcc-data.json';
  const LS = { cfg: 'edcc-sync', tok: 'edcc-gtoken', tombs: 'edcc-tombs', force: 'edcc-sync-force', dev: 'edcc-device' };
  const SKIP_KV = new Set(['salesHandles']);
  const PUSH_DELAY = 10000;

  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const recKey = (store, r) => (store === 'kv' ? r.key : r.id);
  const syncable = (store, id) => store !== 'files' && !(store === 'kv' && (SKIP_KV.has(id) || String(id).startsWith('_')));

  const Sync = {
    cfg: lsGet(LS.cfg, { clientId: '', connected: false, email: '', lastSync: 0, lastError: '' }),
    state: 'idle', // idle | syncing | error | auth | off
    timer: null, busy: false, again: false, tokenClient: null,

    /* ---------- konfigurasi ---------- */
    save() { lsSet(LS.cfg, this.cfg); this.paint(); },
    device() { let d = localStorage.getItem(LS.dev); if (!d) { d = (/Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'HP-' : 'PC-') + U.uid().slice(-5); localStorage.setItem(LS.dev, d); } return d; },
    ready() { return this.cfg.connected && this.cfg.clientId && Lock.enabled() && DB.key; },

    /* ---------- token Google ---------- */
    loadGIS() {
      if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
      if (this._gis) return this._gis;
      this._gis = new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
        s.onload = () => res(); s.onerror = () => { this._gis = null; rej(new Error('Tidak bisa memuat login Google (cek internet)')); };
        document.head.appendChild(s);
      });
      return this._gis;
    },
    token() { const t = lsGet(LS.tok, null); return t && t.exp > Date.now() + 60000 ? t.access : null; },
    async login(interactive) {
      await this.loadGIS();
      return new Promise((res, rej) => {
        const tc = google.accounts.oauth2.initTokenClient({
          client_id: this.cfg.clientId, scope: SCOPE,
          callback: (r) => { if (r.error) return rej(new Error(r.error_description || r.error)); lsSet(LS.tok, { access: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 }); res(r.access_token); },
          error_callback: (e) => rej(new Error(e.type === 'popup_closed' ? 'Jendela login ditutup' : e.type === 'popup_failed_to_open' ? 'Popup login diblokir browser — klik tombol Sinkron' : (e.message || e.type))),
        });
        tc.requestAccessToken({ prompt: interactive ? (this.cfg.email ? '' : 'consent') : '', login_hint: this.cfg.email || undefined });
      });
    },
    async api(path, { method = 'GET', body, headers = {}, base = API, raw = false } = {}) {
      const tok = this.token(); if (!tok) { const e = new Error('Perlu login Google'); e.auth = true; throw e; }
      const r = await fetch(base + path, { method, body, headers: { Authorization: 'Bearer ' + tok, ...headers } });
      if (r.status === 401) { localStorage.removeItem(LS.tok); const e = new Error('Sesi Google berakhir'); e.auth = true; throw e; }
      if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 160)}`);
      if (raw) return r;
      return r.status === 204 ? null : r.json();
    },
    async listFiles() {
      let out = [], page = '';
      do {
        const j = await this.api(`/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,modifiedTime,size)${page ? '&pageToken=' + page : ''}`);
        out = out.concat(j.files || []); page = j.nextPageToken || '';
      } while (page);
      return out;
    },
    async upload(name, blob, existingId) {
      if (existingId) return this.api(`/files/${existingId}?uploadType=media`, { base: UP, method: 'PATCH', body: blob });
      const b = 'edcc' + U.uid();
      const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`, blob, `\r\n--${b}--`]);
      return this.api('/files?uploadType=multipart&fields=id,name', { base: UP, method: 'POST', body, headers: { 'Content-Type': 'multipart/related; boundary=' + b } });
    },

    /* ---------- tombstone ---------- */
    tombs() { return lsGet(LS.tombs, {}); },
    onChange(store, id, deleted) {
      if (store === DB.META) {
        if (deleted && Sync.cfg.connected) { Sync.cfg.connected = false; Sync.save(); U.toast('Sinkron Google Drive diputus karena enkripsi dimatikan', 'warn', 5000); }
        else if (Sync.cfg.connected) Sync.schedule();
        return;
      }
      if (store !== 'files' && !syncable(store, id)) return;
      const t = Sync.tombs(); const k = store + '|' + id;
      if (deleted) t[k] = Date.now(); else delete t[k];
      lsSet(LS.tombs, t);
      if (Sync.cfg.connected) Sync.schedule();
    },
    schedule(ms = PUSH_DELAY) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); this.state = this.state === 'syncing' ? 'syncing' : 'pending'; this.paint(); },

    /* ---------- dokumen lokal ---------- */
    async localDoc() {
      const records = {};
      for (const s of DB.STORES) {
        if (s === 'files') continue;
        const rows = await DB.all(s);
        records[s] = {};
        for (const r of rows) { const id = recKey(s, r); if (syncable(s, id)) records[s][id] = r; }
      }
      return { records, tombs: this.tombs() };
    },

    /* ---------- kunci: perangkat baru / beda kunci ---------- */
    async adoptRemoteKey(remoteMeta) {
      const meta = DB.unb64obj(remoteMeta);
      const local = await DB.lockMeta();
      if (local && b64eq(local.wrapPw, meta.wrapPw) && b64eq(local.wrapRc, meta.wrapRc)) return true; // sama persis
      const same = local && DB.key && (await this.sameKeyAs(meta));
      if (same) { // kunci data sama, hanya password berbeda versi → ambil yang terbaru
        if ((meta.changedAt || 0) > (local.changedAt || 0)) { await DB.setLockMeta({ ...meta, autoLock: local.autoLock }, { silent: true }); Lock.meta = await DB.lockMeta(); }
        return true;
      }
      const res = await Lock.unlockBackup({ lock: remoteMeta }); // minta password perangkat lain
      if (!res) return false;
      await DB.reseal(DB.key || null, res.dek); // enkripsi ulang data lokal dengan kunci yang sama dgn perangkat lain
      await DB.setLockMeta({ ...meta, autoLock: (local && local.autoLock) ?? meta.autoLock }, { silent: true });
      Lock.meta = await DB.lockMeta(); Lock.paintSidebar(); Lock.watchIdle();
      U.toast('Perangkat ini sekarang memakai password dashboard yang sama', 'good', 4500);
      return true;
    },
    async sameKeyAs(meta) {
      try {
        if (!meta.probe || !DB.key) return false;
        const p = DB.unb64(meta.probe.b64 || meta.probe);
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: p.slice(0, 12) }, DB.key, p.slice(12));
        return true; // kunci lokal bisa membuka probe → kunci data sama
      } catch { return false; }
    },

    /* ---------- siklus sinkron ---------- */
    async run(interactive = false) {
      if (!this.cfg.connected) return;
      if (Lock.enabled() && !DB.key) return; // layar kunci aktif
      if (!Lock.enabled() && !interactive) { this.state = 'off'; this.cfg.lastError = 'Kunci Data belum aktif'; this.paint(); return; }
      if (this.busy) { this.again = true; return; }
      if (document.querySelector('.modal-back, #lockscreen') && !interactive) { this.schedule(15000); return; } // jangan ganggu saat mengetik
      this.busy = true; this.state = 'syncing'; this.paint();
      try {
        if (!this.token()) {
          if (!interactive) { this.state = 'auth'; this.busy = false; this.paint(); return; }
          await this.login(true);
        }
        if (!this.cfg.email) { try { const a = await this.api('/about?fields=user(emailAddress)'); this.cfg.email = a.user.emailAddress; } catch {} }
        const files = await this.listFiles();
        const dataFile = files.find((f) => f.name === DATA_NAME);
        let remote = null;
        if (!dataFile && !Lock.enabled()) throw new Error('Belum ada data di Drive. Aktifkan Kunci Data di perangkat utama lalu sinkron dari sana dulu.');
        if (dataFile) {
          const env = await (await this.api(`/files/${dataFile.id}?alt=media`, { raw: true })).json();
          if (!(await this.adoptRemoteKey(env.meta))) throw new Error('Password dibatalkan — sinkron dihentikan');
          remote = await DB.C.decJSON(DB.key, DB.unb64(env.iv), DB.unb64(env.c));
        }
        const force = localStorage.getItem(LS.force) === '1';
        const local = await this.localDoc();
        const { merged, toLocal, delLocal, changedRemote } = merge(local, force ? null : remote);
        // terapkan ke lokal
        let touched = 0;
        for (const [s, rows] of Object.entries(toLocal)) if (rows.length) { await DB.putMany(s, rows, { keepTime: true, silent: true }); touched += rows.length; }
        for (const [s, ids] of Object.entries(delLocal)) for (const id of ids) { await DB.del(s, id, { silent: true }); touched++; }
        lsSet(LS.tombs, merged.tombs);
        // file lampiran
        const remoteBins = Object.fromEntries(files.filter((f) => /^f_.*\.bin$/.test(f.name)).map((f) => [f.name.slice(0, -4), f]));
        const localFiles = (await DB.rawAll('files')).filter((r) => r.e);
        const localIds = new Set(localFiles.map((r) => r.id));
        let up = 0, down = 0;
        for (const r of localFiles) if (!remoteBins[r.id] && !merged.tombs['files|' + r.id]) { await this.upload(r.id + '.bin', packBin(r)); up++; }
        for (const [id, f] of Object.entries(remoteBins)) {
          if (merged.tombs['files|' + id] || (force && !localIds.has(id))) { await this.api(`/files/${f.id}`, { method: 'DELETE' }).catch(() => {}); continue; }
          if (!localIds.has(id)) { const buf = new Uint8Array(await (await this.api(`/files/${f.id}?alt=media`, { raw: true })).arrayBuffer()); await DB.rawPutMany('files', [unpackBin(buf)]); down++; }
        }
        for (const k of Object.keys(merged.tombs)) if (k.startsWith('files|')) { const id = k.slice(6); if (localIds.has(id)) { await DB.del('files', id, { silent: true }); touched++; } }
        // unggah dokumen gabungan bila berubah
        if (changedRemote || force || !dataFile) {
          const meta = await DB.lockMeta(); const { id, ...lock } = meta;
          if (!lock.probe) { const iv = crypto.getRandomValues(new Uint8Array(12)); const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, DB.key, new Uint8Array(4))); lock.probe = { b64: DB.b64(cat(iv, c)) }; await DB.setLockMeta({ ...meta, probe: lock.probe }, { silent: true }); }
          const enc = await DB.C.encJSON(DB.key, merged);
          const env = { v: 1, app: 'edcc', savedAt: Date.now(), device: this.device(), meta: b64obj(lock), iv: DB.b64(enc.iv), c: DB.b64(enc.c) };
          await this.upload(DATA_NAME, new Blob([JSON.stringify(env)], { type: 'application/json' }), dataFile && dataFile.id);
        }
        localStorage.removeItem(LS.force);
        this.cfg.lastSync = Date.now(); this.cfg.lastError = ''; this.state = 'idle'; this.save();
        if (touched || down) { await App.reloadData(); U.toast(`Sinkron: ${touched + down} perubahan dari perangkat lain diterapkan`, 'good', 3500); }
        else if (interactive) U.toast(`Sinkron selesai${up ? ` · ${up} file diunggah` : ''}`, 'good', 2500);
      } catch (e) {
        console.warn('sync', e);
        this.state = e.auth ? 'auth' : 'error'; this.cfg.lastError = e.message; this.save();
        if (interactive) U.toast('Sinkron gagal: ' + e.message, 'bad', 5000);
      } finally {
        this.busy = false; this.paint();
        if (this.again) { this.again = false; this.schedule(2000); }
      }
    },

    /* ---------- UI ---------- */
    init() {
      DB.onChange = (s, id, d) => this.onChange(s, id, d);
      const foot = document.querySelector('.sb-foot');
      const box = document.createElement('div'); box.id = 'sbSync';
      foot.insertBefore(box, document.getElementById('sbLock') || document.getElementById('sbBackup'));
      box.addEventListener('click', () => (this.cfg.connected && this.state === 'auth' ? this.run(true) : this.settings()));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.ready() && Date.now() - this.cfg.lastSync > 60000) this.run(); });
      setInterval(() => { if (document.visibilityState === 'visible' && this.ready()) this.run(); }, 5 * 60000);
      setInterval(() => this.paint(), 30000);
      this.paint();
    },
    afterBoot() { if (this.cfg.connected) { this.loadGIS().catch(() => {}); this.run(); } },
    paint() {
      const el = document.getElementById('sbSync'); if (!el) return;
      const c = this.cfg;
      let ic = 'cloud', txt, cls = '';
      if (!c.connected) { txt = 'Sinkron HP & laptop'; cls = 'muted'; }
      else if (!Lock.enabled()) { txt = 'Sinkron: aktifkan kunci data'; cls = 'warn'; }
      else if (this.state === 'syncing') { ic = 'refresh'; txt = 'Menyinkron…'; }
      else if (this.state === 'auth') { ic = 'user'; txt = 'Klik untuk sinkron (login Google)'; cls = 'warn'; }
      else if (this.state === 'error') { txt = 'Sinkron gagal — klik'; cls = 'bad'; }
      else if (this.state === 'pending') { txt = 'Menunggu sinkron…'; }
      else txt = c.lastSync ? `Tersinkron ${U.timeAgo(c.lastSync)}` : 'Belum sinkron';
      el.innerHTML = `<div class="sb-alarm sb-sync ${cls}" title="${U.esc(c.lastError || (c.email ? 'Google Drive · ' + c.email : 'Sinkron Google Drive'))}">${icon(ic, 15, this.state === 'syncing' ? 'spin' : '')}<span class="t">${U.esc(txt)}</span></div>`;
    },

    settings() {
      const c = this.cfg; const origin = location.origin;
      const lockOff = !Lock.enabled();
      const steps = `<ol class="setup-steps">
          <li>Buka <b>console.cloud.google.com</b> → buat project baru (mis. <i>Command Center</i>).</li>
          <li><b>APIs &amp; Services → Library</b> → cari <b>Google Drive API</b> → <b>Enable</b>.</li>
          <li><b>Google Auth Platform</b> (OAuth consent screen) → <b>Get started</b>: nama app, email Anda, Audience <b>External</b> → selesai. Di <b>Audience → Test users</b> tambahkan email Google Anda.</li>
          <li><b>Data access → Add or remove scopes</b> → centang <code>.../auth/drive.appdata</code> → Save.</li>
          <li><b>Clients → Create client</b> → tipe <b>Web application</b> → <b>Authorized JavaScript origins</b>: <code>${U.esc(origin)}</code> → Create.</li>
          <li>Salin <b>Client ID</b> (berakhiran <code>.apps.googleusercontent.com</code>) dan tempel di bawah.</li></ol>`;
      U.modal({
        title: 'Sinkron Google Drive', icon: 'cloud', size: 'lg', sticky: true,
        body: `<div class="callout">${icon('shield', 15)}<div>Data dashboard disalin ke folder aplikasi tersembunyi di <b>Google Drive Anda sendiri</b>, <b>terenkripsi</b> dengan kunci data dashboard — Google tidak bisa membacanya.
            Buka <b>${U.esc(location.host)}</b> di HP, login Google yang sama, masukkan password dashboard → data sama.</div></div>
          ${lockOff ? `<div class="callout" style="background:var(--warn-soft)">${icon('lock', 15)}<div><b>Perangkat utama:</b> aktifkan Kunci Data dulu, karena sinkron hanya berjalan bila data terenkripsi. <button class="btn sm" data-sy="lock" style="margin-left:6px">Aktifkan sekarang</button><br>
              <b>Perangkat kedua (HP):</b> langsung klik <i>Hubungkan</i> lalu masukkan password dashboard dari perangkat utama.</div></div>` : ''}
          ${c.connected ? `<div class="sum-row" style="margin:0"><div class="card sum"><div class="l">Akun Google</div><div class="v" style="font-size:15px">${U.esc(c.email || '—')}</div><div class="s">perangkat ${U.esc(this.device())}</div></div>
              <div class="card sum"><div class="l">Sinkron terakhir</div><div class="v" style="font-size:15px">${c.lastSync ? U.fmtDateTime(c.lastSync) : 'belum'}</div><div class="s" style="color:var(--bad)">${U.esc(c.lastError || '')}</div></div></div>` : ''}
          <div class="field"><label>Google OAuth Client ID</label><input class="input mono" id="syCid" value="${U.esc(c.clientId)}" placeholder="1234567890-abc...apps.googleusercontent.com"/>
            <span class="hint">Dibuat sekali saja (gratis). Client ID bukan rahasia; sama untuk HP & laptop.</span></div>
          <details ${c.clientId ? '' : 'open'}><summary style="cursor:pointer;font-weight:600;font-size:13px">Cara membuat Client ID (±10 menit)</summary>${steps}</details>`,
        buttons: [
          ...(c.connected ? [{ label: 'Putuskan', cls: 'danger', onClick: () => { this.cfg.connected = false; this.cfg.email = ''; localStorage.removeItem(LS.tok); this.state = 'idle'; this.save(); U.toast('Sinkron diputus di perangkat ini (data lokal & Drive tetap ada)', 'info', 4000); } }] : []),
          { label: 'Tutup', cls: 'ghost' },
          {
            label: c.connected ? 'Sinkron sekarang' : 'Hubungkan Google Drive', cls: 'primary', icon: 'cloud',
            onClick: async (ctx) => {
              const cid = U.$('#syCid', ctx.el).value.trim();
              if (!/\.apps\.googleusercontent\.com$/.test(cid)) { U.toast('Client ID tidak valid', 'warn'); return false; }
              this.cfg.clientId = cid; this.save();
              try { if (!this.token()) await this.login(true); } catch (e) { U.toast('Login Google gagal: ' + e.message, 'bad', 6000); return false; }
              this.cfg.connected = true; this.save();
              ctx.close(); await this.run(true);
            },
          },
        ],
        onMount: (el, ctx) => { this.loadGIS().catch(() => {}); el.addEventListener('click', (e) => { if (e.target.closest('[data-sy="lock"]')) { ctx.close(); Lock.settings(); } }); },
      });
    },
  };

  /* ---------- penggabungan ---------- */
  function merge(local, remote) {
    const tombs = { ...(remote ? remote.tombs : {}) };
    for (const [k, t] of Object.entries(local.tombs)) if (!tombs[k] || t > tombs[k]) tombs[k] = t;
    const out = { records: {}, tombs };
    const toLocal = {}, delLocal = {};
    let changedRemote = !remote;
    const stores = new Set([...Object.keys(local.records), ...Object.keys(remote ? remote.records : {})]);
    for (const s of stores) {
      const L = local.records[s] || {}, R = (remote && remote.records[s]) || {};
      out.records[s] = {}; toLocal[s] = []; delLocal[s] = [];
      for (const id of new Set([...Object.keys(L), ...Object.keys(R)])) {
        const l = L[id], r = R[id], tomb = tombs[s + '|' + id] || 0;
        let win = l && r ? ((r.updatedAt || 0) > (l.updatedAt || 0) ? r : l) : (l || r);
        if (tomb && tomb >= (win.updatedAt || 0)) { if (l) delLocal[s].push(id); if (r) changedRemote = true; continue; }
        if (tomb) delete tombs[s + '|' + id]; // dibuat ulang setelah dihapus
        out.records[s][id] = win;
        if (win !== l) toLocal[s].push(win);
        if (win !== r) changedRemote = true;
      }
    }
    // pangkas tombstone > 90 hari
    const cut = Date.now() - 90 * 864e5; for (const [k, t] of Object.entries(tombs)) if (t < cut) delete tombs[k];
    if (remote && JSON.stringify(Object.keys(remote.tombs).sort()) !== JSON.stringify(Object.keys(tombs).sort())) changedRemote = true;
    return { merged: out, toLocal, delLocal, changedRemote };
  }

  /* ---------- util biner ---------- */
  function cat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  function b64eq(a, b) { if (!a || !b) return false; const x = a instanceof Uint8Array ? a : DB.unb64(a.b64 || a); const y = b instanceof Uint8Array ? b : DB.unb64(b.b64 || b); return x.length === y.length && x.every((v, i) => v === y[i]); }
  function b64obj(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v instanceof Uint8Array ? { b64: DB.b64(v) } : v])); }
  function packBin(r) { const head = new TextEncoder().encode(JSON.stringify({ id: r.id, iv: DB.b64(r.iv), c: DB.b64(r.c), iv2: DB.b64(r.iv2) }) + '\n'); return new Blob([head, r.b], { type: 'application/octet-stream' }); }
  function unpackBin(u8) { const nl = u8.indexOf(10); const h = JSON.parse(new TextDecoder().decode(u8.subarray(0, nl))); return { id: h.id, e: 1, iv: DB.unb64(h.iv), c: DB.unb64(h.c), iv2: DB.unb64(h.iv2), b: u8.slice(nl + 1) }; }

  Sync.merge = merge;
  window.Sync = Sync;
  Sync.init();
})();
