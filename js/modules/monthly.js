/* MENU 3 — Monthly Task (sticky note kompleks + lampiran di IndexedDB)
   Data: store 'monthly' → { id, title, due:'YYYY-MM-DD', notes, color, repeat, done, doneAt, files:[{id,name,type,size}], createdAt } */
(function () {
  const FILTERS = [
    { id: 'active', label: 'Aktif', fn: (t) => !t.done },
    { id: 'today', label: 'Jatuh tempo hari ini', fn: (t) => !t.done && t.due === U.today() },
    { id: 'week', label: '7 hari ke depan', fn: (t) => !t.done && t.due >= U.today() && U.daysBetween(U.today(), t.due) <= 7 },
    { id: 'overdue', label: 'Terlambat', fn: (t) => !t.done && t.due && t.due < U.today() },
    { id: 'done', label: 'Selesai', fn: (t) => t.done },
    { id: 'all', label: 'Semua', fn: () => true },
  ];

  const Monthly = {
    items: [],
    filter: 'active',
    q: '',

    async load() { this.items = await DB.all('monthly'); },
    dueToday() { return this.items.filter((t) => !t.done && t.due === U.today()); },
    overdue() { return this.items.filter((t) => !t.done && t.due && t.due < U.today()).sort((a, b) => (a.due < b.due ? -1 : 1)); },
    dueTodayCount() { return this.dueToday().length + this.overdue().length; },

    status(t) {
      if (t.done) return { cls: 'good', label: 'Selesai' };
      if (!t.due) return { cls: '', label: 'Tanpa tenggat' };
      const n = U.daysBetween(U.today(), t.due);
      if (n < 0) return { cls: 'bad', label: `Terlambat ${-n} hari` };
      if (n === 0) return { cls: 'warn', label: 'Jatuh tempo hari ini' };
      if (n <= 3) return { cls: 'accent', label: U.relDay(t.due) };
      return { cls: '', label: U.fmtDate(t.due) };
    },

    async save(t) {
      const i = this.items.findIndex((x) => x.id === t.id);
      if (i >= 0) this.items[i] = t; else this.items.push(t);
      await DB.put('monthly', t); U.emit('data', { store: 'monthly' });
    },
    async toggle(id, done) {
      const t = this.items.find((x) => x.id === id); if (!t) return;
      t.done = done ?? !t.done; t.doneAt = t.done ? Date.now() : null;
      await this.save(t);
      if (t.done && t.repeat && t.due && !t.spawnedNext) {
        t.spawnedNext = true; await DB.put('monthly', t);
        const next = { ...t, id: U.uid(), due: U.ymd(U.addMonths(U.parse(t.due), 1)), done: false, doneAt: null, spawnedNext: false, files: [], createdAt: Date.now() };
        await this.save(next);
        U.toast(`Selesai. Jadwal berikutnya dibuat: ${U.fmtDate(next.due)}`, 'good');
      } else if (t.done) U.toast('Selesai: ' + t.title, 'good', 1600);
    },
    async remove(id) {
      const t = this.items.find((x) => x.id === id); if (!t) return;
      if (!(await U.confirm(`Hapus "${t.title}" beserta ${t.files.length} lampirannya?`))) return;
      for (const f of t.files) await DB.delFile(f.id);
      this.items = this.items.filter((x) => x.id !== id);
      await DB.del('monthly', id); U.emit('data', { store: 'monthly' });
    },

    /* ---------- UI ---------- */
    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Monthly Task', icon: 'stickyNote',
        sub: 'Report & tugas bulanan dengan tenggat, catatan detail, dan lampiran (gambar/PDF) yang tersimpan offline.',
        actions: `<button class="btn primary" data-new>${icon('plus', 15)}Tugas Baru</button>`,
      }) + `<div class="toolbar"><div class="chips" id="mFilters"></div>
          <div class="search">${icon('search', 14)}<input class="input" id="mSearch" placeholder="Cari judul / catatan…" /></div></div>
        <div class="notes-grid" id="mGrid"></div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-new]')) return this.edit();
        const f = e.target.closest('[data-filter]'); if (f) { this.filter = f.dataset.filter; return this.renderGrid(); }
      });
      U.$('#mSearch', el).addEventListener('input', U.debounce((e) => { this.q = e.target.value.toLowerCase(); this.renderGrid(); }, 150));
      this.bindCards(U.$('#mGrid', el));
      U.on('data', (d) => { if (App.current === 'monthly' && (!d || d.store === 'monthly')) this.renderGrid(); });
    },
    onShow() { this.renderGrid(); },

    renderGrid() {
      const grid = U.$('#mGrid'); if (!grid) return;
      U.$('#mFilters').innerHTML = FILTERS.map((f) => `<button class="chip ${this.filter === f.id ? 'active' : ''}" data-filter="${f.id}">${f.label}<span class="c">${this.items.filter(f.fn).length}</span></button>`).join('');
      const fn = FILTERS.find((f) => f.id === this.filter).fn;
      const list = this.items.filter(fn)
        .filter((t) => !this.q || (t.title + ' ' + (t.notes || '')).toLowerCase().includes(this.q))
        .sort((a, b) => (a.done - b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : 1));
      grid.innerHTML = list.length ? list.map((t) => this.cardHTML(t)).join('') :
        `<div class="empty" style="grid-column:1/-1">${icon('inbox', 28)}<b>Tidak ada tugas di sini</b>Klik “Tugas Baru” untuk menambah report bulanan, lengkap dengan lampiran.</div>`;
      this.hydrate(grid);
    },

    cardHTML(t, compact = false) {
      const st = this.status(t);
      const imgs = t.files.filter((f) => f.type.startsWith('image/'));
      const docs = t.files.filter((f) => !f.type.startsWith('image/'));
      return `<div class="note mnote c-${t.color || 'yellow'} ${t.done ? 'done' : ''}" data-id="${t.id}">
        <div class="note-h">
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <span class="badge ${st.cls}">${icon('calendar', 11)}${st.label}</span>
            ${t.repeat ? `<span class="badge" title="Berulang tiap bulan">${icon('repeat', 11)}Bulanan</span>` : ''}
          </div>
          <div style="display:flex">
            <button class="icon-btn sm" data-edit title="Edit">${icon('pencil', 13)}</button>
            ${compact ? '' : `<button class="icon-btn sm" data-del title="Hapus">${icon('trash', 13)}</button>`}
          </div>
        </div>
        <div style="padding:0 14px 6px"><div class="mnote-title">${U.esc(t.title)}</div></div>
        ${compact ? '' : `<div class="mnote-notes">${U.esc(t.notes || '')}</div>`}
        ${t.files.length ? `<div class="mnote-files">
          ${imgs.slice(0, compact ? 3 : 6).map((f) => `<img class="thumb" data-fid="${f.id}" data-open="${f.id}" alt="${U.esc(f.name)}" title="${U.esc(f.name)}" />`).join('')}
          ${docs.map((f) => `<button class="fchip" data-open="${f.id}" title="${U.esc(f.name)} · ${U.fmtBytes(f.size)}">${icon(/pdf/.test(f.type) ? 'file' : 'paperclip', 13)}<span>${U.esc(f.name)}</span></button>`).join('')}
        </div>` : ''}
        <div class="mnote-foot">
          <label><input type="checkbox" class="chk" data-toggle ${t.done ? 'checked' : ''}/>${t.done ? 'Selesai' : 'Tandai selesai'}</label>
          <span class="note-date">${t.due ? U.fmtDate(t.due) : ''}</span>
        </div>
      </div>`;
    },

    async hydrate(root) {
      for (const img of U.$$('img[data-fid]', root)) { const u = await DB.fileURL(img.dataset.fid); if (u) img.src = u; }
    },

    bindCards(root) {
      root.addEventListener('click', (e) => {
        const card = e.target.closest('.mnote'); if (!card) return;
        const id = card.dataset.id;
        const op = e.target.closest('[data-open]'); if (op) return DB.openFile(op.dataset.open);
        if (e.target.closest('[data-edit]')) return this.edit(this.items.find((x) => x.id === id));
        if (e.target.closest('[data-del]')) return this.remove(id);
      });
      root.addEventListener('change', (e) => {
        if (!e.target.matches('[data-toggle]')) return;
        const card = e.target.closest('.mnote'); card && this.toggle(card.dataset.id, e.target.checked);
      });
    },

    edit(t) {
      const isNew = !t;
      const d = t ? JSON.parse(JSON.stringify(t)) : { id: U.uid(), title: '', due: U.today(), notes: '', color: 'yellow', repeat: false, done: false, files: [], createdAt: Date.now() };
      const pending = []; // File baru (belum disimpan)
      const removed = []; // id file lama yang dihapus
      const renderAtt = async (el) => {
        const box = U.$('#mAtt', el);
        const existing = d.files.map((f) => ({ ...f, old: true }));
        const neu = pending.map((f, i) => ({ id: 'p' + i, name: f.name, type: f.type, size: f.size, file: f }));
        box.innerHTML = [...existing, ...neu].map((f) => `<div class="att">${f.type.startsWith('image/')
          ? `<img class="thumb" data-a="${f.id}" alt="" />` : `<span class="fchip">${icon('file', 13)}<span>${U.esc(f.name)}</span></span>`}
          <button class="x" data-rm="${f.id}" title="Hapus lampiran">${icon('x', 11)}</button></div>`).join('');
        for (const f of existing) { const im = U.$(`img[data-a="${f.id}"]`, box); if (im) im.src = await DB.fileURL(f.id); }
        neu.forEach((f) => { const im = U.$(`img[data-a="${f.id}"]`, box); if (im) im.src = URL.createObjectURL(f.file); });
      };
      const addFiles = (files, el) => { files.forEach((f) => pending.push(f)); renderAtt(el); };

      U.modal({
        title: isNew ? 'Tugas Bulanan Baru' : 'Edit Tugas Bulanan', icon: 'stickyNote', size: 'lg', sticky: true,
        body: `
          <div class="field"><label>Judul report / tugas</label><input class="input" id="mTitle" value="${U.esc(d.title)}" placeholder="mis. Report SIP KPI Q4 ke ASM" autofocus /></div>
          <div class="field-row">
            <div class="field"><label>Tanggal jatuh tempo</label><input class="input" type="date" id="mDue" value="${d.due || ''}" /></div>
            <div class="field"><label>Warna</label><div class="swatches" id="mColors">${U.NOTE_COLORS.map((c) => `<button type="button" class="swatch c-${c} ${d.color === c ? 'active' : ''}" data-c="${c}" title="${c}"></button>`).join('')}</div></div>
          </div>
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer"><input type="checkbox" class="chk" id="mRepeat" ${d.repeat ? 'checked' : ''}/>
            Ulangi tiap bulan <span class="hint">— saat ditandai selesai, tugas bulan depan otomatis dibuat</span></label>
          <div class="field"><label>Catatan detail</label><textarea class="textarea" id="mNotes" rows="6" placeholder="Langkah, sumber data, penerima report…">${U.esc(d.notes)}</textarea></div>
          <div class="field"><label>Lampiran (gambar / PDF / file lain)</label>
            <div class="dropzone" id="mDrop">${icon('upload', 18)}<div>Seret file ke sini, <b>klik untuk memilih</b>, atau <span class="kbd">Ctrl</span>+<span class="kbd">V</span> untuk tempel screenshot</div></div>
            <div class="att-list" id="mAtt" style="margin-top:8px"></div></div>`,
        buttons: [
          { label: 'Batal', cls: 'ghost' },
          {
            label: 'Simpan', cls: 'primary', icon: 'check',
            onClick: async (ctx) => {
              const el = ctx.el;
              d.title = U.$('#mTitle', el).value.trim();
              if (!d.title) { U.$('#mTitle', el).focus(); U.toast('Judul wajib diisi', 'warn'); return false; }
              d.due = U.$('#mDue', el).value; d.notes = U.$('#mNotes', el).value; d.repeat = U.$('#mRepeat', el).checked;
              for (const id of removed) await DB.delFile(id);
              d.files = d.files.filter((f) => !removed.includes(f.id));
              try {
                for (const f of pending) { const id = await DB.saveFile(f); d.files.push({ id, name: f.name || 'tempel.png', type: f.type, size: f.size }); }
              } catch (err) { U.toast('Gagal menyimpan lampiran: ' + err.message, 'bad'); return false; }
              await this.save(d);
              U.toast(isNew ? 'Tugas bulanan ditambahkan' : 'Perubahan disimpan');
            },
          },
        ],
        onMount: (el, ctx) => {
          renderAtt(el);
          U.$('#mColors', el).onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; d.color = b.dataset.c; U.$$('.swatch', el).forEach((s) => s.classList.toggle('active', s === b)); };
          const dz = U.$('#mDrop', el);
          dz.onclick = async () => addFiles(await U.pickFiles({ multiple: true, accept: 'image/*,application/pdf,.xlsx,.xls,.csv,.docx,.pptx' }), el);
          dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
          dz.ondragleave = () => dz.classList.remove('over');
          dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); addFiles(Array.from(e.dataTransfer.files), el); };
          const onPaste = (e) => {
            const files = Array.from(e.clipboardData.items || []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean)
              .map((f) => new File([f], f.name && f.name !== 'image.png' ? f.name : `tempel-${U.fmtTime(new Date()).replace(':', '')}.png`, { type: f.type }));
            if (files.length) { e.preventDefault(); addFiles(files, el); }
          };
          el.addEventListener('paste', onPaste);
          U.$('#mAtt', el).onclick = (e) => {
            const rm = e.target.closest('[data-rm]'); if (!rm) return;
            const id = rm.dataset.rm;
            if (id.startsWith('p')) pending.splice(+id.slice(1), 1); else removed.push(id), (d.files = d.files.filter((f) => f.id !== id));
            renderAtt(el);
          };
        },
      });
    },
  };

  window.Monthly = Monthly;
  App.register('monthly', Monthly);
})();
