# ola-mocks-tool

Servidor local para mockear las respuestas del backend de OLA (apps MyCupra y MySeat) y probar escenarios sin depender del BE real. Las apps llegan a este servidor a través de Charles (Map Remote); lo que no esté mockeado se reenvía al backend real.

## Puesta en marcha

**Requisitos:** Node 22.15 o superior y Charles.

```
git clone https://github.com/seatcode/ola-mocks-tool.git
cd ola-mocks-tool
npm install
npm start
```

Abre http://localhost:3000.

Usa `npm start` y no `node app.js`: el flag `--use-system-ca` hace que Node confíe en los certificados del sistema. Con la inspección TLS de la empresa (Zscaler), sin él las llamadas no mockeadas fallan con `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Al arrancar, el servidor avisa si no confía en el certificado del backend.

Opciones: `PORT=3100 npm start` (otro puerto) y `TARGET_HOST=https://otro.host npm start` (otro entorno; por defecto `https://ola.prod.code.seat.cloud.vwgroup.com`).

## Configurar Charles (una sola vez)

Una única regla en `Tools > Map Remote` manda todo el tráfico de la API al servidor, y es el servidor quien decide qué se mockea:

| | Protocolo | Host | Puerto | Path |
|---|---|---|---|---|
| **Map From** | `https` | `ola.prod.code.seat.cloud.vwgroup.com` | `443` | `/v*` (query vacía) |
| **Map To** | `http` | `localhost` | `3000` | vacío |

- El path de origen **no puede ser vacío ni `/*`**: Charles casaría también la petición `CONNECT` del túnel HTTPS y dejaría de funcionar todo (`SSL: Unsupported or unrecognized SSL message`).
- El host debe estar en `Proxy > SSL Proxying Settings`.
- Borra las reglas antiguas por ruta para que no se pisen.
- Para saltarte el servidor (por ejemplo, si no está arrancado), desactiva Map Remote en el menú `Tools`.

## Uso

A la izquierda están las **features** (Global, RVS, VHR › Maintenance, VHR › Warnings, Driving Data). Cada una tiene su propio escenario activo, así que puedes combinar uno distinto en cada una.

- **Escenario:** elige uno en la tarjeta *Scenarios* de la feature. El icono de flecha circular lo quita (o vuelve al escenario por defecto, si la feature tiene uno).
- **Selectores / JSON:** en la tarjeta *Response* de RVS ajustas campos sueltos (*Selectors*) o editas la respuesta de un endpoint a mano (*JSON*). Un JSON aplicado manda sobre el escenario y los selectores, solo para ese endpoint.
- **Mocking (por feature):** apagado, las peticiones de esa feature van al backend real. No borra su escenario ni su estado.
- **All mocks (cabecera):** pausa todos los mocks a la vez, sin tocar el estado de las features.
- **Restablecer todo:** vuelve cada feature a su escenario por defecto (o a ninguno) y enciende todos los mocks.
- **Tema:** claro/oscuro, arriba a la derecha.

Una feature sin escenario contesta con sus valores por defecto; si no tiene selectores, no hay nada que contestar y todo pasa al backend real. Si el backend real no responde, el servidor devuelve 502.

### Global: MOD y disponibilidad

- **Remote availability** (`online`, `offline`, `no-coverage`): responde `GET /v1/vehicles/:vin/remote-availability`.
- **MOD** (`mod3` por defecto, `mod4`, `mod5`): cambia las respuestas de las demás features sin depender del MOD real del coche. Los campos que no existen en ese MOD se desactivan (hoy, el motor de RVS solo existe en MOD4 y MOD5; los BEV no tienen aceite ni AdBlue en Maintenance). Los escenarios con `"mods"` que no incluyan el MOD elegido se atenúan y avisan al aplicarlos.
- **MOD restrictions** (`apply` por defecto, `ignore`): con `ignore` no se filtra nada por MOD.

### Global: Capabilities

Global sirve `GET /v1/user/:userId/vehicle/:vin/capabilities` y guarda el valor de cada capability una sola vez. Se editan en la tarjeta **Capabilities**, agrupadas por pantalla de la app (Vehicle Status: `state` y `vehicleHealth`; Driving Data: `tripStatistics`).

- Valores: `Default` (como el catálogo), `Active`, `Inactive`, `Inactive · <motivo>` y `Disabled (not sent)` (la app la trata como no disponible).
- **Situation** cambia todas a la vez (hoy: `insufficient-battery-level`). Lo fijado a mano en una capability manda sobre la situación.
- La respuesta parte de un catálogo por MOD (`catalogs/capabilities/mod3|mod4|mod5.json`), que se lee al arrancar. Para otro tipo de coche, copia un catálogo y ajústalo.
- El resto de capabilities y los `parameters` se editan en la pestaña JSON del endpoint.

## Escenarios

Cada escenario es un fichero JSON en `scenarios/<feature>/`, por ejemplo `scenarios/rvs/safe.json`.

- **Desde la web:** icono `+` en la tarjeta *Scenarios*. Guarda nombre, descripción, los valores actuales de los selectores y las respuestas fijas o JSON propios en vigor. Nunca sobrescribe uno existente y queda aplicado.
- **A mano:** copia `scenarios/_template.json` a la carpeta de su feature, quítale el `_` y edítalo. Aparece al recargar la web, sin reiniciar. Los ficheros que empiezan por `_` se ignoran.

Son ficheros del repo: haz commit de los que quieras compartir con el equipo.

```json
{
  "name": "Nombre en la web",
  "description": "Para qué sirve",
  "mods": ["mod4", "mod5"],
  "state": { "locked": false, "doorFrontLeft": "open" },
  "routes": [
    { "method": "GET", "path": "/v1/algo/:vin/capabilities", "status": 200, "delayMs": 0, "headers": {}, "body": {} }
  ]
}
```

- `mods` (opcional): MOD para los que vale. Sin ella, vale para todos.
- `state` (opcional): solo para features con selectores (hoy RVS y VHR › Maintenance). Lo que no pongas queda por defecto. Un campo que la feature no tenga impide aplicar el escenario. En Maintenance los campos son `inspectionDays`, `inspectionKm`, `oilDays`, `oilKm` y `adblueKm`.
- `routes` (opcional): respuestas fijas. `:nombre` casa un tramo de la ruta y `*` casa cualquier cosa. Una ruta fija gana a una generada por selectores. `status`, `headers` y `delayMs` sirven para probar errores (503, etc.) y estados de carga.

## Desarrollo

### Añadir una feature

Una **feature** es una unidad con su escenario, estado e interruptor *Mocking*. Sus endpoints dependen entre sí; los que no tienen relación van en features distintas. `group` las agrupa bajo un título (VHR contiene *Maintenance* y *Warnings*).

1. Copia `features/vhr-warnings.js` a `features/<nombre>.js` y ajusta `id`, `name`, `description` y `paths` (y `group`, si procede).
2. Regístrala en `features/index.js`.
3. Crea `scenarios/<id>/` con sus escenarios.

Para selectores en la web, define `fields` (ver `features/rvs.js` y `features/vhr-maintenance.js`) y `routes` con una función `build(state)`.

Con `defaultScenario: '<nombre-del-fichero-sin-.json>'` en el fichero de la feature, esta arranca con ese escenario y vuelve a él al restablecer. Los cambios en `features/*.js` necesitan reiniciar el servidor.

### API (para tests automáticos)

- `GET /api/state`: features con escenario activo, estado, escenarios disponibles y errores.
- `POST /api/features/{feature}/scenario/{nombre}`: aplica un escenario (nombre del fichero sin `.json`).
- `POST /api/features/{feature}/scenarios` con `{"name","description","state","routes"}`: crea el escenario y lo aplica.
- `PUT /api/features/{feature}/state` con `{"lights":"on"}`: cambia campos sueltos.
- `PUT|DELETE /api/features/{feature}/route`: aplica (`{"route":{…}}`) o descarta (`?method=GET&path=/ruta`) un JSON de un endpoint.
- `PUT|DELETE /api/features/{feature}/routes`: aplica (`{"routes":[…]}`) o quita todos los JSON a la vez.
- `POST /api/features/{feature}/mocking` con `{"enabled":false}`: enciende o apaga el mock de la feature.
- `POST /api/features/{feature}/reset`: vuelve la feature a su punto de partida y enciende el mock.
- `POST /api/mocking` con `{"enabled":false}`: interruptor general.
- `POST /api/reset`: restablece todas las features.
