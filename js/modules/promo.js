/* MENU 7 — Promo & Diskon: timeline Gantt bulanan + kartu promo + file SKP (PDF) di IndexedDB
   Store 'promos' → { id, name, account, mechanism, start, end, color, skp:[{id,name,type,size}], notes } */
(function () {
  const C = DB.collection('promos');

  const Promo = {
    C, filter: 'active',
    cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    async load() { await C.load(); },
    status(p) { const t = U.today(); return p.end < t ? 'ended' : p.start > t ? 'upcoming' : 'active'; },
    countdown(p) {
      const st = this.status(p);
      if (st === 'active') { const n = U.daysBetween(U.today(), p.end); return { cls: n <= 2 ? 'bad' : n <= 6 ? 'warn' : 'good', txt: n === 0 ? 'Berakhir hari ini' : `Sisa ${n + 1} hari` }; }
      if (st === 'upcoming') return { cls: 'accent', txt: `Mulai ${U.daysBetween(U.today(), p.start)} hari lagi` };
      return { cls: '', txt: 'Selesai' };
    },

    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Promo & Diskon', icon: 'tag',
        sub: 'Timeline promo aktif per bulan, countdown sisa hari, dan arsip SKP (PDF) yang bisa dibuka kapan saja tanpa internet.',
        actions: `<button class="btn primary" data-new>${icon('plus', 15)}Promo Baru</button>`,
      }) + `<div class="card" style="margin-bottom:18px">
          <div class="card-h"><div class="card-t">${icon('calendarDays', 16)}Timeline Promo</div>
            <div class="week-nav"><button class="icon-btn sm" data-m="-1">${icon('chevronLeft', 14)}</button><b id="prLabel" style="min-width:120px;text-align:center;font-size:13px"></b><button class="icon-btn sm" data-m="1">${icon('chevronRight', 14)}</button><button class="btn sm" data-m="0">Bulan ini</button></div></div>
          <div class="gantt" id="prGantt"></div></div>
        <div class="toolbar"><div class="chips" id="prFilter"></div><div class="search">${icon('search', 14)}<input class="input" id="prQ" placeholder="Cari promo / account…"/></div></div>
        <div class="notes-grid" id="prGrid"></div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-new]')) return this.edit();
        const m = e.target.closest('[data-m]'); if (m) { const t = new Date(); this.cursor = m.dataset.m === '0' ? new Date(t.getFullYear(), t.getMonth(), 1) : new Date(this.cursor.getFullYear(), this.cursor.getMonth() + +m.dataset.m, 1); return this.paint(); }
        const f = e.target.closest('[data-f]'); if (f) { this.filter = f.dataset.f; return this.paint(); }
        const bar = e.target.closest('[data-bar]'); if (bar) return this.edit(C.get(bar.dataset.bar));
        const card = e.target.closest('[data-prid]'); if (!card) return;
        const p = C.get(card.dataset.prid);
        const op = e.target.closest('[data-pdf]'); if (op) return this.preview(op.dataset.pdf);
        if (e.target.closest('[data-edit]')) return this.edit(p);
        if (e.target.closest('[data-del]')) return this.remove(p);
        if (e.target.closest('[data-up]')) return this.upload(p);
      });
      U.$('#prQ', el).addEventListener('input', U.debounce((e) => { this.q = e.target.value.toLowerCase(); this.paint(); }, 150));
      U.on('data', (d) => { if (App.current === 'promo' && d && d.store === 'promos') this.paint(); });
    },
    onShow() { this.paint(); },

    paint() { this.paintGantt(); this.paintCards(); },

    paintGantt() {
      const y = this.cursor.getFullYear(), mo = this.cursor.getMonth();
      U.$('#prLabel').textContent = `${U.BULAN[mo]} ${y}`;
      const n = U.daysInMonth(this.cursor);
      const ms = U.ymd(new Date(y, mo, 1)), me = U.ymd(new Date(y, mo, n));
      const list = C.items.filter((p) => p.start <= me && p.end >= ms).sort((a, b) => (a.start < b.start ? -1 : 1));
      const today = U.today();
      const todayIdx = today >= ms && today <= me ? +today.slice(8) - 1 : -1;
      const days = Array.from({ length: n }, (_, i) => { const d = new Date(y, mo, i + 1); return `<span class="${d.getDay() === 0 ? 'we' : ''}">${i + 1}</span>`; }).join('');
      const pct = (i) => (i / n) * 100;
      U.$('#prGantt').innerHTML = `<div class="gantt-grid">
        <div class="gantt-row head"><div class="gantt-label muted" style="font-size:11.5px">PROMO</div><div class="gantt-track"><div class="gantt-days" style="grid-template-columns:repeat(${n},1fr)">${days}</div></div><div class="gantt-left muted" style="font-size:11.5px">STATUS</div></div>
        ${list.length ? list.map((p) => {
          const s = Math.max(0, p.start < ms ? 0 : +p.start.slice(8) - 1), e = p.end > me ? n : +p.end.slice(8);
          const cd = this.countdown(p);
          return `<div class="gantt-row"><div class="gantt-label" title="${U.esc(p.name)}">${U.esc(p.name)}<small>${U.esc(p.account || '')}</small></div>
            <div class="gantt-track"><div class="gantt-days" style="grid-template-columns:repeat(${n},1fr);position:absolute;inset:0">${Array.from({ length: n }, (_, i) => `<span class="${new Date(y, mo, i + 1).getDay() === 0 ? 'we' : ''}" style="padding:0"></span>`).join('')}</div>
              <div class="gantt-bar c-${p.color || 'pink'} ${p.start < ms ? 'cut-l' : ''} ${p.end > me ? 'cut-r' : ''}" data-bar="${p.id}" style="left:${pct(s)}%;width:${pct(e - s)}%" title="${U.esc(p.name)} · ${U.fmtDM(p.start)}–${U.fmtDM(p.end)}">${U.esc(p.mechanism || p.name)}</div>
              ${todayIdx >= 0 ? `<div class="gantt-today" style="left:${pct(todayIdx + 0.5)}%"></div>` : ''}</div>
            <div class="gantt-left"><span class="badge ${cd.cls}">${cd.txt}</span></div></div>`;
        }).join('') : `<div class="empty">Tidak ada promo pada ${U.BULAN[mo]} ${y}.</div>`}</div>`;
    },

    paintCards() {
      const F = [['active', 'Aktif'], ['upcoming', 'Akan datang'], ['ended', 'Selesai'], ['all', 'Semua']];
      U.$('#prFilter').innerHTML = F.map(([k, l]) => `<button class="chip ${this.filter === k ? 'active' : ''}" data-f="${k}">${l}<span class="c">${k === 'all' ? C.items.length : C.items.filter((p) => this.status(p) === k).length}</span></button>`).join('');
      const q = this.q || '';
      const list = C.items.filter((p) => (this.filter === 'all' || this.status(p) === this.filter) && (!q || [p.name, p.account, p.mechanism].join(' ').toLowerCase().includes(q))).sort((a, b) => (a.end < b.end ? -1 : 1));
      U.$('#prGrid').innerHTML = list.length ? list.map((p) => {
        const cd = this.countdown(p);
        return `<div class="note mnote c-${p.color || 'pink'}" data-prid="${p.id}">
          <div class="note-h"><div style="display:flex;gap:6px;flex-wrap:wrap"><span class="badge ${cd.cls}">${icon('clock', 11)}${cd.txt}</span>${p.account ? `<span class="badge">${U.esc(p.account)}</span>` : ''}</div>
            <div style="display:flex"><button class="icon-btn sm" data-edit title="Edit">${icon('pencil', 13)}</button><button class="icon-btn sm" data-del title="Hapus">${icon('trash', 13)}</button></div></div>
          <div style="padding:0 14px 6px"><div class="mnote-title">${U.esc(p.name)}</div>
            <div style="font-size:13px;color:var(--ink);font-weight:600;margin-top:2px">${U.esc(p.mechanism || '')}</div>
            <div class="note-date" style="margin-top:4px">${U.fmtDate(p.start)} – ${U.fmtDate(p.end)} · ${U.daysBetween(p.start, p.end) + 1} hari</div></div>
          ${p.notes ? `<div class="mnote-notes">${U.esc(p.notes)}</div>` : ''}
          <div class="mnote-files">${p.skp.map((f) => `<button class="fchip" data-pdf="${f.id}" title="Buka ${U.esc(f.name)}">${icon('file', 13)}<span>${U.esc(f.name)}</span></button>`).join('')}
            <button class="fchip" data-up title="Upload SKP">${icon('upload', 13)}<span>${p.skp.length ? 'Tambah' : 'Upload SKP (PDF)'}</span></button></div>
          <div class="mnote-foot"><span class="note-date">${p.skp.length} file SKP</span></div></div>`;
      }).join('') : `<div class="empty" style="grid-column:1/-1">${icon('tag', 28)}<b>Belum ada promo</b>Tambahkan promo beserta file SKP-nya.</div>`;
    },

    async upload(p) {
      const files = await U.pickFiles({ accept: 'application/pdf,image/*', multiple: true }); if (!files.length) return;
      for (const f of files) { const id = await DB.saveFile(f); p.skp.push({ id, name: f.name, type: f.type, size: f.size }); }
      await C.save(p); U.toast(`${files.length} file SKP disimpan`);
    },
    async preview(fid) {
      const meta = await DB.fileMeta(fid); const url = await DB.fileURL(fid);
      if (!meta || !url) return U.toast('File tidak ditemukan', 'bad');
      if (meta.type.startsWith('image/')) return U.lightbox(url);
      U.modal({
        title: meta.name, icon: 'file', size: 'xl',
        body: `<iframe class="pdf-frame" src="${url}#view=FitH" title="${U.esc(meta.name)}"></iframe>`,
        buttons: [{ label: 'Buka di tab baru', cls: 'ghost', icon: 'external', onClick: () => { window.open(url, '_blank'); return false; } },
          { label: 'Unduh', cls: '', icon: 'download', onClick: async () => { U.download((await DB.get('files', fid)).blob, meta.name); return false; } }, { label: 'Tutup', cls: 'primary' }],
      });
    },
    async remove(p) {
      if (!(await U.confirm(`Hapus promo "${p.name}" beserta ${p.skp.length} file SKP?`))) return;
      for (const f of p.skp) await DB.delFile(f.id);
      await C.remove(p.id);
    },

    edit(p) {
      const isNew = !p;
      const d = p ? { ...p } : { name: '', account: '', mechanism: '', start: U.today(), end: U.ymd(U.addDays(new Date(), 14)), color: 'pink', notes: '', skp: [] };
      const pending = [];
      const accs = [...new Set([...(window.Sales ? Sales.accountNames() : []), ...(window.Account ? Account.items.map((a) => a.name.toUpperCase()) : [])])];
      U.form({
        title: isNew ? 'Promo Baru' : 'Edit Promo', icon: 'tag', data: d,
        fields: [
          { key: 'name', label: 'Nama promo', required: true, placeholder: 'Promo Gajian UHT 1L' },
          { key: 'account', label: 'Account / toko', type: 'datalist', options: accs, half: true, placeholder: 'INDOMARET' },
          { key: 'mechanism', label: 'Mekanisme diskon', half: true, placeholder: 'Disc 15% / Buy 2 Get 1' },
          { key: 'start', label: 'Mulai', type: 'date', half: true, required: true }, { key: 'end', label: 'Berakhir', type: 'date', half: true, required: true },
          { key: 'color', label: 'Warna bar', type: 'colors' },
          { key: 'notes', label: 'Catatan (nomor SKP, klaim, PIC)', type: 'textarea', rows: 3 },
        ],
        bodyAfter: isNew ? `<div class="field"><label>File SKP (PDF)</label><div class="dropzone" id="prDrop">${icon('upload', 18)}<div>Seret PDF ke sini atau <b>klik untuk memilih</b></div></div><div class="att-list" id="prAtt"></div></div>` : '',
        onMount: (el) => {
          const dz = U.$('#prDrop', el); if (!dz) return;
          const paint = () => { U.$('#prAtt', el).innerHTML = pending.map((f) => `<span class="fchip">${icon('file', 13)}<span>${U.esc(f.name)}</span></span>`).join(''); };
          dz.onclick = async () => { pending.push(...(await U.pickFiles({ accept: 'application/pdf,image/*', multiple: true }))); paint(); };
          dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
          dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); pending.push(...e.dataTransfer.files); paint(); };
        },
        onSave: async (v) => {
          if (v.end < v.start) { U.toast('Tanggal berakhir harus setelah mulai', 'warn'); return false; }
          const rec = { ...d, ...v };
          for (const f of pending) { const id = await DB.saveFile(f); rec.skp.push({ id, name: f.name, type: f.type, size: f.size }); }
          await C.save(rec); U.toast(isNew ? 'Promo ditambahkan' : 'Promo disimpan');
        },
      });
    },
  };

  window.Promo = Promo;
  App.register('promo', Promo);
})();
