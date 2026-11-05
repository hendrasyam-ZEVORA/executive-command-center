/* Sales Performance — membaca LANGSUNG file Excel Anda (tanpa pemetaan sel).
   File yang dikenali otomatis (bisa dipilih sekaligus):
     1) Target_STT_Net_2026.xlsx           → target per bulan × distributor × channel × account (FSS NAME)
     2) Data_RF_..._Performance.xlsx        → sheet "Sales Per Day": actual harian (Sales Amount Exc. Tax, retur sudah minus)
     3) Data_Performance_YTD.xlsx (opsional) → Net Revenue resmi per bulan (riwayat bulan yang sudah tutup)
   Cakupan actual = distributor & market channel yang ADA di file target (apple-to-apple).
   kv: 'salesData' (hasil olahan ringkas), 'salesHandles' (handle file), 'salesCfg' (hari kerja, KPI manual). */
(function () {
  const norm = (s) => String(s ?? '').toUpperCase().replace(/,/g, '.').replace(/\s+/g, ' ').trim();
  const ymOf = (d) => d.slice(0, 7);
  const shortDist = (d) => (/SINAR ANUGERAH/.test(d) ? 'SARB' : /WIRA EKA/.test(d) ? 'WEP' : d.split(' ').slice(0, 2).join(' ')) + (/- (\w+)$/.test(d) ? ' ' + d.match(/- (\w+)$/)[1].replace(/^(\w)(\w*)$/, (m, a, b) => a + b.toLowerCase()) : '');
  const ymLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${U.BULAN[m - 1]} ${y}`; };
  const prevYm = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${U.p2(m - 1)}`; };
  const nextYm = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${U.p2(m + 1)}`; };
  const lastDayOf = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${U.p2(new Date(y, m, 0).getDate())}`; };

  const Sales = {
    data: null,      // { target, rf, ytd, syncedAt }
    handles: {},     // { target, rf, ytd } FileSystemFileHandle
    cfg: { workdays: 'monsat', kpi: NaN, kpiNote: '' },
    view: { ym: null, dist: 'all' },

    async load() {
      this.data = await DB.kv.get('salesData', null);
      this.cfg = Object.assign(this.cfg, await DB.kv.get('salesCfg', {}));
      try { this.handles = (await DB.kv.get('salesHandles', {})) || {}; } catch { this.handles = {}; }
    },
    async saveCfg() { await DB.kv.set('salesCfg', this.cfg); U.emit('sales'); },

    /* ================= PARSER ================= */
    async identifyAndParse(file) {
      if (!/\.xlsx$/i.test(file.name)) throw new Error(`${file.name}: hanya file .xlsx yang didukung`);
      const wb = await XLSX.open(file);
      const meta = { name: file.name, size: file.size, lastModified: file.lastModified };
      if (wb.sheetNames.includes('Sales Per Day')) return { role: 'rf', parsed: this.parseRF(await wb.load('Sales Per Day')), meta };
      const ytdName = wb.sheetNames.find((n) => /data performance/i.test(n));
      if (ytdName) return { role: 'ytd', parsed: this.parseYTD(await wb.load(ytdName)), meta };
      const first = await wb.load(wb.sheetNames[0]);
      const rows = XLSX.toRows(first);
      const hdr = (rows[0] || []).map(norm);
      if (hdr.includes('FSS NAME') && hdr.some((h) => /DISTRIBUTOR NAME/.test(h))) return { role: 'target', parsed: this.parseTarget(rows), meta };
      throw new Error(`${file.name}: format tidak dikenali (butuh file Target STT, RF "Sales Per Day", atau Data Performance YTD)`);
    },

    parseTarget(rows) {
      const hdr = rows[0].map(norm);
      const ci = (re) => hdr.findIndex((h) => re.test(h));
      const cDist = hdr.indexOf('DISTRIBUTOR NAME 2026') >= 0 ? hdr.indexOf('DISTRIBUTOR NAME 2026') : ci(/^DISTRIBUTOR NAME/);
      const cCh = ci(/^MARKET CHANNEL$/), cAcct = ci(/^ACCOUNT$/), cFss = ci(/^FSS NAME$/), cFssCode = ci(/^FSS CODE$/);
      const months = rows[0].map((v, j) => ({ j, ym: XLSX.serialToYmd(v) })).filter((x) => x.ym).map((x) => ({ j: x.j, ym: ymOf(x.ym) }));
      if (!months.length) throw new Error('Kolom bulan pada file target tidak ditemukan');
      const out = {}; const fss = new Set(), fssCode = new Set();
      for (const r of rows.slice(1)) {
        if (!r || r[cDist] == null) continue;
        const dist = norm(r[cDist]), ch = norm(r[cCh]), acct = norm(r[cAcct]);
        const k = `${dist}|${ch}|${acct}`;
        const row = out[k] || (out[k] = { dist, ch, acct, m: {} });
        for (const { j, ym } of months) { const v = r[j]; if (typeof v === 'number') row.m[ym] = (row.m[ym] || 0) + v; }
        if (r[cFss]) fss.add(String(r[cFss])); if (r[cFssCode]) fssCode.add(String(r[cFssCode]));
      }
      return { rows: Object.values(out), fss: [...fss], fssCode: [...fssCode], months: months.map((m) => m.ym) };
    },

    parseRF(sheet) {
      const rows = XLSX.toRows(sheet);
      const h = rows.findIndex((r) => r && norm(r[0]) === 'FIX DISTRIBUTOR');
      if (h < 0) throw new Error('Header "Fix Distributor" tidak ditemukan di sheet Sales Per Day');
      const dates = rows[h].map((v, j) => ({ j, d: XLSX.serialToYmd(v) })).filter((x) => x.d);
      const out = {}; let fill = [];
      let last = '';
      for (const r of rows.slice(h + 1)) {
        if (!r || !r.length) continue;
        if (/GRAND TOTAL|TOTAL$/.test(norm(r[0]))) continue;
        const dims = [0, 1, 2, 3, 4].map((i) => (r[i] != null && r[i] !== '' ? r[i] : fill[i]));
        fill = dims;
        if (!dims[0]) continue;
        const dist = norm(dims[0]), ch = norm(dims[1]), sub = norm(dims[2]), acct = norm(dims[3]);
        const k = `${dist}|${ch}|${acct}`;
        const row = out[k] || (out[k] = { dist, ch, sub, acct, d: {} });
        for (const { j, d } of dates) {
          const v = r[j];
          if (typeof v === 'number' && v !== 0) { row.d[d] = (row.d[d] || 0) + v; if (d > last) last = d; }
        }
      }
      return { rows: Object.values(out), lastDate: last, firstDate: dates.length ? dates[0].d : '' };
    },

    parseYTD(sheet) {
      const rows = XLSX.toRows(sheet);
      // Blok pertama "Sum of Net Revenue" by Account: baris judul berisi tanggal bulan, header 'Distributor Name | Sub Channel | Account'
      const t = rows.findIndex((r) => r && r.some((c) => typeof c === 'string' && /REVENUE SALES.*BY ACCOUNT/i.test(c)));
      const h = rows.findIndex((r, i) => i > t && r && norm(r[0]) === 'DISTRIBUTOR NAME' && norm(r[2]) === 'ACCOUNT');
      if (t < 0 || h < 0) throw new Error('Blok "REVENUE SALES ... BY ACCOUNT" tidak ditemukan');
      const months = rows[t].map((v, j) => ({ j, ym: XLSX.serialToYmd(v) })).filter((x) => x.ym).map((x) => ({ j: x.j, ym: ymOf(x.ym) }));
      const fssRow = rows.slice(0, t).find((r) => r && norm(r[0]) === 'FSS NAME');
      const out = {}; let fill = [];
      for (const r of rows.slice(h + 1)) {
        if (!r) continue;
        if (norm(r[0]) === 'GRAND TOTAL') break;
        const dims = [0, 1, 2].map((i) => (r[i] != null && r[i] !== '' ? r[i] : fill[i])); fill = dims;
        if (!dims[0]) continue;
        const dist = norm(dims[0]), acct = norm(dims[2]);
        const k = `${dist}|${acct}`;
        const row = out[k] || (out[k] = { dist, sub: norm(dims[1]), acct, m: {} });
        for (const { j, ym } of months) { const v = r[j]; if (typeof v === 'number') row.m[ym] = (row.m[ym] || 0) + v; }
      }
      return { rows: Object.values(out), fss: fssRow ? String(fssRow[1]) : '', months: months.map((m) => m.ym) };
    },

    /* ================= SYNC ================= */
    async sync() {
      const roles = ['target', 'rf', 'ytd'].filter((r) => this.handles[r] && this.handles[r].getFile);
      if (!roles.length) return this.configure();
      const files = [];
      try {
        for (const r of roles) {
          const h = this.handles[r];
          let perm = await h.queryPermission({ mode: 'read' });
          if (perm !== 'granted') perm = await h.requestPermission({ mode: 'read' });
          if (perm !== 'granted') throw new Error('Izin baca file ditolak');
          files.push(await h.getFile());
        }
      } catch (e) {
        U.toast('Tidak bisa membaca ulang file tersimpan — silakan pilih ulang', 'warn', 4000);
        return this.configure();
      }
      await this.ingest(files);
    },

    async ingest(files, handlesByName = {}) {
      const t0 = performance.now();
      U.toast(`Membaca ${files.length} file…`, 'info', 2500);
      const data = this.data ? { ...this.data } : {};
      const done = [];
      for (const f of files) {
        try {
          const res = await this.identifyAndParse(f);
          data[res.role] = { ...res.parsed, file: res.meta };
          if (handlesByName[f.name]) this.handles[res.role] = handlesByName[f.name];
          done.push(res.role);
        } catch (e) { console.error(e); U.toast(e.message, 'bad', 6000); }
      }
      if (!done.length) return false;
      data.syncedAt = Date.now();
      this.data = data;
      await DB.kv.set('salesData', data);
      try { await DB.kv.set('salesHandles', this.handles); } catch { /* browser tanpa dukungan simpan handle */ }
      this.view.ym = null;
      U.emit('sales');
      const lbl = { target: 'Target', rf: 'RF harian', ytd: 'Resmi YTD' };
      U.toast(`Diperbarui: ${done.map((r) => lbl[r]).join(', ')} · ${((performance.now() - t0) / 1000).toFixed(1)} dtk`, 'good', 4000);
      return true;
    },

    async pickFiles() {
      if (window.showOpenFilePicker) {
        try {
          const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
          const files = await Promise.all(hs.map((h) => h.getFile()));
          const byName = {}; hs.forEach((h, i) => { byName[files[i].name] = h; });
          return { files, byName };
        } catch (e) { if (e.name === 'AbortError') return null; }
      }
      const files = await U.pickFiles({ accept: '.xlsx', multiple: true });
      return files.length ? { files, byName: {} } : null;
    },

    /* ================= PERHITUNGAN ================= */
    scope() {
      const t = this.data && this.data.target;
      if (!t) return null;
      const dists = [...new Set(t.rows.map((r) => r.dist))].sort();
      const chans = [...new Set(t.rows.map((r) => r.ch))];
      return { dists, chans };
    },
    inScope(r, sc, dist) { return sc.dists.includes(r.dist) && sc.chans.includes(r.ch) && (dist === 'all' || r.dist === dist); },
    workdays(ym, uptoDay) {
      const [y, m] = ym.split('-').map(Number); const last = uptoDay ?? new Date(y, m, 0).getDate(); let n = 0;
      for (let d = 1; d <= last; d++) if (this.cfg.workdays === 'all' || new Date(y, m - 1, d).getDay() !== 0) n++;
      return n;
    },
    availableMonths() {
      const rf = this.data && this.data.rf; if (!rf || !rf.lastDate) return [];
      const out = []; let ym = ymOf(rf.firstDate || rf.lastDate); const end = ymOf(rf.lastDate);
      while (ym <= end) { out.push(ym); ym = nextYm(ym); }
      return out;
    },

    compute() {
      const D = this.data; if (!D || !D.rf || !D.target) return null;
      const sc = this.scope(); const dist = this.view.dist;
      const latest = ymOf(D.rf.lastDate);
      const ym = this.view.ym || latest;
      const isCurrent = ym === latest;
      const asOf = isCurrent ? D.rf.lastDate : lastDayOf(ym);
      const asDay = +asOf.slice(8, 10);
      const lm = prevYm(ym);

      const rfRows = D.rf.rows.filter((r) => this.inScope(r, sc, dist));
      const tRows = D.target.rows.filter((r) => this.inScope(r, sc, dist));
      const sumD = (row, from, to) => { let s = 0; for (const [d, v] of Object.entries(row.d)) if (d >= from && d <= to) s += v; return s; };

      // per account
      const acc = {};
      const A = (acct) => acc[acct] || (acc[acct] = { acct, target: 0, mtd: 0, lmSame: 0, lmFull: 0, dists: new Set() });
      for (const r of tRows) { const a = A(r.acct); a.target += r.m[ym] || 0; if (r.m[ym]) a.dists.add(r.dist); }
      for (const r of rfRows) {
        const a = A(r.acct);
        a.mtd += sumD(r, `${ym}-01`, asOf);
        a.lmSame += sumD(r, `${lm}-01`, `${lm}-${U.p2(Math.min(asDay, +lastDayOf(lm).slice(8)))}`);
        a.lmFull += sumD(r, `${lm}-01`, lastDayOf(lm));
        if (a.mtd) a.dists.add(r.dist);
      }
      const accounts = Object.values(acc).filter((a) => a.target || a.mtd || a.lmSame || a.lmFull)
        .map((a) => ({ ...a, dists: [...a.dists].map(shortDist), ach: a.target ? a.mtd / a.target : NaN, growth: a.lmSame > 0 ? a.mtd / a.lmSame - 1 : NaN }));

      const target = accounts.reduce((s, a) => s + a.target, 0);
      const mtd = accounts.reduce((s, a) => s + a.mtd, 0);
      const lmSame = accounts.reduce((s, a) => s + a.lmSame, 0);
      const lmFull = accounts.reduce((s, a) => s + a.lmFull, 0);
      const lmTarget = tRows.reduce((s, r) => s + (r.m[lm] || 0), 0);

      // resmi (YTD) bulan lalu & bulan ini — cakupan distributor sama
      let official = null;
      if (D.ytd) {
        const yRows = D.ytd.rows.filter((r) => sc.dists.includes(r.dist) && (dist === 'all' || r.dist === dist));
        const tot = (m) => yRows.reduce((s, r) => s + (r.m[m] || 0), 0);
        const has = D.ytd.months.includes(lm);
        official = has ? { ym: lm, value: tot(lm), ach: lmTarget ? tot(lm) / lmTarget : NaN, current: D.ytd.months.includes(ym) ? tot(ym) : NaN } : null;
      }

      // kumulatif harian (sparkline)
      const days = []; let cum = 0;
      for (let d = 1; d <= asDay; d++) {
        const ds = `${ym}-${U.p2(d)}`; let s = 0;
        for (const r of rfRows) s += r.d[ds] || 0;
        cum += s; days.push(cum);
      }

      const total = this.workdays(ym);
      const elapsed = Math.max(1, this.workdays(ym, asDay));
      const remaining = Math.max(0, total - elapsed);
      const ach = target ? mtd / target : NaN;
      const timeGone = elapsed / total;
      const daily = mtd / elapsed;
      const projection = isCurrent ? daily * total : mtd;
      const projAch = target ? projection / target : NaN;
      const gap = Math.max(0, target - mtd);
      const needDaily = remaining ? gap / remaining : gap;
      const pace = isFinite(ach) ? (isCurrent ? ach / timeGone : ach) : NaN;
      const status = !isFinite(pace) ? '' : pace >= 1 ? 'good' : pace >= 0.9 ? 'warn' : 'bad';
      let kpi = this.cfg.kpi; if (isFinite(kpi) && kpi > 1.5) kpi /= 100;
      accounts.forEach((a) => { a.proj = isCurrent ? (a.mtd / elapsed) * total : a.mtd; a.projAch = a.target ? a.proj / a.target : NaN; a.need = remaining ? Math.max(0, a.target - a.mtd) / remaining : 0; });
      accounts.sort((a, b) => b.target - a.target || b.mtd - a.mtd);

      return {
        ym, isCurrent, monthLabel: ymLabel(ym), lmLabel: ymLabel(lm), asOf, mtd, target, kpi, lmSame, lmFull, lmTarget,
        growth: lmSame > 0 ? mtd / lmSame - 1 : NaN, lmAch: lmTarget ? lmFull / lmTarget : NaN,
        official, accounts, history: days, scope: sc, dist,
        fss: D.target.fss.join(', '), files: { target: D.target.file, rf: D.rf.file, ytd: D.ytd && D.ytd.file }, updatedAt: D.syncedAt,
        total, elapsed, remaining, ach, timeGone, daily, projection, projAch, gap, needDaily, pace, status,
      };
    },
    shortDist,
    prevYm, nextYm, ymLabel,
    /* Dipakai Program Monitoring: actual RF satu account (cakupan target) pada rentang tanggal */
    accountNames() { const D = this.data; if (!D || !D.rf) return []; const sc = this.scope(); return [...new Set(D.rf.rows.filter((r) => !sc || this.inScope(r, sc, 'all')).map((r) => r.acct))].sort(); },
    actualFor(acct, from, to) {
      const D = this.data; if (!D || !D.rf) return null;
      const sc = this.scope(); const a = norm(acct); let s = 0, found = false;
      for (const r of D.rf.rows) {
        if (r.acct !== a || (sc && !this.inScope(r, sc, 'all'))) continue; found = true;
        for (const [d, v] of Object.entries(r.d)) if (d >= from && d <= to) s += v;
      }
      return found ? { value: s, asOf: D.rf.lastDate < to ? D.rf.lastDate : to } : null;
    },

    /* ================= MODAL SUMBER DATA ================= */
    configure() {
      const self = this;
      const slot = (role, title, desc) => {
        const f = self.data && self.data[role] && self.data[role].file;
        const linked = self.handles[role] && self.handles[role].getFile;
        return `<div class="map-row" style="grid-template-columns:28px 1fr auto;cursor:default">
          <span class="kpi-ic" style="${f ? 'background:var(--good-soft);color:var(--good)' : ''}">${icon(f ? 'check' : 'fileSheet', 14)}</span>
          <div><div class="lbl">${title}</div><div class="hint">${f ? `<b>${U.esc(f.name)}</b> · ${U.fmtBytes(f.size)} · diubah ${U.fmtDateTime(f.lastModified)}` : desc}</div></div>
          <span class="badge ${linked ? 'good' : f ? '' : 'warn'}">${linked ? 'Sync 1-klik' : f ? 'Tersimpan' : role === 'ytd' ? 'Opsional' : 'Belum ada'}</span></div>`;
      };
      const validation = () => {
        const D = self.data; if (!D || !D.rf || !D.target) return '<div class="hint">Validasi muncul setelah file Target + RF dimuat.</div>';
        const keep = self.view.ym; const out = [];
        const months = self.availableMonths().slice(-4);
        for (const ym of months) { self.view.ym = ym; const k = self.compute(); out.push({ ym, k }); }
        self.view.ym = keep;
        return `<div class="grid-preview" style="max-height:none"><table style="width:100%">
          <tr><th style="text-align:left">Bulan</th><th>Target</th><th>Actual RF</th><th>% Ach RF</th><th>Net Revenue resmi</th><th>% Ach resmi</th><th>Data s/d</th></tr>
          ${out.map(({ ym, k }) => {
            const off = D.ytd ? D.ytd.rows.filter((r) => k.scope.dists.includes(r.dist)).reduce((s, r) => s + (r.m[ym] || 0), 0) : NaN;
            return `<tr><td style="text-align:left;cursor:default">${ymLabel(ym)}</td><td style="text-align:right">${U.fmtNum(k.target)}</td><td style="text-align:right">${U.fmtNum(k.mtd)}</td>
              <td style="text-align:right"><b>${U.fmtPct(k.ach)}</b></td><td style="text-align:right">${isFinite(off) ? U.fmtNum(off) : '–'}</td>
              <td style="text-align:right">${isFinite(off) && k.target ? U.fmtPct(off / k.target) : '–'}</td><td>${U.fmtDM(k.asOf)}</td></tr>`;
          }).join('')}</table></div>`;
      };
      const sc = self.scope();
      U.modal({
        title: 'Sumber Data Sales', icon: 'database', size: 'lg', sticky: true,
        body: `
          <div class="callout">${icon('sparkles', 15)}<div>Pilih <b>3 file sekaligus</b> (Ctrl+klik): Target STT Net, Data RF (sheet <i>Sales Per Day</i>), dan Data Performance YTD.
            File dikenali otomatis & dihitung dengan logika tetap — tidak perlu memetakan sel. Di Chrome/Edge, tombol <b>Sync</b> berikutnya membaca ulang file yang sama.</div></div>
          <div style="display:flex;gap:8px;align-items:center"><button class="btn primary" id="sPick">${icon('upload', 14)} Pilih File Excel…</button>
            <span class="hint" id="sStatus"></span></div>
          <div class="map-list" id="sSlots">
            ${slot('target', 'Target STT Net', 'Target_STT_Net_2026.xlsx — target per bulan per account')}
            ${slot('rf', 'Actual harian (RF)', 'Data_RF_Salesman_Costumer_Performance.xlsx — sheet Sales Per Day')}
            ${slot('ytd', 'Net Revenue resmi (YTD)', 'Data_Performance_YTD.xlsx — untuk riwayat bulan yang sudah tutup')}
          </div>
          ${sc ? `<div class="hint">${icon('target', 12)} Cakupan mengikuti target${self.data.target.fss.length ? ` (FSS <b>${U.esc(self.data.target.fss.join(', '))}</b>)` : ''}: ${sc.dists.map((d) => `<span class="badge">${U.esc(shortDist(d))}</span>`).join(' ')} · channel ${sc.chans.map((c) => `<span class="badge">${U.esc(c)}</span>`).join(' ')}</div>` : ''}
          <div class="field"><label>Validasi angka (cakupan target)</label><div id="sVal">${validation()}</div></div>
          <div class="field-row" style="border-top:1px solid var(--border);padding-top:12px">
            <div class="field"><label>Hari kerja untuk Run Rate</label>
              <div class="seg" id="sWd"><button data-v="monsat">Senin–Sabtu</button><button data-v="all">Semua hari</button></div></div>
            <div class="field"><label>KPI Performance (%) — isi manual</label>
              <input class="input mono" id="sKpi" placeholder="mis. 92" value="${isFinite(self.cfg.kpi) ? +(self.cfg.kpi * (self.cfg.kpi <= 1.5 ? 100 : 1)).toFixed(2) : ''}" /></div>
          </div>`,
        buttons: [
          { label: 'Tutup', cls: 'ghost' },
          {
            label: 'Simpan', cls: 'primary', icon: 'check',
            onClick: async (ctx) => {
              const raw = U.$('#sKpi', ctx.el).value.trim();
              self.cfg.kpi = raw ? U.toNum(raw.replace('%', '')) : NaN; // 92 → 92% ; 0,92 → 92%
              await self.saveCfg();
            },
          },
        ],
        onMount: (el) => {
          const box = U.$('#sWd', el);
          const paint = () => U.$$('button', box).forEach((b) => b.classList.toggle('active', b.dataset.v === self.cfg.workdays));
          box.onclick = (e) => { const b = e.target.closest('button'); if (b) { self.cfg.workdays = b.dataset.v; paint(); U.$('#sVal', el).innerHTML = validation(); } }; paint();
          U.$('#sPick', el).onclick = async () => {
            const r = await self.pickFiles(); if (!r) return;
            U.$('#sStatus', el).innerHTML = `${icon('refresh', 12)} Membaca ${r.files.length} file… (file RF besar butuh beberapa detik)`;
            const ok = await self.ingest(r.files, r.byName);
            U.$('#sStatus', el).textContent = ok ? 'Selesai' : 'Gagal — lihat pesan';
            U.$('#sSlots', el).innerHTML = slot('target', 'Target STT Net', '–') + slot('rf', 'Actual harian (RF)', '–') + slot('ytd', 'Net Revenue resmi (YTD)', 'Opsional');
            U.$('#sVal', el).innerHTML = validation();
          };
        },
      });
    },
  };

  window.Sales = Sales;
  App.register('_sales', { load: () => Sales.load() });
})();
