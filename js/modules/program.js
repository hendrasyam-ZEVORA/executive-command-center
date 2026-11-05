/* MENU 6 — Program Monitoring (mis. Program WHS per toko)
   Store 'programs' → { id, name, account, start, end, unit:'Rp'|'Ctn'|'Pcs', target, actualManual, source:'stores'|'manual'|'sales',
                        sales:{value, asOf, at}, stores:[{id,name,target,actual}], notes, color } */
(function () {
  const C = DB.collection('programs');
  const fmtU = (v, unit) => (unit === 'Rp' ? U.fmtRp(v) : `${U.fmtNum(v, v % 1 ? 1 : 0)} ${unit.toLowerCase()}`);

  const Program = {
    C, filter: 'active',
    async load() { await C.load(); },

    actual(p) {
      if (p.source === 'sales' && p.sales) return p.sales.value;
      if (p.source === 'stores') return p.stores.reduce((s, x) => s + (+x.actual || 0), 0);
      return +p.actualManual || 0;
    },
    target(p) { return p.source === 'stores' && p.stores.some((x) => x.target) ? p.stores.reduce((s, x) => s + (+x.target || 0), 0) : +p.target || 0; },
    status(p) { const t = U.today(); return p.end < t ? 'ended' : p.start > t ? 'upcoming' : 'active'; },
    timeGone(p) { const tot = U.daysBetween(p.start, p.end) + 1; const el = U.clamp(U.daysBetween(p.start, U.today()) + 1, 0, tot); return tot > 0 ? el / tot : 0; },

    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Program Monitoring', icon: 'target',
        sub: 'Pantau program berjalan (WHS, display, listing) per toko: target, realisasi, dan progress terhadap waktu.',
        actions: `<button class="btn primary" data-new>${icon('plus', 15)}Program Baru</button>`,
      }) + `<div class="sum-row" id="pSum"></div><div class="toolbar"><div class="chips" id="pFilter"></div></div><div class="prog-grid" id="pGrid"></div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-new]')) return this.edit();
        const f = e.target.closest('[data-f]'); if (f) { this.filter = f.dataset.f; return this.paint(); }
        const card = e.target.closest('[data-pid]'); if (!card) return;
        const p = C.get(card.dataset.pid);
        if (e.target.closest('[data-edit]')) return this.edit(p);
        if (e.target.closest('[data-del]')) return this.remove(p);
        if (e.target.closest('[data-pull]')) return this.pull(p);
        if (e.target.closest('[data-addstore]')) { p.stores.push({ id: U.uid(), name: '', target: 0, actual: 0 }); p.source = 'stores'; return C.save(p).then(() => { const ins = U.$$(`[data-pid="${p.id}"] input[data-k="name"]`); ins[ins.length - 1]?.focus(); }); }
        const rs = e.target.closest('[data-rmstore]'); if (rs) { p.stores = p.stores.filter((s) => s.id !== rs.dataset.rmstore); return C.save(p); }
      });
      el.addEventListener('change', (e) => {
        const inp = e.target.closest('input[data-sid]'); if (!inp) return;
        const p = C.get(inp.closest('[data-pid]').dataset.pid); const s = p.stores.find((x) => x.id === inp.dataset.sid);
        s[inp.dataset.k] = inp.dataset.k === 'name' ? inp.value.trim() : (isFinite(U.toNum(inp.value)) ? U.toNum(inp.value) : 0);
        if (inp.dataset.k !== 'name') p.source = 'stores';
        C.save(p);
      });
      U.on('data', (d) => { if (App.current === 'program' && d && d.store === 'programs') this.paint(); });
      U.on('sales', () => { if (App.current === 'program') this.paint(); });
    },
    onShow() { this.paint(); },

    paint() {
      const all = C.items;
      const act = all.filter((p) => this.status(p) === 'active');
      const achs = act.filter((p) => this.target(p)).map((p) => this.actual(p) / this.target(p));
      const onTrack = act.filter((p) => this.target(p) && this.actual(p) / this.target(p) >= this.timeGone(p)).length;
      U.$('#pSum').innerHTML = `
        <div class="card sum"><div class="l">Program aktif</div><div class="v">${act.length}</div><div class="s">${all.filter((p) => this.status(p) === 'upcoming').length} akan datang</div></div>
        <div class="card sum"><div class="l">Rata-rata achievement</div><div class="v">${achs.length ? U.fmtPct(achs.reduce((a, b) => a + b, 0) / achs.length) : '–'}</div><div class="s">program aktif</div></div>
        <div class="card sum"><div class="l">On-track vs waktu</div><div class="v" style="color:var(--good)">${onTrack}<small class="muted" style="font-size:14px"> / ${act.length}</small></div><div class="s">achievement ≥ time gone</div></div>`;
      const F = [['active', 'Aktif'], ['upcoming', 'Akan datang'], ['ended', 'Selesai'], ['all', 'Semua']];
      U.$('#pFilter').innerHTML = F.map(([k, l]) => `<button class="chip ${this.filter === k ? 'active' : ''}" data-f="${k}">${l}<span class="c">${k === 'all' ? all.length : all.filter((p) => this.status(p) === k).length}</span></button>`).join('');
      const list = all.filter((p) => this.filter === 'all' || this.status(p) === this.filter).sort((a, b) => (a.end < b.end ? -1 : 1));
      U.$('#pGrid').innerHTML = list.length ? list.map((p) => this.card(p)).join('') :
        `<div class="empty" style="grid-column:1/-1">${icon('target', 28)}<b>Belum ada program di sini</b>Contoh: “Program WHS Greenfields UHT 1L — 10 toko Satu Sama”.</div>`;
    },

    card(p) {
      const a = this.actual(p), t = this.target(p), ach = t ? a / t : NaN, tg = this.timeGone(p), st = this.status(p);
      const cls = !isFinite(ach) ? '' : ach >= tg || ach >= 1 ? 'good' : ach >= tg * 0.85 ? 'warn' : 'bad';
      const left = U.daysBetween(U.today(), p.end);
      const salesOk = p.unit === 'Rp' && p.account && window.Sales && Sales.data && Sales.data.rf;
      return `<div class="card" data-pid="${p.id}">
        <div class="card-h" style="align-items:flex-start">
          <div style="min-width:0"><div class="card-t" style="font-size:15px">${U.esc(p.name)}</div>
            <div class="kcard-m" style="margin-top:4px">${p.account ? `<span class="badge accent">${icon('building', 10)}${U.esc(p.account)}</span>` : ''}
              <span>${U.fmtDM(p.start)} – ${U.fmtDate(p.end)}</span>
              <span class="badge ${st === 'active' ? (left <= 3 ? 'warn' : '') : st === 'ended' ? 'good' : ''}">${st === 'active' ? `sisa ${left + 1} hari` : st === 'upcoming' ? `mulai ${U.relDay(p.start).toLowerCase()}` : 'selesai'}</span></div></div>
          <div style="display:flex;flex-shrink:0">${salesOk ? `<button class="icon-btn sm" data-pull title="Tarik realisasi dari data Sales (RF)">${icon('refresh', 13)}</button>` : ''}
            <button class="icon-btn sm" data-edit title="Edit">${icon('pencil', 13)}</button><button class="icon-btn sm danger" data-del title="Hapus">${icon('trash', 13)}</button></div>
        </div>
        <div class="card-b" style="display:flex;flex-direction:column;gap:10px">
          <div class="prog-big"><span class="v ${cls ? '' : ''}" style="color:var(--${cls || 'text'})">${isFinite(ach) ? U.fmtNum(ach * 100, 1) + '%' : '–'}</span>
            <span class="muted">${fmtU(a, p.unit)} dari ${fmtU(t, p.unit)}</span>
            <span class="hint" style="margin-left:auto">${p.source === 'sales' && p.sales ? `${icon('database', 11)} Sales RF s/d ${U.fmtDM(p.sales.asOf)}` : p.source === 'stores' ? 'Σ per toko' : 'input manual'}</span></div>
          <div class="progress ${cls}"><span style="width:${U.clamp((ach || 0) * 100, 0, 100)}%"></span>${st === 'active' ? `<i class="marker" style="left:${tg * 100}%" title="Time gone ${U.fmtPct(tg, 0)}"></i>` : ''}</div>
          <table class="mini-table"><thead><tr><th class="l">Toko / outlet</th><th>Target</th><th>Actual</th><th>%</th><th></th></tr></thead><tbody>
            ${p.stores.map((s) => { const r = s.target ? s.actual / s.target : NaN; return `<tr>
              <td class="l"><input class="l" data-sid="${s.id}" data-k="name" value="${U.esc(s.name)}" placeholder="Nama toko"/></td>
              <td><input data-sid="${s.id}" data-k="target" value="${s.target ? U.fmtNum(s.target) : ''}" placeholder="0"/></td>
              <td><input data-sid="${s.id}" data-k="actual" value="${s.actual ? U.fmtNum(s.actual) : ''}" placeholder="0"/></td>
              <td style="color:var(--${!isFinite(r) ? 'muted' : r >= tg ? 'good' : r >= tg * 0.85 ? 'warn' : 'bad'});font-weight:600">${isFinite(r) ? U.fmtNum(r * 100, 0) + '%' : '–'}</td>
              <td><button class="icon-btn sm danger" data-rmstore="${s.id}" title="Hapus toko">${icon('x', 12)}</button></td></tr>`; }).join('')}
          </tbody></table>
          <button class="btn ghost sm" data-addstore style="align-self:flex-start">${icon('plus', 13)}Tambah toko</button>
          ${p.notes ? `<div class="hint" style="white-space:pre-wrap">${U.esc(p.notes)}</div>` : ''}
        </div></div>`;
    },

    async pull(p) {
      const r = Sales.actualFor(p.account, p.start, p.end);
      if (!r) return U.toast(`Account "${p.account}" tidak ditemukan di data Sales RF`, 'warn', 4000);
      p.sales = { value: r.value, asOf: r.asOf, at: Date.now() }; p.source = 'sales';
      await C.save(p); U.toast(`Realisasi ${p.account}: ${U.fmtRp(r.value)} (s/d ${U.fmtDM(r.asOf)})`);
    },
    async remove(p) { if (await U.confirm(`Hapus program "${p.name}"?`)) await C.remove(p.id); },

    edit(p) {
      const isNew = !p;
      const t = U.today();
      const d = p || { name: '', account: '', start: t.slice(0, 8) + '01', end: U.ymd(new Date(+t.slice(0, 4), +t.slice(5, 7), 0)), unit: 'Rp', target: 0, actualManual: 0, source: 'stores', stores: [], notes: '' };
      const accs = window.Sales ? Sales.accountNames() : [];
      U.form({
        title: isNew ? 'Program Baru' : 'Edit Program', icon: 'target', data: { ...d, storesText: '' },
        fields: [
          { key: 'name', label: 'Nama program', required: true, placeholder: 'Program WHS UHT 1L November' },
          { key: 'account', label: 'Account', type: 'datalist', options: accs, placeholder: 'SATU SAMA', hint: accs.length ? 'Nama sama dengan data Sales → realisasi bisa ditarik otomatis' : '' },
          { key: 'start', label: 'Mulai', type: 'date', half: true, required: true }, { key: 'end', label: 'Selesai', type: 'date', half: true, required: true },
          { key: 'unit', label: 'Satuan', type: 'select', options: ['Rp', 'Ctn', 'Pcs'], half: true }, { key: 'target', label: 'Target total', type: 'money', half: true, hint: 'Kosongkan bila dijumlah dari target per toko' },
          { key: 'source', label: 'Sumber realisasi', type: 'select', options: [{ v: 'stores', l: 'Jumlah actual per toko' }, { v: 'manual', l: 'Input manual' }, { v: 'sales', l: 'Tarik dari Sales RF (account)' }], half: true },
          { key: 'actualManual', label: 'Realisasi manual', type: 'money', half: true },
          ...(isNew ? [{ key: 'storesText', label: 'Daftar toko (opsional)', type: 'textarea', rows: 4, placeholder: 'Satu toko per baris, boleh dengan target:\nSatu Sama Panakkukang; 25\nSatu Sama Pettarani; 20' }] : []),
          { key: 'notes', label: 'Catatan / mekanisme', type: 'textarea', rows: 2 },
        ],
        onSave: async (v) => {
          if (v.end < v.start) { U.toast('Tanggal selesai harus setelah mulai', 'warn'); return false; }
          const rec = { ...(p || {}), ...v, stores: p ? p.stores : [] };
          if (isNew && v.storesText) rec.stores = v.storesText.split('\n').map((l) => l.split(/[;\t|]/)).filter((x) => x[0].trim()).map(([n, tg]) => ({ id: U.uid(), name: n.trim(), target: isFinite(U.toNum(tg)) ? U.toNum(tg) : 0, actual: 0 }));
          delete rec.storesText;
          await C.save(rec);
          if (rec.source === 'sales' && rec.account && window.Sales && Sales.data) await this.pull(rec);
          U.toast(isNew ? 'Program dibuat' : 'Program disimpan');
        },
      });
    },
  };

  window.Program = Program;
  App.register('program', Program);
})();
