"""Previsão do VenSul: GFS da NOAA (domínio público), recortado no Sul do Brasil.

Baixa a rodada mais nova do GFS 0,25° (de hora em hora, f000 a f054) pelo filtro do NOMADS,
lê os arquivos GRIB e gera as duas grades que a página usa:
  F: grade fina de 0,5° no Sul (vento, rajada, chuva, temperatura a 2 m)
  C: grade larga de 1° na tela toda (vento, rajada, temperatura a 850 hPa, pressão)
Envia para o site (ROBO_URL + ROBO_KEY) ou grava num arquivo (SAIDA_LOCAL).
Só baixa de novo quando sai uma rodada nova.
"""
import base64, datetime as dt, json, os, sys, tempfile, time, urllib.request, urllib.error
import numpy as np
import eccodes

NH = 55  # f000 a f054
FILTRO = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl'
PROD = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod'
CAIXA = dict(toplat=-12, leftlon=288, rightlon=328, bottomlat=-42)  # lon -72 a -32, lat -42 a -12
LAT_S, LON_W, PASSO = -42.0, 288.0, 0.25
UA = {'User-Agent': 'VenSul/1.0 (robo de dados)'}

FINA = dict(lats=[round(-22 - 0.5 * i, 2) for i in range(26)], lons=[round(-58.5 + 0.5 * i, 2) for i in range(30)], step=0.5)
LARGA = dict(lats=[float(-12 - i) for i in range(31)], lons=[float(-72 + i) for i in range(41)], step=1)


def http(url, tentativas=4, metodo='GET', dados=None, cab=None):
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, data=dados, method=metodo, headers={**UA, **(cab or {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, b''
            if t == tentativas - 1:
                raise
        except Exception:
            if t == tentativas - 1:
                raise
        time.sleep(5 * (t + 1))


def rodada_mais_nova():
    agora = dt.datetime.now(dt.timezone.utc)
    for horas_atras in range(0, 48, 6):
        c = agora - dt.timedelta(hours=horas_atras)
        c = c.replace(hour=c.hour // 6 * 6, minute=0, second=0, microsecond=0)
        dia, hh = c.strftime('%Y%m%d'), c.strftime('%H')
        st, _ = http(f'{PROD}/gfs.{dia}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{NH - 1:03d}.idx', metodo='HEAD')
        if st == 200:
            return c
    raise SystemExit('nenhuma rodada completa do GFS nas últimas 48 h')


def baixar(c, f, pasta):
    dia, hh = c.strftime('%Y%m%d'), c.strftime('%H')
    q = (f'?dir=%2Fgfs.{dia}%2F{hh}%2Fatmos&file=gfs.t{hh}z.pgrb2.0p25.f{f:03d}'
         '&var_UGRD=on&var_VGRD=on&var_GUST=on&var_TMP=on&var_PRMSL=on&var_APCP=on'
         '&lev_10_m_above_ground=on&lev_surface=on&lev_2_m_above_ground=on&lev_850_mb=on&lev_mean_sea_level=on'
         f'&subregion=&toplat={CAIXA["toplat"]}&leftlon={CAIXA["leftlon"]}&rightlon={CAIXA["rightlon"]}&bottomlat={CAIXA["bottomlat"]}')
    st, corpo = http(FILTRO + q)
    if st != 200 or corpo[:4] != b'GRIB':
        raise RuntimeError(f'f{f:03d}: resposta inválida ({st})')
    arq = os.path.join(pasta, f'f{f:03d}.grb2')
    with open(arq, 'wb') as fh:
        fh.write(corpo)
    return arq


def ler(arq):
    """Devolve dict nome -> matriz (Nj, Ni) com a linha 0 no sul. Chuva: acumulado desde o início da rodada."""
    campos, chuva = {}, []
    with open(arq, 'rb') as fh:
        while True:
            h = eccodes.codes_grib_new_from_file(fh)
            if h is None:
                break
            try:
                nome, tipo, nivel = eccodes.codes_get(h, 'shortName'), eccodes.codes_get(h, 'typeOfLevel'), eccodes.codes_get(h, 'level')
                ni, nj = eccodes.codes_get(h, 'Ni'), eccodes.codes_get(h, 'Nj')
                if eccodes.codes_get(h, 'jScansPositively') != 1 or eccodes.codes_get(h, 'latitudeOfFirstGridPointInDegrees') != LAT_S:
                    raise RuntimeError('grade em ordem inesperada')
                v = eccodes.codes_get_values(h).reshape(nj, ni)
                chave = {('10u', 'heightAboveGround', 10): 'u', ('10v', 'heightAboveGround', 10): 'v', ('gust', 'surface', 0): 'g',
                         ('2t', 'heightAboveGround', 2): 't2', ('t', 'isobaricInhPa', 850): 't850', ('prmsl', 'meanSea', 0): 'pm'}.get((nome, tipo, nivel))
                if chave:
                    campos[chave] = v
                elif nome == 'tp':
                    chuva.append((eccodes.codes_get(h, 'startStep'), eccodes.codes_get(h, 'endStep'), v))
            finally:
                eccodes.codes_release(h)
    # acumulado contínuo (começa no 0); se só houver o do "balde" de 6 h, marca o início para descontar depois
    chuva.sort(key=lambda x: x[0])
    if chuva:
        campos['tp'] = chuva[0]
    return campos


def amostra(m, grade):
    j = np.array([round((la - LAT_S) / PASSO) for la in grade['lats']])
    i = np.array([round((lo + 360 - LON_W) / PASSO) for lo in grade['lons']])
    return m[np.ix_(j, i)]


def b64(a, tipo):
    return base64.b64encode(np.ascontiguousarray(a).astype(tipo).tobytes()).decode()


def main():
    c = rodada_mais_nova()
    run = c.strftime('%Y%m%d%H')
    saida_local, url, chave = os.environ.get('SAIDA_LOCAL'), os.environ.get('ROBO_URL'), os.environ.get('ROBO_KEY')
    if not saida_local:
        if not url or not chave:
            raise SystemExit('faltam ROBO_URL e ROBO_KEY (ou SAIDA_LOCAL)')
        st, corpo = http(url.rstrip('/') + '/dados/previsao')
        if st == 200:
            try:
                if json.loads(corpo).get('run') == run and os.environ.get('FORCAR') != '1':
                    print('rodada', run, 'já está no site; nada a fazer')
                    return
            except ValueError:
                pass
    print('rodada', run)
    nf, nc = len(FINA['lats']) * len(FINA['lons']), len(LARGA['lats']) * len(LARGA['lons'])
    F = {k: np.zeros((NH, nf)) for k in ('u', 'v', 'g', 'p', 't')}
    C = {k: np.zeros((NH, nc)) for k in ('u', 'v', 'g', 't8', 'pm')}
    anterior = None  # (início, fim, acumulado) da hora anterior
    with tempfile.TemporaryDirectory() as pasta:
        for f in range(NH):
            arq = baixar(c, f, pasta)
            m = ler(arq)
            os.remove(arq)
            kmh = 3.6
            F['u'][f] = (amostra(m['u'], FINA) * kmh).ravel()
            F['v'][f] = (amostra(m['v'], FINA) * kmh).ravel()
            F['g'][f] = (amostra(m['g'], FINA) * kmh).ravel()
            F['t'][f] = (amostra(m['t2'], FINA) - 273.15).ravel()
            C['u'][f] = (amostra(m['u'], LARGA) * kmh).ravel()
            C['v'][f] = (amostra(m['v'], LARGA) * kmh).ravel()
            C['g'][f] = (amostra(m['g'], LARGA) * kmh).ravel()
            C['t8'][f] = (amostra(m['t850'], LARGA) - 273.15).ravel()
            C['pm'][f] = (amostra(m['pm'], LARGA) / 100).ravel()
            # chuva da hora: diferença do acumulado; quando o acumulado recomeça (balde de 6 h), usa o valor cheio
            if 'tp' in m:
                ini, fim, acc = m['tp']
                acc = amostra(acc, FINA).ravel()
                if anterior is not None and anterior[0] == ini and anterior[1] == fim - 1:
                    F['p'][f] = np.maximum(0, acc - anterior[2])
                else:
                    F['p'][f] = np.maximum(0, acc) if fim - ini <= 1 else np.maximum(0, acc - (anterior[2] if anterior is not None and anterior[0] == ini else 0))
                anterior = (ini, fim, acc)
            if f % 10 == 0:
                print(f'  f{f:03d} ok')
            time.sleep(0.4)
    cl = lambda a, lo, hi: np.clip(np.rint(a), lo, hi)
    dados = {
        'versao': 1, 'fonte': 'GFS 0,25° (NOAA/NCEP)', 'run': run,
        'inicio': int(c.timestamp() * 1000), 'nh': NH,
        'F': {'lats': FINA['lats'], 'lons': FINA['lons'], 'step': 0.5,
              'u': b64(cl(F['u'], -127, 127), '<i1'), 'v': b64(cl(F['v'], -127, 127), '<i1'), 'g': b64(cl(F['g'], 0, 255), '<u1'),
              'p': b64(cl(F['p'] * 10, 0, 65535), '<u2'), 't': b64(cl(F['t'] * 2, -128, 127), '<i1')},
        'C': {'lats': LARGA['lats'], 'lons': LARGA['lons'], 'step': 1,
              'u': b64(cl(C['u'], -127, 127), '<i1'), 'v': b64(cl(C['v'], -127, 127), '<i1'), 'g': b64(cl(C['g'], 0, 255), '<u1'),
              't8': b64(cl(C['t8'] * 2, -128, 127), '<i1'), 'pm': b64(cl((C['pm'] - 950) * 2, 0, 255), '<u1')},
    }
    texto = json.dumps(dados, separators=(',', ':'))
    print('tamanho', round(len(texto) / 1024), 'KB')
    if saida_local:
        with open(saida_local, 'w', encoding='utf-8') as fh:
            fh.write(texto)
        print('gravado em', saida_local)
    else:
        st, corpo = http(url.rstrip('/') + '/dados/previsao', metodo='PUT', dados=texto.encode(),
                         cab={'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json'}, tentativas=3)
        print('enviado', st)


if __name__ == '__main__':
    main()
