/* IndexedDB helper — penyimpanan permanen offline (teks, gambar, PDF sebagai Blob)
   + ENKRIPSI SAAT DISIMPAN (AES-256-GCM) bila Kunci Data diaktifkan (lihat js/core/lock.js).

   API (tidak berubah untuk modul):
     await DB.all('daily') / DB.get('daily', id) / DB.put('daily', obj) / DB.putMany / DB.del / DB.clear
     await DB.kv.get('key', default) / DB.kv.set('key', value)
     await DB.saveFile(File|Blob, name?) → id ; DB.fileURL(id) ; DB.fileMeta(id) ; DB.openFile(id)
     await DB.exportAll() / DB.importAll(json)  → Backup/Restore (terenkripsi bila kunci aktif)

   Format terenkripsi per record: { id|key, e:1, iv, c }  (c = AES-GCM(JSON record))
   File: { id, e:1, iv, c (meta JSON), iv2, b (isi file) }
   Kunci data (DEK) hanya ada di memori setelah password/kode pemulihan dimasukkan. */
(function () {
  const NAME = 'edcc';
  const VERSION = 2; // v2: tambah store 'lock'
  const STORES = [
    'daily', 'monthly', 'accounts', 'files', 'kv',
    'calendar', 'programs', 'promos', 'events', 'projects', 'gallery', 'contacts', 'shop',
  ];
  const META = 'lock'; // metadata kunci (salt, kunci terbungkus) — tidak terenkripsi, tidak berisi data
  const PLAIN_KV = new Set(['salesHandles']); // handle file tidak bisa diserialisasi → tidak dienkripsi (hanya referensi file)
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('Browser tidak mendukung IndexedDB'));
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' }); });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); location.reload(); }; res(db); };
      req.onerror = () => rej(req.error);
      req.onblocked = () => U.toast('Tutup tab lain dashboard ini agar pembaruan database bisa berjalan', 'warn', 6000);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      fn(t.objectStore(store));
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Transaksi dibatalkan (mungkin kuota penuh)'));
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rawAll = async (store) => { const db = await open(); return reqP(db.transaction(store).objectStore(store).getAll()); };
  const rawGet = async (store, id) => { const db = await open(); return reqP(db.transaction(store).objectStore(store).get(id)); };
  const rawPutMany = (store, arr) => tx(store, 'readwrite', (s) => arr.forEach((o) => s.put(o)));

  /* ---------- kripto ---------- */
  const te = new TextEncoder(), td = new TextDecoder();
  const replacer = (k, v) => (typeof v === 'number' && !isFinite(v) ? { __n: String(v) } : v);
  const reviver = (k, v) => (v && typeof v === 'object' && '__n' in v && Object.keys(v).length === 1 ? Number(v.__n) : v);
  const C = {
    async enc(key, bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv, c: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)) }; },
    async dec(key, iv, c) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, c)); },
    async encJSON(key, obj) { return C.enc(key, te.encode(JSON.stringify(obj, replacer))); },
    async decJSON(key, iv, c) { return JSON.parse(td.decode(await C.dec(key, iv, c)), reviver); },
  };

  async function seal(store, obj) {
    const key = DB.key;
    if (!key || (store === 'kv' && PLAIN_KV.has(obj.key))) return obj;
    if (store === 'files') {
      const { blob, ...meta } = obj;
      const m = await C.encJSON(key, meta);
      const b = await C.enc(key, new Uint8Array(await blob.arrayBuffer()));
      return { id: obj.id, e: 1, iv: m.iv, c: m.c, iv2: b.iv, b: b.c };
    }
    const r = await C.encJSON(key, obj);
    return store === 'kv' ? { key: obj.key, e: 1, iv: r.iv, c: r.c } : { id: obj.id, e: 1, iv: r.iv, c: r.c };
  }
  async function open_(store, rec, { metaOnly = false } = {}) {
    if (!rec || !rec.e) return rec;
    if (!DB.key) throw new Error('Data terkunci');
    const obj = await C.decJSON(DB.key, rec.iv, rec.c);
    if (store === 'files' && !metaOnly) obj.blob = new Blob([await C.dec(DB.key, rec.iv2, rec.b)], { type: obj.type });
    return obj;
  }

  /* Pemberitahuan perubahan → dipakai modul Sinkron (js/core/sync.js) */
  function changed(store, id, deleted = false) { try { DB.onChange && DB.onChange(store, id, deleted); } catch (e) { console.warn(e); } }

  const DB = {
    STORES, META, C, onChange: null, seal, open_,
    key: null, // CryptoKey (DEK) setelah dibuka
    open,
    rawAll, rawGet, rawPutMany,
    async all(store) { return Promise.all((await rawAll(store)).map((r) => open_(store, r))); },
    async get(store, id) { return open_(store, await rawGet(store, id)); },
    async put(store, obj, { silent = false } = {}) { if (!obj.id && store !== 'kv') obj.id = U.uid(); obj.updatedAt = Date.now(); const s = await seal(store, obj); await tx(store, 'readwrite', (os) => os.put(s)); if (!silent) changed(store, store === 'kv' ? obj.key : obj.id); return obj; },
    /* keepTime: pertahankan updatedAt (dipakai sinkron/restore); silent: tanpa memicu sinkron */
    async putMany(store, arr, { keepTime = false, silent = false } = {}) {
      const now = Date.now(); if (!keepTime) arr.forEach((o) => { o.updatedAt = now; });
      const sealed = await Promise.all(arr.map((o) => seal(store, o))); await rawPutMany(store, sealed);
      if (!silent) arr.forEach((o) => changed(store, store === 'kv' ? o.key : o.id));
    },
    async del(store, id, { silent = false } = {}) { await tx(store, 'readwrite', (s) => s.delete(id)); if (!silent) changed(store, id, true); },
    async clear(store) { await tx(store, 'readwrite', (s) => s.clear()); },

    kv: {
      async get(key, def = null) { const r = await DB.get('kv', key); return r ? r.value : def; },
      async set(key, value) { await DB.put('kv', { key, value }); },
      async del(key) { await tx('kv', 'readwrite', (s) => s.delete(key)); changed('kv', key, true); },
    },

    /* ---- metadata kunci ---- */
    async lockMeta() { return rawGet(META, 'main'); },
    async setLockMeta(m, { silent = false } = {}) { if (m) await tx(META, 'readwrite', (s) => s.put({ ...m, id: 'main' })); else await tx(META, 'readwrite', (s) => s.delete('main')); if (!silent) changed(META, 'main', !m); },
    /* Enkripsi ulang SEMUA data: oldKey → newKey (null = polos). Dipakai saat aktifkan / matikan kunci */
    async reseal(oldKey, newKey) {
      for (const s of STORES) {
        DB.key = oldKey; const plain = await DB.all(s);
        DB.key = newKey; const sealed = await Promise.all(plain.map((o) => seal(s, o)));
        await rawPutMany(s, sealed);
      }
      DB.key = newKey;
    },

    /* ---- File / gambar / PDF ---- */
    _urls: {},
    async saveFile(file, name) {
      const rec = { id: 'f_' + U.uid(), name: name || file.name || 'lampiran', type: file.type || 'application/octet-stream', size: file.size, blob: file, createdAt: Date.now() };
      const s = await seal('files', rec);
      await tx('files', 'readwrite', (os) => os.put(s));
      changed('files', rec.id);
      return rec.id;
    },
    async fileMeta(id) { const r = await open_('files', await rawGet('files', id), { metaOnly: true }); return r ? { id: r.id, name: r.name, type: r.type, size: r.size } : null; },
    async fileURL(id) {
      if (DB._urls[id]) return DB._urls[id];
      const r = await DB.get('files', id);
      if (!r) return null;
      return (DB._urls[id] = URL.createObjectURL(r.blob));
    },
    async delFile(id) { if (DB._urls[id]) { URL.revokeObjectURL(DB._urls[id]); delete DB._urls[id]; } await DB.del('files', id); },
    async openFile(id) {
      const url = await DB.fileURL(id);
      const meta = await DB.fileMeta(id);
      if (!url) return U.toast('File tidak ditemukan', 'bad');
      if (meta.type.startsWith('image/')) return U.lightbox(url);
      const w = window.open(url, '_blank');
      if (!w) { const a = document.createElement('a'); a.href = url; a.download = meta.name; a.click(); }
    },

    async estimate() { try { return await navigator.storage.estimate(); } catch { return null; } },

    /* ---- Backup / Restore ---- */
    async exportPlain() {
      const out = { app: 'edcc', version: VERSION, exportedAt: new Date().toISOString(), stores: {} };
      for (const s of STORES) {
        const rows = await DB.all(s);
        if (s === 'files') out.stores.files = await Promise.all(rows.map(async (r) => ({ ...r, blob: await blobToDataURL(r.blob) })));
        else out.stores[s] = rows.filter((r) => !(s === 'kv' && (PLAIN_KV.has(r.key) || (window.FileSystemHandle && r.value instanceof window.FileSystemHandle))));
      }
      return out;
    },
    /* Bila kunci aktif → seluruh isi backup dienkripsi dengan kunci data yang sama (butuh password / kode pemulihan untuk restore) */
    async exportAll() {
      const plain = await DB.exportPlain();
      const meta = await DB.lockMeta();
      if (!DB.key || !meta) return plain;
      const r = await C.encJSON(DB.key, plain);
      const { id, ...lock } = meta;
      return { app: 'edcc', version: VERSION, exportedAt: plain.exportedAt, encrypted: true, lock: b64obj(lock), iv: b64(r.iv), c: b64(r.c), counts: Object.fromEntries(Object.entries(plain.stores).map(([k, v]) => [k, v.length])) };
    },
    async decryptBackup(json, dek) { return C.decJSON(dek, unb64(json.iv), unb64(json.c)); },
    async importAll(json, { replace = true } = {}) {
      if (!json || json.app !== 'edcc' || !json.stores) throw new Error('File backup tidak dikenali');
      for (const s of STORES) {
        const rows = json.stores[s]; if (!rows) continue;
        if (replace) await DB.clear(s);
        const fixed = s === 'files' ? await Promise.all(rows.map(async (r) => ({ ...r, blob: await (await fetch(r.blob)).blob() }))) : rows;
        await DB.putMany(s, fixed, { keepTime: true, silent: true });
      }
    },
  };
  function blobToDataURL(b) { return new Promise((res) => { if (!b) return res(null); const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }
  function b64(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function b64obj(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v instanceof Uint8Array ? { b64: b64(v) } : v])); }
  DB.b64 = b64; DB.unb64 = unb64;
  DB.unb64obj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && v.b64 ? unb64(v.b64) : v]));

  window.DB = DB;
})();

/* Koleksi sederhana: cache di memori + simpan ke store IndexedDB. */
DB.collection = function (store) {
  return {
    store, items: [],
    async load() { this.items = await DB.all(store); return this.items; },
    get(id) { return this.items.find((x) => x.id === id); },
    async save(o) {
      if (!o.id) o.id = U.uid(); if (!o.createdAt) o.createdAt = Date.now();
      const i = this.items.findIndex((x) => x.id === o.id);
      if (i >= 0) this.items[i] = o; else this.items.push(o);
      await DB.put(store, o); U.emit('data', { store }); return o;
    },
    async remove(id) { this.items = this.items.filter((x) => x.id !== id); await DB.del(store, id); U.emit('data', { store }); },
  };
};
