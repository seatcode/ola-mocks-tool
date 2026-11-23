// Lista de features, en el orden en que salen en la web.
// Una feature es una unidad con su propio escenario, estado e interruptor de mocking: sus endpoints dependen entre sí.
// Los endpoints independientes van en features distintas; `group` las agrupa bajo un título en la barra lateral.
// Para añadir una: crea features/<nombre>.js (copia vhr-warnings.js), regístrala aquí y crea scenarios/<id>/.
module.exports = [
    require('./global'),
    require('./rvs'),
    require('./vhr-maintenance'),
    require('./vhr-warnings'),
    require('./driving-data'),
];
