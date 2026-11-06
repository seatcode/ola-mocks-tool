// Lista de features, en el orden en que salen en la web.
// Para añadir una: crea features/<nombre>.js (copia vhr.js), regístrala aquí y crea scenarios/<id>/.
module.exports = [require('./global'), require('./rvs'), require('./vhr'), require('./driving-data')];
