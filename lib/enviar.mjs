// Envia um pacote de dados para o site (PUT /dados/<chave>, com a chave do robô)
// ou grava num arquivo quando SAIDA_LOCAL aponta para uma pasta (para testar no PC).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function enviar(chave, obj) {
  const texto = JSON.stringify(obj);
  const kb = Math.round(texto.length / 1024);
  if (process.env.SAIDA_LOCAL) {
    writeFileSync(join(process.env.SAIDA_LOCAL, `${chave}.json`), texto);
    console.log(`${chave}: ${kb} KB gravados em ${process.env.SAIDA_LOCAL}`);
    return;
  }
  const url = process.env.ROBO_URL, segredo = process.env.ROBO_KEY;
  if (!url || !segredo) throw new Error('faltam ROBO_URL e ROBO_KEY (ou SAIDA_LOCAL)');
  for (let t = 0; t < 3; t++) {
    const r = await fetch(`${url.replace(/\/$/, '')}/dados/${chave}`, {
      method: 'PUT', body: texto, headers: { 'content-type': 'application/json', authorization: `Bearer ${segredo}` },
    });
    if (r.ok) { console.log(`${chave}: ${kb} KB enviados`); return; }
    console.log(`${chave}: envio falhou (http ${r.status}), tentativa ${t + 1}`);
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  throw new Error(`não consegui enviar ${chave}`);
}
