const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

/**
 * ============================================================================
 * CONTRATO DE CONFORMIDADE: test/v1-failsafe.test.js <-> firmware main.cpp
 * ============================================================================
 * Fonte canônica da verdade:
 *   firmware/gateway-atuador-esp32/src/main.cpp
 *   - Limiares e constantes: linhas ~179-180 (NH3_LIGA_PPM, NH3_DESLIGA_PPM)
 *   - Timeout do sensor: linhas ~154-155 (SENSOR_TIMEOUT_MS)
 *   - Lógica de avaliação e histerese: linhas 607-640 (avaliarProtecaoNH3, recalcularVentilacao)
 *
 * ATENÇÃO: Qualquer alteração nos limiares, operadores (>=, <), tempos ou
 * lógica em firmware/gateway-atuador-esp32/src/main.cpp DEVE ser
 * obrigatoriamente espelhada neste modelo e validada via `npm test`.
 * ============================================================================
 */

const NH3_LIGA_PPM = 10.0;
const NH3_DESLIGA_PPM = 5.0;
const SENSOR_TIMEOUT_MS = 480000; // 480 s (1.5x ciclo ATtiny85 de 320 s)

const MODO_MANUAL = 'MANUAL';
const MODO_AUTOMATICO = 'AUTO';

class ControladorV1 {
  constructor() {
    this.protecaoNH3Ativa = false;
    this.v1Comandado = false;
    this.modo = MODO_MANUAL;
    this.sensor = { valido: false, nh3: Number.NaN, recebidoEm: 0 };
    this.estadoV1 = false;
  }

  sensorOnline(agoraMs = 0) {
    return this.sensor.valido && (agoraMs - this.sensor.recebidoEm <= SENSOR_TIMEOUT_MS);
  }

  avaliarProtecaoNH3(agoraMs = 0) {
    if (!this.sensorOnline(agoraMs) || Number.isNaN(this.sensor.nh3)) {
      this.protecaoNH3Ativa = true;
      return this.protecaoNH3Ativa;
    }

    this.protecaoNH3Ativa = this.protecaoNH3Ativa
      ? (this.sensor.nh3 >= NH3_DESLIGA_PPM)
      : (this.sensor.nh3 >= NH3_LIGA_PPM);

    return this.protecaoNH3Ativa;
  }

  recalcularVentilacao(agoraMs = 0) {
    const proteger = this.avaliarProtecaoNH3(agoraMs);
    const v1Desejado = proteger || (this.modo === MODO_MANUAL && this.v1Comandado);
    const mudou = (v1Desejado !== this.estadoV1);
    this.estadoV1 = v1Desejado;
    return { mudou, v1Desejado, proteger };
  }
}

describe('Invariante de V1 e Failsafe de NH3 (Gateway-Atuador ESP32)', () => {

  test('Boot inicial: sensor sem leitura arma protecao e forca V1 ON', () => {
    const ctrl = new ControladorV1();
    assert.equal(ctrl.sensorOnline(0), false);
    assert.ok(Number.isNaN(ctrl.sensor.nh3));

    const res = ctrl.recalcularVentilacao(0);
    assert.equal(res.proteger, true, 'Protecao deve armar no boot');
    assert.equal(res.v1Desejado, true, 'V1 deve ser 1 (ON) no boot');
    assert.equal(ctrl.estadoV1, true);
  });

  test('Primeira leitura valida com NH3 seguro (< 5.0 ppm) desarma protecao', () => {
    const ctrl = new ControladorV1();
    ctrl.recalcularVentilacao(0); // Estado de boot -> V1 ligado

    // Chega pacote aos 10s com NH3 = 2.0 ppm
    ctrl.sensor.valido = true;
    ctrl.sensor.nh3 = 2.0;
    ctrl.sensor.recebidoEm = 10000;

    const res = ctrl.recalcularVentilacao(10000);
    assert.equal(res.proteger, false, 'Protecao deve desarmar com 2.0 ppm');
    assert.equal(res.v1Desejado, false, 'Comando manual era false, V1 deve desligar');
    assert.equal(ctrl.estadoV1, false);
  });

  test('Histerese: subida de NH3 liga apenas em >= 10.0 ppm', () => {
    const ctrl = new ControladorV1();
    ctrl.sensor.valido = true;
    ctrl.sensor.recebidoEm = 1000;

    // 4.9 ppm -> OFF
    ctrl.sensor.nh3 = 4.9;
    ctrl.recalcularVentilacao(1000);
    assert.equal(ctrl.protecaoNH3Ativa, false);

    // 9.9 ppm -> ainda OFF
    ctrl.sensor.nh3 = 9.9;
    ctrl.recalcularVentilacao(1000);
    assert.equal(ctrl.protecaoNH3Ativa, false);

    // Exatamente 10.0 ppm (operador >=) -> LIGA
    ctrl.sensor.nh3 = 10.0;
    ctrl.recalcularVentilacao(1000);
    assert.equal(ctrl.protecaoNH3Ativa, true, 'Deve armar em exatamente 10.0 ppm');
    assert.equal(ctrl.estadoV1, true);
  });

  test('Histerese: descida de NH3 mantem ligado ate < 5.0 ppm', () => {
    const ctrl = new ControladorV1();
    ctrl.sensor.valido = true;
    ctrl.sensor.recebidoEm = 1000;

    // Dispara protecao com 15.0 ppm
    ctrl.sensor.nh3 = 15.0;
    ctrl.recalcularVentilacao(1000);
    assert.equal(ctrl.protecaoNH3Ativa, true);

    // Baixa para 8.0 ppm -> continua ligado (histerese)
    ctrl.sensor.nh3 = 8.0;
    ctrl.recalcularVentilacao(1000);
    assert.equal(ctrl.protecaoNH3Ativa, true, 'Mantem ligado em 8.0 ppm');

    // Baixa para exatamente 5.0 ppm -> continua ligado (operador >= 5.0)
    ctrl.sensor.nh3 = 5.0;
    ctrl.recalcularVentilacao(1000);
    assert.equal(ctrl.protecaoNH3Ativa, true, '5.0 ppm ainda mantem ligado');

    // Baixa para 4.9 ppm (< 5.0) -> desliga
    ctrl.sensor.nh3 = 4.9;
    ctrl.recalcularVentilacao(1000);
    assert.equal(ctrl.protecaoNH3Ativa, false, '4.9 ppm desliga protecao');
    assert.equal(ctrl.estadoV1, false);
  });

  test('Invariante do comando manual: operador NUNCA desliga V1 se protecao ativa', () => {
    const ctrl = new ControladorV1();
    ctrl.sensor.valido = true;
    ctrl.sensor.recebidoEm = 1000;
    ctrl.sensor.nh3 = 12.0; // Protecao ativa
    ctrl.modo = MODO_MANUAL;

    ctrl.recalcularVentilacao(1000);
    assert.equal(ctrl.estadoV1, true);

    // Operador envia comando CMD|MODO:MANUAL|V1:0
    ctrl.v1Comandado = false;
    const res = ctrl.recalcularVentilacao(1000);
    assert.equal(res.v1Desejado, true, 'V1 deve permanecer ligado pela protecao');
    assert.equal(ctrl.estadoV1, true);
  });

  test('Comando manual liga V1 mesmo com NH3 baixo (< 5 ppm)', () => {
    const ctrl = new ControladorV1();
    ctrl.sensor.valido = true;
    ctrl.sensor.recebidoEm = 1000;
    ctrl.sensor.nh3 = 2.0;
    ctrl.modo = MODO_MANUAL;

    ctrl.v1Comandado = false;
    ctrl.recalcularVentilacao(1000);
    assert.equal(ctrl.estadoV1, false);

    ctrl.v1Comandado = true;
    const res = ctrl.recalcularVentilacao(1000);
    assert.equal(res.v1Desejado, true);
    assert.equal(res.proteger, false, 'Protecao nao esta ativa, mas V1 liga pelo comando manual');
  });

  test('MODO AUTO ignora v1Comandado e segue estritamente a histerese', () => {
    const ctrl = new ControladorV1();
    ctrl.sensor.valido = true;
    ctrl.sensor.recebidoEm = 1000;
    ctrl.sensor.nh3 = 2.0;
    ctrl.modo = MODO_AUTOMATICO;
    ctrl.v1Comandado = true;

    const res = ctrl.recalcularVentilacao(1000);
    assert.equal(res.v1Desejado, false, 'Em AUTO, v1Comandado nao forca V1 ON se NH3 esta baixo');
  });

  test('Failsafe por perda de sinal (sensor offline apos 480 s) liga V1', () => {
    const ctrl = new ControladorV1();
    ctrl.sensor.valido = true;
    ctrl.sensor.nh3 = 2.0;
    ctrl.sensor.recebidoEm = 10000;
    ctrl.recalcularVentilacao(10000);
    assert.equal(ctrl.estadoV1, false);

    // 480s depois (t = 490000 ms) -> limite
    assert.equal(ctrl.sensorOnline(490000), true);
    ctrl.recalcularVentilacao(490000);
    assert.equal(ctrl.estadoV1, false);

    // 481s depois (t = 491001 ms) -> sensor OFFLINE
    assert.equal(ctrl.sensorOnline(491001), false);
    const res = ctrl.recalcularVentilacao(491001);
    assert.equal(res.proteger, true, 'Protecao deve armar por timeout');
    assert.equal(res.v1Desejado, true, 'V1 deve ligar');
    assert.equal(ctrl.estadoV1, true);
  });

  test('Failsafe por leitura corrompida (nh3 = NaN) com sensor online liga V1', () => {
    const ctrl = new ControladorV1();
    ctrl.sensor.valido = true;
    ctrl.sensor.nh3 = 2.0;
    ctrl.sensor.recebidoEm = 10000;
    ctrl.recalcularVentilacao(10000);
    assert.equal(ctrl.estadoV1, false);

    // Pacote chega com campo NH3 = NaN
    ctrl.sensor.recebidoEm = 15000;
    ctrl.sensor.nh3 = Number.NaN;

    const res = ctrl.recalcularVentilacao(15000);
    assert.equal(res.proteger, true, 'Protecao deve armar com NH3 NaN');
    assert.equal(res.v1Desejado, true, 'V1 deve ligar');
  });
});

