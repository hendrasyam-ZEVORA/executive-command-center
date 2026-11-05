/* MENU 11 — Kontak Person & Bank Email
   Store 'contacts' → { id, name, title, company, category, phone, email, notes, color } */
(function () {
  const C = DB.collection('contacts');
  const CATS = ['Internal', 'Distributor', 'Buyer Account', 'Vendor'];
  const CAT_COLOR = { Internal: 'blue', Distributor: 'green', 'Buyer Account': 'orange', Vendor: 'purple' };

  const Kontak = {
    C, cat: 'all', q: '',
    async load() { await C.load(); },

    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Kontak & Bank Email', icon: 'users',
        sub: 'Direktori relasi kerja dengan chat WhatsApp 1-klik, salin email, dan mailto.',
        actions: `<button class="btn" data-import title="Ambil PIC dari Account Management">${icon('download', 14)}Impor PIC Account</button><button class="btn primary" data-new>${icon('plus', 15)}Kontak Baru</button>`,
      }) + `<div class="toolbar"><div class="chips" id="ktCats"></div><div class="search">${icon('search', 14)}<input class="input" id="ktQ" placeholder="Cari nama, perusahaan, email, nomor…"/></div></div>
        <div class="card table-wrap"><table class="list-table"><thead><tr><th>Nama</th><th>Kategori</th><th>WhatsApp / HP</th><th>Email</th><th></th></tr></thead><tbody id="ktBody"></tbody></table></div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-new]')) return this.edit();
        if (e.target.closest('[data-import]')) return this.importAccounts();
        const c = e.target.closest('[data-cat]'); if (c) { this.cat = c.dataset.cat; return this.paint(); }
        const cp = e.target.closest('[data-copy]'); if (cp) return U.copy(cp.dataset.copy);
        const row = e.target.closest('[data-kid]'); if (!row) return;
        const k = C.get(row.dataset.kid);
        if (e.target.closest('[data-edit]')) return this.edit(k);
        if (e.target.closest('[data-del]')) return U.confirm(`Hapus kontak "${k.name}"?`).then((ok) => ok && C.remove(k.id));
        const ex = e.target.closest('[data-copyall]'); if (ex) return U.copy(this.list().map((x) => x.email).filter(Boolean).join('; '));
      });
      U.$('#ktQ', el).addEventListener('input', U.debounce((e) => { this.q = e.target.value.toLowerCase(); this.paint(); }, 120));
      U.on('data', (d) => { if (App.current === 'kontak' && d && d.store === 'contacts') this.paint(); });
    },
    onShow() { this.paint(); },
    list() {
      return C.items.filter((k) => (this.cat === 'all' || k.category === this.cat) && (!this.q || [k.name, k.title, k.company, k.email, k.phone, k.notes].join(' ').toLowerCase().includes(this.q)))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    paint() {
      U.$('#ktCats').innerHTML = [['all', 'Semua']].concat(CATS.map((c) => [c, c])).map(([k, l]) => `<button class="chip ${this.cat === k ? 'active' : ''}" data-cat="${k}">${l}<span class="c">${k === 'all' ? C.items.length : C.items.filter((x) => x.category === k).length}</span></button>`).join('')
        + (this.list().some((k) => k.email) ? `<button class="chip" data-copyall title="Salin semua email yang tampil (untuk To/CC)">${icon('copy', 11)} Salin semua email</button>` : '');
      const list = this.list();
      U.$('#ktBody').innerHTML = list.length ? list.map((k) => {
        const wa = U.waNumber(k.phone);
        return `<tr data-kid="${k.id}">
          <td><div class="who"><span class="av c-${CAT_COLOR[k.category] || 'gray'}">${U.esc(U.initials(k.name))}</span><div style="min-width:0"><b>${U.esc(k.name)}</b><span>${U.esc([k.title, k.company].filter(Boolean).join(' · '))}</span></div></div></td>
          <td><span class="badge">${U.esc(k.category)}</span></td>
          <td>${k.phone ? `<div class="lnk"><span class="mono" style="font-size:12.5px">${U.esc(k.phone)}</span>${wa ? `<a class="wa-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">${icon('message', 12)}WA</a>` : ''}<a class="icon-btn sm" href="tel:${U.esc(k.phone)}" title="Telepon">${icon('phone', 12)}</a></div>` : '<span class="faint">–</span>'}</td>
          <td>${k.email ? `<div class="lnk"><span style="font-size:12.5px">${U.esc(k.email)}</span><button class="icon-btn sm" data-copy="${U.esc(k.email)}" title="Salin email">${icon('copy', 12)}</button><a class="icon-btn sm" href="mailto:${U.esc(k.email)}" title="Kirim email">${icon('mail', 12)}</a></div>` : '<span class="faint">–</span>'}</td>
          <td><div class="row-act"><button class="icon-btn sm" data-edit title="Edit">${icon('pencil', 13)}</button><button class="icon-btn sm danger" data-del title="Hapus">${icon('trash', 13)}</button></div></td></tr>`;
      }).join('') : `<tr><td colspan="5"><div class="empty">${icon('users', 26)}<b>Belum ada kontak</b>Tambah manual atau klik “Impor PIC Account”.</div></td></tr>`;
    },
    edit(k) {
      const isNew = !k;
      U.form({
        title: isNew ? 'Kontak Baru' : 'Edit Kontak', icon: 'user', data: k || { category: 'Buyer Account' },
        fields: [
          { key: 'name', label: 'Nama PIC', required: true },
          { key: 'title', label: 'Jabatan', half: true, placeholder: 'Buyer / ASM / Admin' }, { key: 'company', label: 'Perusahaan / account', half: true, placeholder: 'Indomaret / SARB' },
          { key: 'category', label: 'Kategori', type: 'select', options: CATS },
          { key: 'phone', label: 'Nomor WA / HP', type: 'tel', half: true, placeholder: '0812…' }, { key: 'email', label: 'Email', type: 'email', half: true },
          { key: 'notes', label: 'Catatan', type: 'textarea', rows: 2 },
        ],
        onSave: async (v) => { await C.save({ ...(k || {}), ...v }); U.toast(isNew ? 'Kontak ditambahkan' : 'Kontak disimpan'); },
      });
    },
    async importAccounts() {
      if (!window.Account) return;
      const key = (x) => (U.waNumber(x.phone) || (x.email || '').toLowerCase() || x.name.toLowerCase());
      const have = new Set(C.items.map(key));
      const add = Account.items.filter((a) => a.pic).map((a) => ({ name: a.pic, title: a.role || 'Buyer', company: a.name, category: 'Buyer Account', phone: a.phone, email: a.email, notes: '' })).filter((x) => !have.has(key(x)));
      for (const x of add) await C.save(x);
      U.toast(add.length ? `${add.length} PIC diimpor dari Account` : 'Tidak ada PIC baru — isi PIC di Account Management dulu', add.length ? 'good' : 'info', 3500);
    },
  };

  window.Kontak = Kontak;
  App.register('kontak', Kontak);
})();
