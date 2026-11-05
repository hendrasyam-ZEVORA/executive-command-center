/* Menu 5–12 — placeholder Tahap 2.
   Cara mengisi di Tahap 2: buat js/modules/{id}.js yang memanggil App.register('{id}', {...}),
   lalu tambahkan <script> file itu di index.html. Placeholder di bawah otomatis tidak dipakai
   bila modul aslinya sudah terdaftar. Store IndexedDB untuk tiap menu sudah disiapkan di db.js. */
(function () {
  const PLAN = {
    kalender: { store: 'calendar', title: 'Kalender & MS Teams Sync', icon: 'calendarDays', points: ['Kalender bulanan besar dengan badge per tanggal (Monthly Task + Event + Meeting)', 'Input meeting manual + link MS Teams yang bisa diklik', 'Import file .ics hasil export Outlook / MS Teams'] },
    program: { store: 'programs', title: 'Program Monitoring', icon: 'target', points: ['Kartu program (mis. WHS) dengan periode, target kuota/value & progress bar', 'Tabel pencapaian per toko', 'Update angka manual atau tarik dari Sync Sales Greenfields'] },
    promo: { store: 'promos', title: 'Promo & Diskon Monitoring', icon: 'tag', points: ['Timeline / Gantt promo aktif bulan ini + countdown sisa hari', 'Kartu promo: account, mekanisme diskon, periode', 'Upload & preview SKP PDF langsung di browser (IndexedDB)'] },
    event: { store: 'events', title: 'Event Monthly', icon: 'flag', points: ['Kanban: Preparation · On-Going · Done', 'PIC, tanggal, budget & checklist persiapan'] },
    projek: { store: 'projects', title: 'Projek Luar', icon: 'rocket', points: ['Halaman ala Notion untuk ide & kurikulum Kelas Online FMCG', 'Kanban eksekusi: konten, materi, progress website'] },
    gallery: { store: 'gallery', title: 'Screenshot Gallery', icon: 'image', points: ['Drag & drop atau Ctrl+V langsung dari clipboard', 'Judul, tag (Bukti Display, Data Kompetitor, Chat Penting), pencarian', 'Lightbox untuk memperbesar gambar'] },
    kontak: { store: 'contacts', title: 'Kontak Person & Bank Email', icon: 'users', points: ['Direktori dengan filter: Internal, Distributor, Buyer, Vendor', 'Tombol 1-klik WhatsApp, salin email & mailto:'] },
    shop: { store: 'shop', title: 'SHOP — Wishlist & Plan Belanja', icon: 'bag', points: ['Barang/aplikasi, kategori, estimasi harga, prioritas, link toko', 'Status sudah dibeli + total estimasi otomatis'] },
  };

  Object.entries(PLAN).forEach(([id, p]) => {
    if (App.modules[id]) return;
    App.register(id, {
      placeholder: true,
      render(el) {
        el.innerHTML = App.pageHead({ title: p.title, icon: p.icon, sub: 'Disiapkan untuk Tahap 2', actions: '<span class="badge accent">Tahap 2</span>' }) + `
          <div class="ph-hero">
            <div class="ph-ic">${icon(p.icon, 26)}</div>
            <div style="font-size:17px;font-weight:650">Modul ini akan dibangun di Tahap 2</div>
            <div class="muted" style="max-width:520px">Container <code>#page-${id}</code> dan store database <code>${p.store}</code> sudah siap, jadi modul baru bisa dipasang tanpa mengubah menu lain.</div>
            <ul class="ph-list">${p.points.map((x) => `<li>${icon('check', 14)}<span>${x}</span></li>`).join('')}</ul>
          </div>`;
      },
    });
  });
})();
