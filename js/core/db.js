/* IndexedDB helper — penyimpanan permanen offline (teks, gambar, PDF sebagai Blob).
   Semua data aplikasi ada di sini, kecuali preferensi kecil UI (tema, sidebar) di localStorage.

   API:
     await DB.all('daily')            → array
     await DB.get('daily', id)        → objek | undefined
     await DB.put('daily', obj)       → obj (obj.id wajib)
     await DB.del('daily', id)
     await DB.kv.get('key', default) / DB.kv.set('key', value)
     await DB.saveFile(File|Blob, name?) → id     (store 'files')
     await DB.fileURL(id)               → objectURL (di-cache)
     await DB.exportAll() / DB.importAll(json)   → dipakai Backup/Restore di Tahap 2
*/
(function () {
  const NAME = 'edcc';
  const VERSION = 1;
  // Store Tahap 1 + store yang sudah disiapkan untuk Tahap 2 (agar tidak perlu upgrade versi).
  const STORES = [
    'daily', 'monthly', 'accounts', 'files', 'kv',
    'calendar', 'programs', 'promos', 'events', 'projects', 'gallery', 'contacts', 'shop',
  ];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('Browser tidak mendukung IndexedDB'));
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' }); });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
      req.onblocked = () => console.warn('IndexedDB terblokir: tutup tab lain aplikasi ini.');
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

  const DB = {
    STORES,
    open,
    async all(store) { const db = await open(); return reqP(db.transaction(store).objectStore(store).getAll()); },
    async get(store, id) { const db = await open(); return reqP(db.transaction(store).objectStore(store).get(id)); },
    async put(store, obj) { if (!obj.id && store !== 'kv') obj.id = U.uid(); obj.updatedAt = Date.now(); await tx(store, 'readwrite', (s) => s.put(obj)); return obj; },
    async putMany(store, arr) { await tx(store, 'readwrite', (s) => arr.forEach((o) => s.put(o))); },
    async del(store, id) { await tx(store, 'readwrite', (s) => s.delete(id)); },
    async clear(store) { await tx(store, 'readwrite', (s) => s.clear()); },

    kv: {
      async get(key, def = null) { const r = await DB.get('kv', key); return r ? r.value : def; },
      async set(key, value) { await tx('kv', 'readwrite', (s) => s.put({ key, value })); },
      async del(key) { await tx('kv', 'readwrite', (s) => s.delete(key)); },
    },

    /* ---- File / gambar / PDF ---- */
    _urls: {},
    async saveFile(file, name) {
      const rec = { id: 'f_' + U.uid(), name: name || file.name || 'lampiran', type: file.type || 'application/octet-stream', size: file.size, blob: file, createdAt: Date.now() };
      await tx('files', 'readwrite', (s) => s.put(rec));
      return rec.id;
    },
    async fileMeta(id) { const r = await DB.get('files', id); return r ? { id: r.id, name: r.name, type: r.type, size: r.size } : null; },
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

    /* ---- Backup / Restore (Blob → base64) — UI-nya dibuat di Tahap 2 ---- */
    async exportAll() {
      const out = { app: 'edcc', version: VERSION, exportedAt: new Date().toISOString(), stores: {} };
      for (const s of STORES) {
        const rows = await DB.all(s);
        if (s === 'files') {
          out.stores.files = await Promise.all(rows.map(async (r) => ({ ...r, blob: await blobToDataURL(r.blob) })));
        } else out.stores[s] = rows.filter((r) => !(s === 'kv' && (r.key === 'salesHandles' || (window.FileSystemHandle && r.value instanceof window.FileSystemHandle))));
      }
      return out;
    },
    async importAll(json, { replace = true } = {}) {
      if (!json || json.app !== 'edcc') throw new Error('File backup tidak dikenali');
      for (const s of STORES) {
        const rows = json.stores[s]; if (!rows) continue;
        if (replace) await DB.clear(s);
        const fixed = s === 'files' ? await Promise.all(rows.map(async (r) => ({ ...r, blob: await (await fetch(r.blob)).blob() }))) : rows;
        await DB.putMany(s, fixed);
      }
    },
  };
  function blobToDataURL(b) { return new Promise((res) => { if (!b) return res(null); const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }

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
