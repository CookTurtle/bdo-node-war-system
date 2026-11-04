// 在使用者框選的範圍內，自動找出每一列的「職業圖示」與「類型圖示」位置。
// 使用者只需要大略框住圖示欄（上下蓋住所有列即可），不用對準每個圖示。
//
// locateIcons(px, W, H, n)
//   px：框選範圍的 RGBA 像素（ImageData.data），W×H 為範圍大小
//   n ：資料列數（AI 辨識出的列數）；第 i 個格子對應第 i 列資料（由上到下）
// 回傳 { cells:[{cls:[x,y,w,h], sty:[x,y,w,h]|null}], cols, conf, equalSplit } 或 null（找不到圖示）
// 座標都相對於框選範圍左上角。
(function (root) {
  const CLIP = 80;                       // 單點邊緣強度上限，避免個別亮點主導
  const smooth = (a, r) => {             // 移動平均
    const o = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) { s += a[j]; c++; }
      o[i] = s / c;
    }
    return o;
  };

  // 水平方向的顏色變化量（只看左右邊緣：列與列之間的橫線不會被算進去）
  function edgesX(px, W, H) {
    const g = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 1; x < W - 1; x++) {
      const a = (y * W + x - 1) * 4, b = (y * W + x + 1) * 4;
      g[y * W + x] = Math.min(CLIP, Math.max(Math.abs(px[a] - px[b]), Math.abs(px[a + 1] - px[b + 1]), Math.abs(px[a + 2] - px[b + 2])));
    }
    return g;
  }

  // 找出沿 x 方向的圖示欄（由左到右）
  function findColumns(g, W, H, pitch) {
    const col = new Float32Array(W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) col[x] += g[y * W + x];
    const s = smooth(col, 1), mx = Math.max(...s);
    if (mx <= 0) return [];
    const th = mx * 0.28, runs = [];   // 略降門檻，讓較淡的類型圖示也能成欄
    for (let x = 0; x < W; x++) if (s[x] > th) {
      const last = runs[runs.length - 1];
      if (last && x - last[1] <= Math.max(2, Math.round(pitch * 0.12))) last[1] = x; else runs.push([x, x]);
    }
    const minW = Math.max(4, pitch * 0.2);
    return runs.filter(r => r[1] - r[0] + 1 >= minW).map(r => ({ x: r[0] + 1, w: Math.max(1, r[1] - r[0] - 1) }));  // 差分會讓邊緣各外擴 1px
  }

  // 以「n 個等距的峰」去貼合垂直方向的圖示分布，回傳每列中心 y
  function combFit(g, W, H, cols, n) {
    const prof = new Float32Array(H);
    for (let y = 0; y < H; y++) for (const c of cols) for (let x = c.x; x < c.x + c.w; x++) prof[y] += g[y * W + x];
    const p0 = H / n, sp = smooth(prof, Math.max(1, Math.round(p0 * 0.22)));
    const mean = sp.reduce((a, b) => a + b, 0) / H || 1;
    let best = { score: -1, o: 0, p: p0 };
    for (let k = 0.8; k <= 1.25; k += 0.004) {
      const p = p0 * k;
      if (p * n > H * 1.02 + 2) continue;                            // n 列放不進範圍
      for (let o = 0; o + p * n <= H + 2; o += 0.5) {
        let s = 0;
        for (let i = 0; i < n; i++) s += sp[Math.min(H - 1, Math.round(o + (i + 0.5) * p))];
        if (s > best.score) best = { score: s, o, p };
      }
    }
    const conf = best.score / n / mean;                              // 圖示列的平均強度 ÷ 整體平均
    return { ...best, conf, prof };
  }

  function locateIcons(px, W, H, n, opt = {}) {
    if (W < 8 || H < 8 || n < 1) return null;
    const g = edgesX(px, W, H), pitch0 = H / n;
    const cols = findColumns(g, W, H, pitch0);
    if (!cols.length) return null;
    const use = cols.slice(0, 2);                                    // 左＝職業、右＝類型
    const fit = combFit(g, W, H, use, n), minConf = opt.minConf ?? 1.1;
    const equalSplit = !(fit.conf >= minConf);                       // 信心不足 → 改用等分
    const p = equalSplit ? pitch0 : fit.p, o = equalSplit ? 0 : fit.o;
    const cyOf = i => {                                              // 逐列微調：取該列視窗內強邊緣的重心（最多偏離 15% 列高）
      const c0 = o + (i + 0.5) * p;
      if (equalSplit) return c0;
      const a = Math.max(0, Math.round(c0 - p / 2)), b = Math.min(H - 1, Math.round(c0 + p / 2));
      let mx = 0; for (let y = a; y <= b; y++) mx = Math.max(mx, fit.prof[y]);
      let sw = 0, sy = 0; for (let y = a; y <= b; y++) if (fit.prof[y] > mx * 0.5) { sw += fit.prof[y]; sy += fit.prof[y] * y; }
      return sw ? Math.max(c0 - p * 0.15, Math.min(c0 + p * 0.15, sy / sw)) : c0;
    };
    const box = (c, i) => {                                          // 以欄位寬為邊長的正方形，置中於該列
      const side = c.w, cx = c.x + c.w / 2, cy = cyOf(i);
      return [Math.round(cx - side / 2), Math.round(cy - side / 2), side, side];
    };
    const cells = Array.from({ length: n }, (_, i) => ({ cls: box(use[0], i), sty: use[1] ? box(use[1], i) : null }));
    return { cells, cols, conf: fit.conf, equalSplit, pitch: p };
  }

  if (typeof module !== 'undefined') module.exports = { locateIcons };
  else root.locateIcons = locateIcons;
})(typeof self !== 'undefined' ? self : this);
