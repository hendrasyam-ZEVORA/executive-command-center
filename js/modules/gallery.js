/* MENU 10 — Screenshot Gallery (drag & drop, Ctrl+V dari clipboard, tag, cari, lightbox)
   Store 'gallery' → { id, fileId, title, tag, note, w, h, size, createdAt } ; gambar di store 'files' */
(function () {
  const C = DB.collection('gallery');
  const TAGS = ['Bukti Display', 'Data Kompetitor', 'Chat Penting', 'Harga & Promo', 'Lainnya'];

  const Gallery = {
    C, tag: 'all', q: '',
    async load() { await C.load(); },
    tags() { return [...new Set([...TAGS, ...C.items.map((g) => g.tag).filter(Boolean)])]; },
    list() { return C.items.filter((g) => (this.tag === 'all' || g.tag === this.tag) && (!this.q || (g.title + ' ' + g.tag + ' ' + (g.note || '')).toLowerCase().includes(this.q))).sort((a, b) => b.createdAt - a.createdAt); },

    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Screenshot Gallery', icon: 'image',
        sub: 'Tekan <span class="kbd">Ctrl</span>+<span class="kbd">V</span> di halaman ini untuk menempel screenshot langsung, atau seret file gambar ke kotak di bawah.',
        actions: `<div class="search">${icon('search', 14)}<input class="input" id="gQ" placeholder="Cari judul / tag…"/></div>`,
      }) + `<div class="dropzone" id="gDrop" style="margin-bottom:16px">${icon('upload', 20)}<div><b>Tempel (Ctrl+V)</b>, seret gambar ke sini, atau klik untuk memilih file</div></div>
        <div class="toolbar"><div class="chips" id="gTags"></div><span class="hint" id="gInfo"></span></div><div class="masonry" id="gGrid"></div>`;
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
        const t = e.target.closest('[data-tag]'); if (t) { this.tag = t.dataset.tag; return this.paint(); }
        const it = e.target.closest('[data-gid]'); if (!it) return;
        const g = C.get(it.dataset.gid);
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
      const tag = this.tag !== 'all' ? this.tag : 'Lainnya';
      const ids = [];
      for (const f of files) {
        const dim = await new Promise((res) => { const im = new Image(); const u = URL.createObjectURL(f); im.onload = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u); }; im.onerror = () => res({ w: 0, h: 0 }); im.src = u; });
        const now = new Date();
        const fileId = await DB.saveFile(f, f.name && f.name !== 'image.png' ? f.name : `screenshot-${U.ymd(now)}-${U.fmtTime(now).replace(':', '')}.png`);
        const title = pasted || !f.name || f.name === 'image.png' ? `Screenshot ${U.fmtDM(now)} ${U.fmtTime(now)}` : f.name.replace(/\.\w+$/, '');
        const g = { id: U.uid(), fileId, title, tag, note: '', ...dim, size: f.size, createdAt: Date.now() + ids.length };
        C.items.push(g); await DB.put('gallery', g); ids.push(g.id);
      }
      U.emit('data', { store: 'gallery' });
      ids.forEach((id) => { const n = U.$(`[data-gid="${id}"]`); n && n.classList.add('new'); });
      U.toast(`${files.length} gambar disimpan ke “${tag}” — klik ✎ untuk beri judul`, 'good', 3200);
    },

    async paint() {
      const all = C.items;
      U.$('#gTags').innerHTML = [['all', 'Semua', all.length]].concat(this.tags().map((t) => [t, t, all.filter((g) => g.tag === t).length]))
        .map(([k, l, n]) => `<button class="chip ${this.tag === k ? 'active' : ''}" data-tag="${U.esc(k)}">${U.esc(l)}<span class="c">${n}</span></button>`).join('');
      const list = this.list();
      const bytes = all.reduce((s, g) => s + (g.size || 0), 0);
      U.$('#gInfo').textContent = `${all.length} gambar · ${U.fmtBytes(bytes)}`;
      U.$('#gGrid').innerHTML = list.length ? list.map((g) => `<div class="gitem" data-gid="${g.id}">
          <img alt="${U.esc(g.title)}" data-f="${g.fileId}" ${g.w ? `style="aspect-ratio:${g.w}/${g.h}"` : ''} />
          <div class="gitem-act"><button class="icon-btn sm" data-edit title="Edit">${icon('pencil', 13)}</button><button class="icon-btn sm" data-dl title="Unduh">${icon('download', 13)}</button><button class="icon-btn sm" data-del title="Hapus">${icon('trash', 13)}</button></div>
          <div class="gitem-b"><div class="gitem-t">${U.esc(g.title)}</div><div class="kcard-m"><span class="badge accent">${U.esc(g.tag || 'Lainnya')}</span><span>${U.fmtDateTime(g.createdAt)}</span></div>
            ${g.note ? `<div class="hint">${U.esc(g.note)}</div>` : ''}</div></div>`).join('')
        : `<div class="empty" style="column-span:all">${icon('image', 28)}<b>Belum ada gambar${this.tag !== 'all' ? ' di tag ini' : ''}</b>Ambil screenshot (Win+Shift+S), lalu tekan Ctrl+V di sini.</div>`;
      for (const img of U.$$('#gGrid img[data-f]')) img.src = await DB.fileURL(img.dataset.f);
    },

    async open(id) {
      const list = this.list(); let i = list.findIndex((g) => g.id === id);
      const el = document.createElement('div'); el.className = 'lightbox';
      const show = async () => { const g = list[i]; el.innerHTML = `<img src="${await DB.fileURL(g.fileId)}" alt="">
          <button class="icon-btn" data-x>${icon('x', 18)}</button>
          ${list.length > 1 ? `<button class="icon-btn lb-prev" data-p style="position:absolute;left:16px;top:50%">${icon('chevronLeft', 20)}</button><button class="icon-btn lb-next" data-n style="position:absolute;right:16px;top:50%">${icon('chevronRight', 20)}</button>` : ''}
          <div class="lb-cap">${U.esc(g.title)} · ${U.esc(g.tag)} · ${i + 1}/${list.length}</div>`; };
      const close = () => { el.remove(); document.removeEventListener('keydown', key); };
      const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { i = (i + 1) % list.length; show(); } if (e.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; show(); } };
      el.onclick = (e) => { if (e.target.closest('[data-n]')) { i = (i + 1) % list.length; return show(); } if (e.target.closest('[data-p]')) { i = (i - 1 + list.length) % list.length; return show(); } if (e.target.tagName !== 'IMG') close(); };
      document.addEventListener('keydown', key); document.body.appendChild(el); show();
    },
    edit(g) {
      U.form({
        title: 'Detail Screenshot', icon: 'image', data: g,
        fields: [{ key: 'title', label: 'Judul', required: true }, { key: 'tag', label: 'Tag kategori', type: 'datalist', options: this.tags() }, { key: 'note', label: 'Catatan', type: 'textarea', rows: 3, placeholder: 'Toko, tanggal kunjungan, konteks…' }],
        onSave: async (v) => { Object.assign(g, v, { tag: v.tag || 'Lainnya' }); await C.save(g); },
      });
    },
    async remove(g) { if (!(await U.confirm(`Hapus "${g.title}"?`))) return; await DB.delFile(g.fileId); await C.remove(g.id); },
  };

  window.Gallery = Gallery;
  App.register('gallery', Gallery);
})();
