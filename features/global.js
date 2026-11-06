// Feature Global: ajustes que afectan a todo el vehículo, no a una pantalla concreta.
//  - remoteAvailability: modo de conectividad (endpoint remote-availability).
//  - mod: MOD elegido para las pruebas. Las respuestas de las demás features cambian según el MOD
//    (campos con `mods: [...]`, escenarios con `mods: [...]`). null = sin MOD elegido: no se filtra nada.
const MODS = require('./mods');

const fields = [
    { key: 'remoteAvailability', label: 'Remote availability', group: 'Connectivity', options: ['online', 'offline', 'no-coverage'] },
    {
        key: 'mod', label: 'MOD', group: 'Vehicle', options: [null, ...MODS],
        hint: 'The responses of the other features change according to the selected MOD (e.g. the engine is only sent on MOD4 and MOD5). Not set: nothing is filtered.',
    },
];

module.exports = {
    id: 'global',
    name: 'Global',
    description: 'Settings that apply to the whole vehicle: connectivity mode and MOD.',
    paths: ['GET /v1/vehicles/:vin/remote-availability'],
    fields,
    defaultState: { remoteAvailability: 'online', mod: null },
    routes: [{
        method: 'GET',
        path: '/v1/vehicles/:vin/remote-availability',
        build: (s) => ({ 'remote-availability': s.remoteAvailability }),
    }],
};
