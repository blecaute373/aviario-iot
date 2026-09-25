# Dashboard web — AEREM PLS (Precision Livestock System)

Frontend estático do aviário: monitoramento (NH₃, umidade da cama, temperatura + telemetria) e controle de 4 atuadores (ventiladores, aspersores, exaustores, cortinas), com gráfico histórico e limiares.

## Estrutura

```
public/
├── index.html          # tela de acesso + dashboard
├── css/
│   ├── tokens.css      # variáveis de design (cores, fontes)
│   ├── base.css        # header, botões, zoom, modal
│   ├── login.css       # tela de acesso + modal de configuração
│   └── dashboard.css   # sensores, atuadores, gráfico, rodapé
├── js/
│   ├── config.js       # IP/porta do broker + modal de configuração
│   ├── auth.js         # login/registro local (localStorage + SHA-256)
│   ├── zoom.js         # pinch/pan em telas de toque
│   ├── mock.js         # dados simulados (modo Simulação)
│   └── dashboard.js    # carga de dados, gráfico, comandos, alertas
└── assets/
    ├── logo-aerem.png
    └── logo-baap.png
```

## Modos de operação

- **Simulação** (padrão): dados gerados no próprio navegador — funciona offline e em qualquer hospedagem (ex.: Vercel).
- **Real**: consulta HTTP ao ESP32/broker **na rede local** (configurar no modal ⚙️).

## Configuração (navegador)

| Chave (localStorage) | Padrão | Uso |
|---|---|---|
| `aerem_broker_ip` | `192.168.0.5` | IP/host do ESP32/broker |
| `aerem_broker_port` | `80` | porta do servidor HTTP |
| `aerem_auth_user` / `aerem_auth_pass` | — | credenciais do login local (hash SHA-256) |

## API esperada do dispositivo (modo Real)

| Rota | Resposta |
|---|---|
| `GET /api/status` | `{ nh3, umidade, temperatura, bateria, rssi, pacotesRecebidos, tempoUltimaLeitura, nosAtivos: [..], limites: {nh3, umidade, temperatura}, atuadores: { ventilador: {ligado, manual}, aspersor: {...}, exaustor: {...}, cortina: {...} } }` |
| `GET /api/dados?periodo=1h\|6h\|24h\|7d` | `{ dados: [ { t, nh3, umid, temp }, ... ] }` (t = epoch ms) |
| `GET /api/atuador?tipo=ventilador\|aspersor\|exaustor\|cortina&acao=on\|off\|auto` | `{ ok: true }` |

Cadência: status a cada 5 s; histórico a cada 15 s (constantes em `js/dashboard.js`).

## Alertas e limites

- Limites padrão: NH₃ 20 ppm · umidade 22 % · temperatura 26 °C (podem vir do campo `limites` da API).
- Banner de alerta quando qualquer leitura ultrapassa o limite; linhas de limite desenhadas no gráfico.

## Deploy (Vercel)

Estático — o `vercel.json` da raiz publica `public/`:

```bash
npx vercel login   # uma vez
npx vercel --prod  # na raiz do repositório
```

Ou importe o repositório em [vercel.com/new](https://vercel.com/new) (Framework: *Other*).

**Produção:** https://aerem-pls.vercel.app (projeto `aerem-pls`, deploy atual do `public/`).

> ⚠️ Fora da rede local (ex.: no Vercel), o modo **Real** não conecta — use **Simulação**.

## Segurança

- O login é **local/demonstrativo** (client-side): protege o painel no dispositivo, mas não substitui autenticação de servidor.
- Nenhuma credencial real é versionada; as configurações ficam no `localStorage` do navegador.
