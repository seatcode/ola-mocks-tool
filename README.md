# ola-mocks

Servidor local para mockear las respuestas del backend de OLA (apps MyCupra y MySeat) y probar escenarios sin depender del BE real. Las apps llegan a este servidor a través de Charles (Map Remote).

## Arrancar

```
npm install      # solo la primera vez
node app.js
```

Abre http://localhost:3000. A la izquierda están las **features** (RVS, VHR, Driving Data), cada una con su escenario activo; puedes tener un escenario distinto en cada una a la vez. Arriba están los controles globales (interruptor de Map Remote y "Restablecer todo").

## Charles

`Tools > Map Remote`: una regla por cada ruta que quieras mockear (la web lista las rutas de cada feature).

- Origen: el host real de la API y el path de la llamada (p. ej. `/v2/vehicles/*/status`).
- Destino: protocolo `http`, host `localhost`, puerto `3000`, sin cambiar el path.
- El host debe estar en `Proxy > SSL Proxying Settings`.

Las rutas que no mapees siguen yendo al backend real.

### Interruptor de Map Remote

El botón de arriba activa o desactiva Map Remote en Charles (con él desactivado, las apps hablan con el backend real). Usa la Web Interface de Charles, que debe estar activada (`Proxy > Web Interface Settings`). Ojo: activa o desactiva la herramienta Map Remote entera, no solo tus reglas.

Por defecto habla con Charles en `127.0.0.1:8888`. Si el tuyo usa otro puerto: `CHARLES_PORT=8889 node app.js`. Para cambiar el puerto del servidor: `PORT=3100 node app.js`.

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
- `routes` (opcional): respuestas fijas para cualquier llamada. Una feature puede tener varias (VHR, por ejemplo, usa solo esto). `:nombre` casa un tramo de la ruta y `*` casa cualquier cosa. Si una ruta fija coincide con una ruta generada por los selectores, gana la fija.
- `status`, `headers` y `delayMs` sirven para probar errores (p. ej. 503) y estados de carga.

### Editar la respuesta desde la web

La tarjeta *Response* de cada feature con selectores (RVS) tiene dos pestañas:

- **Selectors:** formulario con los campos del vehículo; debajo se ve la respuesta que se enviará.
- **JSON:** la respuesta como JSON editable (un array de rutas, con el mismo formato que `routes` de un escenario). *Apply JSON* la aplica tal cual. Las features sin selectores (VHR, Driving Data) solo tienen el editor JSON.

Un JSON aplicado manda sobre los selectores y sobre las respuestas fijas del escenario hasta que cambies un selector, apliques otro escenario o pulses *Discard custom JSON*. Ojo: el JSON aplicado es literal, así que campos como `updatedAt` quedan con el valor que tengan en el texto. Si guardas un escenario nuevo con un JSON aplicado, ese JSON se guarda en sus `routes`.

### RVS: campos de `state`

| Campos | Valores |
|---|---|
| `locked` | `true`, `false` |
| `lights`, `engine` | `"on"`, `"off"`, `"unknown"`, `null` |
| `hood`, `trunk`, `sunRoof`, `doorFrontLeft/FrontRight/RearLeft/RearRight`, `windowFrontLeft/FrontRight/RearLeft/RearRight` | `"open"`, `"closed"`, `"unknown"`, `null` |

Por defecto todo está cerrado y apagado, incluido el techo solar; el motor no se envía. `null` significa que el campo no se envía y la app no lo muestra.

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
- `PUT /api/features/{feature}/state` con `{"lights":"on"}`: cambia campos sueltos.
- `PUT /api/features/{feature}/routes` con `{"routes":[…]}`: aplica un JSON escrito a mano (el editor JSON de la web). `DELETE` en la misma ruta lo descarta.
- `POST /api/features/{feature}/reset`: quita el escenario de esa feature.
- `POST /api/reset`: restablece todas las features.
- `GET /api/charles`: estado de Map Remote en Charles.
- `POST /api/charles/map-remote` con `{"enabled":false}`: activa o desactiva Map Remote.
