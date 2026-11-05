/* Utilitas umum: tanggal Indonesia, format angka, event bus, modal, toast. */
(function () {
  const U = {};

  /* ---------- DOM ---------- */
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  U.debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- Tanggal (Bahasa Indonesia) ---------- */
  U.HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  U.HARI3 = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  U.BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  U.BULAN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const p2 = (n) => String(n).padStart(2, '0');
  U.p2 = p2;
  U.ymd = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  U.today = () => U.ymd(new Date());
  U.parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  U.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  U.addMonths = (d, n) => { const x = new Date(d); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(Math.min(day, U.daysInMonth(x))); return x; };
  U.weekStart = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; }; // Senin
  U.daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  U.isoWeek = (d) => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - n); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y0) / 864e5 + 1) / 7); };
  U.fmtLong = (d = new Date()) => `${U.HARI[d.getDay()]}, ${d.getDate()} ${U.BULAN[d.getMonth()]} ${d.getFullYear()}`;
  U.fmtDate = (d) => { d = typeof d === 'string' ? U.parse(d) : d; return `${d.getDate()} ${U.BULAN3[d.getMonth()]} ${d.getFullYear()}`; };
  U.fmtDM = (d) => { d = typeof d === 'string' ? U.parse(d) : d; return `${d.getDate()} ${U.BULAN3[d.getMonth()]}`; };
  U.fmtTime = (d = new Date(), sec = false) => `${p2(d.getHours())}:${p2(d.getMinutes())}${sec ? ':' + p2(d.getSeconds()) : ''}`;
  U.fmtDateTime = (ts) => { const d = new Date(ts); return `${U.fmtDM(d)} ${U.fmtTime(d)}`; };
  U.daysBetween = (a, b) => Math.round((U.parse(b) - U.parse(a)) / 864e5); // b - a
  U.relDay = (s) => {
    const n = U.daysBetween(U.today(), s);
    if (n === 0) return 'Hari ini'; if (n === 1) return 'Besok'; if (n === -1) return 'Kemarin';
    return n > 0 ? `${n} hari lagi` : `Lewat ${-n} hari`;
  };
  U.dur = (ms) => { // HH:MM:SS
    ms = Math.max(0, ms); const s = Math.floor(ms / 1000);
    return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;
  };
  U.timeAgo = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'baru saja'; if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
    if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`; return `${Math.floor(s / 86400)} hari lalu`;
  };

  /* ---------- Angka ---------- */
  U.fmtNum = (n, dec = 0) => (isFinite(n) ? Number(n).toLocaleString('id-ID', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '–');
  U.fmtPct = (n, dec = 1) => (isFinite(n) ? U.fmtNum(n * 100, dec) + '%' : '–');
  U.fmtRp = (n, compact = true) => {
    if (!isFinite(n)) return '–';
    const a = Math.abs(n), sgn = n < 0 ? '-' : '';
    if (!compact) return sgn + 'Rp ' + U.fmtNum(a);
    if (a >= 1e12) return `${sgn}Rp ${U.fmtNum(a / 1e12, 2)} T`;
    if (a >= 1e9) return `${sgn}Rp ${U.fmtNum(a / 1e9, 2)} M`;
    if (a >= 1e6) return `${sgn}Rp ${U.fmtNum(a / 1e6, 1)} jt`;
    if (a >= 1e3) return `${sgn}Rp ${U.fmtNum(a / 1e3, 0)} rb`;
    return sgn + 'Rp ' + U.fmtNum(a);
  };
  /* Terima "1.250.000", "1,25", "85%", "Rp 1.2 M", 0.85 → angka */
  U.toNum = (v) => {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s) return NaN;
    const pct = /%$/.test(s);
    let mult = 1;
    if (/\bT$/i.test(s)) mult = 1e12; else if (/\bM$/i.test(s)) mult = 1e9; else if (/\b(jt|juta)$/i.test(s)) mult = 1e6; else if (/\b(rb|ribu|K)$/i.test(s)) mult = 1e3;
    s = s.replace(/rp|%|\s|[a-z]+$/gi, '');
    // format Indonesia: titik ribuan, koma desimal
    if (/,\d{1,3}$/.test(s) && /\./.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else if (/,/.test(s) && !/\./.test(s)) s = (/^\d{1,3}(,\d{3})+$/.test(s)) ? s.replace(/,/g, '') : s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s) * mult;
    return pct ? n / 100 : n;
  };
  U.fmtBytes = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB');

  /* ---------- Event bus ---------- */
  const handlers = {};
  U.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return () => U.off(ev, fn); };
  U.off = (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); };
  U.emit = (ev, data) => (handlers[ev] || []).slice().forEach((fn) => { try { fn(data); } catch (e) { console.error(ev, e); } });

  /* ---------- Toast ---------- */
  U.toast = (msg, type = 'good', ms = 2800) => {
    const root = document.getElementById('toastRoot');
    const ic = { good: 'checkCircle', bad: 'x', warn: 'bell', info: 'sparkles' }[type] || 'checkCircle';
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = icon(ic, 16) + `<span>${U.esc(msg)}</span>`;
    root.appendChild(el);
    while (root.children.length > 3) root.firstElementChild.remove();
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
  };

  /* ---------- Modal ----------
     U.modal({ title, icon, body: html, size: 'lg'|'xl', buttons: [{label, cls, onClick(ctx) → false utk tetap buka}], onMount(el, ctx), onClose })
  */
  U.modal = (opt) => {
    const root = document.getElementById('modalRoot');
    const back = document.createElement('div');
    back.className = 'modal-back';
    const btns = opt.buttons || [{ label: 'Tutup', cls: '' }];
    back.innerHTML = `
      <div class="modal ${opt.size || ''}" role="dialog" aria-modal="true">
        <div class="modal-h">
          <div class="modal-t">${opt.icon ? icon(opt.icon, 18) : ''}${U.esc(opt.title || '')}</div>
          <button class="icon-btn" data-x title="Tutup (Esc)">${icon('x', 16)}</button>
        </div>
        <div class="modal-b">${opt.body || ''}</div>
        ${btns.length ? `<div class="modal-f">${btns.map((b, i) => `<button class="btn ${b.cls || ''}" data-b="${i}">${b.icon ? icon(b.icon, 14) : ''}${U.esc(b.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    const ctx = {
      el: back.querySelector('.modal'),
      body: back.querySelector('.modal-b'),
      close() { back.remove(); document.removeEventListener('keydown', onKey); opt.onClose && opt.onClose(); },
    };
    const onKey = (e) => {
      if (e.key === 'Escape') ctx.close();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { const p = btns.findIndex((b) => /primary|good/.test(b.cls || '')); if (p >= 0) back.querySelector(`[data-b="${p}"]`).click(); }
    };
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => { if (e.target === back) back._down = true; });
    back.addEventListener('mouseup', (e) => { if (e.target === back && back._down && !opt.sticky) ctx.close(); back._down = false; });
    back.querySelector('[data-x]').onclick = () => ctx.close();
    btns.forEach((b, i) => {
      back.querySelector(`[data-b="${i}"]`).onclick = async () => {
        if (b.onClick) { const r = await b.onClick(ctx); if (r === false) return; }
        ctx.close();
      };
    });
    root.appendChild(back);
    opt.onMount && opt.onMount(ctx.el, ctx);
    const f = back.querySelector('[autofocus]') || back.querySelector('.modal-b input, .modal-b textarea');
    f && setTimeout(() => { const a = document.activeElement; if (!a || !back.contains(a) || !a.matches('input, textarea, select')) f.focus(); }, 30);
    return ctx;
  };
  U.confirm = (msg, { title = 'Konfirmasi', ok = 'Hapus', cls = 'danger' } = {}) =>
    new Promise((res) => {
      let done = false;
      U.modal({
        title, body: `<div>${U.esc(msg)}</div>`,
        buttons: [{ label: 'Batal', cls: 'ghost' }, { label: ok, cls, onClick: () => { done = true; res(true); } }],
        onClose: () => { if (!done) res(false); },
      });
    });

  U.lightbox = (src) => {
    const el = document.createElement('div');
    el.className = 'lightbox';
    el.innerHTML = `<img src="${src}" alt=""><button class="icon-btn">${icon('x', 18)}</button>`;
    const close = () => { el.remove(); document.removeEventListener('keydown', k); };
    const k = (e) => e.key === 'Escape' && close();
    el.onclick = close; document.addEventListener('keydown', k);
    document.body.appendChild(el);
  };

  /* Pilih file lewat dialog */
  U.pickFiles = ({ accept = '', multiple = false } = {}) => new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => res(Array.from(inp.files || []));
    inp.click();
  });

  U.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    U.toast('Disalin: ' + text, 'good', 1800);
  };

  /* Nomor HP Indonesia → format wa.me (62xxx) */
  U.waNumber = (raw) => {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = '62' + d.slice(1);
    else if (d.startsWith('8')) d = '62' + d;
    return d;
  };

  U.NOTE_COLORS = ['yellow', 'blue', 'green', 'purple', 'pink', 'orange', 'red', 'gray'];

  window.U = U;
})();

/* ---------- Form modal generik (dipakai modul Tahap 2) ----------
   U.form({ title, icon, size, data, fields:[{key,label,type,options,placeholder,half,required,hint,rows}], onSave(values, ctx) → false utk tetap buka, extra:[{label,cls,onClick}], onMount(el) })
   type: text | textarea | date | time | number | money | select | email | tel | url | colors | check | datalist */
(function () {
  const U = window.U;
  U.form = (opt) => {
    const d = opt.data || {};
    const fieldHTML = (f) => {
      const v = d[f.key] ?? f.default ?? '';
      const id = 'f_' + f.key;
      const ph = f.placeholder ? ` placeholder="${U.esc(f.placeholder)}"` : '';
      let input;
      switch (f.type) {
        case 'textarea': input = `<textarea class="textarea" id="${id}" rows="${f.rows || 4}"${ph}>${U.esc(v)}</textarea>`; break;
        case 'select': input = `<select class="select" id="${id}">${f.options.map((o) => { const ov = typeof o === 'object' ? o.v : o, ol = typeof o === 'object' ? o.l : o; return `<option value="${U.esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${U.esc(ol)}</option>`; }).join('')}</select>`; break;
        case 'datalist': input = `<input class="input" id="${id}" list="${id}_dl" value="${U.esc(v)}"${ph}/><datalist id="${id}_dl">${(f.options || []).map((o) => `<option value="${U.esc(o)}">`).join('')}</datalist>`; break;
        case 'money': input = `<input class="input mono" id="${id}" inputmode="decimal" value="${v === '' || v == null || !isFinite(v) ? '' : U.fmtNum(v)}"${ph}/>`; break;
        case 'colors': input = `<div class="swatches" id="${id}" data-v="${U.esc(v || 'yellow')}">${U.NOTE_COLORS.map((c) => `<button type="button" class="swatch c-${c} ${(v || 'yellow') === c ? 'active' : ''}" data-c="${c}"></button>`).join('')}</div>`; break;
        case 'check': return `<label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer"><input type="checkbox" class="chk" id="${id}" ${v ? 'checked' : ''}/>${U.esc(f.label)}${f.hint ? ` <span class="hint">— ${U.esc(f.hint)}</span>` : ''}</label>`;
        default: input = `<input class="input" type="${f.type || 'text'}" id="${id}" value="${U.esc(v)}"${ph}/>`;
      }
      return `<div class="field"><label>${U.esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<span class="hint">${U.esc(f.hint)}</span>` : ''}</div>`;
    };
    let body = ''; const fs = opt.fields;
    for (let i = 0; i < fs.length; i++) {
      if (fs[i].half && fs[i + 1] && fs[i + 1].half) { body += `<div class="field-row">${fieldHTML(fs[i])}${fieldHTML(fs[i + 1])}</div>`; i++; }
      else body += fieldHTML(fs[i]);
    }
    if (opt.bodyAfter) body += opt.bodyAfter;
    const read = (el) => {
      const out = {};
      for (const f of fs) {
        const n = U.$('#f_' + f.key, el); if (!n) continue;
        if (f.type === 'check') out[f.key] = n.checked;
        else if (f.type === 'colors') out[f.key] = n.dataset.v;
        else if (f.type === 'money' || f.type === 'number') { const x = U.toNum(n.value); out[f.key] = isFinite(x) ? x : (f.type === 'money' ? 0 : ''); }
        else out[f.key] = n.value.trim();
      }
      return out;
    };
    return U.modal({
      title: opt.title, icon: opt.icon, size: opt.size, sticky: true, body,
      buttons: [
        ...(opt.extra || []),
        { label: 'Batal', cls: 'ghost' },
        {
          label: opt.saveLabel || 'Simpan', cls: 'primary', icon: 'check',
          onClick: async (ctx) => {
            const vals = read(ctx.el);
            const miss = fs.find((f) => f.required && !vals[f.key]);
            if (miss) { U.toast(`${miss.label} wajib diisi`, 'warn'); U.$('#f_' + miss.key, ctx.el).focus(); return false; }
            return opt.onSave(vals, ctx);
          },
        },
      ],
      onMount: (el, ctx) => {
        U.$$('.swatches', el).forEach((sw) => { sw.onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; sw.dataset.v = b.dataset.c; U.$$('.swatch', sw).forEach((s) => s.classList.toggle('active', s === b)); }; });
        U.$$('input.mono[inputmode="decimal"]', el).forEach((inp) => inp.addEventListener('blur', () => { const x = U.toNum(inp.value); if (isFinite(x)) inp.value = U.fmtNum(x); }));
        opt.onMount && opt.onMount(el, ctx, read);
      },
    });
  };
  U.domain = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  U.initials = (s) => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  U.download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
})();

/* Drag & drop kanban: elemen .kcard[draggable][data-card] di dalam .kcol[data-col] */
U.kanbanDnD = function (root, onDrop) {
  let dragId = null;
  root.addEventListener('dragstart', (e) => { const c = e.target.closest('.kcard[data-card]'); if (!c) return; dragId = c.dataset.card; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
  root.addEventListener('dragend', (e) => { const c = e.target.closest('.kcard'); c && c.classList.remove('dragging'); U.$$('.kcol.over', root).forEach((x) => x.classList.remove('over')); });
  root.addEventListener('dragover', (e) => { const col = e.target.closest('.kcol[data-col]'); if (!col || !dragId) return; e.preventDefault(); U.$$('.kcol.over', root).forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over'); });
  root.addEventListener('drop', (e) => {
    const col = e.target.closest('.kcol[data-col]'); if (!col || !dragId) return; e.preventDefault(); col.classList.remove('over');
    const cards = U.$$('.kcard[data-card]', col).filter((c) => c.dataset.card !== dragId);
    const before = cards.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    const id = dragId; dragId = null;
    onDrop(id, col.dataset.col, before ? before.dataset.card : null);
  });
};
