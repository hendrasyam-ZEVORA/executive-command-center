/* MENU 1 — Beranda Utama (Dashboard) */
(function () {
  const tzLabel = () => { const o = -new Date().getTimezoneOffset() / 60; return o === 7 ? 'WIB' : o === 8 ? 'WITA' : o === 9 ? 'WIT' : 'UTC' + (o >= 0 ? '+' : '') + o; };
  const greet = (h) => (h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam');

  const Beranda = {
    chart: null,
    el: null,

    render(el) {
      this.el = el;
      el.innerHTML = `
        <div class="hero">
          <div class="hero-date">
            <div class="greet" id="hGreet"></div>
            <div class="date" id="hDate"></div>
            <div class="clock" id="hClock"></div>
          </div>
          <div class="card alarm-banner" id="hAlarm"></div>
        </div>

        <div class="sales-head">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div class="section-title" style="margin:0">${icon('trendUp', 14)}Sales Performance</div>
            <div class="week-nav" id="hMonthNav">
              <button class="icon-btn sm" data-mnav="-1" title="Bulan sebelumnya">${icon('chevronLeft', 14)}</button>
              <b id="hSalesMonth" style="font-size:13px;min-width:112px;text-align:center"></b>
              <button class="icon-btn sm" data-mnav="1" title="Bulan berikutnya">${icon('chevronRight', 14)}</button>
            </div>
            <div class="seg" id="hDistSeg"></div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span class="sales-meta" id="hSalesMeta"></span>
            <div class="btn-group">
              <button class="btn sm primary" id="hSync" title="Baca ulang file Excel & hitung ulang">${icon('refresh', 13)}Sync Data Sales</button>
              <button class="btn sm" id="hSalesCfg" title="Sumber file, validasi angka, KPI manual">${icon('settings', 13)}</button>
            </div>
          </div>
        </div>
        <div class="kpi-row" id="hKpi"></div>
        <div class="sales-note" id="hSalesNote"></div>
        <div class="card" id="hAccCard" style="margin-bottom:22px">
          <div class="card-h"><div><div class="card-t">${icon('building', 16)}Performance per Account</div><div class="card-s" id="hAccSub"></div></div>
            <div class="seg" id="hAccSort"><button data-s="target">Target</button><button data-s="ach">% Ach</button><button data-s="gap">Gap</button></div></div>
          <div class="acc-table-wrap" id="hAcc"></div>
        </div>

        <div class="home-grid">
          <div class="home-left">
            <div class="card">
              <div class="card-h">
                <div><div class="card-t">${icon('activity', 16)}Produktivitas Minggu Ini</div><div class="card-s" id="hChartSub"></div></div>
                <div class="chart-legend"><span><i style="background:var(--accent)"></i>Selesai</span><span><i style="background:var(--good)"></i>Hari ini</span><span><i style="background:var(--surface-3)"></i>Total tugas</span></div>
              </div>
              <div class="card-b"><div id="hChart"></div></div>
            </div>
            <div class="home-split">
              <div class="card">
                <div class="card-h"><div class="card-t">${icon('calendarCheck', 16)}Daily Task Hari Ini <span class="badge" id="hDailyCount"></span></div>
                  <a href="#/daily" class="btn ghost sm">Buka ${icon('arrowRight', 13)}</a></div>
                <div class="card-b" id="hDailyBox">
                  <div class="feed-scroll" id="hDaily"></div>
                  <form class="quick-add" id="hDailyAdd" autocomplete="off">
                    <input class="input sm" type="text" placeholder="Tugas cepat untuk hari ini…" maxlength="200" />
                    <input class="input sm" type="time" title="Jam alarm (opsional)" />
                    <button class="btn sm primary" type="submit" title="Tambah">${icon('plus', 14)}</button>
                  </form>
                </div>
              </div>
              <div class="card">
                <div class="card-h"><div class="card-t">${icon('stickyNote', 16)}Monthly Task Jatuh Tempo <span class="badge" id="hMonthCount"></span></div>
                  <button class="btn ghost sm" id="hMonthNew" title="Tugas bulanan baru">${icon('plus', 13)}</button></div>
                <div class="card-b"><div class="feed-scroll" id="hMonthly"></div></div>
              </div>
            </div>
          </div>
          <div class="card news-card" id="hNews"></div>
        </div>`;

      // Chart
      this.chart = new BarChart(U.$('#hChart', el), this.chartData());
      // Daily feed: pakai handler yang sama dengan Menu 2
      const box = U.$('#hDailyBox', el);
      U.$('#hDailyAdd', el).dataset.add = U.today();
      Daily.bindGrid(box);
      // Monthly feed
      U.$('#hMonthly', el).addEventListener('change', (e) => { if (e.target.matches('[data-mtoggle]')) Monthly.toggle(e.target.closest('[data-mid]').dataset.mid, e.target.checked); });
      U.$('#hMonthly', el).addEventListener('click', (e) => {
        const op = e.target.closest('[data-open]'); if (op) return DB.openFile(op.dataset.open);
        const t = e.target.closest('[data-medit]'); if (t) Monthly.edit(Monthly.items.find((x) => x.id === t.closest('[data-mid]').dataset.mid));
      });
      U.$('#hMonthNew', el).onclick = () => Monthly.edit();
      // Sales
      U.$('#hSync', el).onclick = async (e) => { const b = e.currentTarget; b.disabled = true; await Sales.sync(); b.disabled = false; };
      U.$('#hSalesCfg', el).onclick = () => Sales.configure();
      U.$('#hMonthNav', el).onclick = (e) => {
        const b = e.target.closest('[data-mnav]'); if (!b) return;
        const months = Sales.availableMonths(); if (!months.length) return;
        const cur = Sales.view.ym || months[months.length - 1];
        const i = U.clamp(months.indexOf(cur) + +b.dataset.mnav, 0, months.length - 1);
        Sales.view.ym = i === months.length - 1 ? null : months[i]; this.paintSales();
      };
      U.$('#hDistSeg', el).onclick = (e) => { const b = e.target.closest('[data-d]'); if (b) { Sales.view.dist = b.dataset.d; this.paintSales(); } };
      this.accSort = 'target';
      U.$('#hAccSort', el).onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { this.accSort = b.dataset.s; this.paintSales(); } };
      // Alarm banner actions
      U.$('#hAlarm', el).addEventListener('click', (e) => {
        if (e.target.closest('[data-snd]')) { Alarm.test(); setTimeout(() => this.paintAlarm(true), 300); }
        if (e.target.closest('[data-notif]')) Alarm.requestNotif();
        if (e.target.closest('[data-goto]')) location.hash = '#/daily';
      });
      // News
      News.mount(U.$('#hNews', el));

      // Reaktif
      U.on('tick', (now) => { if (App.current === 'beranda') { this.paintClock(now); this.paintAlarm(false); } });
      U.on('data', () => { if (App.current === 'beranda') this.paintData(); else this.dirty = true; });
      U.on('alarmstate', () => App.current === 'beranda' && this.paintAlarm(true));
      U.on('sales', () => this.paintSales());
      U.on('daychange', () => { U.$('#hDailyAdd', el).dataset.add = U.today(); this.paintAll(); });
      this.paintAll();
    },
    onShow() { if (this.dirty) { this.dirty = false; this.paintData(); } this.paintClock(new Date()); this.paintAlarm(true); },

    paintAll() { this.paintClock(new Date()); this.paintAlarm(true); this.paintSales(); this.paintData(); },
    paintData() { this.paintChart(); this.paintDaily(); this.paintMonthly(); this.paintAlarm(true); },

    paintClock(now) {
      U.$('#hGreet').textContent = greet(now.getHours()) + ' 👋';
      U.$('#hDate').textContent = U.fmtLong(now);
      U.$('#hClock').innerHTML = `${U.p2(now.getHours())}:${U.p2(now.getMinutes())}<span class="sec">:${U.p2(now.getSeconds())}</span><span class="tz">${tzLabel()}</span>`;
    },

    /* ---------- Alarm & countdown ---------- */
    paintAlarm(full) {
      const box = U.$('#hAlarm'); if (!box) return;
      const n = Alarm.next();
      const ringing = Alarm.ringing;
      const key = (ringing ? 'R' + ringing.id : '') + (n ? n.task.id + n.at + n.queue.map((q) => q.task.id).join() : 'none') + Alarm.missed().length + Alarm.soundReady() + (window.Notification ? Notification.permission : '');
      if (!full && key === this._alarmKey) {
        if (n) { const c = U.$('[data-count]', box); if (c) c.textContent = U.dur(n.left); const bar = U.$('.ab-bar', box); if (bar) bar.style.width = (U.clamp(1 - n.left / 3600e3, 0, 1) * 100) + '%'; box.classList.toggle('soon', n.left < 15 * 60e3); }
        return;
      }
      this._alarmKey = key;
      const tools = `<div style="display:flex;gap:2px">
        ${window.Notification && Notification.permission !== 'granted' ? `<button class="icon-btn sm" data-notif title="Aktifkan notifikasi desktop">${icon('bell', 14)}</button>` : ''}
        <button class="icon-btn sm" data-snd title="Tes suara alarm">${icon('volume', 14)}</button></div>`;
      const missed = Alarm.missed();
      const soundHint = !Alarm.soundReady() ? `<span class="hint">${icon('volume', 11)} Klik di mana saja sekali agar alarm bisa berbunyi</span>` : '';
      box.classList.toggle('ringing', !!ringing);
      box.classList.toggle('soon', !!n && n.left < 15 * 60e3);
      if (ringing) {
        box.innerHTML = `<div class="ab-top"><span class="ab-label">${icon('bellRing', 13)}Alarm berbunyi</span>${tools}</div>
          <div class="ab-main"><div class="ab-ic">${icon('bellRing', 22)}</div><div style="min-width:0"><div class="ab-title">${U.esc(ringing.title)}</div><div class="ab-when">${ringing.alarm}</div></div></div>`;
      } else if (n) {
        box.innerHTML = `<div class="ab-top"><span class="ab-label">${icon('alarm', 13)}Alarm berikutnya</span>${tools}</div>
          <div class="ab-main"><div class="ab-ic">${icon('alarm', 22)}</div>
            <div style="min-width:0"><div class="ab-title">${U.esc(n.task.title)}</div><div class="ab-when mono">${U.fmtTime(new Date(n.at))}${n.task.snoozeUntil ? ' · ditunda' : ''}</div></div>
            <div class="ab-count"><span data-count>${U.dur(n.left)}</span><small>hitung mundur</small></div></div>
          ${n.queue.length || missed.length ? `<div class="ab-queue">${n.queue.slice(0, 3).map((q) => `<span class="badge">${icon('bell', 10)}${U.fmtTime(new Date(q.at))} ${U.esc(q.task.title.slice(0, 22))}</span>`).join('')}
            ${missed.length ? `<span class="badge bad" data-goto style="cursor:pointer">${missed.length} alarm terlewat</span>` : ''}</div>` : ''}
          ${soundHint}<div class="ab-bar" style="width:${U.clamp(1 - n.left / 3600e3, 0, 1) * 100}%"></div>`;
      } else {
        const open = Daily.openTodayCount();
        box.innerHTML = `<div class="ab-top"><span class="ab-label">${icon('bell', 13)}Active Alarm</span>${tools}</div>
          <div class="ab-main"><div class="ab-ic" style="background:var(--surface-2);color:var(--muted)">${icon('bell', 22)}</div>
            <div style="min-width:0"><div class="ab-title">Tidak ada alarm tersisa hari ini</div>
            <div class="ab-when">${open ? `${open} tugas belum selesai · ` : ''}<a href="#/daily">Set jam alarm di Daily Task</a></div></div></div>
          ${missed.length ? `<div class="ab-queue"><span class="badge bad" data-goto style="cursor:pointer">${missed.length} alarm terlewat hari ini</span></div>` : ''}`;
      }
    },

    /* ---------- Sales KPI ---------- */
    kpiCard({ label, ic, value, unit = '', sub = '', bar = null, status = '', spark = '' }) {
      return `<div class="card kpi ${status}">
        <div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-ic">${icon(ic, 14)}</span></div>
        <div class="kpi-val">${value}${unit ? `<small>${unit}</small>` : ''}</div>
        ${spark}
        ${bar ? `<div class="progress ${bar.cls || ''}"><span style="width:${U.clamp(bar.pct * 100, 0, 100)}%"></span>${bar.marker != null ? `<i class="marker" style="left:${U.clamp(bar.marker * 100, 0, 100)}%" title="Time gone ${U.fmtPct(bar.marker, 0)}"></i>` : ''}</div>` : ''}
        <div class="kpi-sub">${sub}</div></div>`;
    },
    paintSales() {
      const k = Sales.compute();
      const sc = Sales.scope();
      // kontrol bulan & distributor
      const months = Sales.availableMonths();
      const curYm = Sales.view.ym || months[months.length - 1];
      U.$('#hSalesMonth').textContent = k ? k.monthLabel : U.BULAN[new Date().getMonth()] + ' ' + new Date().getFullYear();
      U.$$('#hMonthNav [data-mnav]').forEach((b) => { b.disabled = !months.length || (b.dataset.mnav === '-1' ? curYm === months[0] : curYm === months[months.length - 1]); b.style.opacity = b.disabled ? .35 : 1; });
      U.$('#hDistSeg').innerHTML = sc && sc.dists.length > 1 ? [['all', 'Semua']].concat(sc.dists.map((d) => [d, Sales.shortDist(d)]))
        .map(([v, l]) => `<button data-d="${U.esc(v)}" class="${Sales.view.dist === v ? 'active' : ''}">${U.esc(l)}</button>`).join('') : '';
      U.$('#hDistSeg').style.display = sc && sc.dists.length > 1 ? '' : 'none';
      U.$$('#hAccSort button').forEach((b) => b.classList.toggle('active', b.dataset.s === this.accSort));

      if (!k) {
        U.$('#hSalesMeta').innerHTML = `<span class="badge warn">Belum ada data</span>`;
        U.$('#hSalesNote').innerHTML = '';
        U.$('#hAccCard').style.display = 'none';
        U.$('#hKpi').innerHTML = [
          ['Sales MTD vs Target', 'banknote'], ['% Achievement', 'percent'], ['Run Rate (proyeksi)', 'gauge'], ['KPI Performance', 'award'],
        ].map(([l, ic]) => this.kpiCard({ label: l, ic, value: '<span class="faint">—</span>', sub: '<span>Klik <b>Sync Data Sales</b> lalu pilih file Target, RF & YTD</span>', bar: { pct: 0 } })).join('');
        return;
      }
      U.$('#hAccCard').style.display = '';
      U.$('#hSalesMeta').innerHTML = `${icon('fileSheet', 13)}<span>Data s/d <b>${U.fmtDM(k.asOf)}</b></span>·<span title="${new Date(k.updatedAt).toLocaleString('id-ID')}">sync ${U.timeAgo(k.updatedAt)}</span>`;
      const achCls = k.status;
      const spark = BarChart.spark(k.history, { color: 'var(--accent)' });
      const kpiCls = !isFinite(k.kpi) ? '' : k.kpi >= 1 ? 'good' : k.kpi >= 0.85 ? 'warn' : 'bad';
      const g = (v) => (isFinite(v) ? `<b style="color:var(--${v >= 0 ? 'good' : 'bad'})">${v >= 0 ? '▲' : '▼'} ${U.fmtNum(Math.abs(v) * 100, 1)}%</b>` : '–');
      U.$('#hKpi').innerHTML = [
        this.kpiCard({ label: `Sales ${k.isCurrent ? 'MTD' : 'bulan'} vs Target`, ic: 'banknote', value: U.fmtRp(k.mtd), spark,
          bar: { pct: k.ach || 0, cls: achCls, marker: k.isCurrent ? k.timeGone : null },
          sub: `<span>Target <b>${U.fmtRp(k.target)}</b></span><span title="Dibanding ${k.lmLabel} tanggal 1–${+k.asOf.slice(8)} (${U.fmtRp(k.lmSame)})">vs LM ${g(k.growth)}</span>` }),
        this.kpiCard({ label: '% Achievement', ic: 'percent', value: isFinite(k.ach) ? U.fmtNum(k.ach * 100, 1) : '–', unit: '%', status: achCls,
          bar: { pct: k.ach || 0, cls: achCls, marker: k.isCurrent ? k.timeGone : null },
          sub: k.isCurrent ? `<span>Time gone <b>${U.fmtPct(k.timeGone, 0)}</b></span><span>${isFinite(k.pace) ? (k.pace >= 1 ? '▲ di atas pace' : '▼ di bawah pace') : ''}</span>`
            : `<span>Gap <b>${U.fmtRp(k.gap)}</b></span><span>Bulan tutup</span>` }),
        k.isCurrent
          ? this.kpiCard({ label: 'Run Rate (proyeksi akhir bulan)', ic: 'gauge', value: U.fmtRp(k.projection), status: !isFinite(k.projAch) ? '' : k.projAch >= 1 ? 'good' : k.projAch >= 0.9 ? 'warn' : 'bad',
              bar: { pct: k.projAch || 0, cls: k.projAch >= 1 ? 'good' : k.projAch >= 0.9 ? 'warn' : 'bad' },
              sub: `<span title="Rata-rata ${U.fmtRp(k.daily)}/hari kerja">Proyeksi <b>${U.fmtPct(k.projAch, 0)}</b></span><span title="Kebutuhan per hari untuk ${k.remaining} hari kerja tersisa">Perlu <b>${U.fmtRp(k.needDaily)}</b>/hr</span>` })
          : this.kpiCard({ label: 'Rata-rata harian', ic: 'gauge', value: U.fmtRp(k.daily), sub: `<span>${k.elapsed} hari kerja</span><span>vs LM ${g(k.growth)}</span>` }),
        this.kpiCard({ label: 'KPI Performance', ic: 'award', value: isFinite(k.kpi) ? U.fmtNum(k.kpi * 100, 1) : '–', unit: isFinite(k.kpi) ? '%' : '', status: kpiCls,
          bar: { pct: isFinite(k.kpi) ? k.kpi : 0, cls: kpiCls },
          sub: isFinite(k.kpi) ? `<span>Hari kerja <b>${k.elapsed}/${k.total}</b></span><span>Sisa <b>${k.remaining}</b> hari</span>` : '<span>Isi nilai KPI di ⚙ pengaturan</span>' }),
      ].join('');

      const o = k.official;
      U.$('#hSalesNote').innerHTML = `
        <span>${icon('target', 12)} Cakupan target: ${k.scope.dists.filter((d) => k.dist === 'all' || d === k.dist).map((d) => `<b>${U.esc(Sales.shortDist(d))}</b>`).join(' + ')} · ${k.scope.chans.map((c) => U.esc(c.replace(' TRADE', ' T.'))).join(', ')}${k.fss ? ` · FSS ${U.esc(k.fss)}` : ''}</span>
        <span>${k.lmLabel}: RF <b>${U.fmtRp(k.lmFull)}</b> (${U.fmtPct(k.lmAch)})${o ? ` · resmi <b>${U.fmtRp(o.value)}</b> (${U.fmtPct(o.ach)})` : ''} dari target ${U.fmtRp(k.lmTarget)}</span>`;

      // tabel per account
      const rows = [...k.accounts];
      if (this.accSort === 'ach') rows.sort((a, b) => (isFinite(b.ach) ? b.ach : -1) - (isFinite(a.ach) ? a.ach : -1));
      if (this.accSort === 'gap') rows.sort((a, b) => (b.target - b.mtd) - (a.target - a.mtd));
      const tg = k.timeGone;
      const cls = (a) => (!isFinite(a) ? '' : (k.isCurrent ? a / tg : a) >= 1 ? 'good' : (k.isCurrent ? a / tg : a) >= 0.9 ? 'warn' : 'bad');
      const noTarget = rows.filter((a) => !a.target && a.mtd).length;
      U.$('#hAccSub').textContent = `${rows.length} account · ${k.isCurrent ? `MTD s/d ${U.fmtDM(k.asOf)} · time gone ${U.fmtPct(tg, 0)}` : 'bulan penuh'}${noTarget ? ` · ${noTarget} account tanpa target` : ''}`;
      const line = (a, total) => `<tr class="${total ? 'tot' : ''}">
          <td class="l"><div class="an">${U.esc(total ? 'TOTAL' : a.acct)}</div>${!total && a.dists.length ? `<div class="ad">${a.dists.map(U.esc).join(' · ')}</div>` : ''}</td>
          <td>${U.fmtRp(a.target)}</td><td><b>${U.fmtRp(a.mtd)}</b></td>
          <td class="pc"><div class="pcw"><span class="${cls(a.ach)}">${isFinite(a.ach) ? U.fmtNum(a.ach * 100, 1) + '%' : '<span class="faint">tanpa target</span>'}</span>
            ${isFinite(a.ach) ? `<div class="progress ${cls(a.ach)}"><span style="width:${U.clamp(a.ach * 100, 0, 100)}%"></span>${k.isCurrent ? `<i class="marker" style="left:${U.clamp(tg * 100, 0, 100)}%"></i>` : ''}</div>` : ''}</div></td>
          ${k.isCurrent ? `<td>${isFinite(a.projAch) ? U.fmtPct(a.projAch, 0) : '–'}</td><td>${a.target > a.mtd ? U.fmtRp(a.need) : '<span style="color:var(--good)">✓</span>'}</td>` : `<td>${U.fmtRp(Math.max(0, a.target - a.mtd))}</td>`}
          <td>${g(a.growth)}</td></tr>`;
      U.$('#hAcc').innerHTML = `<table class="acc-table">
        <thead><tr><th class="l">Account</th><th>Target</th><th>${k.isCurrent ? 'MTD' : 'Actual'}</th><th class="pc">% Ach</th>${k.isCurrent ? '<th>Proyeksi</th><th>Perlu/hari</th>' : '<th>Gap</th>'}<th>vs LM</th></tr></thead>
        <tbody>${rows.map((a) => line(a)).join('')}</tbody>
        <tfoot>${line({ target: k.target, mtd: k.mtd, ach: k.ach, projAch: k.projAch, need: k.needDaily, growth: k.growth }, true)}</tfoot></table>`;
    },

    /* ---------- Chart minggu ini (Sen–Sab) ---------- */
    chartData() {
      const start = U.weekStart(new Date());
      const days = Array.from({ length: 6 }, (_, i) => U.addDays(start, i));
      const today = U.today();
      const values = days.map((d) => Daily.doneCount(U.ymd(d)));
      const ghost = days.map((d) => Daily.totalCount(U.ymd(d)));
      return {
        labels: days.map((d) => U.HARI3[d.getDay()]),
        sub: days.map((d) => `${d.getDate()}/${d.getMonth() + 1}`),
        values, ghost,
        highlight: days.findIndex((d) => U.ymd(d) === today),
        tip: (i) => `<b>${U.HARI[days[i].getDay()]}, ${U.fmtDM(days[i])}</b><br>${values[i]} dari ${ghost[i]} tugas selesai`,
        days,
      };
    },
    paintChart() {
      const d = this.chartData();
      this.chart.update(d);
      const tot = d.values.reduce((a, b) => a + b, 0), all = d.ghost.reduce((a, b) => a + b, 0);
      const best = d.values.indexOf(Math.max(...d.values));
      U.$('#hChartSub').textContent = `${U.fmtDM(d.days[0])} – ${U.fmtDM(d.days[5])} · ${tot} dari ${all} tugas selesai` + (tot ? ` · hari terbaik: ${U.HARI[d.days[best].getDay()]}` : '');
    },

    paintDaily() {
      const list = Daily.forDate(U.today());
      const dn = list.filter((t) => t.done).length;
      U.$('#hDailyCount').textContent = list.length ? `${dn}/${list.length}` : '0';
      U.$('#hDaily').innerHTML = list.length ? list.map((t) => Daily.taskHTML(t)).join('')
        : `<div class="empty">${icon('checkCircle', 24)}<b>Belum ada tugas hari ini</b>Tambahkan lewat kolom di bawah atau di menu Daily Task.</div>`;
    },

    paintMonthly() {
      const due = Monthly.dueToday(), late = Monthly.overdue();
      U.$('#hMonthCount').textContent = due.length + (late.length ? ` +${late.length}` : '');
      U.$('#hMonthCount').className = 'badge ' + (late.length ? 'bad' : due.length ? 'warn' : '');
      const row = (t, cls) => `<div class="feed-item" data-mid="${t.id}">
          <input type="checkbox" class="chk" data-mtoggle title="Tandai selesai" />
          <div class="ft"><a href="javascript:void 0" data-medit style="color:inherit;font-weight:560">${U.esc(t.title)}</a>
            <div class="meta"><span class="badge ${cls}">${U.relDay(t.due)}</span>
              ${t.repeat ? `<span class="badge">${icon('repeat', 10)}Bulanan</span>` : ''}
              ${t.files.map((f) => `<span class="badge" data-open="${f.id}" style="cursor:pointer" title="${U.esc(f.name)}">${icon(f.type.startsWith('image/') ? 'image' : 'paperclip', 10)}${U.esc(f.name.slice(0, 14))}</span>`).join('')}
            </div>
            ${t.notes ? `<div class="meta" style="display:block">${U.esc(t.notes.slice(0, 90))}${t.notes.length > 90 ? '…' : ''}</div>` : ''}</div></div>`;
      U.$('#hMonthly').innerHTML =
        (due.length ? due.map((t) => row(t, 'warn')).join('') : `<div class="empty" style="padding:18px 8px">${icon('calendar', 22)}<b>Tidak ada yang jatuh tempo hari ini</b></div>`) +
        (late.length ? `<div class="section-title" style="margin:12px 0 2px;color:var(--bad)">${icon('clock', 12)}Terlambat (${late.length})</div>` + late.map((t) => row(t, 'bad')).join('') : '');
    },
  };

  App.register('beranda', Beranda);
})();
