// Feature VHR (Vehicle Health Report): mantenimiento y testigos de aviso.
//  - /maintenance se genera desde los campos:
//      { inspectionDue: {duration:{value,unit}, distance:{value,unit}},
//        oilServiceDue: {duration:{value,unit}, distance:{value,unit}},
//        adblueDue: {value, unit} }
//    Los BEV (MOD4 y MOD5) no tienen aceite ni AdBlue, así que esos campos solo existen en MOD3.
//
// Las unidades son siempre `days` y `km` (no se pueden cambiar desde la GUI)

const DAYS = 'days';
const KM = 'km';
const NOT_BEV = ['mod3'];
const num = (key, label, group, extra = {}) => ({ key, label, group, type: 'number', ...extra });

const fields = [
    num('inspectionDays', 'Time to inspection (days)', 'Inspection'),
    num('inspectionKm', 'Distance to inspection (km)', 'Inspection'),
    num('oilDays', 'Time to oil service (days)', 'Oil service', { mods: NOT_BEV }),
    num('oilKm', 'Distance to oil service (km)', 'Oil service', { mods: NOT_BEV }),
    num('adblueKm', 'AdBlue remaining (km)', 'AdBlue', { mods: NOT_BEV }),
];

const defaultState = {
    inspectionDays: 405, inspectionKm: 149,
    oilDays: 180, oilKm: 4200,
    adblueKm: 2400,
};

const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
const part = (obj) => (Object.keys(compact(obj)).length ? compact(obj) : undefined);
// { value, unit } only when there is a value; no value = the field is not sent
const measure = (value, unit) => (value === null || value === undefined ? undefined : { value, unit });

function buildMaintenance(s) {
    return compact({
        inspectionDue: part({ duration: measure(s.inspectionDays, DAYS), distance: measure(s.inspectionKm, KM) }),
        oilServiceDue: part({ duration: measure(s.oilDays, DAYS), distance: measure(s.oilKm, KM) }),
        adblueDue: measure(s.adblueKm, KM),
    });
}

module.exports = {
    id: 'vhr-maintenance',
    group: 'VHR',
    name: 'Maintenance',
    description: 'Vehicle Health Report: inspection, oil service and AdBlue.',
    paths: ['GET /v2/vehicles/:vin/maintenance'],
    fields,
    defaultState,
    routes: [{ method: 'GET', path: '/v2/vehicles/:vin/maintenance', build: buildMaintenance }],
};
