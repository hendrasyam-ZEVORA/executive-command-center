/* MENU 8 — Event Monthly (Kanban: Preparation · On-Going · Done)
   Store 'events' → { id, name, date, endDate, pic, budget, needs, checklist:[{id,text,done}], status:'prep'|'ongoing'|'done', order, notes, color } */
(function () {
  const C = DB.collection('events');
  const COLS = [{ k: 'prep', l: 'Preparation', c: 'var(--warn)' }, { k: 'ongoing', l: 'On-Going', c: 'var(--accent)' }, { k: 'done', l: 'Done', c: 'var(--good)' }];

  const EventMod = {
    C, month: 'all',
    async load() { await C.load(); },

    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Event Monthly', icon: 'flag',
        sub: 'Papan agenda event: PIC, tanggal, budget, dan checklist persiapan. Seret kartu antar kolom untuk ubah status.',
        actions: `<button class="btn primary" data-new>${icon('plus', 15)}Event Baru</button>`,
      }) + `<div class="sum-row" id="evSum"></div><div class="toolbar"><div class="chips" id="evMonths"></div></div><div class="kanban" id="evBoard"></div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-new]')) return this.edit(null, e.target.closest('[data-new]').dataset.new);
        const m = e.target.closest('[data-month]'); if (m) { this.month = m.dataset.month; return this.paint(); }
        const card = e.target.closest('[data-card]'); if (!card) return;
        const ev = C.get(card.dataset.card);
        if (e.target.closest('[data-edit]')) return this.edit(ev);
        if (e.target.closest('[data-del]')) return this.remove(ev);
        const mv = e.target.closest('[data-move]'); if (mv) { ev.status = mv.dataset.move; return C.save(ev); }
      });
      el.addEventListener('change', (e) => {
        if (!e.target.matches('[data-ck]')) return;
        const ev = C.get(e.target.closest('[data-card]').dataset.card);
        const it = ev.checklist.find((x) => x.id === e.target.dataset.ck); it.done = e.target.checked; C.save(ev);
      });
      U.kanbanDnD(U.$('#evBoard', el), async (id, col, beforeId) => {
        const ev = C.get(id); ev.status = col;
        const colItems = this.list().filter((x) => x.status === col && x.id !== id);
        const idx = beforeId ? colItems.findIndex((x) => x.id === beforeId) : colItems.length;
        colItems.splice(idx, 0, ev); colItems.forEach((x, i) => { x.order = i; });
        await DB.putMany('events', colItems); U.emit('data', { store: 'events' });
      });
      U.on('data', (d) => { if (App.current === 'event' && d && d.store === 'events') this.paint(); });
    },
    onShow() { this.paint(); },

    list() { return C.items.filter((e) => this.month === 'all' || (e.date || '').slice(0, 7) === this.month).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || (a.date < b.date ? -1 : 1)); },

    paint() {
      const months = [...new Set(C.items.map((e) => (e.date || '').slice(0, 7)).filter(Boolean))].sort();
      U.$('#evMonths').innerHTML = [['all', 'Semua bulan']].concat(months.map((m) => [m, Sales.ymLabel(m)])).map(([k, l]) => `<button class="chip ${this.month === k ? 'active' : ''}" data-month="${k}">${l}</button>`).join('');
      const list = this.list();
      const budget = list.reduce((s, e) => s + (+e.budget || 0), 0);
      const ck = list.flatMap((e) => e.checklist); const ckd = ck.filter((c) => c.done).length;
      const next = list.filter((e) => e.status !== 'done' && e.date >= U.today()).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      U.$('#evSum').innerHTML = `
        <div class="card sum"><div class="l">Total event</div><div class="v">${list.length}</div><div class="s">${list.filter((e) => e.status === 'done').length} selesai</div></div>
        <div class="card sum"><div class="l">Total budget</div><div class="v">${U.fmtRp(budget)}</div><div class="s">semua status</div></div>
        <div class="card sum"><div class="l">Persiapan</div><div class="v">${ck.length ? Math.round((ckd / ck.length) * 100) : 0}%</div><div class="s">${ckd}/${ck.length} checklist</div></div>
        <div class="card sum"><div class="l">Event terdekat</div><div class="v" style="font-size:16px;line-height:1.3;margin-top:4px">${next ? U.esc(next.name) : '–'}</div><div class="s">${next ? U.fmtDate(next.date) + ' · ' + U.relDay(next.date) : ''}</div></div>`;
      U.$('#evBoard').innerHTML = COLS.map((c) => {
        const items = list.filter((e) => e.status === c.k);
        return `<div class="kcol" data-col="${c.k}">
          <div class="kcol-h"><div class="kcol-t"><span class="dot" style="background:${c.c}"></span>${c.l} <span class="badge">${items.length}</span></div><span class="kcol-s">${U.fmtRp(items.reduce((s, e) => s + (+e.budget || 0), 0))}</span></div>
          ${items.map((e) => this.card(e)).join('')}
          <button class="btn ghost sm" data-new="${c.k}" style="justify-content:center">${icon('plus', 13)}Tambah</button></div>`;
      }).join('');
    },

    card(e) {
      const dn = e.checklist.filter((c) => c.done).length;
      const idx = COLS.findIndex((c) => c.k === e.status);
      const late = e.status !== 'done' && e.date && e.date < U.today();
      return `<div class="kcard" draggable="true" data-card="${e.id}">
        <div class="kcard-a"><span class="badge ${late ? 'bad' : e.date === U.today() ? 'warn' : ''}">${icon('calendar', 10)}${e.date ? U.fmtDM(e.date) + (e.endDate && e.endDate !== e.date ? '–' + U.fmtDM(e.endDate) : '') : 'Tanpa tanggal'}</span>
          <div style="display:flex"><button class="icon-btn sm" data-edit title="Edit">${icon('pencil', 12)}</button><button class="icon-btn sm danger" data-del title="Hapus">${icon('trash', 12)}</button></div></div>
        <div class="kcard-t">${U.esc(e.name)}</div>
        <div class="kcard-m">${e.pic ? `<span>${icon('user', 11)} ${U.esc(e.pic)}</span>` : ''}${+e.budget ? `<span>${icon('banknote', 11)} ${U.fmtRp(+e.budget)}</span>` : ''}</div>
        ${e.needs ? `<div class="hint" style="white-space:pre-wrap">${U.esc(e.needs.slice(0, 120))}</div>` : ''}
        ${e.checklist.length ? `<div class="progress good"><span style="width:${(dn / e.checklist.length) * 100}%"></span></div>
          ${e.checklist.slice(0, 5).map((c) => `<div class="tk ${c.done ? 'done' : ''}"><input type="checkbox" class="chk" data-ck="${c.id}" ${c.done ? 'checked' : ''}/><div class="tk-body"><div class="tk-title">${U.esc(c.text)}</div></div></div>`).join('')}
          ${e.checklist.length > 5 ? `<div class="hint">+${e.checklist.length - 5} item lagi</div>` : ''}` : ''}
        <div class="kcard-a">${idx > 0 ? `<button class="btn ghost sm" data-move="${COLS[idx - 1].k}">${icon('chevronLeft', 12)}${COLS[idx - 1].l}</button>` : '<span></span>'}
          ${idx < 2 ? `<button class="btn ghost sm" data-move="${COLS[idx + 1].k}">${COLS[idx + 1].l}${icon('chevronRight', 12)}</button>` : ''}</div>
      </div>`;
    },

    async remove(e) { if (await U.confirm(`Hapus event "${e.name}"?`)) await C.remove(e.id); },

    edit(e, status) {
      const isNew = !e;
      const d = e ? { ...e, checkText: e.checklist.map((c) => c.text).join('\n') } : { name: '', date: U.today(), endDate: '', pic: '', budget: 0, needs: '', status: status || 'prep', checkText: '', notes: '', checklist: [] };
      U.form({
        title: isNew ? 'Event Baru' : 'Edit Event', icon: 'flag', data: d,
        fields: [
          { key: 'name', label: 'Nama event', required: true, placeholder: 'Sampling Greenfields di Satu Sama' },
          { key: 'date', label: 'Tanggal pelaksanaan', type: 'date', half: true, required: true }, { key: 'endDate', label: 'Sampai (opsional)', type: 'date', half: true },
          { key: 'pic', label: 'PIC terkait', half: true, placeholder: 'Nama PIC / SPG / MD' }, { key: 'budget', label: 'Budget (Rp)', type: 'money', half: true },
          { key: 'status', label: 'Status', type: 'select', options: COLS.map((c) => ({ v: c.k, l: c.l })) },
          { key: 'needs', label: 'Kebutuhan', type: 'textarea', rows: 2, placeholder: 'Booth, sample 10 ctn, SPG 2 orang, banner' },
          { key: 'checkText', label: 'Checklist persiapan (satu per baris)', type: 'textarea', rows: 5, placeholder: 'Ajukan proposal ke buyer\nKonfirmasi stok sample\nBriefing SPG' },
          { key: 'notes', label: 'Catatan / draft kegiatan', type: 'textarea', rows: 2 },
        ],
        onSave: async (v) => {
          const old = e ? e.checklist : [];
          const checklist = v.checkText.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => { const o = old.find((x) => x.text === t); return o || { id: U.uid(), text: t, done: false }; });
          const rec = { ...(e || {}), ...v, checklist }; delete rec.checkText;
          await C.save(rec); U.toast(isNew ? 'Event ditambahkan' : 'Event disimpan');
        },
      });
    },
  };

  window.EventMod = EventMod;
  App.register('event', EventMod);
})();
