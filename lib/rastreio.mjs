// Raios -> pontos para desenhar + núcleos de tempestade com direção e velocidade.
// A velocidade vem da comparação do desenho dos raios de 20 em 20 minutos (correlação por janelas, como o TREC dos radares).
// Devolve o objeto no formato que a página lê (pontos e vetores em base64, um bloco por 10 minutos).
const BIN = 10, Q = 0.1, LAT0 = -38, LON0 = -66, NY = 221, NX = 261;
const kmLat = 111.2, kmLon = (lat) => 111.2 * Math.cos(lat * Math.PI / 180);
const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');

function borrar(src, r) { // média em caixa (2 passadas = quase gaussiana)
  let a = src, b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < NY; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * NX + Math.min(NX - 1, Math.max(0, x))];
      for (let x = 0; x < NX; x++) { b[y * NX + x] = s / (2 * r + 1); s += a[y * NX + Math.min(NX - 1, x + r + 1)] - a[y * NX + Math.max(0, x - r)]; } }
    const c = new Float32Array(src.length);
    for (let x = 0; x < NX; x++) { let s = 0; for (let y = -r; y <= r; y++) s += b[Math.min(NY - 1, Math.max(0, y)) * NX + x];
      for (let y = 0; y < NY; y++) { c[y * NX + x] = s / (2 * r + 1); s += b[Math.min(NY - 1, y + r + 1) * NX + x] - b[Math.max(0, y - r) * NX + x]; } }
    a = c; b = new Float32Array(src.length);
  }
  return a;
}

export function rastrear(J, amostra) {
  const NB = Math.floor((J.fim - J.inicio) / 60e3 / BIN) + 1;
  // 1) densidade de raios por bloco de 10 min na grade de 0,1°
  const D = Array.from({ length: NB }, () => new Float32Array(NY * NX));
  for (const [min, la100, lo100] of J.raios) {
    const b = Math.floor(min / BIN); if (b < 0 || b >= NB) continue;
    const iy = Math.round((la100 / 100 - LAT0) / Q), ix = Math.round((lo100 / 100 - LON0) / Q);
    if (iy < 0 || iy >= NY || ix < 0 || ix >= NX) continue;
    D[b][iy * NX + ix] += 1;
  }
  const flat = [], offs = [0];
  for (let b = 0; b < NB; b++) {
    const d = D[b];
    for (let k = 0; k < d.length; k++) if (d[k] > 0) flat.push(Math.floor(k / NX), k % NX, Math.min(65535, d[k]));
    offs.push(flat.length / 3);
  }
  // janela de 20 min (bloco atual + anterior), levemente borrada
  const S = Array.from({ length: NB }, (_, b) => {
    const s = new Float32Array(NY * NX);
    for (let k = 0; k < s.length; k++) s[k] = D[b][k] + (b > 0 ? D[b - 1][k] : 0);
    return borrar(s, 1);
  });
  // 2) vetores de deslocamento por janelas (S[b-2] -> S[b], 20 min)
  const PASSO = 5, MEIA = 7, BUSCA = 5; // centro a cada 0,5°, janela de 1,5°, busca até ±0,5° (≈165 km/h)
  function vetores(b) {
    if (b < 2) return [];
    const A = S[b - 2], B = S[b], out = [];
    for (let cy = MEIA + BUSCA; cy < NY - MEIA - BUSCA; cy += PASSO) for (let cx = MEIA + BUSCA; cx < NX - MEIA - BUSCA; cx += PASSO) {
      let sa = 0, sb = 0, saa = 0;
      for (let y = cy - MEIA; y <= cy + MEIA; y++) for (let x = cx - MEIA; x <= cx + MEIA; x++) { const a = A[y * NX + x], v = B[y * NX + x]; sa += a; sb += v; saa += a * a; }
      if (sa < 12 || sb < 12) continue;
      const res = [];
      let best = -1, bx = 0, by = 0;
      for (let dy = -BUSCA; dy <= BUSCA; dy++) { const linha = []; for (let dx = -BUSCA; dx <= BUSCA; dx++) {
        let sab = 0, sbb2 = 0;
        for (let y = cy - MEIA; y <= cy + MEIA; y++) for (let x = cx - MEIA; x <= cx + MEIA; x++) { const v = B[(y + dy) * NX + x + dx]; sab += A[y * NX + x] * v; sbb2 += v * v; }
        const r = sab / Math.sqrt(saa * sbb2 + 1e-9); linha.push(r);
        if (r > best) { best = r; bx = dx; by = dy; }
      } res.push(linha); }
      if (best < 0.45 || Math.abs(bx) === BUSCA || Math.abs(by) === BUSCA) continue;
      const R = (dy, dx) => res[dy + BUSCA][dx + BUSCA];
      const px = (R(by, bx - 1) - R(by, bx + 1)) / (2 * (R(by, bx - 1) - 2 * best + R(by, bx + 1)) || 1);
      const py = (R(by - 1, bx) - R(by + 1, bx)) / (2 * (R(by - 1, bx) - 2 * best + R(by + 1, bx)) || 1);
      const fx = bx + (Math.abs(px) < 1 ? px : 0), fy = by + (Math.abs(py) < 1 ? py : 0);
      const lat = LAT0 + cy * Q, lon = LON0 + cx * Q;
      out.push({ lat, lon, vx: fx * Q * kmLon(lat) * 3, vy: fy * Q * kmLat * 3, w: best * Math.sqrt(sb) });
    }
    return out.map((v) => {
      let sx = 0, sy = 0, sw = 0;
      for (const u of out) { const d = Math.hypot(u.lon - v.lon, u.lat - v.lat); if (d > 1.05) continue; sx += u.vx * u.w; sy += u.vy * u.w; sw += u.w; }
      return { lat: v.lat, lon: v.lon, vx: sx / sw, vy: sy / sw, w: v.w };
    });
  }
  // 3) núcleos: máximos locais da densidade borrada
  function nucleos(b) {
    const s = borrar(S[b], 2), out = [];
    for (let y = 3; y < NY - 3; y++) for (let x = 3; x < NX - 3; x++) {
      const v = s[y * NX + x]; if (v < 0.6) continue;
      let max = true;
      for (let dy = -3; dy <= 3 && max; dy++) for (let dx = -3; dx <= 3; dx++) { if ((dx || dy) && s[(Math.min(NY - 1, Math.max(0, y + dy))) * NX + Math.min(NX - 1, Math.max(0, x + dx))] > v) { max = false; break; } }
      if (!max) continue;
      let n = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) n += D[b][(y + dy) * NX + x + dx] + (b > 0 ? D[b - 1][(y + dy) * NX + x + dx] : 0);
      if (n < 6) continue;
      out.push({ lat: LAT0 + y * Q, lon: LON0 + x * Q, n: n / 2 });
    }
    return out;
  }
  const cel = [], vflat = [], voffs = [0];
  let anteriores = [];
  for (let b = 0; b < NB; b++) {
    const vs = vetores(b);
    const vsT = vs.map((v) => { const p = anteriores.find((u) => Math.abs(u.lon - v.lon) < 0.01 && Math.abs(u.lat - v.lat) < 0.01); return p ? { ...v, vx: (v.vx * 2 + p.vx) / 3, vy: (v.vy * 2 + p.vy) / 3 } : v; });
    anteriores = vsT;
    for (const v of vsT) vflat.push(Math.round((v.lon - LON0) / Q), Math.round((v.lat - LAT0) / Q), Math.round(v.vx), Math.round(v.vy));
    voffs.push(vflat.length / 4);
    cel.push(nucleos(b).map((c) => {
      let sx = 0, sy = 0, sw = 0;
      for (const v of vsT) { const d = Math.hypot((v.lon - c.lon) * Math.cos(c.lat * Math.PI / 180), v.lat - c.lat); if (d > 0.9) continue; const w = v.w / (0.15 + d); sx += v.vx * w; sy += v.vy * w; sw += w; }
      const r = Math.round(Math.min(60, 12 + 3 * Math.sqrt(c.n)));
      return [Math.round(c.lon * 100) / 100, Math.round(c.lat * 100) / 100, Math.round(c.n), r, null, sw ? Math.round(sx / sw) : null, sw ? Math.round(sy / sw) : null];
    }));
  }
  return {
    inicio: J.inicio, fim: J.fim, bin: BIN, nb: NB, lat0: LAT0, lon0: LON0, q: Q, amostra,
    pontos: b64(Uint16Array.from(flat)), offs, cel, vetB64: b64(Int16Array.from(vflat)), voffs,
  };
}
