// Feature Global: ajustes que afectan a todo el vehículo, no a una pantalla concreta.
//  - remoteAvailability: modo de conectividad (endpoint remote-availability).
//  - mod: MOD elegido para las pruebas. Las respuestas de las demás features cambian según el MOD
//    (campos con `mods: [...]`, escenarios con `mods: [...]`). Por defecto mod3.
//  - modRestrictions: 'ignore' desactiva ese filtro (se envía todo aunque el MOD no lo tenga).
//  - Capabilities (endpoint capabilities): Global guarda el valor de cada una, UNA sola vez, y la web las muestra en una
//    tarjeta aparte, agrupadas por pantalla de la app (CAPABILITY_GROUPS). capabilitiesSituation las cambia todas a la vez.
const MODS = require('./mods');
const { SITUATIONS, capabilityField, buildCapabilities } = require('./capability-catalog');

// Qué capabilities afectan a cada pantalla de la app (según Android e iOS). `hint` = tooltip: qué hace la app con ella.
// "Vehicle Status" es la pantalla que agrupa RVS y VHR (Maintenance y Warnings).
const CAPABILITY_GROUPS = [
    { name: 'Vehicle Status', items: [
        { id: 'state', hint: 'RVS card (and the mileage block of VHR). Inactive: shown as inactive, /status is not called. Disabled: card hidden.' },
        { id: 'vehicleHealth', hint: 'VHR: maintenance and warnings. Inactive: warnings are not fetched and a notice is shown. Disabled: card hidden.' },
    ] },
    { name: 'Driving Data', items: [
        { id: 'tripStatistics', hint: 'Driving Data card. Inactive: shown as inactive. Disabled: card hidden.' },
    ] },
];
const capabilityIds = [...new Set(CAPABILITY_GROUPS.flatMap((g) => g.items.map((i) => i.id)))];

const fields = [
    { key: 'remoteAvailability', label: 'Remote availability', group: 'Connectivity', options: ['online', 'offline', 'no-coverage'] },
    {
        key: 'mod', label: 'MOD', group: 'Vehicle', options: MODS,
        hint: 'The responses of the other features change according to the selected MOD (e.g. the engine is only sent on MOD4 and MOD5).',
    },
    {
        key: 'modRestrictions', label: 'MOD restrictions', group: 'Vehicle', options: ['apply', 'ignore'],
        hint: 'Ignore: fields and capabilities that do not exist in the selected MOD can be sent anyway (e.g. the engine on MOD3).',
    },
    // Los campos del grupo 'Capabilities' no salen en Selectors sino en su propia tarjeta
    {
        key: 'capabilitiesSituation', label: 'Situation', group: 'Capabilities', options: ['none', ...Object.keys(SITUATIONS)],
        hint: 'Changes every capability at once. The ones set by hand win over it.',
    },
    ...capabilityIds.map((id) => capabilityField(id)),
];

module.exports = {
    id: 'global',
    name: 'Global',
    description: 'Settings that apply to the whole vehicle: connectivity, MOD and capabilities.',
    paths: ['GET /v1/vehicles/:vin/remote-availability', 'GET /v1/user/:userId/vehicle/:vin/capabilities'],
    capabilityGroups: CAPABILITY_GROUPS,
    fields,
    defaultState: {
        remoteAvailability: 'online', mod: 'mod3', modRestrictions: 'apply', capabilitiesSituation: 'none',
        ...Object.fromEntries(capabilityIds.map((id) => [`cap_${id}`, 'default'])),
    },
    routes: [{
        method: 'GET',
        path: '/v1/vehicles/:vin/remote-availability',
        build: (s) => ({ 'remote-availability': s.remoteAvailability }),
    }, {
        method: 'GET',
        path: '/v1/user/:userId/vehicle/:vin/capabilities',
        build: (s, req, ctx = {}) => {
            const states = {};
            for (const id of capabilityIds) if (s[`cap_${id}`] !== 'default') states[id] = s[`cap_${id}`];
            return buildCapabilities(states, { mod: ctx.mod, situation: s.capabilitiesSituation }, req);
        },
    }],
};
