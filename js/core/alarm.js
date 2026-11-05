/* Mesin alarm global — berjalan di semua halaman (bukan hanya Beranda).
   Membaca task Daily hari ini yang punya jam alarm, menghitung mundur,
   dan saat waktunya tiba: bunyi (WebAudio, tanpa file suara), modal, notifikasi desktop.
   Catatan browser: suara baru bisa diputar setelah ada 1x klik di halaman (aturan autoplay). */
(function () {
  const GRACE_MS = 3 * 60 * 1000; // jika app baru dibuka >3 menit setelah jam alarm → dianggap "terlewat" (tanpa bunyi)

  const Alarm = {
    ctx: null,
    ringing: null,
    _loop: null,
    _titleTimer: null,

    dueTs(t) {
      if (t.snoozeUntil) return t.snoozeUntil;
      if (!t.alarm) return null;
      const [h, m] = t.alarm.split(':').map(Number);
      const d = U.parse(t.date); d.setHours(h, m, 0, 0); return d.getTime();
    },
    stateOf(t) {
      if (!t.alarm) return '';
      if (t.missed && !t.done) return 'missed';
      if (t.alarmFired) return 'fired';
      return '';
    },
    todayAlarms() { return Daily.forDate(U.today()).filter((t) => t.alarm && !t.done); },
    next() {
      const now = Date.now();
      const up = this.todayAlarms().filter((t) => !t.alarmFired).map((t) => ({ task: t, at: this.dueTs(t) })).filter((x) => x.at >= now - 1000)
        .sort((a, b) => a.at - b.at);
      return up[0] ? { ...up[0], left: up[0].at - now, queue: up.slice(1) } : null;
    },
    missed() { return this.todayAlarms().filter((t) => t.missed); },

    init() {
      const unlock = () => { this.audio(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };
      ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { capture: true }));
      U.on('tick', () => this.tick());
    },

    async tick() {
      const now = Date.now();
      for (const t of this.todayAlarms()) {
        if (t.alarmFired) continue;
        const at = this.dueTs(t);
        if (at && now >= at) {
          if (now - at <= GRACE_MS) { await Daily.update(t.id, { alarmFired: true, missed: false }); this.ring(t); }
          else { await Daily.update(t.id, { alarmFired: true, missed: true }); }
        }
      }
      this.renderSidebar();
    },

    renderSidebar() {
      const el = document.getElementById('sbAlarm'); if (!el) return;
      const n = this.next();
      el.classList.toggle('ringing', !!this.ringing);
      if (this.ringing) el.innerHTML = `${icon('bellRing', 16)}<span class="t">Alarm: ${U.esc(this.ringing.title)}</span>`;
      else if (n) el.innerHTML = `${icon('alarm', 16)}<span class="t"><b>${U.dur(n.left)}</b> · ${U.esc(n.task.title)}</span>`;
      else el.innerHTML = `${icon('bell', 16)}<span class="t muted">Tidak ada alarm aktif</span>`;
    },

    /* ---------- Suara ---------- */
    audio() {
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
      return this.ctx;
    },
    soundReady() { return this.ctx && this.ctx.state === 'running'; },
    chime() {
      const ctx = this.audio(); if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const notes = [880, 1108.73, 1318.51, 1760];
      notes.forEach((f, i) => {
        [0, 0.9].forEach((rep) => {
          const t0 = ctx.currentTime + rep + i * 0.16;
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
          o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.6);
        });
      });
    },
    test() { this.audio(); this.chime(); if (!this.soundReady()) setTimeout(() => this.chime(), 150); },

    async requestNotif() {
      if (!('Notification' in window)) return U.toast('Browser tidak mendukung notifikasi desktop', 'warn');
      const p = await Notification.requestPermission();
      U.toast(p === 'granted' ? 'Notifikasi desktop aktif' : 'Notifikasi ditolak — alarm tetap berbunyi di tab ini', p === 'granted' ? 'good' : 'warn');
      U.emit('alarmstate');
    },

    ring(t) {
      this.ringing = t;
      this.chime();
      let n = 0;
      clearInterval(this._loop);
      this._loop = setInterval(() => { if (++n > 9 || !this.ringing) return clearInterval(this._loop); this.chime(); }, 6000);
      const orig = document.title; let flip = false;
      clearInterval(this._titleTimer);
      this._titleTimer = setInterval(() => { document.title = (flip = !flip) ? '⏰ ' + t.title : orig; }, 1000);
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('⏰ ' + t.title, { body: `Alarm ${t.alarm} — Daily Task`, requireInteraction: true }); } catch {}
      U.emit('alarmstate');
      const stop = () => { this.ringing = null; clearInterval(this._loop); clearInterval(this._titleTimer); document.title = orig; U.emit('alarmstate'); this.renderSidebar(); };
      U.modal({
        title: 'Waktunya!', icon: 'bellRing', sticky: true,
        body: `<div style="display:flex;gap:14px;align-items:center">
            <div class="ab-ic" style="width:52px;height:52px;border-radius:12px;display:grid;place-items:center;background:var(--warn-soft);color:var(--warn)">${icon('alarm', 26)}</div>
            <div><div style="font-size:17px;font-weight:650;line-height:1.3">${U.esc(t.title)}</div>
            <div class="muted mono" style="font-size:13px">${t.alarm} · ${U.fmtLong(U.parse(t.date))}</div></div></div>`,
        buttons: [
          { label: 'Tunda 5 menit', cls: 'ghost', icon: 'clock', onClick: () => Daily.update(t.id, { snoozeUntil: Date.now() + 5 * 60000, alarmFired: false, missed: false }).then(() => U.toast('Ditunda 5 menit', 'info')) },
          { label: 'Tutup', cls: '' },
          { label: 'Tandai Selesai', cls: 'good', icon: 'check', onClick: () => Daily.toggle(t.id, true) },
        ],
        onClose: stop,
      });
    },
  };

  window.Alarm = Alarm;
  Alarm.init();
})();
