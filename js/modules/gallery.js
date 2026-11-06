/* MENU 10 — Screenshot Gallery + FOLDER PER TOKO (bukti display)
   Store 'gallery' → { id, fileId, title, tag, note, folder, w, h, size, createdAt } ; gambar di store 'files'
   kv 'galleryFolders' → [{ id, name, account, note, createdAt }]
   Tampilan: Folder (kartu per toko → isi dikelompokkan per tanggal kunjungan) | Semua gambar.
   Tempel (Ctrl+V) / seret saat berada di dalam folder → otomatis masuk folder tsb. */
(function () {
  const C = DB.collection('gallery');
  const TAGS = ['Bukti Display', 'Data Kompetitor', 'Chat Penting', 'Harga & Promo', 'Lainnya'];

  const Gallery = {
    C, folders: [], tag: 'all', q: '', mode: 'folders', folder: null, selecting: false, sel: new Set(),
    async load() { await C.load(); this.folders = (await DB.kv.get('galleryFolders', [])) || []; },
    async saveFolders() { await DB.kv.set('galleryFolders', this.folders); U.emit('data', { store: 'gallery' }); },
    tags() { return [...new Set([...TAGS, ...C.items.map((g) => g.tag).filter(Boolean)])]; },
    folderOf(id) { return this.folders.find((f) => f.id === id); },
    inFolder(fid) { return C.items.filter((g) => (fid === '_none' ? !g.folder || !this.folderOf(g.folder) : g.folder === fid)); },
    list() {
      let pool = this.mode === 'folders' && this.folder ? this.inFolder(this.folder) : C.items;
      return pool.filter((g) => (this.tag === 'all' || g.tag === this.tag) && (!this.q || [g.title, g.tag, g.note, (this.folderOf(g.folder) || {}).name].join(' ').toLowerCase().includes(this.q)))
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Screenshot Gallery', icon: 'image',
        sub: 'Folder per toko untuk bukti display. Tekan <span class="kbd">Ctrl</span>+<span class="kbd">V</span> untuk menempel screenshot — di dalam folder, gambar otomatis masuk folder itu.',
        actions: `<div class="search">${icon('search', 14)}<input class="input" id="gQ" placeholder="Cari toko, judul, catatan…"/></div>
          <button class="btn primary" data-newfolder>${icon('plus', 15)}Folder Toko</button>`,
      }) + `<div class="dropzone" id="gDrop" style="margin-bottom:14px"></div>
        <div class="toolbar">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div class="seg" id="gMode"><button data-mode="folders">${icon('stickyNote', 13)} Folder Toko</button><button data-mode="all">${icon('image', 13)} Semua gambar</button></div>
            <div id="gCrumb" class="g-crumb"></div></div>
          <div style="display:flex;gap:8px;align-items:center"><span class="hint" id="gInfo"></span><button class="btn sm" data-select>${icon('check', 13)}Pilih</button></div>
        </div>
        <div class="g-selbar hidden" id="gSelBar"></div>
        <div class="chips" id="gTags" style="margin-bottom:14px"></div>
        <div id="gBody"></div>`;
      const dz = U.$('#gDrop', el);
      dz.onclick = async () => this.add(await U.pickFiles({ accept: 'image/*', multiple: true }));
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); this.add(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))); };
      document.addEventListener('paste', (e) => {
        if (App.current !== 'gallery' || document.querySelector('.modal-back') || (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]'))) return;
        const files = Array.from(e.clipboardData.items || []).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
        if (files.length) { e.preventDefault(); this.add(files, true); }
      });
      U.$('#gQ', el).addEventListener('input', U.debounce((e) => { this.q = e.target.value.toLowerCase(); this.paint(); }, 150));
      el.addEventListener('click', (e) => {
        const m = e.target.closest('[data-mode]'); if (m) { this.mode = m.dataset.mode; this.folder = null; this.tag = 'all'; return this.paint(); }
        if (e.target.closest('[data-newfolder]')) return this.editFolder();
        if (e.target.closest('[data-select]')) { this.selecting = !this.selecting; this.sel.clear(); return this.paint(); }
        const crumb = e.target.closest('[data-root]'); if (crumb) { this.folder = null; this.tag = 'all'; return this.paint(); }
        const t = e.target.closest('[data-tag]'); if (t) { this.tag = t.dataset.tag; return this.paint(); }
        const fo = e.target.closest('[data-open-folder]'); if (fo && !e.target.closest('[data-fedit]')) { this.folder = fo.dataset.openFolder; this.tag = 'all'; window.scrollTo(0, 0); return this.paint(); }
        const fe = e.target.closest('[data-fedit]'); if (fe) return this.editFolder(this.folderOf(fe.dataset.fedit));
        if (e.target.closest('[data-auto]')) return this.autoGroup();
        const sb = e.target.closest('[data-selact]'); if (sb) return this.selAction(sb.dataset.selact);
        const it = e.target.closest('[data-gid]'); if (!it) return;
        const g = C.get(it.dataset.gid);
        if (this.selecting) { this.sel.has(g.id) ? this.sel.delete(g.id) : this.sel.add(g.id); it.classList.toggle('picked', this.sel.has(g.id)); return this.paintSelBar(); }
        if (e.target.closest('[data-edit]')) return this.edit(g);
        if (e.target.closest('[data-del]')) return this.remove(g);
        if (e.target.closest('[data-dl]')) return DB.get('files', g.fileId).then((f) => U.download(f.blob, (g.title || 'screenshot').replace(/[^\w\- ]+/g, '') + '.' + (f.type.split('/')[1] || 'png')));
        if (e.target.tagName === 'IMG') return this.open(g.id);
      });
      U.on('data', (d) => { if (App.current === 'gallery' && d && d.store === 'gallery') this.paint(); });
    },
    onShow() { this.paint(); },

    async add(files, pasted) {
      if (!files || !files.length) return;
      const inFolder = this.mode === 'folders' && this.folder && this.folder !== '_none' ? this.folder : null;
      const tag = this.tag !== 'all' ? this.tag : inFolder ? 'Bukti Display' : 'Lainnya';
      const fname = inFolder ? this.folderOf(inFolder).name : '';
      const ids = [];
      for (const f of files) {
        const dim = await new Promise((res) => { const im = new Image(); const u = URL.createObjectURL(f); im.onload = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u); }; im.onerror = () => res({ w: 0, h: 0 }); im.src = u; });
        const now = new Date();
        const fileId = await DB.saveFile(f, f.name && f.name !== 'image.png' ? f.name : `screenshot-${U.ymd(now)}-${U.fmtTime(now).replace(':', '')}.png`);
        const base = pasted || !f.name || f.name === 'image.png' ? `${fname || 'Screenshot'} ${U.fmtDM(now)} ${U.fmtTime(now)}` : f.name.replace(/\.\w+$/, '');
        const g = { id: U.uid(), fileId, title: base, tag, note: '', folder: inFolder, ...dim, size: f.size, createdAt: Date.now() + ids.length };
        C.items.push(g); await DB.put('gallery', g); ids.push(g.id);
      }
      U.emit('data', { store: 'gallery' });
      ids.forEach((id) => { const n = U.$(`[data-gid="${id}"]`); n && n.classList.add('new'); });
      U.toast(`${files.length} gambar disimpan${fname ? ` ke folder “${fname}”` : ` ke “${tag}”`}`, 'good', 3200);
    },

    /* ---------- render ---------- */
    async paint() {
      U.$$('#gMode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === this.mode));
      const f = this.folder ? (this.folder === '_none' ? { name: 'Tanpa folder' } : this.folderOf(this.folder)) : null;
      if (this.folder && !f) this.folder = null;
      U.$('#gCrumb').innerHTML = this.mode === 'folders' && f
        ? `<button class="btn ghost sm" data-root>${icon('chevronLeft', 13)}Semua folder</button><b>${U.esc(f.name)}</b>${f.account ? `<span class="badge accent">${U.esc(f.account)}</span>` : ''}${f.id ? `<button class="icon-btn sm" data-fedit="${f.id}" title="Edit folder">${icon('pencil', 13)}</button>` : ''}` : '';
      U.$('#gDrop').innerHTML = `${icon('upload', 20)}<div><b>Tempel (Ctrl+V)</b>, seret gambar ke sini, atau klik untuk memilih file${this.mode === 'folders' && f && f.id ? ` → masuk folder <b>${U.esc(f.name)}</b>` : ''}</div>`;
      const showFolders = this.mode === 'folders' && !this.folder && !this.q;
      U.$('#gTags').style.display = showFolders ? 'none' : '';
      U.$('[data-select]').style.display = showFolders ? 'none' : '';
      if (showFolders) this.selecting = false;
      const all = C.items;
      U.$('#gInfo').textContent = `${this.folders.length} folder · ${all.length} gambar · ${U.fmtBytes(all.reduce((s, g) => s + (g.size || 0), 0))}`;
      this.paintSelBar();
      if (showFolders) return this.paintFolders();
      const scope = this.mode === 'folders' && this.folder ? this.inFolder(this.folder) : all;
      U.$('#gTags').innerHTML = [['all', 'Semua', scope.length]].concat(this.tags().map((t) => [t, t, scope.filter((g) => g.tag === t).length]).filter(([, , n], i) => n || i < 5))
        .map(([k, l, n]) => `<button class="chip ${this.tag === k ? 'active' : ''}" data-tag="${U.esc(k)}">${U.esc(l)}<span class="c">${n}</span></button>`).join('');
      const list = this.list();
      const body = U.$('#gBody');
      if (!list.length) { body.innerHTML = `<div class="empty">${icon('image', 28)}<b>Belum ada gambar${f ? ` di ${U.esc(f.name)}` : ''}</b>Ambil foto/screenshot, lalu tekan Ctrl+V atau seret ke kotak di atas.</div>`; return; }
      // dalam folder → kelompok per tanggal kunjungan
      if (this.mode === 'folders' && this.folder) {
        const groups = {}; list.forEach((g) => { const k = U.ymd(new Date(g.createdAt)); (groups[k] = groups[k] || []).push(g); });
        body.innerHTML = Object.keys(groups).sort().reverse().map((k) => `<div class="g-day"><div class="section-title">${icon('calendar', 12)}${U.fmtLong(U.parse(k))} <span class="badge">${groups[k].length} foto</span></div>
          <div class="masonry">${groups[k].map((g) => this.card(g)).join('')}</div></div>`).join('');
      } else body.innerHTML = `<div class="masonry">${list.map((g) => this.card(g, true)).join('')}</div>`;
      for (const img of U.$$('#gBody img[data-f]')) { try { img.src = await DB.fileURL(img.dataset.f); } catch {} }
    },

    card(g, showFolder) {
      const f = this.folderOf(g.folder);
      return `<div class="gitem ${this.sel.has(g.id) ? 'picked' : ''} ${this.selecting ? 'selecting' : ''}" data-gid="${g.id}">
        <span class="g-check">${icon('check', 14)}</span>
        <img alt="${U.esc(g.title)}" data-f="${g.fileId}" ${g.w ? `style="aspect-ratio:${g.w}/${g.h}"` : ''} />
        <div class="gitem-act"><button class="icon-btn sm" data-edit title="Edit / pindah folder">${icon('pencil', 13)}</button><button class="icon-btn sm" data-dl title="Unduh">${icon('download', 13)}</button><button class="icon-btn sm" data-del title="Hapus">${icon('trash', 13)}</button></div>
        <div class="gitem-b"><div class="gitem-t">${U.esc(g.title)}</div>
          <div class="kcard-m"><span class="badge accent">${U.esc(g.tag || 'Lainnya')}</span>${showFolder && f ? `<span class="badge">${icon('stickyNote', 10)}${U.esc(f.name)}</span>` : ''}<span>${U.fmtDateTime(g.createdAt)}</span></div>
          ${g.note ? `<div class="hint" style="white-space:pre-wrap">${U.esc(g.note)}</div>` : ''}</div></div>`;
    },

    async paintFolders() {
      const body = U.$('#gBody');
      const none = this.inFolder('_none');
      const cards = this.folders.map((f) => ({ f, items: this.inFolder(f.id).sort((a, b) => b.createdAt - a.createdAt) }))
        .sort((a, b) => ((b.items[0] || {}).createdAt || b.f.createdAt) - ((a.items[0] || {}).createdAt || a.f.createdAt));
      const fcard = (id, name, items, sub, extra = '') => {
        const last = items[0];
        const display = items.filter((g) => g.tag === 'Bukti Display').length;
        return `<div class="g-folder" data-open-folder="${id}">
          <div class="g-cover">${items.slice(0, 3).map((g, i) => `<img data-f="${g.fileId}" alt="" class="c${i}"/>`).join('') || `<div class="g-empty">${icon('image', 26)}</div>`}</div>
          <div class="g-fb"><div class="g-fn">${icon('stickyNote', 14)}<span>${U.esc(name)}</span>${extra}</div>
            <div class="kcard-m">${sub ? `<span class="badge accent">${U.esc(sub)}</span>` : ''}<span>${items.length} foto${display ? ` · ${display} display` : ''}</span></div>
            <div class="hint">${last ? `Kunjungan terakhir ${U.fmtDate(new Date(last.createdAt))} · ${U.relDay(U.ymd(new Date(last.createdAt))).toLowerCase()}` : 'Belum ada foto'}</div></div></div>`;
      };
      const suggest = this.suggestGroups();
      body.innerHTML = `${!this.folders.length ? `<div class="callout" style="margin-bottom:14px">${icon('sparkles', 15)}<div>Buat folder per toko (mis. <b>Satu Sama Perintis</b>, <b>Ektong</b>) lalu simpan foto bukti display di dalamnya. Foto lama bisa dipindahkan lewat tombol <b>Pilih</b> di tab “Semua gambar”.</div></div>` : ''}
        ${suggest.length ? `<div class="callout" style="margin-bottom:14px">${icon('sparkles', 15)}<div style="flex:1">${suggest.length} foto tanpa folder judulnya cocok dengan nama folder (${[...new Set(suggest.map((s) => s.f.name))].map(U.esc).join(', ')}).</div><button class="btn sm primary" data-auto>Masukkan ke folder</button></div>` : ''}
        <div class="g-folders">${cards.map(({ f, items }) => fcard(f.id, f.name, items, f.account, `<button class="icon-btn sm" data-fedit="${f.id}" title="Edit folder" style="margin-left:auto">${icon('pencil', 12)}</button>`)).join('')}
          ${none.length ? fcard('_none', 'Tanpa folder', none.sort((a, b) => b.createdAt - a.createdAt), '') : ''}
          <button class="g-folder g-add" data-newfolder>${icon('plus', 22)}<span>Folder toko baru</span></button></div>`;
      for (const img of U.$$('#gBody img[data-f]')) { try { img.src = await DB.fileURL(img.dataset.f); } catch {} }
    },

    /* ---------- pilih banyak ---------- */
    paintSelBar() {
      const bar = U.$('#gSelBar'); if (!bar) return;
      U.$('[data-select]').innerHTML = this.selecting ? `${icon('x', 13)}Selesai` : `${icon('check', 13)}Pilih`;
      bar.classList.toggle('hidden', !this.selecting);
      if (!this.selecting) return;
      bar.innerHTML = `<b>${this.sel.size} dipilih</b>
        <select class="select" id="gMoveTo" style="width:auto;min-width:200px"><option value="">Pindahkan ke folder…</option>${this.folders.map((f) => `<option value="${f.id}">${U.esc(f.name)}</option>`).join('')}<option value="_new">+ Folder baru…</option><option value="_none">(Keluarkan dari folder)</option></select>
        <button class="btn sm primary" data-selact="move" ${this.sel.size ? '' : 'disabled'}>Pindahkan</button>
        <button class="btn sm" data-selact="all">Pilih semua</button>
        <button class="btn sm danger" data-selact="del" ${this.sel.size ? '' : 'disabled'}>${icon('trash', 13)}Hapus</button>`;
    },
    async selAction(a) {
      if (a === 'all') { this.list().forEach((g) => this.sel.add(g.id)); return this.paint(); }
      const items = [...this.sel].map((id) => C.get(id)).filter(Boolean);
      if (a === 'del') {
        if (!(await U.confirm(`Hapus ${items.length} gambar?`))) return;
        for (const g of items) { await DB.delFile(g.fileId); await DB.del('gallery', g.id); }
        C.items = C.items.filter((g) => !this.sel.has(g.id)); this.sel.clear(); U.emit('data', { store: 'gallery' }); return;
      }
      if (a === 'move') {
        let to = U.$('#gMoveTo').value; if (!to) return U.toast('Pilih folder tujuan', 'warn');
        if (to === '_new') { const f = await this.editFolder(); if (!f) return; to = f.id; }
        for (const g of items) { g.folder = to === '_none' ? null : to; if (to !== '_none' && (!g.tag || g.tag === 'Lainnya')) g.tag = 'Bukti Display'; }
        await DB.putMany('gallery', items);
        U.toast(`${items.length} gambar dipindah${to === '_none' ? ' keluar folder' : ` ke “${this.folderOf(to).name}”`}`);
        this.sel.clear(); this.selecting = false; U.emit('data', { store: 'gallery' });
      }
    },

    /* ---------- folder ---------- */
    norm: (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    suggestGroups() {
      const out = [];
      const fs = this.folders.filter((f) => this.norm(f.name).length >= 3).sort((a, b) => b.name.length - a.name.length);
      for (const g of this.inFolder('_none')) {
        const t = ' ' + this.norm(g.title + ' ' + (g.note || '')) + ' ';
        const f = fs.find((x) => t.includes(' ' + this.norm(x.name) + ' ') || t.includes(' ' + this.norm(x.name)));
        if (f) out.push({ g, f });
      }
      return out;
    },
    async autoGroup() {
      const s = this.suggestGroups();
      s.forEach(({ g, f }) => { g.folder = f.id; if (!g.tag || g.tag === 'Lainnya') g.tag = 'Bukti Display'; });
      await DB.putMany('gallery', s.map((x) => x.g)); U.emit('data', { store: 'gallery' });
      U.toast(`${s.length} foto dimasukkan ke folder`);
    },
    editFolder(f) {
      const isNew = !f;
      const accs = [...new Set([...(window.Account ? Account.items.map((a) => a.name) : []), ...(window.Sales ? Sales.accountNames() : [])])];
      return new Promise((resolve) => {
        let saved = null;
        U.form({
          title: isNew ? 'Folder Toko Baru' : 'Edit Folder', icon: 'stickyNote', data: f || {},
          fields: [
            { key: 'name', label: 'Nama toko / outlet', required: true, placeholder: 'Satu Sama Perintis' },
            { key: 'account', label: 'Account (opsional)', type: 'datalist', options: accs, placeholder: 'SATU SAMA' },
            { key: 'note', label: 'Catatan toko (alamat, PIC, jadwal visit)', type: 'textarea', rows: 2 },
          ],
          extra: isNew ? [] : [{ label: 'Hapus folder', cls: 'danger', onClick: async () => {
            const n = this.inFolder(f.id).length;
            if (!(await U.confirm(`Hapus folder "${f.name}"? ${n} foto di dalamnya tidak dihapus, hanya dipindah ke "Tanpa folder".`, { ok: 'Hapus folder' }))) return false;
            const items = this.inFolder(f.id); items.forEach((g) => { g.folder = null; }); await DB.putMany('gallery', items);
            this.folders = this.folders.filter((x) => x.id !== f.id);
            if (this.folder === f.id) this.folder = null;
            await this.saveFolders();
          } }],
          onSave: async (v) => {
            if (this.folders.some((x) => x.id !== (f && f.id) && this.norm(x.name) === this.norm(v.name))) { U.toast('Folder dengan nama ini sudah ada', 'warn'); return false; }
            if (isNew) { saved = { id: 'gf_' + U.uid(), ...v, createdAt: Date.now() }; this.folders.push(saved); } else { Object.assign(f, v); saved = f; }
            await this.saveFolders();
            const s = this.suggestGroups().filter((x) => x.f.id === saved.id);
            if (s.length) U.toast(`${s.length} foto lama cocok dengan “${saved.name}” — klik “Masukkan ke folder”`, 'info', 4500);
            resolve(saved);
          },
          onMount: () => {},
        });
        // resolve null bila ditutup tanpa simpan
        const t = setInterval(() => { if (!document.querySelector('.modal-back')) { clearInterval(t); if (!saved) resolve(null); } }, 300);
      });
    },

    async open(id) {
      const list = this.list(); let i = list.findIndex((g) => g.id === id);
      const el = document.createElement('div'); el.className = 'lightbox';
      const show = async () => { const g = list[i]; const f = this.folderOf(g.folder); el.innerHTML = `<img src="${await DB.fileURL(g.fileId)}" alt="">
          <button class="icon-btn" data-x>${icon('x', 18)}</button>
          ${list.length > 1 ? `<button class="icon-btn lb-prev" data-p style="position:absolute;left:16px;top:50%">${icon('chevronLeft', 20)}</button><button class="icon-btn lb-next" data-n style="position:absolute;right:16px;top:50%">${icon('chevronRight', 20)}</button>` : ''}
          <div class="lb-cap">${f ? U.esc(f.name) + ' · ' : ''}${U.esc(g.title)} · ${U.fmtDateTime(g.createdAt)} · ${i + 1}/${list.length}</div>`; };
      const close = () => { el.remove(); document.removeEventListener('keydown', key); };
      const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { i = (i + 1) % list.length; show(); } if (e.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; show(); } };
      el.onclick = (e) => { if (e.target.closest('[data-n]')) { i = (i + 1) % list.length; return show(); } if (e.target.closest('[data-p]')) { i = (i - 1 + list.length) % list.length; return show(); } if (e.target.tagName !== 'IMG') close(); };
      document.addEventListener('keydown', key); document.body.appendChild(el); show();
    },
    edit(g) {
      U.form({
        title: 'Detail Gambar', icon: 'image', data: { ...g, folder: g.folder || '' },
        fields: [{ key: 'title', label: 'Judul', required: true },
          { key: 'folder', label: 'Folder toko', type: 'select', options: [{ v: '', l: '(Tanpa folder)' }, ...this.folders.map((f) => ({ v: f.id, l: f.name }))], half: true },
          { key: 'tag', label: 'Tag kategori', type: 'datalist', options: this.tags(), half: true },
          { key: 'note', label: 'Catatan (OOS, planogram, temuan)', type: 'textarea', rows: 3 }],
        onSave: async (v) => { Object.assign(g, v, { tag: v.tag || 'Lainnya', folder: v.folder || null }); await C.save(g); },
      });
    },
    async remove(g) { if (!(await U.confirm(`Hapus "${g.title}"?`))) return; await DB.delFile(g.fileId); await C.remove(g.id); },
  };

  window.Gallery = Gallery;
  App.register('gallery', Gallery);
})();
