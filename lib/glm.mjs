// Raios do satélite GOES-19 (sensor GLM), dados abertos da NOAA na AWS (bucket noaa-goes19).
// Baixa 1 arquivo por minuto (o que começa no segundo 00), guarda só os raios dentro da região do mapa
// e apaga o arquivo. Cada arquivo cobre 20 s, então a amostra é 1 em 3.
import h5wasm from 'h5wasm/node';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://noaa-goes19.s3.amazonaws.com';
export const CAIXA = { lon0: -66, lon1: -40, lat0: -38, lat1: -16 };
export const AMOSTRA = 3;

const doy = (d) => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
const p2 = (n) => String(n).padStart(2, '0'), p3 = (n) => String(n).padStart(3, '0');

async function listar(prefix) {
  const keys = []; let token = '';
  for (;;) {
    const url = `${BASE}/?list-type=2&prefix=${encodeURIComponent(prefix)}${token ? '&continuation-token=' + encodeURIComponent(token) : ''}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`listagem ${prefix}: http ${r.status}`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    const t = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    if (!t) break; token = t[1];
  }
  return keys;
}

// inicio e fim em ms (UTC). Devolve { inicio, fim, arquivos, falhas, raios: [[minuto desde o início, lat*100, lon*100, energia]] }
export async function baixarRaios({ inicio, fim, pasta, paralelo = 12 }) {
  await h5wasm.ready;
  if (!existsSync(pasta)) mkdirSync(pasta, { recursive: true });
  const alvos = [];
  const horas = new Set();
  for (let t = Math.floor(inicio / 3600e3) * 3600e3; t <= fim; t += 3600e3) horas.add(t);
  for (const t of horas) {
    const d = new Date(t);
    const prefix = `GLM-L2-LCFA/${d.getUTCFullYear()}/${p3(doy(d))}/${p2(d.getUTCHours())}/`;
    for (const k of await listar(prefix)) {
      const m = k.match(/_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_/);
      if (!m || m[5] !== '00') continue;
      const ts = Date.UTC(+m[1], 0, 1) + (+m[2] - 1) * 864e5 + +m[3] * 3600e3 + +m[4] * 60e3;
      if (ts < inicio || ts > fim) continue;
      alvos.push({ key: k, minuto: Math.round((ts - inicio) / 60e3) });
    }
  }
  const raios = [];
  let falhas = 0, i = 0;
  async function processar(a, slot) {
    const arq = join(pasta, `glm_${slot}.nc`);
    for (let tent = 0; tent < 3; tent++) {
      try {
        const r = await fetch(`${BASE}/${a.key}`);
        if (!r.ok) throw new Error('http ' + r.status);
        writeFileSync(arq, Buffer.from(await r.arrayBuffer()));
        const f = new h5wasm.File(arq, 'r');
        const lat = f.get('flash_lat').value, lon = f.get('flash_lon').value, en = f.get('flash_energy').value;
        f.close();
        for (let j = 0; j < lat.length; j++) {
          const la = lat[j], lo = lon[j];
          if (lo < CAIXA.lon0 || lo > CAIXA.lon1 || la < CAIXA.lat0 || la > CAIXA.lat1) continue;
          raios.push([a.minuto, Math.round(la * 100), Math.round(lo * 100), Math.min(255, en[j] & 0xffff)]);
        }
        unlinkSync(arq);
        return;
      } catch (e) {
        if (existsSync(arq)) try { unlinkSync(arq); } catch {}
        if (tent === 2) { falhas++; console.log('falha', a.key, e.message); }
      }
    }
  }
  await Promise.all(Array.from({ length: paralelo }, async (_, slot) => {
    while (i < alvos.length) await processar(alvos[i++], slot);
  }));
  raios.sort((a, b) => a[0] - b[0]);
  return { inicio, fim, arquivos: alvos.length, falhas, raios };
}
