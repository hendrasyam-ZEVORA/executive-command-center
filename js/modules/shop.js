/* MENU 12 — SHOP: wishlist & rencana belanja (barang kerja/pribadi, langganan aplikasi)
   Store 'shop' → { id, name, category, price, qty, priority:'urgent'|'wish', link, bought, boughtAt, notes } */
(function () {
  const C = DB.collection('shop');
  const CATS = ['Perlengkapan Kerja', 'Elektronik', 'Langganan Aplikasi', 'Pribadi', 'Rumah', 'Lainnya'];
  const STORE = (u) => { const d = U.domain(u); return /tokopedia/.test(d) ? ['Tokopedia', '#03ac0e'] : /shopee/.test(d) ? ['Shopee', '#ee4d2d'] : /lazada/.test(d) ? ['Lazada', '#0f146d'] : /blibli/.test(d) ? ['Blibli', '#0095da'] : d ? [d, 'var(--muted)'] : null; };

  const Shop = {
    C, f: 'open',
    async load() { await C.load(); },
    total(x) { return (+x.price || 0) * (+x.qty || 1); },

    render(el) {
      el.innerHTML = App.pageHead({
        title: 'SHOP', icon: 'bag', sub: 'Wishlist & rencana belanja: estimasi biaya dihitung otomatis.',
        actions: `<button class="btn primary" data-new>${icon('plus', 15)}Tambah Barang</button>`,
      }) + `<div class="sum-row" id="shSum"></div><div class="toolbar"><div class="chips" id="shF"></div></div>
        <div class="card table-wrap"><table class="list-table"><thead><tr><th style="width:36px"></th><th>Barang / aplikasi</th><th>Kategori</th><th>Prioritas</th><th class="r">Estimasi</th><th></th></tr></thead><tbody id="shBody"></tbody></table></div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-new]')) return this.edit();
        const f = e.target.closest('[data-f]'); if (f) { this.f = f.dataset.f; return this.paint(); }
        const row = e.target.closest('[data-sid]'); if (!row) return;
        const x = C.get(row.dataset.sid);
        if (e.target.closest('[data-edit]')) return this.edit(x);
        if (e.target.closest('[data-del]')) return U.confirm(`Hapus "${x.name}"?`).then((ok) => ok && C.remove(x.id));
        if (e.target.closest('[data-prio]')) { x.priority = x.priority === 'urgent' ? 'wish' : 'urgent'; return C.save(x); }
      });
      el.addEventListener('change', (e) => {
        if (!e.target.matches('[data-bought]')) return;
        const x = C.get(e.target.closest('[data-sid]').dataset.sid); x.bought = e.target.checked; x.boughtAt = x.bought ? Date.now() : null; C.save(x);
      });
      U.on('data', (d) => { if (App.current === 'shop' && d && d.store === 'shop') this.paint(); });
    },
    onShow() { this.paint(); },

    paint() {
      const all = C.items, open = all.filter((x) => !x.bought);
      const sum = (arr) => arr.reduce((s, x) => s + this.total(x), 0);
      const ym = U.today().slice(0, 7);
      U.$('#shSum').innerHTML = `
        <div class="card sum"><div class="l">Total estimasi (belum dibeli)</div><div class="v">${U.fmtRp(sum(open), false)}</div><div class="s">${open.length} item</div></div>
        <div class="card sum"><div class="l">Butuh segera</div><div class="v" style="color:var(--bad)">${U.fmtRp(sum(open.filter((x) => x.priority === 'urgent')), false)}</div><div class="s">${open.filter((x) => x.priority === 'urgent').length} item</div></div>
        <div class="card sum"><div class="l">Wishlist</div><div class="v">${U.fmtRp(sum(open.filter((x) => x.priority !== 'urgent')), false)}</div><div class="s">${open.filter((x) => x.priority !== 'urgent').length} item</div></div>
        <div class="card sum"><div class="l">Sudah dibeli bulan ini</div><div class="v" style="color:var(--good)">${U.fmtRp(sum(all.filter((x) => x.bought && x.boughtAt && U.ymd(new Date(x.boughtAt)).startsWith(ym))), false)}</div><div class="s">${all.filter((x) => x.bought).length} item total dibeli</div></div>`;
      const F = [['open', 'Belum dibeli', (x) => !x.bought], ['urgent', 'Butuh segera', (x) => !x.bought && x.priority === 'urgent'], ['wish', 'Wishlist', (x) => !x.bought && x.priority !== 'urgent'], ['bought', 'Sudah dibeli', (x) => x.bought], ['all', 'Semua', () => true]];
      U.$('#shF').innerHTML = F.map(([k, l, fn]) => `<button class="chip ${this.f === k ? 'active' : ''}" data-f="${k}">${l}<span class="c">${all.filter(fn).length}</span></button>`).join('');
      const list = all.filter(F.find((x) => x[0] === this.f)[2]).sort((a, b) => a.bought - b.bought || (a.priority === 'urgent' ? -1 : 1) - (b.priority === 'urgent' ? -1 : 1) || this.total(b) - this.total(a));
      U.$('#shBody').innerHTML = list.length ? list.map((x) => {
        const st = x.link ? STORE(x.link) : null;
        return `<tr data-sid="${x.id}" class="${x.bought ? 'bought' : ''}">
          <td><input type="checkbox" class="chk" data-bought ${x.bought ? 'checked' : ''} title="Tandai sudah dibeli"/></td>
          <td><div class="nm" style="font-weight:600">${U.esc(x.name)}</div><div class="lnk" style="margin-top:2px">
            ${st ? `<a href="${U.esc(x.link)}" target="_blank" rel="noopener" class="badge" style="background:${st[1]}1a;color:${st[1]}">${icon('external', 10)}${U.esc(st[0])}</a>` : ''}
            ${x.notes ? `<span class="hint">${U.esc(x.notes.slice(0, 70))}</span>` : ''}</div></td>
          <td><span class="badge">${U.esc(x.category)}</span></td>
          <td><button class="badge ${x.priority === 'urgent' ? 'bad' : 'accent'}" data-prio style="border:0;cursor:pointer" title="Klik untuk ganti">${x.priority === 'urgent' ? 'Butuh segera' : 'Wishlist'}</button></td>
          <td class="r"><b>${U.fmtRp(this.total(x), false)}</b>${(+x.qty || 1) > 1 ? `<div class="hint">${x.qty} × ${U.fmtRp(+x.price, false)}</div>` : ''}</td>
          <td><div class="row-act"><button class="icon-btn sm" data-edit title="Edit">${icon('pencil', 13)}</button><button class="icon-btn sm danger" data-del title="Hapus">${icon('trash', 13)}</button></div></td></tr>`;
      }).join('') : `<tr><td colspan="6"><div class="empty">${icon('bag', 26)}<b>Kosong</b>Tambahkan barang atau langganan yang direncanakan.</div></td></tr>`;
    },
    edit(x) {
      const isNew = !x;
      U.form({
        title: isNew ? 'Tambah Barang' : 'Edit Barang', icon: 'bag', data: x || { category: 'Perlengkapan Kerja', priority: 'wish', qty: 1, price: 0 },
        fields: [
          { key: 'name', label: 'Nama barang / aplikasi', required: true, placeholder: 'Mouse wireless / Canva Pro 1 tahun' },
          { key: 'category', label: 'Kategori', type: 'datalist', options: CATS, half: true }, { key: 'priority', label: 'Prioritas', type: 'select', options: [{ v: 'urgent', l: 'Butuh segera' }, { v: 'wish', l: 'Wishlist' }], half: true },
          { key: 'price', label: 'Estimasi harga satuan (Rp)', type: 'money', half: true }, { key: 'qty', label: 'Jumlah', type: 'number', half: true },
          { key: 'link', label: 'Link pembelian', type: 'url', placeholder: 'https://www.tokopedia.com/…' },
          { key: 'notes', label: 'Catatan', type: 'textarea', rows: 2 },
        ],
        onSave: async (v) => { await C.save({ ...(x || { bought: false }), ...v, qty: +v.qty || 1 }); U.toast(isNew ? 'Ditambahkan' : 'Disimpan'); },
      });
    },
  };

  window.Shop = Shop;
  App.register('shop', Shop);
})();
