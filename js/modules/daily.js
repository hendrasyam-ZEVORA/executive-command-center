/* MENU 2 — Daily Task (7 sticky notes Senin–Minggu)
   Data: store 'daily' → { id, date:'YYYY-MM-DD', title, alarm:'HH:MM'|'', done, doneAt, alarmFired, snoozeUntil, createdAt }
   Task disimpan per TANGGAL (bukan per nama hari) → riwayat minggu lalu tetap ada & grafik akurat. */
(function () {
  const DAY_COLORS = ['yellow', 'blue', 'green', 'purple', 'pink', 'orange', 'gray']; // Sen..Min

  const Daily = {
    tasks: [],
    weekOffset: 0,

    async load() { this.tasks = await DB.all('daily'); },

    forDate(ymd) {
      return this.tasks.filter((t) => t.date === ymd).sort((a, b) =>
        (a.done - b.done) || ((a.alarm || '99') < (b.alarm || '99') ? -1 : (a.alarm || '99') > (b.alarm || '99') ? 1 : 0) || a.createdAt - b.createdAt);
    },
    openTodayCount() { return this.tasks.filter((t) => t.date === U.today() && !t.done).length; },
    doneCount(ymd) { return this.tasks.filter((t) => t.date === ymd && t.done).length; },
    totalCount(ymd) { return this.tasks.filter((t) => t.date === ymd).length; },

    async add(date, title, alarm = '') {
      title = title.trim(); if (!title) return;
      const t = { id: U.uid(), date, title, alarm: alarm || '', done: false, doneAt: null, alarmFired: false, snoozeUntil: null, createdAt: Date.now() };
      this.tasks.push(t); await DB.put('daily', t); U.emit('data', { store: 'daily' });
      return t;
    },
    async update(id, patch) {
      const t = this.tasks.find((x) => x.id === id); if (!t) return;
      if ('alarm' in patch && patch.alarm !== t.alarm) { patch.alarmFired = false; patch.snoozeUntil = null; }
      if ('date' in patch && patch.date !== t.date) { patch.alarmFired = false; patch.snoozeUntil = null; }
      Object.assign(t, patch); await DB.put('daily', t); U.emit('data', { store: 'daily' });
    },
    async toggle(id, done) {
      const t = this.tasks.find((x) => x.id === id); if (!t) return;
      done = done ?? !t.done;
      await this.update(id, { done, doneAt: done ? Date.now() : null });
      if (done) U.toast('Selesai: ' + t.title, 'good', 1600);
    },
    async remove(id) {
      this.tasks = this.tasks.filter((x) => x.id !== id); await DB.del('daily', id); U.emit('data', { store: 'daily' });
    },
    async carryOver(date) {
      const next = U.ymd(U.addDays(U.parse(date), 1));
      const open = this.tasks.filter((t) => t.date === date && !t.done);
      for (const t of open) await this.update(t.id, { date: next });
      U.toast(`${open.length} tugas dipindah ke ${U.fmtDM(next)}`, 'good');
    },

    /* ---------- UI ---------- */
    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Daily Task', icon: 'calendarCheck',
        sub: 'Satu sticky note per hari. Centang selesai → grafik Beranda ikut terupdate. Isi jam untuk alarm.',
        actions: `<div class="week-nav">
          <button class="icon-btn" data-wk="-1" title="Minggu sebelumnya">${icon('chevronLeft', 16)}</button>
          <div class="week-label" id="dWeekLabel"></div>
          <button class="icon-btn" data-wk="1" title="Minggu berikutnya">${icon('chevronRight', 16)}</button>
          <button class="btn sm" data-wk="0">Minggu ini</button></div>`,
      }) + `<div class="stat-strip" id="dStats"></div><div class="notes-grid" id="dGrid"></div>`;
      el.addEventListener('click', (e) => {
        const w = e.target.closest('[data-wk]');
        if (w) { this.weekOffset = w.dataset.wk === '0' ? 0 : this.weekOffset + +w.dataset.wk; this.renderGrid(); }
      });
      this.bindGrid(U.$('#dGrid', el));
      U.on('data', (d) => { if (App.current === 'daily' && (!d || d.store === 'daily' || !d.store) && !this._busy) this.renderGrid(); });
      U.on('alarmstate', () => { if (App.current === 'daily') this.renderGrid(true); });
    },
    onShow() { this.renderGrid(); },

    weekDates() {
      const start = U.addDays(U.weekStart(new Date()), this.weekOffset * 7);
      return Array.from({ length: 7 }, (_, i) => U.addDays(start, i));
    },

    renderGrid(keepFocus = true) {
      const grid = U.$('#dGrid'); if (!grid) return;
      const active = document.activeElement;
      const focusDate = keepFocus && active && active.closest && active.closest('[data-add]') ? active.closest('[data-add]').dataset.add : null;
      const keepVals = focusDate ? Array.from(active.closest('[data-add]').querySelectorAll('input')).map((i) => i.value) : null;
      const dates = this.weekDates();
      const today = U.today();
      const s = dates[0], e = dates[6];
      U.$('#dWeekLabel').textContent = `Minggu ${U.isoWeek(s)} · ${s.getDate()} ${U.BULAN3[s.getMonth()]} – ${e.getDate()} ${U.BULAN3[e.getMonth()]} ${e.getFullYear()}`;

      const all = dates.flatMap((d) => this.forDate(U.ymd(d)));
      const done = all.filter((t) => t.done).length;
      const alarms = all.filter((t) => t.alarm && !t.done).length;
      U.$('#dStats').innerHTML = `
        <div class="stat"><span class="v">${all.length}</span><span class="l">Total tugas</span></div>
        <div class="stat"><span class="v" style="color:var(--good)">${done}</span><span class="l">Selesai</span></div>
        <div class="stat"><span class="v">${all.length ? Math.round((done / all.length) * 100) : 0}%</span><span class="l">Penyelesaian</span></div>
        <div class="stat"><span class="v">${alarms}</span><span class="l">Alarm aktif</span></div>`;

      grid.innerHTML = dates.map((d, i) => {
        const ymd = U.ymd(d);
        const list = this.forDate(ymd);
        const dn = list.filter((t) => t.done).length;
        const isToday = ymd === today;
        const open = list.length - dn;
        return `<div class="note c-${DAY_COLORS[i]} ${isToday ? 'today' : ''}" data-date="${ymd}">
          <div class="note-h">
            <div>
              <div class="note-day">${U.HARI[d.getDay()]}${isToday ? '<span class="badge accent">Hari ini</span>' : ''}</div>
              <div class="note-date">${d.getDate()} ${U.BULAN[d.getMonth()]} ${d.getFullYear()}</div>
            </div>
            <div style="display:flex;align-items:center;gap:2px">
              ${list.length ? `<span class="note-prog">${dn}/${list.length}</span>` : ''}
              ${open && ymd <= today ? `<button class="icon-btn sm" data-carry="${ymd}" title="Pindahkan ${open} tugas belum selesai ke hari berikutnya">${icon('moveRight', 14)}</button>` : ''}
            </div>
          </div>
          <div class="note-b">${list.length ? list.map((t) => Daily.taskHTML(t)).join('') : `<div class="empty" style="padding:14px 6px;color:var(--ink);opacity:.6">Belum ada tugas</div>`}</div>
          <div class="note-f">
            <form class="note-add" data-add="${ymd}" autocomplete="off">
              <input type="text" placeholder="Tambah tugas…" maxlength="200" />
              <input type="time" title="Jam alarm (opsional)" />
              <button class="icon-btn sm" type="submit" title="Tambah (Enter)">${icon('plus', 15)}</button>
            </form>
          </div>
        </div>`;
      }).join('');
      if (focusDate) {
        const f = U.$(`[data-add="${focusDate}"]`, grid);
        if (f) { f.querySelectorAll('input').forEach((inp, i) => { inp.value = keepVals[i] || ''; }); f.querySelector('input[type=text]').focus(); }
      }
    },

    /* Dipakai juga oleh Beranda */
    taskHTML(t, { showDate = false } = {}) {
      const st = window.Alarm ? Alarm.stateOf(t) : '';
      return `<div class="tk ${t.done ? 'done' : ''}" data-id="${t.id}">
        <input type="checkbox" class="chk" data-toggle ${t.done ? 'checked' : ''} title="Tandai selesai" />
        <div class="tk-body">
          <div class="tk-title" data-title title="Klik dua kali untuk edit">${U.esc(t.title)}</div>
          ${t.alarm || showDate ? `<div class="tk-meta">
            ${t.alarm ? `<button class="tk-alarm ${st}" data-alarm title="${st === 'missed' ? 'Alarm terlewat' : st === 'fired' ? 'Alarm sudah berbunyi' : 'Ubah jam alarm'}">${icon(st === 'missed' ? 'bellRing' : 'bell', 11)}${t.alarm}</button>` : ''}
            ${showDate ? `<span class="badge">${U.relDay(t.date)}</span>` : ''}
          </div>` : ''}
        </div>
        <div class="tk-act">
          ${!t.alarm && !t.done ? `<button class="icon-btn sm" data-alarm title="Set alarm">${icon('alarm', 13)}</button>` : ''}
          <button class="icon-btn sm danger" data-del title="Hapus">${icon('trash', 13)}</button>
        </div>
      </div>`;
    },

    /* Event delegation untuk daftar task (dipakai Daily & Beranda) */
    bindGrid(root) {
      root.addEventListener('submit', async (e) => {
        const f = e.target.closest('[data-add]'); if (!f) return;
        e.preventDefault();
        const [txt, tm] = f.querySelectorAll('input');
        if (!txt.value.trim()) return txt.focus();
        await this.add(f.dataset.add, txt.value, tm.value);
        txt.value = ''; tm.value = '';
        const again = U.$(`[data-add="${f.dataset.add}"] input[type=text]`, root); again && again.focus();
      });
      root.addEventListener('change', (e) => {
        const tk = e.target.closest('.tk'); if (!tk) return;
        if (e.target.matches('[data-toggle]')) this.toggle(tk.dataset.id, e.target.checked);
      });
      root.addEventListener('click', async (e) => {
        const carry = e.target.closest('[data-carry]');
        if (carry) return this.carryOver(carry.dataset.carry);
        const tk = e.target.closest('.tk'); if (!tk) return;
        const id = tk.dataset.id;
        if (e.target.closest('[data-del]')) {
          const t = this.tasks.find((x) => x.id === id);
          tk.style.opacity = '.4';
          await this.remove(id);
          U.toast('Dihapus: ' + (t ? t.title : ''), 'info', 1600);
          return;
        }
        const ab = e.target.closest('[data-alarm]');
        if (ab) { this.editAlarm(id, ab); }
      });
      root.addEventListener('dblclick', (e) => {
        const ttl = e.target.closest('[data-title]'); if (!ttl) return;
        const id = ttl.closest('.tk').dataset.id;
        ttl.contentEditable = 'true'; ttl.focus();
        document.getSelection().selectAllChildren(ttl);
        this._busy = true;
        const finish = async (save) => {
          ttl.contentEditable = 'false'; this._busy = false;
          ttl.removeEventListener('blur', onBlur); ttl.removeEventListener('keydown', onKey);
          const v = ttl.textContent.trim();
          if (save && v) await this.update(id, { title: v }); else U.emit('data', { store: 'daily' });
        };
        const onBlur = () => finish(true);
        const onKey = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ttl.blur(); } if (ev.key === 'Escape') { finish(false); } };
        ttl.addEventListener('blur', onBlur); ttl.addEventListener('keydown', onKey);
      });
    },

    editAlarm(id, anchor) {
      const t = this.tasks.find((x) => x.id === id); if (!t) return;
      U.modal({
        title: 'Jam Alarm', icon: 'alarm',
        body: `<div class="hint">${U.esc(t.title)} · ${U.fmtLong(U.parse(t.date))}</div>
          <div class="field"><label>Jam (HH:MM)</label><input class="input" type="time" id="alTime" value="${t.alarm || ''}" autofocus /></div>`,
        buttons: [
          ...(t.alarm ? [{ label: 'Hapus alarm', cls: 'danger', onClick: () => this.update(id, { alarm: '' }) }] : []),
          { label: 'Batal', cls: 'ghost' },
          { label: 'Simpan', cls: 'primary', onClick: (ctx) => this.update(id, { alarm: U.$('#alTime', ctx.el).value }) },
        ],
        onMount: (el, ctx) => U.$('#alTime', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.update(id, { alarm: e.target.value }); ctx.close(); } }),
      });
    },
  };

  window.Daily = Daily;
  App.register('daily', Daily);
})();
