# Executive Daily Command Center — Tahap 1 + 2 (12 menu lengkap)

Dashboard kerja harian yang berjalan **100% offline di browser**. Tidak perlu server, tidak perlu internet (kecuali panel berita & cuaca).

## Cara membuka
**Online (GitHub Pages):** buka link Pages repo ini. **Offline:** unduh/clone repo lalu buka `index.html`.

1. Ekstrak folder `edcc/` ke mana saja (mis. `D:\Dashboard\edcc`).
2. Klik dua kali `index.html` → buka dengan **Chrome atau Edge** (disarankan: fitur Sync Excel 1-klik hanya ada di sini).
3. Simpan sebagai bookmark / pin tab. Data tersimpan di browser (IndexedDB) pada laptop tersebut.

> Penting: data terikat pada **browser + lokasi folder**. Jangan pindah folder setelah mulai dipakai,
> atau gunakan fitur Backup/Restore (Tahap 2) sebelum pindah laptop.

## Isi Tahap 1
| Menu | Fitur |
|---|---|
| 1. Beranda | Tanggal & jam real-time, banner alarm + hitung mundur + bunyi, 4 KPI Sales + tabel per account, grafik tugas selesai Sen–Sab, feed Daily & Monthly, **Football Hub** (Barcelona & Roma, hasil, statistik, klasemen LaLiga/EPL/Serie A/Bundesliga) |
| 2. Daily Task | 7 sticky note Senin–Minggu, navigasi minggu, alarm HH:MM, edit (klik dua kali), pindahkan tugas belum selesai ke besok |
| 3. Monthly Task | Tenggat, catatan, warna, lampiran gambar/PDF (drag-drop / Ctrl+V), opsi **ulangi tiap bulan** |
| 4. Account | Kartu per account (IDM, SAT, Lotte…), PIC, tombol WA (`wa.me`), email (mailto + salin), checklist & catatan |
| 5. Kalender & MS Teams | Kalender bulanan (Meeting + Monthly Task + Event + Promo), agenda harian, tombol **Join Teams**, import **.ics** Outlook/Teams (termasuk meeting berulang), pengingat otomatis ke Daily Task 10 menit sebelum meeting |
| 6. Program Monitoring | Kartu program (WHS dll): periode, target, realisasi vs time gone, tabel per toko yang bisa diedit langsung, **tarik realisasi dari data Sales RF** per account |
| 7. Promo & Diskon | Timeline Gantt per bulan + garis hari ini, countdown sisa hari, upload & **preview SKP PDF** di dalam aplikasi |
| 8. Event Monthly | Kanban Preparation / On-Going / Done (drag & drop), PIC, budget, checklist persiapan |
| 9. Projek Luar | Halaman ala Notion (judul, ikon, catatan bebas) + board Ide / Proses / Selesai per projek |
| 10. Screenshot Gallery | **Folder per toko** untuk bukti display (foto dikelompokkan per tanggal kunjungan), **Ctrl+V** langsung dari clipboard, drag & drop, pilih banyak → pindah folder, tag, cari, lightbox |
| 11. Kontak & Bank Email | Direktori Internal / Distributor / Buyer Account / Vendor, WA 1-klik, salin email, mailto, salin semua email, impor PIC dari Account |
| 12. SHOP | Wishlist & rencana belanja, prioritas, link toko (Tokopedia/Shopee terdeteksi), total estimasi otomatis |
| Kunci Data | Password + **enkripsi AES-256** semua data di browser, layar kunci, kunci otomatis saat tidak aktif, kode pemulihan, backup ikut terenkripsi |
| Backup / Restore | Tombol di bawah sidebar: semua data termasuk gambar & PDF jadi 1 file JSON; pengingat bila belum backup ≥ 7 hari |

Pintasan: `Alt+1` … `Alt+9` untuk pindah menu · `Ctrl+Enter` simpan modal · `Esc` tutup.

## Sales Performance (membaca file Excel Anda langsung)
1. Beranda → **Sync Data Sales** → **Pilih File Excel…** → pilih 3 file sekaligus (Ctrl+klik):
   - `Target_STT_Net_2026.xlsx`: target per bulan × distributor × channel × account
   - `Data_RF_Salesman_Costumer_Performance.xlsx`: hanya sheet **Sales Per Day** yang dibaca (actual harian, retur sudah minus)
   - `Data_Performance_YTD.xlsx` (opsional): Net Revenue resmi untuk bulan yang sudah tutup
2. File dikenali otomatis, tanpa perlu memetakan sel. Di Chrome/Edge, klik **Sync** berikutnya akan membaca ulang file yang sama setelah Excel di-refresh.

Aturan hitung:
- **Cakupan** = distributor + market channel yang ada di file target (otomatis terbaca dari file target). Actual di luar cakupan tidak ikut dihitung.
- **MTD** = jumlah Sales Per Day dari tanggal 1 s/d tanggal data terakhir.
- **vs LM** = dibanding periode tanggal yang sama bulan lalu. Bila periode bulan lalu ≤ 0 (retur), ditampilkan "–".
- **Time gone / Run Rate** memakai hari kerja Senin–Sabtu (bisa diubah di ⚙).
- **KPI Performance** diisi manual di ⚙.
- Modal ⚙ menampilkan **tabel validasi** 4 bulan terakhir: Target, Actual RF, Net Revenue resmi.


## Struktur
```
index.html            ← kerangka + 12 <section id="page-…">
css/app.css           ← design system (light/dark, sticky notes)
js/core/              ← icons, utils, db (IndexedDB), xlsx reader, barchart, app (router), alarm
js/modules/           ← beranda, daily, monthly, account, sales, news, placeholders
```
## Menambah / mengubah modul
Setiap menu = 1 file `js/modules/{id}.js` yang memanggil `App.register('{id}', { load, render, onShow })`.
Helper bersama: `U.form()` (form modal), `DB.collection(store)` (CRUD + cache), `U.kanbanDnD()` (drag & drop).

## Backup sebelum pindah laptop / masuk GitHub
Sidebar → **Backup** → file `edcc-backup-YYYY-MM-DD-HHMM.json`. Di laptop lain: buka aplikasi → **Restore** → pilih file tersebut.
Catatan: izin "Sync 1-klik" file Excel tidak ikut backup (aturan keamanan browser) → cukup pilih ulang file sekali di ⚙ Sales.
Jangan commit file backup ke repo publik: isinya data kerja & kontak.

## Keamanan data
- Data hanya tersimpan di browser perangkat Anda (IndexedDB); repo & situs GitHub Pages hanya berisi kode.
- Sidebar → **Aktifkan kunci data**: semua record dienkripsi AES-256-GCM. Kunci data dibungkus dengan password (PBKDF2-SHA256, 310.000 iterasi) dan dengan kode pemulihan. Password & kode tidak disimpan.
- Lupa password → layar kunci → "Lupa password? Pakai kode pemulihan". Tanpa password **dan** kode pemulihan, data tidak bisa dibuka siapa pun.
