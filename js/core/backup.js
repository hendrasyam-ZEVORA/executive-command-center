/* Backup & Restore — seluruh data (IndexedDB termasuk gambar/PDF + preferensi) ke 1 file JSON.
   Tombol ada di bagian bawah sidebar. */
(function () {
  const Backup = {
    async export() {
      U.toast('Menyiapkan backup…', 'info', 1500);
      const data = await DB.exportAll();
      data.local = {}; Object.keys(localStorage).filter((k) => /^edcc-(theme|sidebar|fb-ui)$/.test(k)).forEach((k) => { data.local[k] = localStorage.getItem(k); });
      const counts = data.counts || Object.fromEntries(Object.entries(data.stores).map(([k, v]) => [k, v.length]));
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const d = new Date();
      U.download(blob, `edcc-backup-${U.ymd(d)}-${U.fmtTime(d).replace(':', '')}.json`);
      localStorage.setItem('edcc-last-backup', String(Date.now()));
      this.paint();
      U.toast(`Backup ${data.encrypted ? 'terenkripsi ' : ''}${U.fmtBytes(blob.size)} diunduh · ${Object.values(counts).reduce((a, b) => a + b, 0)} data`, 'good', 4000);
    },
    async restore() {
      const [file] = await U.pickFiles({ accept: '.json,application/json' }); if (!file) return;
      let json;
      try { json = JSON.parse(await file.text()); if (json.app !== 'edcc') throw new Error(); } catch { return U.toast('Bukan file backup Command Center', 'bad'); }
      let unlocked = null, plain = json;
      if (json.encrypted) {
        unlocked = await Lock.unlockBackup(json); if (!unlocked) return;
        try { plain = await DB.decryptBackup(json, unlocked.dek); } catch { return U.toast('Isi backup rusak / tidak bisa didekripsi', 'bad'); }
      }
      const rows = Object.entries(plain.stores).filter(([, v]) => v.length).map(([k, v]) => `<span class="badge">${k}: ${v.length}</span>`).join(' ');
      U.modal({
        title: 'Restore Data', icon: 'upload',
        body: `<div class="callout">${icon('database', 15)}<div><b>${U.esc(file.name)}</b> · ${U.fmtBytes(file.size)}${json.encrypted ? ' · 🔒 terenkripsi' : ''}<br>Dibuat ${new Date(json.exportedAt).toLocaleString('id-ID')}</div></div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">${rows}</div>
          ${json.encrypted ? `<div class="hint">${icon('shield', 11)} Setelah restore, perangkat ini memakai <b>password & kode pemulihan dari backup</b> tersebut.</div>` : Lock.enabled() ? `<div class="hint">${icon('shield', 11)} Data akan dienkripsi dengan password perangkat ini.</div>` : ''}
          <div class="callout" style="background:var(--warn-soft)">${icon('bell', 15)}<div><b>Semua data saat ini akan diganti</b> dengan isi backup. Disarankan klik “Backup” dulu bila ragu.</div></div>`,
        buttons: [{ label: 'Batal', cls: 'ghost' }, {
          label: 'Ganti & Restore', cls: 'danger', onClick: async () => {
            try {
              if (unlocked) { DB.key = unlocked.dek; await DB.setLockMeta(unlocked.meta); }
              await DB.importAll(plain, { replace: true });
              Object.entries(plain.local || json.local || {}).forEach(([k, v]) => localStorage.setItem(k, v));
              U.toast('Restore berhasil — memuat ulang…', 'good');
              setTimeout(() => location.reload(), 900);
            } catch (e) { U.toast('Restore gagal: ' + e.message, 'bad', 6000); }
          },
        }],
      });
    },
    paint() {
      const el = document.getElementById('sbBackup'); if (!el) return;
      const last = +localStorage.getItem('edcc-last-backup') || 0;
      const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
      el.innerHTML = `<div class="sb-row"><button class="sb-item" data-bk="export" title="Backup semua data ke file JSON">${icon('download', 14)}<span class="sb-label">Backup</span></button>
        <button class="sb-item" data-bk="import" title="Restore dari file backup JSON">${icon('upload', 14)}<span class="sb-label">Restore</span></button></div>
        <div class="sb-backup-age ${days === null || days >= 7 ? 'warn' : ''}">${last ? `Backup terakhir ${days === 0 ? 'hari ini' : days + ' hari lalu'}` : 'Belum pernah backup'}</div>`;
    },
    init() {
      const foot = document.querySelector('.sb-foot');
      const box = document.createElement('div'); box.id = 'sbBackup';
      foot.insertBefore(box, document.getElementById('themeToggle'));
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-bk]'); if (!b) return; b.dataset.bk === 'export' ? this.export() : this.restore(); });
      this.paint();
    },
  };
  window.Backup = Backup;
  Backup.init();
})();
