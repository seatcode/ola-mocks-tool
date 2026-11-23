// Feature Driving Data: informes y viajes de conducción.
// Por ahora solo con escenarios de respuestas fijas (scenarios/driving-data/*.json), sin selectores.

module.exports = {
    id: 'driving-data',
    name: 'Driving Data',
    description: 'Driving data: report, statistics by interval and trips.',
    paths: [
        'GET /v2/vehicles/:vin/driving-data/report',
        'GET /v2/vehicles/:vin/driving-data/:intervalType',
        'GET /v1/vehicles/:vin/driving-data/:tripType',
        'DELETE /v1/vehicles/:vin/driving-data/:tripType',
        'DELETE /v1/vehicles/:vin/driving-data/:tripType/:tripId',
    ],
    fields: [],
    defaultState: {},
    routes: [],
};
