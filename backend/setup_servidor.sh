#!/bin/bash
# =============================================================================
# setup_servidor.sh
# Instala e configura: InfluxDB 1.8.x, Telegraf, Grafana
# Sistema: Ubuntu 22.04 / Debian 12
# =============================================================================

set -e  # para na primeira linha com erro

# ── Variáveis — edite antes de rodar ─────────────────────────────────────────
INFLUX_DB="aviario"
INFLUX_USER="admin"
INFLUX_PASS="SuaSenhaForte123"   # mínimo 8 caracteres

GRAFANA_ADMIN_PASS="GrafanaSenha123"

MQTT_BROKER_IP="192.168.0.3"     # IP do broker Mosquitto (gateway local)

# =============================================================================
# 1. DEPENDÊNCIAS
# =============================================================================
echo ">>> Atualizando sistema..."
apt-get update -qq
apt-get install -y curl wget gnupg apt-transport-https software-properties-common

# =============================================================================
# 2. INFLUXDB 1.8.x (InfluxQL, sem tokens/buckets v2)
# =============================================================================
echo ">>> Instalando InfluxDB 1.8.x..."
wget -q https://repos.influxdata.com/influxdata-archive_compat.key
gpg --dearmor < influxdata-archive_compat.key > /etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg
echo "deb [signed-by=/etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg] https://repos.influxdata.com/debian stable main" \
  > /etc/apt/sources.list.d/influxdata.list

apt-get update -qq
apt-get install -y influxdb

systemctl enable influxdb
systemctl start influxdb

sleep 3  # aguarda o serviço subir

echo ">>> Criando banco e usuário no InfluxDB 1.x..."
influx -execute "CREATE DATABASE \"${INFLUX_DB}\""
influx -execute "CREATE USER \"${INFLUX_USER}\" WITH PASSWORD '${INFLUX_PASS}' WITH ALL PRIVILEGES"

# =============================================================================
# 3. TELEGRAF (outputs.influxdb 1.x)
# =============================================================================
echo ">>> Instalando Telegraf..."
apt-get install -y telegraf

# Configuração do Telegraf para InfluxDB 1.x:
cat > /etc/telegraf/telegraf.d/aviario.conf << EOF
[agent]
  interval       = "10s"
  flush_interval = "10s"
  hostname       = "aviario-server"

[[outputs.influxdb]]
  urls     = ["http://localhost:8086"]
  database = "${INFLUX_DB}"
  username = "${INFLUX_USER}"
  password = "${INFLUX_PASS}"

[[inputs.mqtt_consumer]]
  servers     = ["tcp://${MQTT_BROKER_IP}:1883"]
  topics      = ["aviario/no1/sensores"]
  qos         = 0
  data_format = "json"
  name_override = "sensores"
  [inputs.mqtt_consumer.tags]
    no    = "1"
    local = "galpao"

[[inputs.mqtt_consumer]]
  servers     = ["tcp://${MQTT_BROKER_IP}:1883"]
  topics      = ["aviario/no1/atuadores/estado"]
  qos         = 0
  data_format = "json"
  name_override = "atuadores"
  [inputs.mqtt_consumer.tags]
    no    = "1"
    local = "galpao"
EOF

systemctl enable telegraf
systemctl restart telegraf

# =============================================================================
# 4. GRAFANA (Datasource InfluxQL InfluxDB 1.x)
# =============================================================================
echo ">>> Instalando Grafana..."
wget -q -O /etc/apt/keyrings/grafana.gpg \
  https://apt.grafana.com/gpg.key
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
  > /etc/apt/sources.list.d/grafana.list

apt-get update -qq
apt-get install -y grafana

systemctl enable grafana-server
systemctl start grafana-server

sleep 3

# Configura senha do admin via API
curl -s -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"${GRAFANA_ADMIN_PASS}\"}" \
  http://admin:admin@localhost:3000/api/user/password > /dev/null

# Adiciona datasource InfluxDB 1.x (InfluxQL) no Grafana via API
curl -s -X POST \
  -H "Content-Type: application/json" \
  -u "admin:${GRAFANA_ADMIN_PASS}" \
  http://localhost:3000/api/datasources \
  -d "{
    \"name\":      \"InfluxDB-Aviario\",
    \"type\":      \"influxdb\",
    \"url\":       \"http://localhost:8086\",
    \"access\":    \"proxy\",
    \"database\":  \"${INFLUX_DB}\",
    \"user\":      \"${INFLUX_USER}\",
    \"secureJsonData\": {
      \"password\": \"${INFLUX_PASS}\"
    },
    \"isDefault\": true
  }" > /dev/null

echo ""
echo "============================================================"
echo "  INSTALAÇÃO CONCLUÍDA (INFLUXDB 1.x / TELEGRAF / GRAFANA)"
echo "============================================================"
echo "  InfluxDB  → http://SEU_IP:8086"
echo "             banco:   ${INFLUX_DB}"
echo "             usuário: ${INFLUX_USER}"
echo "             senha:   ${INFLUX_PASS}"
echo ""
echo "  Grafana   → http://SEU_IP:3000"
echo "             usuário: admin"
echo "             senha:   ${GRAFANA_ADMIN_PASS}"
echo ""
echo "  Telegraf  → configurado em /etc/telegraf/telegraf.d/aviario.conf"
echo "============================================================"
echo ""
echo "  Próximo passo: importe o dashboard"
echo "  Grafana → Dashboards → Import → cole o JSON do arquivo"
echo "  aviario_dashboard.json"
echo "============================================================"
