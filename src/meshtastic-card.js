import {
  LitElement,
  html,
  css,
} from "lit";

const ENV_ICON_MAP = {
  'temperature': 'mdi:thermometer',
  'relative_humidity': 'mdi:water-percent',
  'barometric_pressure': 'mdi:gauge',
  'gas_resistance': 'mdi:air-filter',
  'illuminance': 'mdi:brightness-5',
  'lux': 'mdi:brightness-5',
  'wind_direction': 'mdi:compass-outline',
  'wind_speed': 'mdi:weather-windy',
  'rain_1h': 'mdi:weather-pouring',
  'rain_24h': 'mdi:weather-pouring'
};

class MeshtasticCard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
    };
  }

  static getConfigForm() {
    return {
      schema: [
        {
          name: "device_id",
          selector: { device: { filter: { integration: 'meshtastic' } } }
        },
        { name: "show_battery", selector: { boolean: {} } },
        { name: "show_environment", selector: { boolean: {} } },
        { name: "show_power_metrics", selector: { boolean: {} } },
        { name: "use_24h_format", selector: { boolean: {} } },
        {
          name: "font_size",
          selector: {
            select: {
              options: [
                { value: "1", label: "Default (1x)" },
                { value: "1.2", label: "Medium (1.2x)" },
                { value: "1.5", label: "Large (1.5x)" }
              ]
            }
          }
        }
      ],
      computeLabel: (schema) => {
        const labels = {
          device_id: "Device",
          show_battery: "Show Battery",
          show_environment: "Show Environment Metrics",
          show_power_metrics: "Show Power Metrics",
          use_24h_format: "Use 24h Time Format",
          font_size: "Font Size Multiplier"
        };
        return labels[schema.name] || undefined;
      },
    }
  }

  static getStubConfig(hass) {
    const entity = Object.values(hass?.entities || {}).find(e => e.platform === 'meshtastic');
    return { 
      device_id: entity?.device_id || '', 
      show_battery: true,
      show_environment: true,
      show_power_metrics: true,
      use_24h_format: true,
      font_size: "1"
    };
  }

  setConfig(config) {
    if (!config.device_id) throw new Error("Please define a Meshtastic device");
    this.config = config;
  }

  _getDeviceEntities() {
    if (!this.hass || !this.hass.entities || !this.config?.device_id) return [];
    return Object.values(this.hass.entities).filter(e => e.device_id === this.config.device_id);
  }

  _getState(suffix) {
    const found = this._getDeviceEntities().find(e => e.entity_id.includes(suffix));
    return found ? this.hass.states[found.entity_id] : null;
  }

  _formatUptime(seconds) {
    if (!seconds) return "N/A";
    const s = parseInt(seconds) || 0;
    if (s === 0) return "N/A";
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m}m`;
  }

  // CORE FEATURE: Dispatch more-info dialog
  _fireMoreInfo(entityId) {
    if (!entityId) return;
    const event = new Event("hass-more-info", {
      bubbles: true,
      cancelable: false,
      composed: true,
    });
    event.detail = { entityId };
    this.dispatchEvent(event);
  }

  // HELPER: Notice the clickable class and @click binder
  _renderBar(label, stateObj, icon, color, showPower = false, isPowered = false, decimals = null) {
    if (!stateObj) return html``;
    const val = parseFloat(stateObj.state) || 0;
    const displayVal = decimals !== null ? val.toFixed(decimals) : val;
    return html`
      <div class="stat-bar">
        <div class="stat-info">
          <span class="clickable" @click=${() => this._fireMoreInfo(stateObj.entity_id)}>
            <ha-icon icon="${icon}"></ha-icon> ${label}
            ${showPower && isPowered ? html`<ha-icon icon="mdi:flash" class="charging-icon"></ha-icon>` : ""}
          </span>
          <span class="stat-value">${displayVal}${stateObj.attributes?.unit_of_measurement || ""}</span>
        </div>
        <div class="bar-bg"><div class="bar-fill" style="width: ${Math.min(val, 100)}%; background-color: ${color}"></div></div>
      </div>
    `;
  }

  render() {
    if (!this.hass || !this.config || !this.config.device_id) return html``;

    const device = this.hass.devices ? this.hass.devices[this.config.device_id] : null;

    const uptimeEntity = this._getState("device_uptime");
    const batteryObj = this._getState("battery_level");
    const voltageObj = this._getState("device_voltage");
    const utilObj = this._getState("channel_utilization");
    const airtimeObj = this._getState("airtime");
    const powered = this._getState("device_powered")?.state === "on";

    const rxObj = this._getState("packets_rx");
    const txObj = this._getState("packets_tx");
    const relayedObj = this._getState("packets_tx_relayed");
    const canceledObj = this._getState("packets_tx_relay_cancelled");
    const badObj = this._getState("packets_rx_bad");
    const dupObj = this._getState("packets_rx_duplicate");

    // Logic: Battery & Voltage
    const batteryValue = batteryObj ? parseFloat(batteryObj.state) : NaN;
    const voltageValue = voltageObj ? parseFloat(voltageObj.state) : NaN;
    const isBatteryZero = !isNaN(batteryValue) && batteryValue <= 0;
    const isVoltageZero = !isNaN(voltageValue) && voltageValue <= 0;
    const hasValidVoltage = !isNaN(voltageValue) && voltageValue > 0;
    
    const showBatteryToggle = this.config.show_battery !== false; 
    const showBatteryCondition = showBatteryToggle && batteryObj && !isBatteryZero && !isVoltageZero;

    // Logic: Network Traffic
    const hasTraffic = rxObj && !['unavailable', 'unknown'].includes(rxObj.state);

    // Logic: Environment Metrics
    const showEnvToggle = this.config.show_environment !== false;
    const envEntities = showEnvToggle ? this._getDeviceEntities()
      .filter(e => e.entity_id.includes('_environment_'))
      .map(e => this.hass.states[e.entity_id])
      .filter(s => s && !['unavailable', 'unknown'].includes(s.state)) : [];

    // Logic: Power Metrics
    const showPowerToggle = this.config.show_power_metrics !== false;
    const powerChannels = {};
    if (showPowerToggle) {
      this._getDeviceEntities()
        .filter(e => e.entity_id.includes('_power_'))
        .forEach(e => {
          const stateObj = this.hass.states[e.entity_id];
          if (!stateObj || ['unavailable', 'unknown'].includes(stateObj.state)) return;
          const match = e.entity_id.split('_power_')[1]?.match(/^(?:(ch\d+)_)?(.+)$/);
          if (match) {
            const ch = (match[1] || 'main').toUpperCase();
            if (!powerChannels[ch]) powerChannels[ch] = {};
            powerChannels[ch][match[2]] = stateObj;
          }
        });
    }

    // CORE FEATURE: 24h Toggle & Font Size
    const use24h = this.config.use_24h_format !== false;
    const lastUpdated = uptimeEntity?.last_updated 
        ? new Date(uptimeEntity.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !use24h })
        : "Unknown";
    const fontSize = this.config.font_size || "1";

    return html`
      <ha-card style="font-size: ${fontSize}em;">
        <div class="header">
          <div class="title-group">
            <a class="node-name clickable" href="/config/devices/device/${this.config.device_id}">
                ${this._getState("node_short_name")?.state || "Unknown Node"}
                <span class="long-name">| ${this._getState("node_long_name")?.state || ""}</span>
            </a>
            <div class="hw-version">${device?.model || "Meshtastic Node"} • v${device?.sw_version || "---"}</div>
          </div>
          <div class="uptime-badge clickable" @click=${() => this._fireMoreInfo(uptimeEntity?.entity_id)}>
            ${this._formatUptime(uptimeEntity?.state)}
          </div>
        </div>

        <div class="main-stats">
          ${showBatteryCondition ? this._renderBar("Battery", batteryObj, "mdi:battery", "#4CAF50", true, powered) : html``}
          ${this._renderBar("Channel", utilObj, "mdi:chart-donut", "#2196F3", false, false, 1)}
          ${this._renderBar("Airtime", airtimeObj, "mdi:clock-fast", "#FF9800", false, false, 1)}
        </div>

        <div class="secondary-stats">
            ${hasValidVoltage ? html`<div class="sec-item clickable" @click=${() => this._fireMoreInfo(voltageObj?.entity_id)}><ha-icon icon="mdi:flash-outline"></ha-icon> ${voltageValue}V</div>` : html``}
            <div class="sec-item clickable" @click=${() => this._fireMoreInfo(this._getState("nodes_online")?.entity_id)}>
              <ha-icon icon="mdi:antenna"></ha-icon> ${this._getState("nodes_online")?.state || 0}/${this._getState("nodes_total")?.state || 0} Nodes
            </div>
        </div>

        ${Object.keys(powerChannels).length > 0 ? html`
        <div class="power-section">
          <div class="section-header">POWER METRICS</div>
          <div class="power-grid">
            ${Object.entries(powerChannels).map(([ch, metrics]) => {
              const vObj = metrics.voltage;
              const cObj = metrics.current;
              const vVal = vObj ? parseFloat(vObj.state).toFixed(2) : '--';
              const vUnit = vObj?.attributes?.unit_of_measurement || 'V';
              const cVal = cObj ? parseFloat(cObj.state).toFixed(0) : '--';
              const cUnit = cObj?.attributes?.unit_of_measurement || 'mA';
              return html`
                <div class="power-col">
                  <div class="p-ch-title">${ch}</div>
                  <div class="p-row clickable" @click=${() => this._fireMoreInfo(vObj?.entity_id)}>
                    <ha-icon icon="mdi:flash" class="blue"></ha-icon> <span>${vVal} ${vUnit}</span>
                  </div>
                  <div class="p-row clickable" @click=${() => this._fireMoreInfo(cObj?.entity_id)}>
                    <ha-icon icon="mdi:power-plug" class="orange"></ha-icon> <span>${cVal} ${cUnit}</span>
                  </div>
                </div>
              `;
            })}
          </div>
        </div>
        ` : html``}

        ${envEntities.length > 0 ? html`
        <div class="env-section">
          ${envEntities.map(s => {
            const rawName = s.entity_id.split('_environment_')[1] || 'metric';
            const name = rawName.charAt(0).toUpperCase() + rawName.slice(1).replace(/_/g, ' ');
            const val = parseFloat(s.state);
            const displayVal = isNaN(val) ? s.state : val.toFixed(1);
            const mappedIcon = s?.attributes?.icon || ENV_ICON_MAP[rawName] || 'mdi:leaf';
            return html`
              <div class="env-item clickable" @click=${() => this._fireMoreInfo(s.entity_id)}>
                <ha-icon icon="${mappedIcon}"></ha-icon>
                <span>${name}:</span> <strong>${displayVal}${s?.attributes?.unit_of_measurement || ''}</strong>
              </div>
            `;
          })}
        </div>
        ` : html``}

        ${hasTraffic ? html`
        <div class="traffic-section">
          <div class="section-header">NETWORK TRAFFIC</div>
          <div class="traffic-grid">
            <div class="t-item clickable" @click=${() => this._fireMoreInfo(txObj?.entity_id)}><span>Sent</span><strong>${txObj?.state || 0}</strong></div>
            <div class="t-item clickable" @click=${() => this._fireMoreInfo(rxObj?.entity_id)}><span>Received</span><strong>${rxObj?.state || 0}</strong></div>
            <div class="t-item clickable" @click=${() => this._fireMoreInfo(relayedObj?.entity_id)}><span>Relayed</span><strong class="blue">${relayedObj?.state || 0}</strong></div>
            <div class="t-item clickable" @click=${() => this._fireMoreInfo(canceledObj?.entity_id)}><span>Canceled</span><strong class="red">${canceledObj?.state || 0}</strong></div>
            <div class="t-item clickable" @click=${() => this._fireMoreInfo(dupObj?.entity_id)}><span>Duplicate</span><strong class="orange">${dupObj?.state || 0}</strong></div>
            <div class="t-item clickable" @click=${() => this._fireMoreInfo(badObj?.entity_id)}><span>Malformed</span><strong class="red">${badObj?.state || 0}</strong></div>
          </div>
        </div>
        ` : html``}

        <div class="footer">
          <ha-icon icon="mdi:clock-outline"></ha-icon> Latest update: ${lastUpdated}
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      ha-card { padding: 16px; border-radius: 12px; transition: font-size 0.3s ease; }
      
      /* CORE FEATURE: Hover states for clickables */
      .clickable { cursor: pointer; transition: color 0.2s ease, opacity 0.2s ease; }
      .clickable:hover { color: var(--primary-color); opacity: 1 !important; }
      a.clickable { text-decoration: none; color: inherit; }

      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
      .node-name { font-size: 1.1em; font-weight: bold; display: block; }
      .long-name { font-weight: normal; font-size: 0.8em; opacity: 0.6; }
      .hw-version { font-size: 0.7em; opacity: 0.5; margin-top: 2px; }
      .uptime-badge { font-size: 0.75em; background: var(--secondary-background-color); padding: 2px 8px; border-radius: 10px; font-family: monospace; }

      .main-stats { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
      .stat-bar { display: flex; flex-direction: column; gap: 2px; }
      .stat-info { display: flex; justify-content: space-between; font-size: 0.75em; opacity: 0.8; align-items: center; }
      .stat-info ha-icon { --mdc-icon-size: 14px; }
      .charging-icon { color: #fdd835; margin-left: 4px; animation: pulse 2s infinite; }

      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.4; }
        100% { opacity: 1; }
      }

      .bar-bg { background: var(--secondary-background-color); height: 4px; border-radius: 2px; overflow: hidden; }
      .bar-fill { height: 100%; transition: width 1s ease; }

      .secondary-stats { display: flex; justify-content: space-around; font-size: 0.85em; padding: 8px 0; border-top: 1px solid var(--divider-color); }
      .sec-item { display: flex; align-items: center; gap: 4px; }
      .sec-item ha-icon { --mdc-icon-size: 16px; color: var(--secondary-text-color); }

      .section-header { font-size: 0.65em; font-weight: bold; letter-spacing: 1px; margin-bottom: 8px; opacity: 0.5; }
      
      .power-section { background: var(--secondary-background-color); padding: 10px; border-radius: 8px; margin-top: 8px; }
      .power-grid { display: flex; gap: 8px; overflow-x: auto; }
      .power-col { flex: 1; display: flex; flex-direction: column; gap: 4px; padding-right: 8px; border-right: 1px solid var(--divider-color); min-width: 80px; }
      .power-col:last-child { border-right: none; padding-right: 0; }
      .p-ch-title { font-size: 0.7em; font-weight: bold; opacity: 0.7; }
      .p-row { display: flex; align-items: center; gap: 6px; font-size: 0.85em; font-weight: 500; }
      .p-row ha-icon { --mdc-icon-size: 14px; opacity: 0.9; }

      .env-section { display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.8em; padding: 10px; background: var(--secondary-background-color); border-radius: 8px; margin-top: 8px; }
      .env-item { display: flex; align-items: center; gap: 4px; width: calc(50% - 4px); }
      .env-item ha-icon { --mdc-icon-size: 14px; opacity: 0.7; }
      .env-item span { opacity: 0.8; }

      .traffic-section { background: var(--secondary-background-color); padding: 10px; border-radius: 8px; margin-top: 8px; }
      .traffic-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
      .t-item { display: flex; flex-direction: column; font-size: 0.75em; }
      .t-item span { opacity: 0.6; font-size: 0.8em; margin-bottom: 2px; }
      .t-item strong { font-size: 1.1em; }
      
      .blue { color: #2196F3; } .red { color: #f44336; } .orange { color: #FF9800; }

      .footer { font-size: 0.65em; opacity: 0.5; text-align: center; margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--divider-color); display: flex; justify-content: center; align-items: center; gap: 4px; }
      .footer ha-icon { --mdc-icon-size: 12px; }
    `;
  }
}
customElements.define("meshtastic-card", MeshtasticCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "meshtastic-card",
  name: "Meshtastic Node Card",
  preview: true,
  description: "Monitoring card for Meshtastic LoRa nodes."
});