// Feature VHR (Vehicle Health Report): mantenimiento y testigos de aviso.
// Por ahora solo con escenarios de respuestas fijas (scenarios/vhr/*.json), sin selectores.

module.exports = {
    id: 'vhr',
    name: 'VHR',
    description: 'Vehicle Health Report: maintenance and warning lights.',
    paths: ['GET /v2/vehicles/:vin/maintenance', 'GET /v3/vehicles/:vin/warninglights'],
    fields: [],
    defaultState: {},
    routes: [],
};
