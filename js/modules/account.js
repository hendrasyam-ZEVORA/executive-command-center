/* MENU 4 — Account Management (sticky note per account Modern Trade)
   Data: store 'accounts' → { id, code, name, pic, role, phone, email, color, checklist:[{id,text,done}], notes, createdAt } */
(function () {
  const SEED = [
    { code: 'IDM', name: 'Indomaret', color: 'blue' },
    { code: 'SAT', name: 'Alfamart (Sumber Alfaria Trijaya)', color: 'red' },
    { code: 'LTE', name: 'Lotte Grosir / Lotte Mart', color: 'orange' },
  ];

  const Account = {
    items: [],
    q: '',

    async load() {
      this.items = await DB.all('accounts');
      if (!this.items.length && !(await DB.kv.get('accSeeded'))) {
        for (const [i, s] of SEED.entries()) {
          const a = { id: U.uid(), ...s, pic: '', role: 'Buyer', phone: '', email: '', checklist: [], notes: '', createdAt: Date.now() + i };
          this.items.push(a); await DB.put('accounts', a);
        }
        await DB.kv.set('accSeeded', true);
      }
    },
    async save(a) {
      const i = this.items.findIndex((x) => x.id === a.id);
      if (i >= 0) this.items[i] = a; else this.items.push(a);
      await DB.put('accounts', a); U.emit('data', { store: 'accounts' });
    },
    get(id) { return this.items.find((x) => x.id === id); },

    render(el) {
      el.innerHTML = App.pageHead({
        title: 'Account Management', icon: 'building',
        sub: 'Satu kartu per account Modern Trade: PIC/Buyer, kontak 1-klik WhatsApp & email, serta checklist pekerjaan berjalan.',
        actions: `<div class="search">${icon('search', 14)}<input class="input" id="aSearch" placeholder="Cari account / PIC…" /></div>
          <button class="btn primary" data-new>${icon('plus', 15)}Account Baru</button>`,
      }) + `<div class="acc-grid" id="aGrid"></div>`;
      el.addEventListener('click', (e) => { if (e.target.closest('[data-new]')) this.edit(); });
      U.$('#aSearch', el).addEventListener('input', U.debounce((e) => { this.q = e.target.value.toLowerCase(); this.renderGrid(); }, 150));
      this.bind(U.$('#aGrid', el));
      U.on('data', (d) => { if (App.current === 'account' && d && d.store === 'accounts' && !this._typing) this.renderGrid(); });
    },
    onShow() { this.renderGrid(); },

    renderGrid() {
      const grid = U.$('#aGrid'); if (!grid) return;
      const list = this.items
        .filter((a) => !this.q || [a.code, a.name, a.pic, a.email].join(' ').toLowerCase().includes(this.q))
        .sort((a, b) => a.createdAt - b.createdAt);
      grid.innerHTML = list.length ? list.map((a) => this.cardHTML(a)).join('') :
        `<div class="empty" style="grid-column:1/-1">${icon('building', 28)}<b>Belum ada account</b>Tambahkan account seperti IDM, SAT, Lotte, Hypermart…</div>`;
    },

    cardHTML(a) {
      const wa = U.waNumber(a.phone);
      const dn = a.checklist.filter((c) => c.done).length;
      const items = [...a.checklist].sort((x, y) => x.done - y.done);
      return `<div class="note c-${a.color || 'blue'}" data-id="${a.id}">
        <div class="note-h" style="align-items:center">
          <div style="display:flex;gap:11px;align-items:center;min-width:0">
            <div class="acc-avatar">${U.esc((a.code || a.name || '?').slice(0, 3).toUpperCase())}</div>
            <div style="min-width:0"><div class="acc-name">${U.esc(a.name)}</div>
              <div class="acc-pic">${a.pic ? `${icon('user', 12)} ${U.esc(a.pic)}${a.role ? ' · ' + U.esc(a.role) : ''}` : '<i style="opacity:.7">PIC belum diisi</i>'}</div></div>
          </div>
          <div style="display:flex;flex-shrink:0"><button class="icon-btn sm" data-edit title="Edit">${icon('pencil', 13)}</button>
            <button class="icon-btn sm" data-del title="Hapus">${icon('trash', 13)}</button></div>
        </div>
        <div class="acc-contacts">
          <div class="acc-line">${icon('phone', 14)}<span class="v ${a.phone ? '' : 'empty-v'}">${U.esc(a.phone || 'Nomor HP belum diisi')}</span>
            ${wa ? `<a class="wa-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener" title="Chat WhatsApp">${icon('message', 12)}WA</a>
                    <a class="mini-btn" href="tel:${U.esc(a.phone)}" title="Telepon">${icon('phone', 11)}</a>` : ''}</div>
          <div class="acc-line">${icon('mail', 14)}<span class="v ${a.email ? '' : 'empty-v'}">${U.esc(a.email || 'Email belum diisi')}</span>
            ${a.email ? `<a class="mini-btn" href="mailto:${U.esc(a.email)}" title="Kirim email">${icon('mail', 11)}Email</a>
                         <button class="mini-btn" data-copy="${U.esc(a.email)}" title="Salin email">${icon('copy', 11)}</button>` : ''}</div>
        </div>
        <div class="acc-sec">
          <div class="acc-sec-t"><span>Pekerjaan berjalan</span><span>${a.checklist.length ? `${dn}/${a.checklist.length}` : ''}</span></div>
          ${items.map((c) => `<div class="tk ${c.done ? 'done' : ''}" data-cid="${c.id}">
              <input type="checkbox" class="chk" data-ctoggle ${c.done ? 'checked' : ''}/>
              <div class="tk-body"><div class="tk-title">${U.esc(c.text)}</div></div>
              <div class="tk-act"><button class="icon-btn sm danger" data-cdel title="Hapus">${icon('x', 12)}</button></div></div>`).join('')}
          <form class="note-add" data-cadd style="margin:4px 2px 6px" autocomplete="off">
            <input type="text" placeholder="Tambah pekerjaan (mis. follow-up listing SKU baru)…" maxlength="200" />
            <button class="icon-btn sm" type="submit">${icon('plus', 14)}</button></form>
        </div>
        <div class="acc-sec" style="padding-bottom:8px">
          <div class="acc-sec-t"><span>Catatan</span><span class="faint" data-saved></span></div>
          <textarea class="acc-notes" data-notes placeholder="Catatan negosiasi, jadwal visit, deal promo…">${U.esc(a.notes || '')}</textarea>
        </div>
      </div>`;
    },

    bind(root) {
      root.addEventListener('click', async (e) => {
        const card = e.target.closest('.note[data-id]'); if (!card) return;
        const a = this.get(card.dataset.id);
        const cp = e.target.closest('[data-copy]'); if (cp) return U.copy(cp.dataset.copy);
        if (e.target.closest('[data-edit]')) return this.edit(a);
        if (e.target.closest('[data-del]')) {
          if (await U.confirm(`Hapus account "${a.name}"?`)) { this.items = this.items.filter((x) => x !== a); await DB.del('accounts', a.id); U.emit('data', { store: 'accounts' }); }
          return;
        }
        const cdel = e.target.closest('[data-cdel]');
        if (cdel) { const cid = cdel.closest('[data-cid]').dataset.cid; a.checklist = a.checklist.filter((c) => c.id !== cid); await this.save(a); }
      });
      root.addEventListener('change', async (e) => {
        if (!e.target.matches('[data-ctoggle]')) return;
        const a = this.get(e.target.closest('.note').dataset.id);
        const c = a.checklist.find((x) => x.id === e.target.closest('[data-cid]').dataset.cid);
        c.done = e.target.checked; await this.save(a);
      });
      root.addEventListener('submit', async (e) => {
        const f = e.target.closest('[data-cadd]'); if (!f) return;
        e.preventDefault();
        const inp = f.querySelector('input'); const v = inp.value.trim(); if (!v) return;
        const id = f.closest('.note').dataset.id;
        const a = this.get(id);
        a.checklist.push({ id: U.uid(), text: v, done: false }); await this.save(a);
        const again = U.$(`.note[data-id="${id}"] [data-cadd] input`, root); again && again.focus();
      });
      const saveNotes = U.debounce(async (ta) => {
        const card = ta.closest('.note'); const a = this.get(card.dataset.id);
        a.notes = ta.value; await DB.put('accounts', a);
        const s = U.$('[data-saved]', card); if (s) { s.textContent = 'tersimpan'; setTimeout(() => (s.textContent = ''), 1200); }
        this._typing = false;
      }, 500);
      root.addEventListener('input', (e) => { if (e.target.matches('[data-notes]')) { this._typing = true; saveNotes(e.target); } });
    },

    edit(a) {
      const isNew = !a;
      const d = a ? { ...a } : { id: U.uid(), code: '', name: '', pic: '', role: 'Buyer', phone: '', email: '', color: U.NOTE_COLORS[this.items.length % 8], checklist: [], notes: '', createdAt: Date.now() };
      U.modal({
        title: isNew ? 'Account Baru' : 'Edit Account', icon: 'building', sticky: true,
        body: `
          <div class="field-row">
            <div class="field"><label>Nama Account</label><input class="input" id="aName" value="${U.esc(d.name)}" placeholder="Indomaret" autofocus /></div>
            <div class="field"><label>Kode singkat (avatar)</label><input class="input" id="aCode" value="${U.esc(d.code)}" maxlength="4" placeholder="IDM" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Nama PIC / Buyer</label><input class="input" id="aPic" value="${U.esc(d.pic)}" placeholder="Nama buyer" /></div>
            <div class="field"><label>Jabatan</label><input class="input" id="aRole" value="${U.esc(d.role)}" placeholder="Buyer / Category Manager" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Nomor HP / WA</label><input class="input" id="aPhone" value="${U.esc(d.phone)}" placeholder="0812xxxxxxx" inputmode="tel" />
              <span class="hint" id="aWaHint"></span></div>
            <div class="field"><label>Email</label><input class="input" id="aEmail" type="email" value="${U.esc(d.email)}" placeholder="buyer@account.co.id" /></div>
          </div>
          <div class="field"><label>Warna kartu</label><div class="swatches" id="aColors">${U.NOTE_COLORS.map((c) => `<button type="button" class="swatch c-${c} ${d.color === c ? 'active' : ''}" data-c="${c}"></button>`).join('')}</div></div>`,
        buttons: [
          { label: 'Batal', cls: 'ghost' },
          {
            label: 'Simpan', cls: 'primary', icon: 'check',
            onClick: async (ctx) => {
              const g = (id) => U.$(id, ctx.el).value.trim();
              d.name = g('#aName'); if (!d.name) { U.toast('Nama account wajib diisi', 'warn'); return false; }
              d.code = g('#aCode') || d.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
              d.pic = g('#aPic'); d.role = g('#aRole'); d.phone = g('#aPhone'); d.email = g('#aEmail');
              await this.save(d); U.toast(isNew ? 'Account ditambahkan' : 'Account disimpan');
            },
          },
        ],
        onMount: (el) => {
          U.$('#aColors', el).onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; d.color = b.dataset.c; U.$$('.swatch', el).forEach((s) => s.classList.toggle('active', s === b)); };
          const ph = U.$('#aPhone', el), hint = U.$('#aWaHint', el);
          const upd = () => { const w = U.waNumber(ph.value); hint.textContent = w ? 'WhatsApp: wa.me/' + w : ''; };
          ph.addEventListener('input', upd); upd();
        },
      });
    },
  };

  window.Account = Account;
  App.register('account', Account);
})();
