/* Pembaca Excel (.xlsx) & CSV mini — tanpa library, 100% offline.
   Membaca NILAI tersimpan (cached value) tiap sel, termasuk hasil rumus & pivot yang sudah di-refresh.
   Butuh DecompressionStream (Chrome/Edge 80+, Firefox 113+, Safari 16.4+).

   XLSX.read(file) → { name, sheets: [{ name, cells: { 'A1': value }, maxR, maxC }] }
   XLSX.cell(book, 'Sheet1!C5') → value
*/
(function () {
  const td = new TextDecoder('utf-8');

  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Bukan file Excel .xlsx yang valid');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const loff = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      files[name] = { method, csize, loff };
      p += 46 + nlen + elen + clen;
    }
    return {
      has: (name) => !!files[name],
      async text(name) {
        const f = files[name];
        if (!f) return null;
        const ln = dv.getUint16(f.loff + 26, true), le = dv.getUint16(f.loff + 28, true);
        const start = f.loff + 30 + ln + le;
        const data = u8.subarray(start, start + f.csize);
        const raw = f.method === 0 ? data : await inflateRaw(data);
        return td.decode(raw);
      },
    };
  }

  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const colToNum = (c) => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  const numToCol = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  /* Buka workbook tanpa membaca sheet: { sheetNames, load(name) } — hemat untuk file besar (sheet raw 200 MB tidak disentuh) */
  async function openXlsx(buf, fileName) {
    const z = await unzip(buf);
    const wb = xml(await z.text('xl/workbook.xml'));
    const rels = xml((await z.text('xl/_rels/workbook.xml.rels')) || '<r/>');
    const relMap = {};
    tags(rels, 'Relationship').forEach((r) => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const list = tags(wb, 'sheet').map((s) => {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap[rid] || '';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      return { name: s.getAttribute('name'), target };
    });
    let shared = null;
    const getShared = async () => {
      if (shared) return shared;
      shared = [];
      const ssText = await z.text('xl/sharedStrings.xml');
      if (ssText) tags(xml(ssText), 'si').forEach((si) => shared.push(tags(si, 't').map((t) => t.textContent).join('')));
      return shared;
    };
    return {
      name: fileName,
      sheetNames: list.map((s) => s.name),
      async load(name) {
        const s = list.find((x) => x.name === name); if (!s) return null;
        return parseSheet(name, await z.text(s.target), await getShared());
      },
    };
  }

  function parseSheet(name, txt, shared) {
    if (!txt) return null;
    const doc = xml(txt);
    const cells = {}; let maxR = 0, maxC = 0;
    tags(doc, 'c').forEach((c) => {
      const ref = c.getAttribute('r'); if (!ref) return;
      const t = c.getAttribute('t');
      const vEl = tags(c, 'v')[0];
      let v;
      if (t === 's') v = vEl ? shared[+vEl.textContent] : '';
      else if (t === 'inlineStr') v = tags(c, 't').map((x) => x.textContent).join('');
      else if (t === 'b') v = vEl ? vEl.textContent === '1' : false;
      else if (t === 'str' || t === 'e') v = vEl ? vEl.textContent : '';
      else v = vEl ? parseFloat(vEl.textContent) : undefined;
      if (v === undefined || v === '') return;
      cells[ref] = v;
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (m) { maxR = Math.max(maxR, +m[2]); maxC = Math.max(maxC, colToNum(m[1])); }
    });
    return { name, cells, maxR, maxC };
  }

  async function readXlsx(buf, fileName) {
    const z = await unzip(buf);
    const wb = xml(await z.text('xl/workbook.xml'));
    const rels = xml((await z.text('xl/_rels/workbook.xml.rels')) || '<r/>');
    const relMap = {};
    tags(rels, 'Relationship').forEach((r) => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const shared = [];
    const ssText = await z.text('xl/sharedStrings.xml');
    if (ssText) tags(xml(ssText), 'si').forEach((si) => shared.push(tags(si, 't').map((t) => t.textContent).join('')));

    const sheets = [];
    for (const s of tags(wb, 'sheet')) {
      const name = s.getAttribute('name');
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap[rid] || '';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const txt = await z.text(target);
      if (!txt) continue;
      const doc = xml(txt);
      const cells = {}; let maxR = 0, maxC = 0;
      tags(doc, 'c').forEach((c) => {
        const ref = c.getAttribute('r'); if (!ref) return;
        const t = c.getAttribute('t');
        const vEl = tags(c, 'v')[0];
        let v;
        if (t === 's') v = vEl ? shared[+vEl.textContent] : '';
        else if (t === 'inlineStr') v = tags(c, 't').map((x) => x.textContent).join('');
        else if (t === 'b') v = vEl ? vEl.textContent === '1' : false;
        else if (t === 'str' || t === 'e') v = vEl ? vEl.textContent : '';
        else v = vEl ? parseFloat(vEl.textContent) : undefined;
        if (v === undefined || v === '') return;
        cells[ref] = v;
        const m = ref.match(/^([A-Z]+)(\d+)$/);
        if (m) { maxR = Math.max(maxR, +m[2]); maxC = Math.max(maxC, colToNum(m[1])); }
      });
      sheets.push({ name, cells, maxR, maxC });
    }
    return { name: fileName, sheets };
  }

  function parseCSV(text, fileName) {
    const first = text.split(/\r?\n/)[0] || '';
    const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const cells = {}; let maxR = 0, maxC = 0;
    rows.forEach((r, ri) => r.forEach((v, ci) => {
      v = v.trim(); if (v === '') return;
      const n = U.toNum(v);
      cells[numToCol(ci + 1) + (ri + 1)] = /^[-\d.,%\s]+$/.test(v) && isFinite(n) ? n : v;
      maxR = Math.max(maxR, ri + 1); maxC = Math.max(maxC, ci + 1);
    }));
    return { name: fileName, sheets: [{ name: 'CSV', cells, maxR, maxC }] };
  }

  async function read(file) {
    const name = file.name || 'file';
    if (/\.csv$|\.txt$/i.test(name)) return parseCSV(await file.text(), name);
    if (/\.xls$/i.test(name)) throw new Error('Format .xls lama belum didukung — simpan ulang sebagai .xlsx atau .csv');
    if (typeof DecompressionStream === 'undefined') throw new Error('Browser terlalu lama untuk membaca .xlsx — gunakan Chrome/Edge terbaru atau export ke CSV');
    return readXlsx(await file.arrayBuffer(), name);
  }

  /* Referensi "Sheet!C5" atau "C5" (sheet pertama) */
  function cell(book, ref) {
    if (!book || !ref) return undefined;
    let sheetName = null, addr = ref.trim();
    const i = addr.lastIndexOf('!');
    if (i >= 0) { sheetName = addr.slice(0, i).replace(/^'|'$/g, ''); addr = addr.slice(i + 1); }
    addr = addr.replace(/\$/g, '').toUpperCase();
    const sh = sheetName ? book.sheets.find((s) => s.name === sheetName) : book.sheets[0];
    return sh ? sh.cells[addr] : undefined;
  }

  /* Ubah sheet → array baris (array nilai), index 0-based */
  function toRows(sh) {
    const rows = Array.from({ length: sh.maxR }, () => []);
    for (const [ref, v] of Object.entries(sh.cells)) {
      const m = ref.match(/^([A-Z]+)(\d+)$/); if (!m) continue;
      rows[+m[2] - 1][colToNum(m[1]) - 1] = v;
    }
    return rows;
  }
  /* Serial tanggal Excel → 'YYYY-MM-DD' */
  function serialToYmd(n) {
    if (typeof n !== 'number' || n < 20000 || n > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  async function open(file) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Browser terlalu lama untuk membaca .xlsx — gunakan Chrome/Edge terbaru');
    return openXlsx(await file.arrayBuffer(), file.name);
  }

  window.XLSX = { read, open, cell, toRows, serialToYmd, colToNum, numToCol };
})();
