// Capabilities: catálogo por MOD, valores posibles y construcción de la respuesta de /capabilities.
// El endpoint es uno solo y lo sirve Global, que es también quien guarda el valor de cada capability
// (una sola vez, aunque la usen varias features).
//
// Valor de una capability:
//   default   -> tal cual el catálogo del MOD (y la "situación" de Global, si hay)
//   active    -> active: true
//   inactive  -> active: false, sin motivo
//   <motivo>  -> active: false + status: <motivo>
//   disabled  -> no se envía en la lista (la app la trata como no disponible)
const fs = require('fs');
const path = require('path');
const MODS = require('./mods');

const DEFAULT_MOD = 'mod3'; // catálogo que se usa si no hay MOD elegido
const catalogs = Object.fromEntries(MODS.map((m) => [m, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogs', 'capabilities', `${m}.json`), 'utf8'))]));

// id -> en qué MOD existe
const modsOf = {};
for (const m of MODS) for (const c of catalogs[m].capabilities) (modsOf[c.id] = modsOf[c.id] || []).push(m);

// Motivos (`status`) que se pueden elegir. Las apps solo distinguen la licencia (license-expired) y
// location-data-disabled; el resto da el aviso genérico de "inactivo".
const REASONS = ['insufficient-battery-level', 'deactivated-by-active-vehicle-user', 'initially-disabled', 'license-expired', 'location-data-disabled'];
const OPTIONS = ['default', 'active', 'inactive', ...REASONS, 'disabled'];

// Situaciones de Global que afectan a todas las capabilities a la vez.
// `value`: valor para todas, salvo `stayActive`, que se quedan activas (según un ejemplo real de MOD5).
const SITUATIONS = {
    'insufficient-battery-level': {
        value: 'insufficient-battery-level',
        stayActive: ['automaker', 'batterySupport', 'car2Phone', 'mobileDeviceKey', 'privateEmergencyCall', 'readiness', 'remoteChargingStatistics', 'roadsideAssistant', 'vilsa', 'vodafoneNetwork'],
    },
};
const situationValue = (id, situation) => {
    const s = SITUATIONS[situation];
    if (!s) return 'default';
    return s.stayActive.includes(id) ? 'active' : s.value;
};

// Campo de una feature que controla una capability
function capabilityField(id, hint) {
    return { key: `cap_${id}`, label: id, group: 'Capabilities', capability: id, options: OPTIONS, mods: modsOf[id], unavailableValue: 'default', hint };
}

function apply(cap, value) {
    if (value === 'disabled') return null;
    const c = JSON.parse(JSON.stringify(cap));
    if (value === 'active') { c.active = true; delete c.status; }
    else if (value === 'inactive') { c.active = false; delete c.status; }
    else if (REASONS.includes(value)) { c.active = false; c.status = value; }
    return c;
}

// states: { capabilityId: valor } (solo los que no son default). ctx: { mod, situation }
function buildCapabilities(states, ctx, req) {
    const mod = catalogs[ctx.mod] ? ctx.mod : DEFAULT_MOD;
    const valueOf = (id) => states[id] || situationValue(id, ctx.situation);
    const capabilities = catalogs[mod].capabilities.map((c) => apply(c, valueOf(c.id))).filter(Boolean);
    // Capabilities que no son de este MOD pero se han configurado a mano (solo llegan aquí si Global ignora las restricciones)
    for (const id of Object.keys(states)) {
        if (!modsOf[id] || capabilities.some((c) => c.id === id) || catalogs[mod].capabilities.some((c) => c.id === id)) continue;
        const extra = apply(catalogs[modsOf[id][0]].capabilities.find((c) => c.id === id), states[id]);
        if (extra) capabilities.push(extra);
    }
    const url = (req && req.path) || '';
    const part = (re, fallback) => { const m = re.exec(url); return m ? decodeURIComponent(m[1]) : fallback; };
    return {
        userId: part(/\/user\/([^/]+)/, '00000000-0000-0000-0000-000000000000'),
        vin: part(/\/vehicle\/([^/]+)/, 'VSSZZZ00000000000'),
        platform: mod.toUpperCase(),
        fallback: false,
        queriedOn: new Date().toISOString(),
        capabilities,
    };
}

module.exports = { OPTIONS, SITUATIONS, capabilityField, buildCapabilities };
