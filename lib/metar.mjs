// Vento medido nos aeroportos do Sul (METAR), pela API pública do aviationweather.gov.
// A API devolve no máximo 400 leituras por pedido, por isso vai em lotes de 5 aeroportos.
const NOMES = {
  SBLO: 'Londrina', SBMG: 'Maringá', SBCA: 'Cascavel', SBFI: 'Foz do Iguaçu', SBCT: 'Curitiba (Afonso Pena)', SBBI: 'Curitiba (Bacacheri)',
  SBFL: 'Florianópolis', SBNF: 'Navegantes', SBJV: 'Joinville', SBCH: 'Chapecó', SBPA: 'Porto Alegre', SBCO: 'Canoas', SBSM: 'Santa Maria',
  SBPF: 'Passo Fundo', SBCX: 'Caxias do Sul', SBPK: 'Pelotas', SBNM: 'Santo Ângelo', SBDN: 'Presidente Prudente', SBPG: 'Ponta Grossa',
  SBGU: 'Guarapuava', SBTD: 'Toledo', SBLJ: 'Lages', SBCM: 'Criciúma', SBJA: 'Jaguaruna', SBUG: 'Uruguaiana', SBBG: 'Bagé', SBRG: 'Rio Grande',
};
const UA = { 'User-Agent': 'VenSul/1.0 (robo de dados)' };

// Devolve [{ id, nome, lat, lon, obs: [[minuto absoluto (ms/60000), direção, vento km/h, rajada km/h | null, temperatura]] }]
export async function aeroportos(horas = 24) {
  const ids = Object.keys(NOMES), lotes = [];
  for (let i = 0; i < ids.length; i += 5) lotes.push(ids.slice(i, i + 5));
  const todas = [];
  for (const lote of lotes) {
    const url = `https://aviationweather.gov/api/data/metar?ids=${lote.join(',')}&format=json&hours=${horas}`;
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(url, { headers: UA });
        if (r.status === 204) break;
        if (!r.ok) throw new Error('http ' + r.status);
        todas.push(...(await r.json()));
        break;
      } catch (e) {
        if (t === 2) console.log('METAR falhou', lote.join(','), e.message);
        else await new Promise((ok) => setTimeout(ok, 2000 * (t + 1)));
      }
    }
  }
  const aero = {}, vistos = new Set();
  for (const m of todas) {
    if (!NOMES[m.icaoId]) continue;
    const ms = m.obsTime ? m.obsTime * 1000 : Date.parse(m.reportTime);
    const chave = m.icaoId + '|' + ms;
    if (vistos.has(chave)) continue; vistos.add(chave);
    const a = aero[m.icaoId] || (aero[m.icaoId] = { id: m.icaoId, nome: NOMES[m.icaoId], lat: m.lat, lon: m.lon, obs: [] });
    a.obs.push([Math.round(ms / 60e3), typeof m.wdir === 'number' ? m.wdir : null, Math.round((m.wspd ?? 0) * 1.852), m.wgst ? Math.round(m.wgst * 1.852) : null, m.temp ?? null]);
  }
  for (const a of Object.values(aero)) a.obs.sort((x, y) => x[0] - y[0]);
  return Object.values(aero);
}
