# ola-mocks

Servidor local para mockear las respuestas del backend de OLA (apps MyCupra y MySeat) y probar escenarios sin depender del BE real. Las apps llegan a este servidor a través de Charles (Map Remote).

## Arrancar

```
npm install      # solo la primera vez
npm start        # equivale a: node --use-system-ca app.js
```

Usa `npm start` y no `node app.js`: el flag `--use-system-ca` (hace falta Node 22.15 o superior) hace que Node confíe en los certificados del sistema. Con la inspección TLS de la empresa (Zscaler), el certificado del backend real está firmado por una CA corporativa que Node no conoce por defecto, y sin el flag las llamadas no mockeadas fallan con `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Al arrancar, el servidor avisa si no confía en el certificado del backend.

Abre http://localhost:3000. A la izquierda están las **features** (Global, RVS, VHR, Driving Data), cada una con su escenario activo; puedes tener un escenario distinto en cada una a la vez. Arriba están los controles globales (interruptor general *All mocks*, "Restablecer todo" y el tema claro/oscuro).

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
- `routes` (opcional): respuestas fijas para cualquier llamada. Una feature puede tener varias (VHR, por ejemplo, usa solo esto). `:nombre` casa un tramo de la ruta y `*` casa cualquier cosa. Si una ruta fija coincide con una ruta generada por los selectores, gana la fija.
- `status`, `headers` y `delayMs` sirven para probar errores (p. ej. 503) y estados de carga.

### Global y MOD

La feature **Global** reúne ajustes que afectan a todo el vehículo:

- **Remote availability** (`online`, `offline`, `no-coverage`): responde `GET /v1/vehicles/:vin/remote-availability` con `{"remote-availability": "<modo>"}`.
- **MOD** (`mod3`, `mod4`, `mod5`, o "Not set"): el MOD con el que quieres probar. Al elegirlo cambian las respuestas de las demás features, sin depender del MOD real del coche:
  - Un campo de una feature puede declarar en qué MOD existe (`mods: [...]` en su definición). Con otro MOD elegido, el selector se desactiva y el campo no se envía. Hoy, el motor de RVS solo se envía en MOD4 y MOD5.
  - Un escenario puede llevar `"mods": ["mod4", "mod5"]`; si el MOD elegido no está en la lista, el botón se atenúa y la web avisa al aplicarlo (no se bloquea).
  - Con "Not set" no se filtra nada.

### Editar la respuesta desde la web

La tarjeta *Response* de cada feature con selectores (RVS) tiene dos pestañas:

- **Selectors:** formulario con los campos del vehículo.
- **JSON:** un editor **por endpoint**, cada uno desplegable. Contiene la ruta de ese endpoint como JSON (`method`, `path`, `status`, opcionalmente `delayMs` y `headers`, y `body`); *Apply* lo aplica solo a ese endpoint y *Discard custom JSON* lo quita. `method` y `path` no se pueden cambiar. Un endpoint sin mock definido muestra una plantilla: aplicarla le define uno. Las features sin selectores (VHR, Driving Data) solo tienen esta vista.

Un JSON aplicado a un endpoint manda sobre el escenario y sobre los selectores **para ese endpoint**; los demás no se tocan. Cambiar un selector descarta el JSON de los endpoints que generan los selectores (p. ej. `/status` en RVS), pero no el de los que son respuestas fijas. El JSON aplicado es literal, así que campos como `updatedAt` quedan con el valor que tengan en el texto. Si guardas un escenario nuevo con el icono **+**, se guardan en sus `routes` las respuestas fijas y los JSON propios que estén en vigor.

### VHR: `/maintenance`

La respuesta de `GET /v2/vehicles/:vin/maintenance` se genera desde campos, con esta forma:

```json
{
  "inspectionDue": { "duration": { "value": 405, "unit": "days" }, "distance": { "value": 149, "unit": "km" } },
  "oilServiceDue": { "duration": { "value": 180, "unit": "days" }, "distance": { "value": 4200, "unit": "km" } },
  "adblueDue": { "value": 2400, "unit": "km" }
}
```

Las unidades son siempre `days` y `km` y no se pueden cambiar desde la GUI. Los valores son numéricos; un campo vacío no se envía (y si falta el valor, no se envía ese bloque). Los BEV (MOD4 y MOD5) no tienen aceite ni AdBlue: con esos MOD elegidos en Global, esos campos se desactivan y no salen. Los valores por defecto de inspección vienen de tus mocks antiguos; los de aceite y AdBlue son provisionales. `/warninglights` sigue siendo una respuesta fija del escenario (p. ej. *No warnings*).

En un escenario de VHR, los campos van en `state` con estos nombres: `inspectionDays`, `inspectionKm`, `oilDays`, `oilKm`, `adblueKm`.

## Añadir una feature nueva

1. Copia `features/vhr.js` a `features/<nombre>.js` y ajusta `id`, `name`, `description` y `paths`.
2. Regístrala en `features/index.js`.
3. Crea la carpeta `scenarios/<id>/` con sus escenarios.

Si quiere selectores en la web, define `fields` (ver `features/rvs.js` para desplegables y `features/vhr.js` para campos numéricos `type: 'number'`) y `routes` con una función `build(state)` que genere la respuesta.

## API (para tests automáticos)

- `GET /api/state`: todas las features con su escenario activo, estado, escenarios disponibles y errores.
- `POST /api/features/{feature}/scenario/{nombre}`: aplica un escenario (nombre del fichero sin `.json`).
- `POST /api/features/{feature}/scenarios` con `{"name":"…","description":"…","state":{…},"routes":[…]}`: crea el fichero del escenario y lo aplica.
- `PUT /api/features/{feature}/state` con `{"lights":"on"}`: cambia campos sueltos .
- `PUT /api/features/{feature}/route` con `{"route":{…}}`: aplica un JSON escrito a mano a un endpoint (el editor JSON de la web). `DELETE /api/features/{feature}/route?method=GET&path=/ruta` lo descarta.
- `PUT /api/features/{feature}/routes` con `{"routes":[…]}`: aplica varios a la vez, sustituyendo los que hubiera. `DELETE` en la misma ruta quita todos.
- `POST /api/features/{feature}/mocking` con `{"enabled":false}`: enciende o apaga el mock de esa feature (apagado = backend real).
- `POST /api/features/{feature}/reset`: quita el escenario de esa feature y la deja con el mock encendido.
- `POST /api/reset`: restablece todas las features.
- `POST /api/mocking` con `{"enabled":false}`: pausa o reanuda todos los mocks (interruptor general).
