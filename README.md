# VenSul · robô de dados

Busca os dados de tempo severo do Sul do Brasil e envia para o site do VenSul.

| Parte | De onde vem | A cada | Licença |
|---|---|---|---|
| Raios e rastreio das tempestades | Satélite GOES-19, sensor GLM (NOAA, bucket aberto na AWS) | 5 min | Domínio público (NOAA) |
| Vento medido | METAR dos aeroportos (aviationweather.gov) | 5 min | Domínio público |
| Alertas | Inmet, avisos em vigor (apiprevmet3.inmet.gov.br) | 5 min | Citar a fonte (Inmet) |
| Previsão | Modelo GFS 0,25° (NOAA/NCEP, filtro do NOMADS) | quando sai rodada nova | Domínio público |

- `vivo.mjs`: raios dos últimos 90 min (1 arquivo por minuto), rastreio das tempestades em blocos de 10 min, aeroportos e alertas. Envia o pacote `vivo`.
- `previsao.py`: rodada mais nova do GFS, de f000 a f054, recortada no Sul. Envia o pacote `previsao`.

O GitHub Actions roda os dois (`.github/workflows/robo.yml`). Precisa de dois segredos no repositório:
`ROBO_URL` (endereço do site) e `ROBO_KEY` (chave que o site exige para aceitar os dados).

Para testar no computador, sem enviar: `SAIDA_LOCAL=<pasta> node vivo.mjs` e `SAIDA_LOCAL=<arquivo> python previsao.py`.
