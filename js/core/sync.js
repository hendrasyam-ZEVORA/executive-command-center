/* Sinkron via GitHub (repo PRIVAT milik pengguna) — data sama di laptop & HP, terenkripsi ujung-ke-ujung.
   - Gratis, tanpa kartu kredit. Pengguna membuat 1 repo privat (mis. edcc-data) + 1 fine-grained token
     yang HANYA boleh mengakses repo itu (Contents: Read and write).
   - Isi dienkripsi dengan kunci data Kunci Data (AES-256-GCM) SEBELUM diunggah → GitHub tidak bisa membaca.
     Karena itu Sinkron mensyaratkan Kunci Data aktif. Perangkat baru membuka data dengan password yang sama.
   - File di repo:
       edcc-data.json      → { v, meta (kunci terbungkus, aman), savedAt, device, iv, c }  (c = semua record + tombstone)
       files/<id>.bin      → satu lampiran/gambar (record terenkripsi apa adanya)
   - Setiap sinkron menulis 1 commit tanpa induk (riwayat diganti) → ukuran repo tidak membengkak.
   - Penggabungan per record: updatedAt terbaru menang; hapusan dicatat sebagai tombstone. */
(function () {
  const GH = 'https://api.github.com';
  const DATA_NAME = 'edcc-data.json';
  const LS = { cfg: 'edcc-sync', tombs: 'edcc-tombs', force: 'edcc-sync-force', dev: 'edcc-device' };
  const SKIP_KV = new Set(['salesHandles']);
  const PUSH_DELAY = 15000;

  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const recKey = (store, r) => (store === 'kv' ? r.key : r.id);
  const syncable = (store, id) => store !== 'files' && !(store === 'kv' && (SKIP_KV.has(id) || String(id).startsWith('_')));

  const Sync = {
    cfg: Object.assign({ provider: 'github', repo: '', token: '', branch: '', connected: false, login: '', lastSync: 0, lastError: '' }, lsGet(LS.cfg, {})),
    state: 'idle', // idle | pending | syncing | error | auth | off
    timer: null, busy: false, again: false,

    /* ---------- konfigurasi ---------- */
    save() { lsSet(LS.cfg, this.cfg); this.paint(); },
    device() { let d = localStorage.getItem(LS.dev); if (!d) { d = (/Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'HP-' : 'PC-') + U.uid().slice(-5); localStorage.setItem(LS.dev, d); } return d; },
    ready() { return this.cfg.connected && this.cfg.provider === 'github' && this.cfg.token && Lock.enabled() && DB.key; },

    /* ---------- GitHub API ---------- */
    async gh(path, { method = 'GET', body, accept = 'application/vnd.github+json', raw = false, ok404 = false } = {}) {
      const c = this.cfg;
      const url = path.startsWith('/repos/') || path.startsWith('/user') ? GH + path : `${GH}/repos/${c.repo}${path}`;
      let r;
      try {
        r = await fetch(url, { method, cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
          headers: { Authorization: 'Bearer ' + c.token, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) } });
      } catch { throw new Error('Tidak bisa menghubungi GitHub (cek internet)'); }
      if (r.status === 401) { const e = new Error('Token GitHub tidak valid / kedaluwarsa — buat token baru'); e.auth = true; throw e; }
      if (r.status === 403 || r.status === 404) {
        if (ok404 && r.status === 404) return null;
        const t = await r.text();
        if (/rate limit/i.test(t)) throw new Error('Batas pemakaian GitHub tercapai, coba lagi beberapa menit lagi');
        const e = new Error(r.status === 404 ? `Repo "${c.repo}" tidak ditemukan / token tidak punya akses ke repo itu` : 'Token tidak punya izin "Contents: Read and write" pada repo ini'); e.auth = true; throw e;
      }
      if (r.status === 409 && ok404) return null; // repo kosong
      if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 160)}`);
      if (raw) return r;
      return r.status === 204 ? null : r.json();
    },
    async repoInfo() {
      const j = await this.gh('');
      if (!j.private) throw new Error(`Repo "${this.cfg.repo}" PUBLIK — ubah jadi Private dulu (Settings → Danger Zone)`);
      if (j.permissions && !j.permissions.push) { const e = new Error('Token hanya bisa membaca — ubah izin Contents menjadi "Read and write"'); e.auth = true; throw e; }
      this.cfg.branch = j.default_branch || 'main';
      if (j.owner && !this.cfg.login) this.cfg.login = j.owner.login;
      return j;
    },
    async head() { // → { commit, tree, files: {path: {sha,size}} } atau null bila repo kosong
      const ref = await this.gh(`/git/ref/heads/${this.cfg.branch}`, { ok404: true });
      if (!ref) return null;
      const commit = ref.object.sha;
      const cm = await this.gh(`/git/commits/${commit}`);
      const t = await this.gh(`/git/trees/${cm.tree.sha}?recursive=1`);
      const files = {}; for (const e of t.tree) if (e.type === 'blob') files[e.path] = { sha: e.sha, size: e.size };
      return { commit, tree: cm.tree.sha, files };
    },
    async blob(sha) { return new Uint8Array(await (await this.gh(`/git/blobs/${sha}`, { accept: 'application/vnd.github.raw+json', raw: true })).arrayBuffer()); },
    async bootstrap() { // repo baru tanpa commit → buat README lewat Contents API
      const txt = '# Data sinkron Executive Daily Command Center\n\nIsi repo ini terenkripsi. Jangan diedit manual dan jangan dijadikan publik.\n';
      await this.gh('/contents/README.md', { method: 'PUT', body: { message: 'init', content: DB.b64(new TextEncoder().encode(txt)) } });
    },
    async commit(base, writes, deletes, msg) { // writes: {path: Uint8Array}, deletes: [path]
      const entries = [];
      for (const [path, u8] of Object.entries(writes)) {
        const b = await this.gh('/git/blobs', { method: 'POST', body: { content: DB.b64(u8), encoding: 'base64' } });
        entries.push({ path, mode: '100644', type: 'blob', sha: b.sha });
      }
      for (const path of deletes) entries.push({ path, mode: '100644', type: 'blob', sha: null });
      const tree = await this.gh('/git/trees', { method: 'POST', body: { base_tree: base.tree, tree: entries } });
      const c = await this.gh('/git/commits', { method: 'POST', body: { message: msg, tree: tree.sha, parents: [] } });
      const now = await this.gh(`/git/ref/heads/${this.cfg.branch}`);
      if (now.object.sha !== base.commit) { const e = new Error('Perangkat lain baru saja sinkron — mengulang'); e.retry = true; throw e; }
      await this.gh(`/git/refs/heads/${this.cfg.branch}`, { method: 'PATCH', body: { sha: c.sha, force: true } });
    },

    /* ---------- tombstone ---------- */
    tombs() { return lsGet(LS.tombs, {}); },
    onChange(store, id, deleted) {
      if (store === DB.META) {
        if (deleted && Sync.cfg.connected) { Sync.cfg.connected = false; Sync.save(); U.toast('Sinkron diputus karena enkripsi dimatikan', 'warn', 5000); }
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
    async run(interactive = false, tries = 0) {
      if (!this.cfg.connected || !this.cfg.token) return;
      if (Lock.enabled() && !DB.key) return; // layar kunci aktif
      if (this.busy) { this.again = true; return; }
      if (document.querySelector('.modal-back, #lockscreen') && !interactive) { this.schedule(15000); return; } // jangan ganggu saat mengetik
      this.busy = true; this.state = 'syncing'; this.paint();
      let retry = false;
      try {
        if (!this.cfg.branch) await this.repoInfo();
        let base = await this.head();
        if (!base) { if (!Lock.enabled()) throw new Error('Repo masih kosong. Aktifkan Kunci Data di perangkat utama lalu sinkron dari sana dulu.'); await this.bootstrap(); base = await this.head(); }
        const dataFile = base.files[DATA_NAME];
        let remote = null;
        if (!dataFile && !Lock.enabled()) throw new Error('Belum ada data di repo. Aktifkan Kunci Data di perangkat utama lalu sinkron dari sana dulu.');
        if (dataFile) {
          const env = JSON.parse(new TextDecoder().decode(await this.blob(dataFile.sha)));
          if (!(await this.adoptRemoteKey(env.meta))) throw new Error('Password dibatalkan — sinkron dihentikan');
          remote = await DB.C.decJSON(DB.key, DB.unb64(env.iv), DB.unb64(env.c));
        }
        const force = localStorage.getItem(LS.force) === '1';
        const local = await this.localDoc();
        const { merged, toLocal, delLocal, changedRemote } = merge(local, force ? null : remote);
        let touched = 0;
        for (const [s, rows] of Object.entries(toLocal)) if (rows.length) { await DB.putMany(s, rows, { keepTime: true, silent: true }); touched += rows.length; }
        for (const [s, ids] of Object.entries(delLocal)) for (const id of ids) { await DB.del(s, id, { silent: true }); touched++; }
        lsSet(LS.tombs, merged.tombs);
        // lampiran
        const writes = {}, deletes = [];
        const remoteBins = {}; for (const [p, f] of Object.entries(base.files)) { const m = /^files\/(.+)\.bin$/.exec(p); if (m) remoteBins[m[1]] = { ...f, path: p }; }
        const localFiles = (await DB.rawAll('files')).filter((r) => r.e);
        const localIds = new Set(localFiles.map((r) => r.id));
        let up = 0, down = 0;
        for (const r of localFiles) if (!remoteBins[r.id] && !merged.tombs['files|' + r.id]) { writes[`files/${r.id}.bin`] = packBin(r); up++; }
        for (const [id, f] of Object.entries(remoteBins)) {
          if (merged.tombs['files|' + id] || (force && !localIds.has(id))) { deletes.push(f.path); continue; }
          if (!localIds.has(id)) { await DB.rawPutMany('files', [unpackBin(await this.blob(f.sha))]); down++; }
        }
        for (const k of Object.keys(merged.tombs)) if (k.startsWith('files|')) { const id = k.slice(6); if (localIds.has(id)) { await DB.del('files', id, { silent: true }); touched++; } }
        // dokumen gabungan
        if (changedRemote || force || !dataFile) {
          const meta = await DB.lockMeta(); const { id, ...lock } = meta;
          if (!lock.probe) { const iv = crypto.getRandomValues(new Uint8Array(12)); const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, DB.key, new Uint8Array(4))); lock.probe = { b64: DB.b64(cat(iv, c)) }; await DB.setLockMeta({ ...meta, probe: lock.probe }, { silent: true }); }
          const enc = await DB.C.encJSON(DB.key, merged);
          const env = { v: 1, app: 'edcc', savedAt: Date.now(), device: this.device(), meta: b64obj(lock), iv: DB.b64(enc.iv), c: DB.b64(enc.c) };
          writes[DATA_NAME] = new TextEncoder().encode(JSON.stringify(env));
        }
        if (Object.keys(writes).length || deletes.length) await this.commit(base, writes, deletes, `sync ${this.device()} ${new Date().toISOString()}`);
        localStorage.removeItem(LS.force);
        this.cfg.lastSync = Date.now(); this.cfg.lastError = ''; this.state = 'idle'; this.save();
        if (touched || down) { await App.reloadData(); U.toast(`Sinkron: ${touched + down} perubahan dari perangkat lain diterapkan`, 'good', 3500); }
        else if (interactive) U.toast(`Sinkron selesai${up ? ` · ${up} file diunggah` : ''}`, 'good', 2500);
      } catch (e) {
        if (e.retry && tries < 3) retry = true;
        else {
          console.warn('sync', e);
          this.state = e.auth ? 'auth' : 'error'; this.cfg.lastError = e.message; this.save();
          if (interactive) U.toast('Sinkron gagal: ' + e.message, 'bad', 6000);
        }
      } finally {
        this.busy = false; this.paint();
        if (retry) setTimeout(() => this.run(interactive, tries + 1), 1500 + Math.random() * 2000);
        else if (this.again) { this.again = false; this.schedule(2000); }
      }
    },

    /* ---------- UI ---------- */
    init() {
      if (this.cfg.provider !== 'github') { this.cfg = { provider: 'github', repo: '', token: '', branch: '', connected: false, login: '', lastSync: 0, lastError: '' }; lsSet(LS.cfg, this.cfg); localStorage.removeItem('edcc-gtoken'); }
      DB.onChange = (s, id, d) => this.onChange(s, id, d);
      const foot = document.querySelector('.sb-foot');
      const box = document.createElement('div'); box.id = 'sbSync';
      foot.insertBefore(box, document.getElementById('sbLock') || document.getElementById('sbBackup'));
      box.addEventListener('click', () => (this.cfg.connected && this.state === 'error' && !/token|izin|akses|repo/i.test(this.cfg.lastError) ? this.run(true) : this.settings()));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.ready() && Date.now() - this.cfg.lastSync > 60000) this.run(); });
      setInterval(() => { if (document.visibilityState === 'visible' && this.ready()) this.run(); }, 5 * 60000);
      setInterval(() => this.paint(), 30000);
      this.paint();
    },
    afterBoot() { if (this.cfg.connected) this.run(); },
    paint() {
      const el = document.getElementById('sbSync'); if (!el) return;
      const c = this.cfg;
      let ic = 'cloud', txt, cls = '';
      if (!c.connected) { txt = 'Sinkron HP & laptop'; cls = 'muted'; }
      else if (!Lock.enabled()) { txt = 'Sinkron: aktifkan kunci data'; cls = 'warn'; }
      else if (this.state === 'syncing') { ic = 'refresh'; txt = 'Menyinkron…'; }
      else if (this.state === 'auth') { ic = 'key'; txt = 'Sinkron: periksa token'; cls = 'warn'; }
      else if (this.state === 'error') { txt = 'Sinkron gagal — klik'; cls = 'bad'; }
      else if (this.state === 'pending') { txt = 'Menunggu sinkron…'; }
      else txt = c.lastSync ? `Tersinkron ${U.timeAgo(c.lastSync)}` : 'Belum sinkron';
      el.innerHTML = `<div class="sb-alarm sb-sync ${cls}" title="${U.esc(c.lastError || (c.repo ? 'GitHub · ' + c.repo : 'Sinkron HP & laptop'))}">${icon(ic, 15, this.state === 'syncing' ? 'spin' : '')}<span class="t">${U.esc(txt)}</span></div>`;
    },

    settings() {
      const c = this.cfg;
      const lockOff = !Lock.enabled();
      const steps = `<ol class="setup-steps">
          <li>Di <b>github.com</b> klik <b>+ → New repository</b>. Nama: <code>edcc-data</code>, pilih <b>Private</b> → <b>Create repository</b>.</li>
          <li>Buka <b>Settings (foto profil) → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
          <li>Token name: <i>Command Center</i>. Expiration: pilih yang terlama / <b>No expiration</b> bila tersedia.</li>
          <li><b>Repository access → Only select repositories</b> → pilih <code>edcc-data</code> saja.</li>
          <li><b>Permissions → Repository permissions → Contents</b> → <b>Read and write</b>. (Metadata otomatis Read-only.)</li>
          <li><b>Generate token</b> → salin token (<code>github_pat_…</code>) dan tempel di bawah. Token hanya tampil sekali.</li></ol>`;
      U.modal({
        title: 'Sinkron HP & laptop (GitHub)', icon: 'cloud', size: 'lg', sticky: true,
        body: `<div class="callout">${icon('shield', 15)}<div>Data dashboard disalin ke <b>repo GitHub privat milik Anda</b>, <b>terenkripsi</b> dengan kunci data dashboard — GitHub pun tidak bisa membacanya. Gratis, tanpa kartu kredit.
            Di HP: buka <b>${U.esc(location.host)}</b>, isi repo + token yang sama, masukkan password dashboard → data sama.</div></div>
          ${lockOff ? `<div class="callout" style="background:var(--warn-soft)">${icon('lock', 15)}<div><b>Perangkat utama (laptop):</b> aktifkan Kunci Data dulu, karena sinkron hanya berjalan bila data terenkripsi. <button class="btn sm" data-sy="lock" style="margin-left:6px">Aktifkan sekarang</button><br>
              <b>Perangkat kedua (HP):</b> langsung klik <i>Hubungkan</i> lalu masukkan password dashboard dari laptop.</div></div>` : ''}
          ${c.connected ? `<div class="sum-row" style="margin:0"><div class="card sum"><div class="l">Repo</div><div class="v" style="font-size:15px">${U.esc(c.repo)}</div><div class="s">perangkat ${U.esc(this.device())}</div></div>
              <div class="card sum"><div class="l">Sinkron terakhir</div><div class="v" style="font-size:15px">${c.lastSync ? U.fmtDateTime(c.lastSync) : 'belum'}</div><div class="s" style="color:var(--bad)">${U.esc(c.lastError || '')}</div></div></div>` : ''}
          <div class="field"><label>Repo privat (pemilik/nama)</label><input class="input mono" id="syRepo" value="${U.esc(c.repo || 'hendrasyam-ZEVORA/edcc-data')}" placeholder="username/edcc-data" autocapitalize="off" autocorrect="off" spellcheck="false"/></div>
          <div class="field"><label>Fine-grained token</label><input class="input mono" id="syTok" type="password" value="${U.esc(c.token)}" placeholder="github_pat_…" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off"/>
            <span class="hint">Token hanya bisa mengakses repo data itu & isinya terenkripsi. Disimpan di browser ini saja. Untuk HP: kirim ke diri sendiri (mis. WA "Message yourself") lalu hapus pesannya.</span></div>
          <details ${c.token ? '' : 'open'}><summary style="cursor:pointer;font-weight:600;font-size:13px">Cara membuat repo & token (±3 menit)</summary>${steps}</details>`,
        buttons: [
          ...(c.connected ? [{ label: 'Putuskan', cls: 'danger', onClick: () => { Object.assign(this.cfg, { connected: false, token: '', branch: '', lastError: '' }); this.state = 'idle'; this.save(); U.toast('Sinkron diputus di perangkat ini (data lokal & repo tetap ada)', 'info', 4000); } }] : []),
          { label: 'Tutup', cls: 'ghost' },
          {
            label: c.connected ? 'Simpan & sinkron' : 'Hubungkan', cls: 'primary', icon: 'cloud',
            onClick: async (ctx) => {
              const repo = U.$('#syRepo', ctx.el).value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
              const tok = U.$('#syTok', ctx.el).value.trim();
              if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { U.toast('Isi repo dengan format pemilik/nama', 'warn'); return false; }
              if (!/^(github_pat_|ghp_)\w+$/.test(tok)) { U.toast('Token tidak valid (harus diawali github_pat_)', 'warn'); return false; }
              const prev = { ...this.cfg };
              Object.assign(this.cfg, { repo, token: tok, branch: '' });
              try { await this.repoInfo(); } catch (e) { Object.assign(this.cfg, prev); U.toast(e.message, 'bad', 7000); return false; }
              this.cfg.connected = true; this.cfg.lastError = ''; this.save();
              ctx.close(); await this.run(true);
            },
          },
        ],
        onMount: (el, ctx) => { el.addEventListener('click', (e) => { if (e.target.closest('[data-sy="lock"]')) { ctx.close(); Lock.settings(); } }); },
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
  function packBin(r) { const head = new TextEncoder().encode(JSON.stringify({ id: r.id, iv: DB.b64(r.iv), c: DB.b64(r.c), iv2: DB.b64(r.iv2) }) + '\n'); const b = r.b instanceof Uint8Array ? r.b : new Uint8Array(r.b); return cat(head, b); }
  function unpackBin(u8) { const nl = u8.indexOf(10); const h = JSON.parse(new TextDecoder().decode(u8.subarray(0, nl))); return { id: h.id, e: 1, iv: DB.unb64(h.iv), c: DB.unb64(h.c), iv2: DB.unb64(h.iv2), b: u8.slice(nl + 1) }; }

  Sync.merge = merge;
  window.Sync = Sync;
  Sync.init();
})();
