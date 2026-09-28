# Estado atual e próximos passos

> Consolidado a partir do código-fonte completo dos 3 nós + backend (última atualização deste documento). Itens antigos, registrados antes do envio do código, estão marcados como tal.

## ✅ Resolvido nesta revisão

- **Divergência SF/CR entre sensor e gateway**: o gateway antigo (`.ino`) estava em SF9/CR7 contra SF7/CR5 do sensor — causa provável da falha de transmissão end-to-end relatada anteriormente. O gateway atual (`firmware/gateway-esp32/`), incluído junto com o firmware completo, já está em SF7/CR5, igual ao sensor e ao atuador. **Ainda não testado fisicamente** — grave o firmware atual nos 3 nós e confirme a transmissão ponta a ponta.
- **Nó atuador**: firmware completo agora incluído (`firmware/no-atuador-esp32/`) — antes não tínhamos esse código.
- **Backend completo**: script de instalação (InfluxDB/Telegraf/Grafana), config do Telegraf e dashboard do Grafana agora incluídos em `backend/`.

## Itens a verificar/confirmar

1. Gravar o firmware atualizado nos nós físicos:
   - Nó sensor ATtiny85: `firmware/no-sensor-attiny85/`
   - Nó único Gateway + Atuador ESP32: `firmware/gateway-atuador-esp32/` (ver [ADR-0004](ADR-0004-no-unico-gateway-atuador.md))
   - Confirmar recepção ponta a ponta pelo ESP32 e acionamento do relé V1.
2. Confirmar o pipeline completo: LoRa → MQTT (`aviario/no1/sensores` e `aviario/no1/atuadores/estado`) → Telegraf / Node-RED → InfluxDB 1.x → Grafana, usando o dashboard já pronto (`backend/grafana/aviario_dashboard.json`).
3. Trocar as credenciais placeholder pelas reais — no firmware, em `firmware/*/src/config.h` (copiado de `config.h.example`, fora do Git); no backend, `INFLUX_PASS`/`GRAFANA_ADMIN_PASS` no `setup_servidor.sh` — sem commitar os valores reais.
4. `SENSOR_TIMEOUT_MS`: Definido e implementado no nó único (`firmware/gateway-atuador-esp32/src/main.cpp`) como 480 s (1,5× o ciclo do ATtiny85 de ~320 s). Quando expira, o failsafe de NH₃ mantém V1 ligado preventivamente.
5. Pipeline unificado em **InfluxDB 1.x (InfluxQL)**: tanto o Telegraf quanto o Node-RED gravam no InfluxDB 1.x (banco `aviario`), consumidos harmoniosamente pelo Grafana e pelo Node-RED.
6. Dashboard AEREM PLS (`public/`): evoluir o login local (hoje demo) para autenticação real, transformar em PWA instalável e integrar aos dados reais do ESP32 (o modo Simulação é o padrão fora da rede local).

## Registrado em 28/09/2026 (tela de acesso e tema)

1. **Tema claro da consola/painel (pendente, escopo consciente):** o tema claro vale hoje **só na tela de acesso** (`#loginScreen[data-tema="claro"]` em `tokens.css` + `public/js/theme.js`); a consola (`index.html`) e o painel (`admin.html`) permanecem sempre escuros. Motivo: `base.css`, `dashboard.css` e `control.css` ainda têm ~78 cores literais (`rgba(...)`) fora dos tokens — migrar essas cores para `tokens.css` é o pré-requisito para estender o tema sem retrabalho. Quando fizer, ampliar o bloco claro e o escopo do `theme.js`.
2. **Definir `ADMIN_USER`/`ADMIN_PASS` no Vercel antes do uso real:** a tela de acesso **não exibe mais** a credencial padrão (`admin`/`admin`) e o aviso de `?login=admin` foi reescrito sem citá-la. Sem essas variáveis de ambiente, a conta administrativa fica no padrão de desenvolvimento (`admin`/`admin` em `lib/auth.js`) — trocar antes de expor o sistema. Vale o mesmo para `SESSAO_HORAS`, `MONGODB_URI` e `MONGODB_DB`.
3. **PWA instalável (fora de escopo por decisão):** a tela de acesso **não** tem bloco de QR Code nem download de aplicativo (o aviário não tem app). Se o PWA for desejado depois, tratar como item próprio (manifest + service worker + ícone), sem depender da tela de acesso.

## Registrado antes do envio do código-fonte (reverificar — pode estar desatualizado)

- Hipóteses de hardware em aberto: corrente insuficiente sob carga de TX (RFM95W ~100–120 mA de pico em PA_BOOST); possíveis problemas de continuidade no MISO do SPI; efeitos colaterais da reinicialização do USI ao alternar I²C/SPI.
- Problemas de hardware já resolvidos: resistor queimado substituído; trilha de RST corrigida com jumper; ponte de solda entre pinos 4–5 do LoRa ressoldada; driver USBasp corrigido via Zadig; `upload_flags` do PlatformIO corrigido para caminho absoluto.
- Item adiado: otimização do aquecimento do NH₃ (hoje roda a cada ciclo — não confirmado se ainda é o caso na versão atual do sensor).
