# Estado atual e próximos passos

> Consolidado a partir do código-fonte completo dos 3 nós + backend (última atualização deste documento). Itens antigos, registrados antes do envio do código, estão marcados como tal.

## ✅ Resolvido nesta revisão

- **Divergência SF/CR entre sensor e gateway**: o gateway antigo (`.ino`) estava em SF9/CR7 contra SF7/CR5 do sensor — causa provável da falha de transmissão end-to-end relatada anteriormente. O gateway atual (`firmware/gateway-esp32/`), incluído junto com o firmware completo, já está em SF7/CR5, igual ao sensor e ao atuador. **Ainda não testado fisicamente** — grave o firmware atual nos 3 nós e confirme a transmissão ponta a ponta.
- **Nó atuador**: firmware completo agora incluído (`firmware/no-atuador-esp32/`) — antes não tínhamos esse código.
- **Backend completo**: script de instalação (InfluxDB/Telegraf/Grafana), config do Telegraf e dashboard do Grafana agora incluídos em `backend/`.

## Itens a verificar/confirmar

1. Gravar o firmware atualizado nos 3 nós físicos (sensor, gateway, atuador) e confirmar recepção ponta a ponta pelo gateway.
2. Confirmar o pipeline completo: LoRa → MQTT → Telegraf → InfluxDB → Grafana, usando o dashboard já pronto (`backend/grafana/aviario_dashboard.json`).
3. Trocar as credenciais placeholder pelas reais — no firmware, em `firmware/*/src/config.h` (copiado de `config.h.example`, fora do Git); no backend, `INFLUX_PASS`/`GRAFANA_ADMIN_PASS` no `setup_servidor.sh` — sem commitar os valores reais.
4. Confirmar se o `SENSOR_TIMEOUT_MS` (ou equivalente) ainda é necessário/está presente na versão atual do gateway — não localizado no código revisado desta vez.

## Registrado antes do envio do código-fonte (reverificar — pode estar desatualizado)

- Hipóteses de hardware em aberto: corrente insuficiente sob carga de TX (RFM95W ~100–120 mA de pico em PA_BOOST); possíveis problemas de continuidade no MISO do SPI; efeitos colaterais da reinicialização do USI ao alternar I²C/SPI.
- Problemas de hardware já resolvidos: resistor queimado substituído; trilha de RST corrigida com jumper; ponte de solda entre pinos 4–5 do LoRa ressoldada; driver USBasp corrigido via Zadig; `upload_flags` do PlatformIO corrigido para caminho absoluto.
- Item adiado: otimização do aquecimento do NH₃ (hoje roda a cada ciclo — não confirmado se ainda é o caso na versão atual do sensor).
