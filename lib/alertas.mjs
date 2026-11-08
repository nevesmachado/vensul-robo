// Alertas oficiais do Inmet em vigor (os mesmos que chegam no celular), só para as cidades do PR, SC e RS.
// Atenção: só funciona por https; pelo http o servidor responde 302.
const NIVEL = { 'Perigo Potencial': 1, 'Perigo': 2, 'Grande Perigo': 3 };
const UA = { 'User-Agent': 'VenSul/1.0 (robo de dados)' };
// "2026-11-08 08:42" no horário de Brasília (sem horário de verão desde 2019) -> ms
const msDe = (s) => Date.parse(s.replace(' ', 'T') + ':00-03:00');

export async function alertasInmet() {
  const r = await fetch('https://apiprevmet3.inmet.gov.br/avisos/ativos', { headers: UA });
  if (!r.ok) throw new Error('Inmet http ' + r.status);
  const j = await r.json();
  const out = [];
  for (const a of [...(j.hoje || []), ...(j.futuro || [])]) {
    const codes = String(a.geocodes || '').split(',').filter((c) => /^4[123]\d{5}$/.test(c));
    if (!codes.length) continue;
    let riscos = a.riscos;
    try { if (typeof riscos === 'string') riscos = JSON.parse(riscos); } catch {}
    out.push({ desc: a.descricao, sev: a.severidade, nivel: NIVEL[a.severidade] || 1, cor: a.aviso_cor, ini: msDe(a.inicio), fim: msDe(a.fim), riscos: [].concat(riscos || []).join(' '), codes });
  }
  return out;
}
