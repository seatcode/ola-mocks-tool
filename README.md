# ola-mocks

Servidor local para mockear las respuestas del backend de OLA (apps MyCupra y MySeat) y probar escenarios sin depender del BE real. Las apps llegan a este servidor a través de Charles (Map Remote).

## Arrancar

```
npm install      # solo la primera vez
npm start        # equivale a: node --use-system-ca app.js
```

Usa `npm start` y no `node app.js`: el flag `--use-system-ca` (hace falta Node 22.15 o superior) hace que Node confíe en los certificados del sistema. Con la inspección TLS de la empresa (Zscaler), el certificado del backend real está firmado por una CA corporativa que Node no conoce por defecto, y sin el flag las llamadas no mockeadas fallan con `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Al arrancar, el servidor avisa si no confía en el certificado del backend.

Abre http://localhost:3000. A la izquierda están las **features** (Global, RVS, VHR › Maintenance, VHR › Warnings, Driving Data), cada una con su escenario activo; puedes tener un escenario distinto en cada una a la vez. Arriba están los controles globales (interruptor general *All mocks*, "Restablecer todo" y el tema claro/oscuro).

## Charles: una sola regla

Una única regla en `Tools > Map Remote` manda **todo** el tráfico de la API a este servidor, y es el servidor quien decide qué se mockea y qué va al backend real:

- Origen (*Map From*): protocolo `https`, host `ola.prod.code.seat.cloud.vwgroup.com`, puerto `443`, path `/v*` y la query vacía. **El path no puede ser vacío ni `/*`**: Charles trata la petición `CONNECT` que abre el túnel HTTPS como si tuviera path `/`, así que esas reglas también la casan, la redirigen al puerto 3000 y deja de funcionar todo (Charles muestra `SSL: Unsupported or unrecognized SSL message`). Con `/v*` solo casan las rutas de la API (`/v1`, `/v2`, `/v3`…); una ruta que no empiece por `/v` iría directa al backend real.
- Destino (*Map To*): protocolo `http`, host `localhost`, puerto `3000`, y deja el path vacío (conserva el original).
- El host debe estar en `Proxy > SSL Proxying Settings`.
- Borra las reglas antiguas por ruta para que no se pisen.

Lo que no esté mockeado se reenvía tal cual (método, ruta, query, cabeceras como `Authorization`, y cuerpo) a `https://ola.prod.code.seat.cloud.vwgroup.com`. Para apuntar a otro entorno: `TARGET_HOST=https://otro.host npm start`. Si el backend no responde, el servidor devuelve un 502.

### Mocking por feature

Cada feature tiene un interruptor **Mocking** (arriba a la derecha de su panel). Encendido, los mocks contestan sus peticiones; apagado, sus peticiones van al backend real. Empiezan todas **encendidas**: una feature sin escenario contesta con sus valores por defecto (o, si no tiene selectores, no tiene nada que contestar y todo pasa al backend real). Apagarlo no borra el escenario ni el estado: al volver a encenderlo sigue todo como estaba. Aplicar un escenario o cambiar un selector no vuelve a encender un mock que apagaste; solo lo cambia el interruptor y *Restablecer todo* (que además quita los escenarios).

### Interruptor general

El interruptor **All mocks** de la cabecera pausa todos los mocks a la vez: mientras está apagado, todo va al backend real. No toca el estado de las features (cada una conserva su escenario, selectores y su interruptor *Mocking*), así que al volver a encenderlo vuelve tu configuración. *Restablecer todo* lo deja encendido.

Para saltarte este servidor por completo (por ejemplo, si no está arrancado), desactiva Map Remote desde el menú `Tools` de Charles. Para cambiar el puerto del servidor: `PORT=3100 npm start`.

## Escenarios

Cada escenario es un fichero JSON en `scenarios/<feature>/`, por ejemplo `scenarios/rvs/safe.json`.

**Crear desde la web:** en la tarjeta *Scenarios* de cada feature, pulsa el icono `+`. Pones nombre y descripción; en RVS se guardan los valores que tengas ahora en los selectores, y en cualquier feature puedes añadir respuestas fijas (`routes`) como JSON. Se escribe `scenarios/<feature>/<nombre>.json` (nunca sobrescribe uno existente) y queda aplicado. El icono de la flecha circular quita el escenario de esa feature. Como son ficheros del repo, no olvides hacer commit de los que quieras compartir.

**Crear a mano:** copia `scenarios/_template.json` a la carpeta de su feature, quítale el `_` al nombre y edítalo. Aparece en la web al recargar; no hace falta reiniciar el servidor. Los ficheros que empiezan por `_` se ignoran.

```json
{
  "name": "Nombre en la web",
  "description": "Para qué sirve",
  "state": { "locked": false, "doorFrontLeft": "open" },
  "routes": [
    { "method": "GET", "path": "/v1/algo/:vin/capabilities", "status": 200, "delayMs": 0, "headers": {}, "body": {} }
  ]
}
```

- `state` (opcional): solo para features con selectores (hoy RVS). Lo que no pongas queda por defecto. Si pones un campo que la feature no tiene, la web lo indica y el escenario no se puede aplicar.
- `mods` (opcional): lista de MOD para los que vale el escenario (`mod3`, `mod4`, `mod5`). Sin ella, vale para todos.
- `routes` (opcional): respuestas fijas para cualquier llamada. Una feature puede tener varias (VHR › Warnings, por ejemplo, usa solo esto). `:nombre` casa un tramo de la ruta y `*` casa cualquier cosa. Si una ruta fija coincide con una ruta generada por los selectores, gana la fija.
- `status`, `headers` y `delayMs` sirven para probar errores (p. ej. 503) y estados de carga.

### Global y MOD

La feature **Global** reúne ajustes que afectan a todo el vehículo:

- **Remote availability** (`online`, `offline`, `no-coverage`): responde `GET /v1/vehicles/:vin/remote-availability` con `{"remote-availability": "<modo>"}`.
- **MOD** (`mod3` por defecto, `mod4`, `mod5`): el MOD con el que quieres probar. Al elegirlo cambian las respuestas de las demás features, sin depender del MOD real del coche:
  - Un campo de una feature puede declarar en qué MOD existe (`mods: [...]` en su definición). Con otro MOD elegido, el selector se desactiva y el campo no se envía. Hoy, el motor de RVS solo se envía en MOD4 y MOD5.
  - Un escenario puede llevar `"mods": ["mod4", "mod5"]`; si el MOD elegido no está en la lista, el botón se atenúa y la web avisa al aplicarlo (no se bloquea).
- **MOD restrictions** (`apply` por defecto, `ignore`): con `ignore` no se filtra nada por MOD. Los campos que no existen en el MOD elegido se envían igual (por ejemplo, el motor en MOD3), los selectores se activan y los escenarios no se atenúan.

### Capabilities: `GET /v1/user/:userId/vehicle/:vin/capabilities`

Lo sirve **Global**, que guarda el valor de cada capability **una sola vez**. Se editan en la tarjeta **Capabilities** de Global, agrupadas por la pantalla de la app a la que afectan (según Android e iOS; el mapa está en `CAPABILITY_GROUPS`, `features/global.js`):

| Pantalla | Capability |
|---|---|
| Vehicle Status (RVS y VHR) | `state` y `vehicleHealth` |
| Driving Data | `tripStatistics` |

Al pasar el ratón por el nombre de una capability se ve qué hace la app con ella.

- La respuesta parte de un **catálogo por MOD** (`catalogs/capabilities/mod3.json`, `mod4.json`, `mod5.json`; el MOD de Global elige cuál). `platform`, `userId` y `vin` se rellenan solos (los dos últimos, desde la URL).
- Valores: `Default` (como el catálogo), `Active`, `Inactive` (sin motivo), `Inactive · <motivo>` (añade `status`: insufficient-battery-level, deactivated-by-active-vehicle-user, initially-disabled, license-expired, location-data-disabled) y `Disabled (not sent)` (no aparece en la lista; las apps la tratan como no disponible y ocultan la tarjeta). Las apps solo distinguen la licencia y `location-data-disabled` en el aviso; el resto da el genérico de inactivo.
- **Situation** (arriba de la tarjeta): afecta a todas a la vez. Hoy: `insufficient-battery-level` (todas inactivas con ese motivo, salvo unas pocas que siguen activas, copiadas de una respuesta real de MOD5; están en `SITUATIONS`). Lo fijado a mano en una capability manda sobre la situación.
- Una capability que no existe en el MOD elegido aparece desactivada y no se envía. Con Global › MOD restrictions = `ignore`, configurarla la añade a la respuesta.
- Las demás capabilities (y los `parameters`) se editan en la pestaña JSON del endpoint.
- Para otro tipo de coche (según lo comprado), copia un catálogo y ajústalo; se leen al arrancar.
- Para añadir una capability a una feature: añádela a `CAPABILITY_GROUPS`.

### Editar la respuesta desde la web

La tarjeta *Response* de cada feature con selectores (RVS) tiene dos pestañas:

- **Selectors:** formulario con los campos del vehículo.
- **JSON:** un editor **por endpoint**, cada uno desplegable. Contiene la ruta de ese endpoint como JSON (`method`, `path`, `status`, opcionalmente `delayMs` y `headers`, y `body`); *Apply* lo aplica solo a ese endpoint y *Discard custom JSON* lo quita. `method` y `path` no se pueden cambiar. Un endpoint sin mock definido muestra una plantilla: aplicarla le define uno. Las features sin selectores (VHR, Driving Data) solo tienen esta vista.

Un JSON aplicado a un endpoint manda sobre el escenario y sobre los selectores **para ese endpoint**; los demás no se tocan. Cambiar un selector descarta el JSON de los endpoints que generan los selectores (p. ej. `/status` en RVS), pero no el de los que son respuestas fijas. El JSON aplicado es literal, así que campos como `updatedAt` quedan con el valor que tengan en el texto. Si guardas un escenario nuevo con el icono **+**, se guardan en sus `routes` las respuestas fijas y los JSON propios que estén en vigor.

### VHR › Maintenance: `/maintenance`

La respuesta de `GET /v2/vehicles/:vin/maintenance` se genera desde campos, con esta forma:

```json
{
  "inspectionDue": { "duration": { "value": 405, "unit": "days" }, "distance": { "value": 149, "unit": "km" } },
  "oilServiceDue": { "duration": { "value": 180, "unit": "days" }, "distance": { "value": 4200, "unit": "km" } },
  "adblueDue": { "value": 2400, "unit": "km" }
}
```

Las unidades son siempre `days` y `km` y no se pueden cambiar desde la GUI. Los valores son numéricos; un campo vacío no se envía (y si falta el valor, no se envía ese bloque). Los BEV (MOD4 y MOD5) no tienen aceite ni AdBlue: con esos MOD elegidos en Global, esos campos se desactivan y no salen. Los valores por defecto de inspección vienen de tus mocks antiguos; los de aceite y AdBlue son provisionales. `/warninglights` es otra feature, VHR › Warnings, independiente de esta.

En un escenario de Maintenance, los campos van en `state` con estos nombres: `inspectionDays`, `inspectionKm`, `oilDays`, `oilKm`, `adblueKm`.

## Features independientes y agrupadas

Una **feature** es una unidad con su propio escenario, estado e interruptor *Mocking*, y sus endpoints **dependen entre sí** (cambiar uno afecta a los otros). Los endpoints que no tienen relación entre sí van en features distintas, para poder elegir un escenario distinto en cada uno. La propiedad `group` las agrupa bajo un título en la barra lateral: así VHR contiene *Maintenance* y *Warnings*, que se configuran por separado (`scenarios/vhr-maintenance/`, `scenarios/vhr-warnings/`; en la API, `vhr-maintenance` y `vhr-warnings`). Si hay relación entre endpoints, van en la misma feature.

## Escenario por defecto

Una feature puede declarar el escenario con el que arranca, con la propiedad `defaultScenario` en su fichero `features/<id>.js` (el nombre del fichero del escenario, sin `.json`):

```js
module.exports = {
    id: 'vhr-warnings',
    defaultScenario: 'no-warnings',   // scenarios/vhr-warnings/no-warnings.json
    // ...
};
```

Se aplica al arrancar el servidor y **también al restablecer**: *Reset all* y el icono de quitar escenario de esa feature vuelven al escenario por defecto, no a "ninguno". En la web, el panel lo indica ("Default scenario: …") y el icono de quitar escenario solo aparece cuando hay algo que deshacer. Si el escenario no existe o tiene errores, el servidor avisa al arrancar y la feature empieza sin escenario. Los cambios en `features/*.js` necesitan reiniciar el servidor.

## Añadir una feature nueva

1. Copia `features/vhr-warnings.js` a `features/<nombre>.js` y ajusta `id`, `name`, `description` y `paths` (y `group`, si va bajo un título compartido).
2. Regístrala en `features/index.js`.
3. Crea la carpeta `scenarios/<id>/` con sus escenarios.

Si quiere selectores en la web, define `fields` (ver `features/rvs.js` para desplegables y `features/vhr-maintenance.js` para campos numéricos `type: 'number'`) y `routes` con una función `build(state)` que genere la respuesta.

## API (para tests automáticos)

- `GET /api/state`: todas las features con su escenario activo, estado, escenarios disponibles y errores.
- `POST /api/features/{feature}/scenario/{nombre}`: aplica un escenario (nombre del fichero sin `.json`).
- `POST /api/features/{feature}/scenarios` con `{"name":"…","description":"…","state":{…},"routes":[…]}`: crea el fichero del escenario y lo aplica.
- `PUT /api/features/{feature}/state` con `{"lights":"on"}`: cambia campos sueltos .
- `PUT /api/features/{feature}/route` con `{"route":{…}}`: aplica un JSON escrito a mano a un endpoint (el editor JSON de la web). `DELETE /api/features/{feature}/route?method=GET&path=/ruta` lo descarta.
- `PUT /api/features/{feature}/routes` con `{"routes":[…]}`: aplica varios a la vez, sustituyendo los que hubiera. `DELETE` en la misma ruta quita todos.
- `POST /api/features/{feature}/mocking` con `{"enabled":false}`: enciende o apaga el mock de esa feature (apagado = backend real).
- `POST /api/features/{feature}/reset`: vuelve la feature a su punto de partida (su escenario por defecto, o ninguno) y deja el mock encendido.
- `POST /api/reset`: restablece todas las features.
- `POST /api/mocking` con `{"enabled":false}`: pausa o reanuda todos los mocks (interruptor general).
