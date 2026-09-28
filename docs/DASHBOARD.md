# Dashboard web — AVIÁRIO IoT (AEREM PLS)

Frontend estático do aviário, em **duas páginas** com qualidade visual de consola industrial:

- **`index.html` — Consola de Supervisão (somente leitura):** monitoramento ambiental em tempo real (Temperatura, Umidade, Pressão atmosférica e Amônia NH₃) com anéis/limiares, estado dos 4 atuadores, gráfico histórico multi-série via InfluxDB 1.x, alertas operacionais e qualidade do enlace LoRa (RSSI/SNR).
- **`admin.html` — Painel de Controle (administrativo):** monitorização ao vivo em faixa compacta, **controle manual dos 4 atuadores** (Ventilador 1, Ventilador 2, Aspersor e Nebulizador), **chave mestra do Modo Automático** (automação Node-RED), log de comandos da sessão e **Usuários & Acessos** (auditoria de login).
- **Acesso único:** as duas páginas compartilham a mesma tela de login/cadastro (`#loginScreen`): a conta de **administrador** (definida por `ADMIN_USER`/`ADMIN_PASS` no servidor — **nenhuma credencial é exibida na interface**) segue para o painel, o usuário cadastrado entra na consola — ver a seção *Acesso* abaixo.

## Estrutura

```
public/
├── index.html          # consola de supervisão (somente leitura)
├── admin.html          # painel administrativo (controle dos atuadores)
├── css/
│   ├── tokens.css      # design tokens (cores, raios, sombras, tipografia)
│   ├── base.css        # reset, fundo ambiente, topbar, botões, seções
│   ├── login.css       # tela de acesso + modal de configuração de rede
│   ├── dashboard.css   # cards de sensores/atuadores, gráfico, alertas, sistema
│   └── control.css     # controles do admin (botões, chave mestra, faixa ao vivo)
├── js/
│   ├── theme.js        # tema claro/escuro da tela de acesso (localStorage['aerem_tema'])
│   ├── config.js       # IP/porta do gateway, modo Simulação/Real, modal
│   ├── auth.js         # acesso: login/cadastro/sessão via /api/auth/*
│   ├── zoom.js         # pinch/pan em telas de toque (consola)
│   ├── mock.js         # dados simulados (lógica de automação do flows.json)
│   ├── api.js          # camada de dados (status/histórico/atuador/modo-auto)
│   ├── ui.js           # helpers de interface (anéis, deltas, chips, CSV)
│   ├── acessos.js      # painel: KPIs, usuários e log de acessos (/api/admin/*)
│   ├── dashboard.js    # lógica da consola de supervisão
│   └── admin.js        # lógica do painel de controle
└── assets/
    ├── logo-aerem.png
    └── logo-baap.png
```

## Modos de operação

- **Simulação:** dados e dinâmica gerados no navegador (`mock.js`) com a mesma lógica de automação do `flows.json` — funciona offline e em hospedagens estáticas (ex.: Vercel).
- **Real:** consulta HTTP ao gateway/backend **na rede local** (IP/porta configuráveis no modal ⚙️). A escolha persiste em `localStorage` (`aerem_modo`).

| Chave (localStorage) | Padrão | Uso |
|---|---|---|
| `aerem_modo` | `sim` | modo de operação (`sim`/`real`) |
| `aerem_tema` | — | tema da tela de acesso (`claro`/`escuro`); **sem** valor salvo, segue o `prefers-color-scheme` do sistema |
| `aerem_broker_ip` | `192.168.0.5` | IP/host do gateway ou servidor backend |
| `aerem_broker_port` | `80` | porta do servidor HTTP |
| `aerem_usuarios_local` / `aerem_acessos_local` | — | **apenas na demonstração local**: cadastros e acessos registrados no navegador quando não há servidor de acesso |

## API esperada do dispositivo / backend (modo Real)

| Rota | Resposta |
|---|---|
| `GET /api/status` | `{ temperatura, umidade, pressao_hpa, nh3_ppm, rssi, snr, tempoUltimaLeitura, modoAutomatico, nosAtivos, limites, atuadores: { v1, v2, asp, neb } }` |
| `GET /api/dados?periodo=1h\|6h\|24h\|7d` | `{ ok: true, dados: [ { t, temp, umid, pres_hpa, nh3 }, ... ] }` (proxy InfluxDB 1.x do `scripts/serve.js`) |
| `GET /api/atuador?tipo=v1\|v2\|asp\|neb&acao=on\|off` | `{ ok: true }` (publica no tópico MQTT do atuador via Node-RED) |
| `GET /api/modo-auto?ativo=0\|1` | `{ ok: true, modoAutomatico: bool }` (chave mestra da automação) |

Cadência: status a cada 5 s (topbar com barra de contagem); histórico a cada 15 s nas duas páginas.

## Acesso: login, cadastro e monitoramento

Um único endereço atende os dois perfis — quem entra como **administrador** vai para o painel, quem entra com **cadastro** vai para a consola:

A tela (`#loginScreen`) é um **split-screen**: à esquerda um **painel de marca** (eyebrow mono *AVIÁRIO 01 · IOT AVÍCOLA*, título *Monitorização em tempo real*, resumo do sistema, silhueta decorativa em SVG e 3 chips — *4 SENSORES* / *~5 min CICLO* / *24/7 ONLINE*); à direita a **coluna do cartão**, com o cartão de acesso (logo AEREM, *AEREM PLS* + subtítulo mono *MONITOR AVÍCOLA · ACESSO*, abas segmentadas *Entrar* / *Registrar* com indicador animado, campos com ícone e botão de revelar senha, botão primário em gradiente e selo do modo de armazenamento com LED pulsante). O painel de marca é sempre escuro (nos dois temas); abaixo de 900 px ele vira uma faixa compacta no topo e só o cartão permanece, centralizado com rolagem própria.

**Sem bloco de QR Code / download de app:** o aviário não tem aplicativo — a tela de acesso não oferece PWA (registrado em [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md)).

### Tema claro/escuro (escopo: tela de acesso)

- Botão no canto superior direito do cartão (`#themeToggle`, `aria-pressed`, ícone lua ⇄ sol), com a preferência em `localStorage['aerem_tema']` (`claro`/`escuro`); sem preferência salva, segue o `prefers-color-scheme` do sistema.
- Script inline no `<head>` das duas páginas aplica o tema antes da primeira pintura (sem flash) e `public/js/theme.js` mantém o estado (`data-tema` no `#loginScreen`, espelhado em `<html data-tema-acesso>` e no `<meta name="theme-color">`).
- Os valores do tema claro ficam no bloco `#loginScreen[data-tema="claro"]` de `tokens.css` — **a consola e o painel continuam sempre escuros nesta fase** (pendência registrada em [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md)).
- **Nenhuma credencial é exibida na tela** (a dica `admin`/`admin` foi removida): a credencial administrativa vem de `ADMIN_USER`/`ADMIN_PASS` no servidor e nunca aparece no HTML.

| Perfil | Como entrar | O que vê |
|---|---|---|
| Administrador | credencial pré-configurada no servidor (`ADMIN_USER`/`ADMIN_PASS`; padrão de desenvolvimento `admin`/`admin`) — **não exibida na interface** | painel de controle: atuadores, modo automático e **Usuários & Acessos** (KPIs, cadastros e log com IP/navegador/horário) |
| Usuário | aba **Registrar** (nome, e-mail, função, usuário e senha de 6+ caracteres) e depois entrar com usuário/senha | consola de supervisão (somente leitura) |

Estados possíveis da tela de acesso, detectados por `GET /api/auth/status` (`public/js/auth.js`):

| Estado | Quando acontece | Comportamento |
|---|---|---|
| `servidor` 🔒 | `npm run serve` (local) ou Vercel com `MONGODB_URI` | cadastro/login/sessão **no servidor**; acessos auditáveis no painel |
| `demo-nuvem` 🧪 | Vercel sem `MONGODB_URI` | demonstração local no navegador; o deploy estático segue funcionando |
| `estatico` 🧪 | HTML aberto direto (file://) ou host estático | demonstração local no navegador |

### API do acesso (servidor local `scripts/serve.js` e nuvem `api/index.js`)

| Rota | Efeito |
|---|---|
| `GET /api/auth/status` | modo do servidor, usuário administrador, validade da sessão e resumo (público) |
| `POST /api/auth/cadastro` | cria usuário comum, grava o evento `cadastro` e já abre sessão (201) |
| `POST /api/auth/login` | administrador (`admin`/`admin`) ou usuário cadastrado; 401 em credenciais inválidas, 429 após 8 tentativas |
| `GET /api/auth/sessao` | sessão atual pelo cookie (usada ao recarregar a página) |
| `POST /api/auth/logout` | encerra a sessão e grava o evento `saida` |
| `GET /api/admin/usuarios` | cadastros (nome, usuário, e-mail, função, último acesso) — **só administrador** |
| `GET /api/admin/acessos?limite=&offset=&evento=` | log de acessos + resumo (`usuarios`, `acessos_hoje`, `falhas_hoje`, `sessoes_ativas`) — **só administrador** |

Eventos registrados no log: `entrada`, `saida`, `cadastro`, `falha_usuario` e `falha_senha` (todos com data/hora, IP e navegador).

### Onde os dados ficam

| Implantação | Armazenamento |
|---|---|
| `npm run serve` (rede local) | `data/*.json` (`usuarios.json`, `sessoes.json`, `acessos.json`) — pasta fora do Git; troque com `AEREM_DATA_DIR` |
| Vercel com `MONGODB_URI` | MongoDB Atlas, coleções `usuarios`, `sessoes` (índice TTL) e `acessos` — driver `mongodb` em `optionalDependencies` (só a nuvem carrega) |

## Painel administrativo (`admin.html`)

- **Faixa ao vivo:** 4 grandezas com valor, delta vs. leitura anterior, chip de estado (Normal/Atenção/Crítico) e notas de enlace (última leitura, RSSI, SNR, modo).
- **Chave mestra "Modo Automático":** liga/desliga a automação do Node-RED. Com ela **ativa**, os botões manuais ficam **bloqueados** (a automação reescreveria o estado na próxima leitura) e um aviso explica o motivo; os limites operacionais vigentes são exibidos em chips.
- **Controle manual:** botões Ligar/Desligar por atuador, com estado real vindo do `/api/status`, feedback do envio e destaque neon quando o atuador está ligado.
- **Log de comandos:** histórico da sessão (hora, comando, sucesso/falha) — apenas em memória, some ao recarregar.
- **Usuários & Acessos:** KPIs (usuários cadastrados, entradas e falhas do dia, sessões ativas), tabela de usuários (nome, usuário, e-mail, função, cadastro e último acesso) e log de acessos filtrável por evento — cada linha traz horário, usuário, **IP**, navegador e detalhe; atualiza sozinho a cada 20 s (`public/js/acessos.js`).

## Alertas e limites operacionais (sincronizados com `flows.json`)

- **Temperatura:** ideal 15.0 a 32.0 °C. Crítico se > 32 °C ou < 15 °C. No modo automático, aciona Ventilador 1, 2 e Nebulizador.
- **Umidade:** ideal 40 a 80 %. Atenção fora da faixa. No modo automático, aciona Aspersor se < 40 %.
- **Amônia (NH₃):** atenção acima de 15 ppm; crítico se > 25 ppm (aciona Nebulizador no modo automático).
- **Pressão Atmosférica:** nominal de 980 a 1030 hPa.

## Deploy (Vercel)

Estático + função — o `vercel.json` da raiz publica `public/` (o `admin.html` fica em `/admin.html`) e publica `api/index.js` para as rotas `/api/*`:

```bash
npx vercel login   # uma vez
npx vercel --prod  # na raiz do repositório
```

**Produção:** https://aerem-pls.vercel.app (projeto `aerem-pls`).

**Login na nuvem (opcional):** defina `MONGODB_URI` e `MONGODB_DB` (Atlas), além de `ADMIN_USER`/`ADMIN_PASS`, em *Settings → Environment Variables*. Sem `MONGODB_URI` a função responde `{ banco: false }`, a tela de acesso opera em demonstração local e o restante do dashboard continua estático.

> ⚠️ Fora da rede local (ex.: no Vercel), o modo **Real** não conecta ao gateway e o histórico fica indisponível — use **Simulação**; o gráfico exibe o estado de erro com opção de tentar de novo.

## Segurança

- O acesso é validado **no servidor** (`lib/auth.js` + `lib/auth-api.js`): senha com **scrypt + salt**, sessão em cookie **httpOnly** (`aerem_sessao`, 8 h por padrão), comparação em tempo constante, freio de 8 tentativas por IP+usuário e log de acessos auditável; em `scripts/serve.js`, `/admin.html` exige **sessão de administrador** (usuário comum é redirecionado com aviso).
- Sem servidor de acesso (HTML aberto direto ou Vercel sem `MONGODB_URI`) a tela entra em **demonstração local** com cadastros no `localStorage` — serve para testar a interface, não é autenticação de servidor.
- Nenhuma credencial real é versionada; `data/` (JSON do acesso), `.env*` e `config.h` ficam fora do Git.

## Validação

```bash
npm run check   # node --check em todos os scripts (dashboard, lib/, api/, servidor e testes)
npm test        # 34 testes: estrutura do dashboard, acesso (layout split-screen/tema) e failsafe de V1
npm run serve   # servidor local + API de acesso (/api/auth/*, /api/admin/*) + proxy InfluxDB 1.x em /api/dados
```

`test/auth.test.js` sobe um servidor HTTP efêmero e cobre cadastro (válido, inválido, reservado e duplicado), login do administrador e do usuário cadastrado, sessão por cookie, logout, monitoramento exclusivo do administrador, filtro de eventos e o freio de tentativas (429 após 8 falhas).
