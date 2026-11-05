/* Diagram batang ringan berbasis <canvas> — pengganti Chart.js agar 100% offline.
   new BarChart(container, { labels, values, ghost, highlight, valueLabel(i) , tip(i) })
   chart.update({ ... })  — otomatis menyesuaikan tema & ukuran. */
(function () {
  class BarChart {
    constructor(container, data) {
      this.wrap = container;
      this.wrap.classList.add('chart-wrap');
      this.canvas = document.createElement('canvas');
      this.tipEl = document.createElement('div');
      this.tipEl.className = 'chart-tip';
      this.wrap.append(this.canvas, this.tipEl);
      this.ctx = this.canvas.getContext('2d');
      this.data = data;
      this.hover = -1;
      this.anim = 0;
      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(this.wrap);
      this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
      this.canvas.addEventListener('mouseleave', () => { this.hover = -1; this.tipEl.style.opacity = 0; this.draw(); });
      U.on('theme', () => this.draw());
      this.animate();
    }
    update(data) { this.data = data; this.animate(); }
    animate() {
      const t0 = performance.now();
      const step = (t) => { this.anim = Math.min(1, (t - t0) / 450); this.draw(); if (this.anim < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
    css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
    layout() {
      const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
      const pad = { l: 34, r: 8, t: 22, b: 40 };
      const n = this.data.labels.length;
      const cw = (w - pad.l - pad.r) / n;
      const bw = Math.min(46, cw * 0.56);
      return { w, h, pad, n, cw, bw };
    }
    draw() {
      const { w, h, pad, n, cw, bw } = this.layout();
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = w * dpr; this.canvas.height = h * dpr;
      const c = this.ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      const { values, ghost = [], labels, sub = [], highlight = -1 } = this.data;
      const max = Math.max(4, ...values, ...ghost);
      const step = max <= 6 ? 1 : max <= 12 ? 2 : Math.ceil(max / 5);
      const top = Math.ceil(max / step) * step;
      const ph = h - pad.t - pad.b;
      const y = (v) => pad.t + ph - (v / top) * ph;
      const muted = this.css('--muted'), faint = this.css('--faint'), border = this.css('--border');
      const good = this.css('--good'), accent = this.css('--accent'), ghostC = this.css('--surface-3'), text = this.css('--text');
      c.font = '11px ' + this.css('--font'); c.textBaseline = 'middle';
      // grid
      for (let v = 0; v <= top; v += step) {
        const yy = Math.round(y(v)) + 0.5;
        c.strokeStyle = border; c.lineWidth = 1; c.setLineDash(v === 0 ? [] : [3, 4]);
        c.beginPath(); c.moveTo(pad.l, yy); c.lineTo(w - pad.r, yy); c.stroke();
        c.fillStyle = faint; c.textAlign = 'right'; c.fillText(String(v), pad.l - 8, yy);
      }
      c.setLineDash([]);
      this.bars = [];
      for (let i = 0; i < n; i++) {
        const cx = pad.l + cw * i + cw / 2;
        const x = cx - bw / 2;
        if (ghost[i]) { this.roundRect(x, y(ghost[i]), bw, y(0) - y(ghost[i]), 6, ghostC); }
        const v = values[i] * this.ease(this.anim);
        const isH = i === highlight, isHover = i === this.hover;
        if (values[i] > 0) {
          const col = isH ? good : accent;
          c.globalAlpha = this.hover >= 0 && !isHover ? 0.55 : 1;
          this.roundRect(x, y(v), bw, y(0) - y(v), 6, col);
          c.globalAlpha = 1;
          if (this.anim === 1) { c.fillStyle = text; c.textAlign = 'center'; c.font = '600 12px ' + this.css('--font'); c.fillText(String(values[i]), cx, y(values[i]) - 10); }
        }
        c.textAlign = 'center';
        c.font = (isH ? '600 ' : '') + '12px ' + this.css('--font');
        c.fillStyle = isH ? text : muted; c.fillText(labels[i], cx, h - pad.b + 15);
        c.font = '11px ' + this.css('--font'); c.fillStyle = faint; c.fillText(sub[i] || '', cx, h - pad.b + 30);
        this.bars.push({ x: pad.l + cw * i, w: cw, cx, top: y(Math.max(values[i], ghost[i] || 0)) });
      }
    }
    ease(t) { return 1 - Math.pow(1 - t, 3); }
    roundRect(x, y, w, h, r, color) {
      const c = this.ctx; if (h <= 0) return; r = Math.min(r, h, w / 2);
      c.fillStyle = color; c.beginPath();
      c.moveTo(x, y + h); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
      c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h); c.closePath(); c.fill();
    }
    onMove(e) {
      const r = this.canvas.getBoundingClientRect(); const mx = e.clientX - r.left;
      const i = (this.bars || []).findIndex((b) => mx >= b.x && mx < b.x + b.w);
      if (i !== this.hover) { this.hover = i; this.draw(); }
      if (i >= 0 && this.data.tip) {
        this.tipEl.innerHTML = this.data.tip(i);
        this.tipEl.style.left = this.bars[i].cx + 'px';
        this.tipEl.style.top = Math.max(18, this.bars[i].top) + 'px';
        this.tipEl.style.opacity = 1;
      } else this.tipEl.style.opacity = 0;
    }
  }

  /* Sparkline SVG kecil untuk KPI card */
  BarChart.spark = (vals, { w = 84, h = 28, color = 'var(--accent)' } = {}) => {
    if (!vals || vals.length < 2) return '';
    const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - mn) / rg) * (h - 6)}`).join(' ');
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/></svg>`;
  };

  window.BarChart = BarChart;
})();
