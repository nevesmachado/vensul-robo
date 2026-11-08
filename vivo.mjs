// Robô "ao vivo" do VenSul: roda a cada 5 minutos.
// Junta os raios do satélite (últimos 90 min, com o rastreio das tempestades), o vento medido nos aeroportos
// (últimas 24 h) e os alertas do Inmet em vigor, e envia tudo como um pacote só ("vivo").
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baixarRaios, AMOSTRA } from './lib/glm.mjs';
import { rastrear } from './lib/rastreio.mjs';
import { aeroportos } from './lib/metar.mjs';
import { alertasInmet } from './lib/alertas.mjs';
import { enviar } from './lib/enviar.mjs';

const BLOCO = 10 * 60e3;
const agora = Date.now();
const fim = agora - 60e3; // o arquivo do último minuto ainda pode estar chegando
const inicio = Math.floor((agora - 90 * 60e3) / BLOCO) * BLOCO; // começa num múltiplo de 10 min (UTC)

const t0 = Date.now();
const [raios, metar, alertas] = await Promise.all([
  baixarRaios({ inicio, fim, pasta: join(tmpdir(), 'vensul-glm') }),
  aeroportos(24).catch((e) => { console.log('aeroportos:', e.message); return null; }),
  alertasInmet().catch((e) => { console.log('alertas:', e.message); return null; }),
]);
const glm = rastrear(raios, AMOSTRA);
console.log(`raios: ${raios.arquivos} arquivos, ${raios.falhas} falhas, ${raios.raios.length} raios, ${glm.cel.at(-1)?.length ?? 0} tempestades no último bloco`);
console.log(`aeroportos: ${metar ? metar.length : 'falhou'} · alertas no Sul: ${alertas ? alertas.length : 'falhou'} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);

if (raios.arquivos === 0) throw new Error('nenhum arquivo de raios encontrado; não envio dados vazios');
await enviar('vivo', { versao: 1, gerado: agora, glm, metar: metar || [], alertas: alertas || [], falhas: { metar: !metar, alertas: !alertas } });
