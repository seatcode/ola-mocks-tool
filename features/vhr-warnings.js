// Feature VHR > Warnings: testigos de aviso. Forma parte del grupo VHR (Vehicle Health Report),
// pero es independiente de Maintenance: tiene su propio escenario e interruptor.
// Por ahora solo con escenarios de respuestas fijas (scenarios/vhr-warnings/*.json), sin selectores.

module.exports = {
    id: 'vhr-warnings',
    group: 'VHR',
    defaultScenario: 'no-warnings',  // opcional: escenario (scenarios/vhr-warnings/*.json) con el que arranca y al que vuelve al restablecer
    name: 'Warnings',
    description: 'Vehicle Health Report: warning lights.',
    paths: ['GET /v3/vehicles/:vin/warninglights'],
    fields: [],
    defaultState: [],
    routes: []
};
