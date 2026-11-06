// Feature RVS (Remote Vehicle Status): estado del vehículo.
// El JSON de /status se genera desde los selectores (state).
//
// Valores válidos (según AlertStatus.fromString de la app Android):
//   puertas / ventanillas / capó / maletero / techo -> open | closed | unknown | null
//   luces / motor                                   -> on | off | unknown | null
//   null = el campo NO se envía (la app no lo muestra)

const OPEN = ['open', 'closed', 'unknown', null];
const ON = ['on', 'off', 'unknown', null];

const fields = [
    { key: 'locked', label: 'Central locking', group: 'General', options: [true, false] },
    { key: 'lights', label: 'Lights', group: 'General', options: ON },
    { key: 'hood', label: 'Hood', group: 'General', options: OPEN },
    { key: 'trunk', label: 'Trunk', group: 'General', options: OPEN },
    { key: 'sunRoof', label: 'Sunroof', group: 'General', options: OPEN },
    // El motor solo se recibe en los MOD 4 y 5 (los BEV)
    { key: 'engine', label: 'Engine', group: 'General', options: ON, mods: ['mod4', 'mod5'] },
    { key: 'doorFrontLeft', label: 'Front left', group: 'Doors', options: OPEN },
    { key: 'doorFrontRight', label: 'Front right', group: 'Doors', options: OPEN },
    { key: 'doorRearLeft', label: 'Rear left', group: 'Doors', options: OPEN },
    { key: 'doorRearRight', label: 'Rear right', group: 'Doors', options: OPEN },
    { key: 'windowFrontLeft', label: 'Front left', group: 'Windows', options: OPEN },
    { key: 'windowFrontRight', label: 'Front right', group: 'Windows', options: OPEN },
    { key: 'windowRearLeft', label: 'Rear left', group: 'Windows', options: OPEN },
    { key: 'windowRearRight', label: 'Rear right', group: 'Windows', options: OPEN },
];

// Punto de partida: todo cerrado y apagado. El motor solo sale en MOD4/MOD5 o sin MOD elegido.
const defaultState = {
    locked: true, lights: 'off', engine: 'off', sunRoof: 'closed',
    hood: 'closed', trunk: 'closed',
    doorFrontLeft: 'closed', doorFrontRight: 'closed', doorRearLeft: 'closed', doorRearRight: 'closed',
    windowFrontLeft: 'closed', windowFrontRight: 'closed', windowRearLeft: 'closed', windowRearRight: 'closed',
};

// Quita las claves con valor null (campos que no se envían)
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
const part = (obj) => (Object.keys(compact(obj)).length ? compact(obj) : undefined);

// Construye el JSON de /status con la misma forma que el backend real
function buildStatus(s) {
    const lockedStr = String(s.locked);
    const door = (open) => (open === null ? undefined : { open, locked: lockedStr });
    return compact({
        locked: s.locked,
        lights: s.lights,
        engine: s.engine,
        sunRoof: s.sunRoof,
        hood: s.hood === null ? undefined : { open: s.hood, locked: 'false' },
        trunk: door(s.trunk),
        doors: part({
            frontLeft: door(s.doorFrontLeft), frontRight: door(s.doorFrontRight),
            rearLeft: door(s.doorRearLeft), rearRight: door(s.doorRearRight),
        }),
        windows: part({
            frontLeft: s.windowFrontLeft, frontRight: s.windowFrontRight,
            rearLeft: s.windowRearLeft, rearRight: s.windowRearRight,
        }),
        updatedAt: new Date().toISOString(),
    });
}

module.exports = {
    id: 'rvs',
    name: 'RVS',
    description: 'Remote Vehicle Status: doors, lights, windows, hood, trunk and engine.',
    paths: ['GET /v2/vehicles/:vin/status'],
    fields,
    defaultState,
    // Rutas generadas desde el estado (si un escenario fija la misma ruta, gana el escenario)
    routes: [{ method: 'GET', path: '/v2/vehicles/:vin/status', build: buildStatus }],
};
