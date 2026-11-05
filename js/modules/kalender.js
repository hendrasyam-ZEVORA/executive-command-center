/* MENU 5 — Kalender Bulanan & MS Teams
   Store 'calendar' → meeting { id, title, date, start, end, allDay, link, location, notes, source:'manual'|'ics', uid, reminderId }
   Kalender menggabungkan: Meeting + Monthly Task (jatuh tempo) + Event (Menu 8) + Promo (mulai/berakhir, Menu 7). */
(function () {
  const C = DB.collection('calendar');
  const TEAMS_RE = /https:\/\/teams\.(?:microsoft|live)\.com\/[^\s"'<>\\]+/i;

  /* ---------------- Parser .ics (Outlook / MS Teams) ---------------- */
  function parseICS(text) {
    const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
    const evs = []; let cur = null;
    const unesc = (s) => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { cur = { exdate: [] }; continue; }
      if (line === 'END:VEVENT') { if (cur) evs.push(cur); cur = null; continue; }
      if (!cur) continue;
      const i = line.indexOf(':'); if (i < 0) continue;
      const left = line.slice(0, i), val = line.slice(i + 1);
      const [name, ...params] = left.split(';');
      const P = Object.fromEntries(params.map((p) => p.split('=')));
      switch (name.toUpperCase()) {
        case 'SUMMARY': cur.title = unesc(val); break;
        case 'DTSTART': cur.start = parseDT(val, P); break;
        case 'DTEND': cur.end = parseDT(val, P); break;
        case 'LOCATION': cur.location = unesc(val); break;
        case 'DESCRIPTION': cur.desc = unesc(val); break;
        case 'URL': cur.url = val; break;
        case 'UID': cur.uid = val; break;
        case 'RRULE': cur.rrule = Object.fromEntries(val.split(';').map((p) => p.split('='))); break;
        case 'EXDATE': val.split(',').forEach((v) => { const d = parseDT(v, P); if (d) cur.exdate.push(d.date); }); break;
        case 'STATUS': cur.status = val; break;
        case 'X-MICROSOFT-SKYPETEAMSMEETINGURL': cur.teams = val; break;
      }
    }
    return evs.filter((e) => e.start && e.status !== 'CANCELLED');
  }
  function parseDT(v, P) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/); if (!m) return null;
    if (!m[4] || P.VALUE === 'DATE') return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '', allDay: true };
    let d = m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]); // TZID → anggap jam lokal
    return { date: U.ymd(d), time: U.fmtTime(d), allDay: false };
  }
  const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function expand(ev, from, to) {
    if (!ev.rrule) return [ev.start.date];
    const r = ev.rrule, iv = +(r.INTERVAL || 1), freq = r.FREQ, count = r.COUNT ? +r.COUNT : Infinity;
    const until = r.UNTIL ? parseDT(r.UNTIL, {}).date : '9999-12-31';
    const s = U.parse(ev.start.date);
    const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => DOW[x.slice(-2)]) : [s.getDay()];
    const out = []; let n = 0;
    for (let d = new Date(s), k = 0; k < 2000; k++, d = U.addDays(d, 1)) {
      const ds = U.ymd(d);
      if (ds > until || ds > to || n >= count) break;
      const diff = Math.round((d - s) / 864e5);
      let hit = false;
      if (freq === 'DAILY') hit = diff % iv === 0;
      else if (freq === 'WEEKLY') hit = byday.includes(d.getDay()) && Math.floor((U.weekStart(d) - U.weekStart(s)) / (7 * 864e5)) % iv === 0;
      else if (freq === 'MONTHLY') hit = d.getDate() === s.getDate() && ((d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth()) % iv === 0;
      else if (freq === 'YEARLY') hit = d.getDate() === s.getDate() && d.getMonth() === s.getMonth();
      if (!hit) continue;
      n++;
      if (ds >= from && !ev.exdate.includes(ds)) out.push(ds);
    }
    return out;
  }

  const Kalender = {
    C,
    cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    sel: U.today(),

    async load() { await C.load(); },
    todayCount() { return C.items.filter((m) => m.date === U.today()).length; },

    itemsOn(ds) {
      const out = [];
      C.items.filter((m) => m.date === ds).forEach((m) => out.push({ type: 'meeting', t: m.allDay ? '' : m.start, title: m.title, ref: m }));
      if (window.Monthly) Monthly.items.filter((t) => t.due === ds).forEach((t) => out.push({ type: 'monthly', title: t.title, done: t.done, ref: t }));
      if (window.EventMod) EventMod.C.items.filter((e) => e.date === ds || (e.endDate && e.date < ds && e.endDate >= ds)).forEach((e) => out.push({ type: 'event', title: e.name, done: e.status === 'done', ref: e }));
      if (window.Promo) Promo.C.items.forEach((p) => { if (p.start === ds) out.push({ type: 'promo', title: 'Mulai: ' + p.name, ref: p }); else if (p.end === ds) out.push({ type: 'promo', title: 'Berakhir: ' + p.name, ref: p }); });
      return out.sort((a, b) => (a.t || '99') < (b.t || '99') ? -1 : 1);
    },

    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Kalender & MS Teams', icon: 'calendarDays',
        sub: 'Meeting, Monthly Task, Event, dan periode Promo dalam satu kalender. Import jadwal dari Outlook/Teams lewat file .ics.',
        actions: `<button class="btn" data-ics>${icon('upload', 14)}Import .ics</button><button class="btn primary" data-new>${icon('plus', 15)}Tambah Jadwal</button>`,
      }) + `<div class="toolbar">
          <div class="week-nav"><button class="icon-btn" data-m="-1">${icon('chevronLeft', 16)}</button><div class="week-label" id="kLabel" style="min-width:150px"></div>
            <button class="icon-btn" data-m="1">${icon('chevronRight', 16)}</button><button class="btn sm" data-m="0">Hari ini</button></div>
          <div class="cal-legend"><span><i style="background:var(--accent)"></i>Meeting</span><span><i style="background:var(--n-yellow-ink)"></i>Monthly Task</span><span><i style="background:var(--n-green-ink)"></i>Event</span><span><i style="background:var(--n-pink-ink)"></i>Promo</span></div>
        </div>
        <div class="split"><div class="cal" id="kCal"></div><div class="card" id="kDay"></div></div>`;
      el.addEventListener('click', (e) => {
        const m = e.target.closest('[data-m]');
        if (m) { if (m.dataset.m === '0') { const t = new Date(); this.cursor = new Date(t.getFullYear(), t.getMonth(), 1); this.sel = U.today(); } else this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() + +m.dataset.m, 1); return this.paint(); }
        if (e.target.closest('[data-new]')) return this.edit(null, this.sel);
        if (e.target.closest('[data-ics]')) return this.importICS();
        const d = e.target.closest('.cal-d'); if (d) { this.sel = d.dataset.d; if (d.classList.contains('out')) { const x = U.parse(d.dataset.d); this.cursor = new Date(x.getFullYear(), x.getMonth(), 1); } return this.paint(); }
        const it = e.target.closest('[data-open]'); if (it) return this.openItem(it.dataset.open, it.dataset.id);
        const ed = e.target.closest('[data-medit]'); if (ed) return this.edit(C.get(ed.dataset.medit));
        const del = e.target.closest('[data-mdel]'); if (del) return this.remove(del.dataset.mdel);
        if (e.target.closest('[data-addday]')) return this.edit(null, this.sel);
      });
      U.on('data', () => { if (App.current === 'kalender') this.paint(); });
    },
    onShow() { this.paint(); },

    paint() {
      const y = this.cursor.getFullYear(), mo = this.cursor.getMonth();
      U.$('#kLabel').textContent = `${U.BULAN[mo]} ${y}`;
      const start = U.weekStart(new Date(y, mo, 1));
      const today = U.today();
      let h = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => `<div class="cal-h">${d}</div>`).join('');
      for (let i = 0; i < 42; i++) {
        const d = U.addDays(start, i); const ds = U.ymd(d);
        if (i === 35 && d.getMonth() !== mo) break;
        const items = this.itemsOn(ds);
        h += `<div class="cal-d ${d.getMonth() !== mo ? 'out' : ''} ${ds === today ? 'today' : ''} ${ds === this.sel ? 'sel' : ''} ${d.getDay() === 0 ? 'wkend' : ''}" data-d="${ds}">
          <div class="cal-top"><span class="cal-n">${d.getDate()}</span>${items.length ? `<span class="cal-cnt">${items.length}</span>` : ''}</div>
          ${items.slice(0, 3).map((it) => `<div class="ev ${it.type} ${it.done ? 'done' : ''}" title="${U.esc(it.title)}">${it.t ? it.t + ' ' : ''}${U.esc(it.title)}</div>`).join('')}
          ${items.length > 3 ? `<div class="ev-more">+${items.length - 3} lainnya</div>` : ''}</div>`;
      }
      U.$('#kCal').innerHTML = h;
      this.paintDay();
    },

    paintDay() {
      const ds = this.sel; const items = this.itemsOn(ds);
      const lbl = { meeting: ['Meeting', 'accent'], monthly: ['Monthly Task', 'warn'], event: ['Event', 'good'], promo: ['Promo', 'bad'] };
      U.$('#kDay').innerHTML = `<div class="card-h"><div><div class="card-t">${icon('calendar', 16)}${U.fmtLong(U.parse(ds))}</div><div class="card-s">${U.relDay(ds)} · ${items.length} agenda</div></div>
          <button class="btn sm" data-addday>${icon('plus', 13)}Meeting</button></div>
        <div class="card-b">${items.length ? items.map((it) => {
          const m = it.ref;
          if (it.type === 'meeting') return `<div class="agenda-item"><div class="agenda-time">${m.allDay ? 'Seharian' : `${m.start}${m.end ? '–' + m.end : ''}`}</div>
            <div class="agenda-body"><div class="agenda-title">${U.esc(m.title)}</div>
              ${m.location ? `<div class="hint">${icon('mapPin', 11)} ${U.esc(m.location.slice(0, 80))}</div>` : ''}
              <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">
                ${m.link ? `<a class="teams-btn" href="${U.esc(m.link)}" target="_blank" rel="noopener">${icon('users', 12)}Join Teams</a>` : ''}
                ${m.reminderId ? `<span class="badge">${icon('bell', 10)}Pengingat</span>` : ''}${m.source === 'ics' ? '<span class="badge">.ics</span>' : ''}
                <span style="margin-left:auto"></span><button class="icon-btn sm" data-medit="${m.id}" title="Edit">${icon('pencil', 13)}</button><button class="icon-btn sm danger" data-mdel="${m.id}" title="Hapus">${icon('trash', 13)}</button></div></div></div>`;
          return `<div class="agenda-item" data-open="${it.type}" data-id="${m.id}" style="cursor:pointer"><div class="agenda-time"><span class="badge ${lbl[it.type][1]}">${lbl[it.type][0]}</span></div>
            <div class="agenda-body"><div class="agenda-title" style="${it.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${U.esc(it.title)}</div></div></div>`;
        }).join('') : `<div class="empty">${icon('calendar', 24)}<b>Tidak ada agenda</b>Klik “+ Meeting” untuk menambah jadwal.</div>`}</div>`;
    },

    openItem(type, id) {
      if (type === 'monthly') return Monthly.edit(Monthly.items.find((x) => x.id === id));
      if (type === 'event') return EventMod.edit(EventMod.C.get(id));
      if (type === 'promo') return Promo.edit(Promo.C.get(id));
    },

    async syncReminder(m, want) {
      if (m.reminderId) { await Daily.remove(m.reminderId); m.reminderId = null; }
      if (!want || m.allDay || !m.start || m.date < U.today()) return;
      const [h, mi] = m.start.split(':').map(Number);
      const t = new Date(2000, 0, 1, h, mi - 10);
      const task = await Daily.add(m.date, `Meeting: ${m.title}`, U.fmtTime(t));
      m.reminderId = task.id;
    },

    edit(m, date) {
      const isNew = !m;
      const d = m ? { ...m, remind: !!m.reminderId } : { title: '', date: date || U.today(), start: '09:00', end: '10:00', link: '', location: '', notes: '', remind: true };
      U.form({
        title: isNew ? 'Tambah Jadwal Meeting' : 'Edit Jadwal', icon: 'calendarDays', data: d,
        fields: [
          { key: 'title', label: 'Judul meeting', required: true, placeholder: 'Weekly review MT dengan ASM' },
          { key: 'date', label: 'Tanggal', type: 'date', required: true },
          { key: 'start', label: 'Mulai', type: 'time', half: true }, { key: 'end', label: 'Selesai', type: 'time', half: true },
          { key: 'link', label: 'Link MS Teams', type: 'url', placeholder: 'https://teams.microsoft.com/l/meetup-join/…', hint: 'Tempel undangan lengkap juga bisa — link Teams diambil otomatis' },
          { key: 'location', label: 'Lokasi / ruang', placeholder: 'Online / Kantor SARB' },
          { key: 'notes', label: 'Catatan / agenda', type: 'textarea', rows: 3 },
          { key: 'remind', label: 'Buat pengingat di Daily Task', type: 'check', hint: 'alarm berbunyi 10 menit sebelum mulai' },
        ],
        onSave: async (v) => {
          const lk = (v.link.match(TEAMS_RE) || [v.link])[0];
          const rec = { ...(m || { source: 'manual' }), title: v.title, date: v.date, start: v.start, end: v.end, allDay: !v.start, link: lk, location: v.location, notes: v.notes };
          await this.syncReminder(rec, v.remind);
          await C.save(rec); this.sel = rec.date;
          U.toast(isNew ? 'Jadwal ditambahkan' : 'Jadwal disimpan');
        },
      });
    },
    async remove(id) {
      const m = C.get(id); if (!m || !(await U.confirm(`Hapus jadwal "${m.title}"?`))) return;
      if (m.reminderId) await Daily.remove(m.reminderId);
      await C.remove(id);
    },

    async importICS() {
      const [file] = await U.pickFiles({ accept: '.ics,text/calendar' }); if (!file) return;
      let evs;
      try { evs = parseICS(await file.text()); } catch (e) { return U.toast('File .ics tidak terbaca: ' + e.message, 'bad'); }
      const from = U.ymd(U.addDays(new Date(), -60)), to = U.ymd(U.addDays(new Date(), 180));
      const occ = [];
      for (const ev of evs) for (const ds of expand(ev, from, to)) {
        const link = ev.teams || ((ev.desc || '') + ' ' + (ev.location || '') + ' ' + (ev.url || '')).match(TEAMS_RE)?.[0] || '';
        occ.push({ uid: (ev.uid || ev.title) + '@' + ds, title: ev.title || '(tanpa judul)', date: ds, start: ev.start.time, end: ev.end ? ev.end.time : '', allDay: ev.start.allDay, link, location: (ev.location || '').replace(TEAMS_RE, '').trim(), notes: (ev.desc || '').replace(/_{5,}[\s\S]*$/, '').trim().slice(0, 800), source: 'ics' });
      }
      const existing = new Set(C.items.map((m) => m.uid).filter(Boolean));
      const fresh = occ.filter((o) => !existing.has(o.uid));
      const upcoming = fresh.filter((o) => o.date >= U.today());
      U.modal({
        title: 'Import Kalender (.ics)', icon: 'upload',
        body: `<div class="callout">${icon('sparkles', 15)}<div><b>${U.esc(file.name)}</b>: ${evs.length} event → ${occ.length} jadwal dalam rentang 60 hari lalu s/d 180 hari ke depan.
            <br><b>${fresh.length}</b> baru, ${occ.length - fresh.length} sudah ada (dilewati). ${fresh.filter((o) => o.link).length} punya link Teams.</div></div>
          ${fresh.slice(0, 8).map((o) => `<div class="hint">• ${U.fmtDM(o.date)} ${o.start} — ${U.esc(o.title)}${o.link ? ' 🔗' : ''}</div>`).join('')}${fresh.length > 8 ? `<div class="hint">… dan ${fresh.length - 8} lainnya</div>` : ''}
          <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" class="chk" id="icsRem"/>Buat pengingat Daily Task (alarm 10 menit sebelum) untuk ${upcoming.filter((o) => !o.allDay).length} meeting mendatang</label>
          <div class="hint">Cara export: Outlook → Calendar → <i>Save Calendar</i> / <i>Share → Export (.ics)</i>. Teams memakai kalender Outlook yang sama.</div>`,
        buttons: [{ label: 'Batal', cls: 'ghost' }, {
          label: `Import ${fresh.length} jadwal`, cls: 'primary', onClick: async (ctx) => {
            const rem = U.$('#icsRem', ctx.el).checked;
            for (const o of fresh) { if (rem) await this.syncReminder(o, true); o.id = U.uid(); o.createdAt = Date.now(); C.items.push(o); }
            await DB.putMany('calendar', fresh); U.emit('data', { store: 'calendar' });
            U.toast(`${fresh.length} jadwal diimpor`);
          },
        }],
      });
    },
  };

  Kalender.parseICS = parseICS; Kalender.expand = expand;
  window.Kalender = Kalender;
  App.register('kalender', Kalender);
})();
