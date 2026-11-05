/* MENU 9 — Projek Luar (halaman ala Notion + Kanban per projek)
   Store 'projects' → { id, emoji, title, doc, cards:[{id,title,note,tag,col,order}], createdAt } */
(function () {
  const C = DB.collection('projects');
  const COLS = [{ k: 'idea', l: 'Ide', c: 'var(--faint)' }, { k: 'doing', l: 'Proses', c: 'var(--accent)' }, { k: 'done', l: 'Selesai', c: 'var(--good)' }];
  const EMOJIS = ['🎓', '📚', '🚀', '💡', '🧀', '🥛', '📈', '🎬', '🌐', '✍️', '🗂️', '⭐'];

  const Projek = {
    C, current: null,
    async load() {
      await C.load();
      if (!C.items.length && !(await DB.kv.get('projSeeded'))) {
        await C.save({ emoji: '🎓', title: 'Kelas Online FMCG', doc: 'Tujuan:\n- \n\nTarget peserta:\n- \n\nKurikulum (draft):\n1. \n2. \n3. ',
          cards: [['Susun kurikulum & silabus', 'idea', 'Materi'], ['Pilih platform kelas / website', 'idea', 'Website'], ['Rencana konten promosi kelas', 'idea', 'Konten']].map(([t, col, tag], i) => ({ id: U.uid(), title: t, note: '', tag, col, order: i })) });
        await DB.kv.set('projSeeded', true);
      }
    },

    render(el) {
      el.innerHTML = `<div class="proj"><div><div class="section-title">${icon('rocket', 13)}Projek</div><div class="proj-list" id="pjList"></div></div><div class="proj-page" id="pjPage"></div></div>`;
      el.addEventListener('click', (e) => {
        const it = e.target.closest('[data-pj]'); if (it) { this.current = it.dataset.pj; return this.paint(); }
        if (e.target.closest('[data-newpj]')) return this.create();
        const p = C.get(this.current); if (!p) return;
        if (e.target.closest('[data-emoji]')) { p.emoji = EMOJIS[(EMOJIS.indexOf(p.emoji) + 1) % EMOJIS.length]; return C.save(p); }
        if (e.target.closest('[data-delpj]')) return this.removeProject(p);
        const card = e.target.closest('[data-card]');
        if (card && e.target.closest('[data-cdel]')) { p.cards = p.cards.filter((c) => c.id !== card.dataset.card); return C.save(p); }
        if (card && !e.target.closest('button')) return this.editCard(p, p.cards.find((c) => c.id === card.dataset.card));
      });
      el.addEventListener('submit', (e) => {
        const f = e.target.closest('[data-kadd]'); if (!f) return; e.preventDefault();
        const p = C.get(this.current); const inp = f.querySelector('input'); const t = inp.value.trim(); if (!t) return;
        const doc = U.$('#pjDoc'), ttl = U.$('#pjTitle'); if (doc) p.doc = doc.value; if (ttl) p.title = ttl.textContent.trim(); this._typing = false;
        p.cards.push({ id: U.uid(), title: t, note: '', tag: '', col: f.dataset.kadd, order: p.cards.length });
        C.save(p).then(() => { const again = U.$(`[data-kadd="${f.dataset.kadd}"] input`); again && again.focus(); });
      });
      U.kanbanDnD(el, (id, col, beforeId) => {
        const p = C.get(this.current); const c = p.cards.find((x) => x.id === id); c.col = col;
        const items = p.cards.filter((x) => x.col === col && x.id !== id).sort((a, b) => a.order - b.order);
        const i = beforeId ? items.findIndex((x) => x.id === beforeId) : items.length;
        items.splice(i, 0, c); items.forEach((x, k) => { x.order = k; });
        C.save(p);
      });
      U.on('data', (d) => { if (App.current === 'projek' && d && d.store === 'projects') { if (this._typing) this._dirty = true; else this.paint(); } });
    },
    onShow() { this.paint(); },

    paint() {
      const list = [...C.items].sort((a, b) => a.createdAt - b.createdAt);
      if (!C.get(this.current)) this.current = list[0] && list[0].id;
      U.$('#pjList').innerHTML = list.map((p) => `<button class="sb-item ${p.id === this.current ? 'active' : ''}" data-pj="${p.id}"><span>${p.emoji || '📄'}</span><span class="sb-label">${U.esc(p.title || 'Tanpa judul')}</span><span class="sb-num">${p.cards.filter((c) => c.col !== 'done').length || ''}</span></button>`).join('')
        + `<button class="sb-item" data-newpj style="color:var(--muted)">${icon('plus', 15)}<span>Projek baru</span></button>`;
      const p = C.get(this.current);
      const page = U.$('#pjPage');
      if (!p) { page.innerHTML = `<div class="empty">${icon('rocket', 28)}<b>Belum ada projek</b></div>`; return; }
      const dn = p.cards.filter((c) => c.col === 'done').length;
      page.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <span class="proj-emoji" data-emoji title="Klik untuk ganti ikon">${p.emoji || '📄'}</span>
          <button class="btn ghost sm danger" data-delpj>${icon('trash', 13)}Hapus projek</button></div>
        <div class="proj-title" contenteditable="true" id="pjTitle" spellcheck="false">${U.esc(p.title)}</div>
        <div class="kcard-m" style="margin-bottom:6px"><span>${p.cards.length} kartu · ${dn} selesai</span><span>·</span><span>diubah ${U.timeAgo(p.updatedAt || p.createdAt)}</span><span id="pjSaved" class="faint"></span></div>
        <div class="progress good" style="margin-bottom:14px"><span style="width:${p.cards.length ? (dn / p.cards.length) * 100 : 0}%"></span></div>
        <textarea class="proj-doc" id="pjDoc" placeholder="Tulis apa saja: tujuan, kurikulum, ide konten, catatan riset…">${U.esc(p.doc || '')}</textarea>
        <div class="section-title" style="margin-top:18px">${icon('listChecks', 13)}Board eksekusi</div>
        <div class="kanban">${COLS.map((c) => {
          const items = p.cards.filter((x) => x.col === c.k).sort((a, b) => a.order - b.order);
          return `<div class="kcol" data-col="${c.k}"><div class="kcol-h"><div class="kcol-t"><span class="dot" style="background:${c.c}"></span>${c.l} <span class="badge">${items.length}</span></div></div>
            ${items.map((x) => `<div class="kcard" draggable="true" data-card="${x.id}"><div class="kcard-a"><div class="kcard-t">${U.esc(x.title)}</div><button class="icon-btn sm danger" data-cdel title="Hapus">${icon('x', 12)}</button></div>
              ${x.note ? `<div class="hint" style="white-space:pre-wrap">${U.esc(x.note.slice(0, 140))}</div>` : ''}${x.tag ? `<div class="kcard-m"><span class="badge accent">${U.esc(x.tag)}</span></div>` : ''}</div>`).join('')}
            <form class="kadd" data-kadd="${c.k}" autocomplete="off"><input placeholder="+ Tambah kartu" maxlength="160"/></form></div>`;
        }).join('')}</div>`;
      const doc = U.$('#pjDoc'); const ttl = U.$('#pjTitle');
      const grow = () => { doc.style.height = 'auto'; doc.style.height = doc.scrollHeight + 'px'; }; grow();
      const save = U.debounce(async () => { p.doc = doc.value; p.title = ttl.textContent.trim(); await DB.put('projects', p); this._typing = false; if (this._dirty) { this._dirty = false; return this.paint(); } const s = U.$('#pjSaved'); if (s) { s.textContent = '· tersimpan'; setTimeout(() => s && (s.textContent = ''), 1200); } const b = U.$(`[data-pj="${p.id}"] .sb-label`); if (b) b.textContent = p.title || 'Tanpa judul'; }, 500);
      doc.addEventListener('input', () => { this._typing = true; grow(); save(); });
      ttl.addEventListener('input', () => { this._typing = true; save(); });
      ttl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doc.focus(); } });
    },

    async create() { const p = await C.save({ emoji: '💡', title: '', doc: '', cards: [] }); this.current = p.id; this.paint(); U.$('#pjTitle').focus(); },
    async removeProject(p) { if (await U.confirm(`Hapus projek "${p.title || 'Tanpa judul'}" beserta ${p.cards.length} kartu?`)) { await C.remove(p.id); this.current = null; } },
    editCard(p, c) {
      U.form({
        title: 'Kartu', icon: 'stickyNote', data: c,
        fields: [{ key: 'title', label: 'Judul', required: true }, { key: 'tag', label: 'Label', type: 'datalist', options: ['Materi', 'Konten', 'Website', 'Riset', 'Marketing'], half: true },
          { key: 'col', label: 'Kolom', type: 'select', options: COLS.map((x) => ({ v: x.k, l: x.l })), half: true }, { key: 'note', label: 'Catatan', type: 'textarea', rows: 6 }],
        onSave: async (v) => { Object.assign(c, v); await C.save(p); },
      });
    },
  };

  window.Projek = Projek;
  App.register('projek', Projek);
})();
