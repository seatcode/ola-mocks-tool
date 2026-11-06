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
- **JSON:** la respuesta como JSON editable (un array de rutas, con el mismo formato que `routes` de un escenario). *Apply JSON* la aplica tal cual. Las features sin selectores (VHR, Driving Data) solo tienen el editor JSON.

Debajo, la tarjeta **Endpoints** lista los endpoints de la feature, cada uno desplegable con la respuesta que se enviará y una etiqueta *Mocked* o *Real backend* según vaya al mock o al backend real. Si una feature solo tiene un endpoint, arranca desplegado.

Un JSON aplicado manda sobre los selectores y sobre las respuestas fijas del escenario hasta que cambies un selector, apliques otro escenario o pulses *Discard custom JSON*. Ojo: el JSON aplicado es literal, así que campos como `updatedAt` quedan con el valor que tengan en el texto. Si guardas un escenario nuevo con un JSON aplicado, ese JSON se guarda en sus `routes`.

### RVS: campos de `state`

| Campos | Valores |
|---|---|
| `locked` | `true`, `false` |
| `lights`, `engine` | `"on"`, `"off"`, `"unknown"`, `null` |
| `hood`, `trunk`, `sunRoof`, `doorFrontLeft/FrontRight/RearLeft/RearRight`, `windowFrontLeft/FrontRight/RearLeft/RearRight` | `"open"`, `"closed"`, `"unknown"`, `null` |

Por defecto todo está cerrado y apagado, incluido el techo solar; el motor solo se envía en MOD4 y MOD5 (o sin MOD elegido). `null` significa que el campo no se envía y la app no lo muestra.

## Idioma de la web

La web está siempre en inglés. Los textos están en un diccionario al principio del script de `public/index.html` (`MESSAGES`), preparado para añadir más idiomas, pero no hay selector de idioma. Los nombres y descripciones de los escenarios y las etiquetas de los campos vienen de los ficheros de datos y se escriben en inglés.

## Añadir una feature nueva

1. Copia `features/vhr.js` a `features/<nombre>.js` y ajusta `id`, `name`, `description` y `paths`.
2. Regístrala en `features/index.js`.
3. Crea la carpeta `scenarios/<id>/` con sus escenarios.

Si quiere selectores en la web, define `fields` (ver `features/rvs.js`) y `routes` con una función `build(state)` que genere la respuesta.

## API (para tests automáticos)

- `GET /api/state`: todas las features con su escenario activo, estado, escenarios disponibles y errores.
- `POST /api/features/{feature}/scenario/{nombre}`: aplica un escenario (nombre del fichero sin `.json`).
- `POST /api/features/{feature}/scenarios` con `{"name":"…","description":"…","state":{…},"routes":[…]}`: crea el fichero del escenario y lo aplica.
- `PUT /api/features/{feature}/state` con `{"lights":"on"}`: cambia campos sueltos .
- `PUT /api/features/{feature}/routes` con `{"routes":[…]}`: aplica un JSON escrito a mano (el editor JSON de la web). `DELETE` en la misma ruta lo descarta.
- `POST /api/features/{feature}/mocking` con `{"enabled":false}`: enciende o apaga el mock de esa feature (apagado = backend real).
- `POST /api/features/{feature}/reset`: quita el escenario de esa feature y la deja con el mock encendido.
- `POST /api/reset`: restablece todas las features.
- `POST /api/mocking` con `{"enabled":false}`: pausa o reanuda todos los mocks (interruptor general).
