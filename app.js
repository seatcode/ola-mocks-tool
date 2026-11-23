const express = require('express');
const fs = require('fs');
const tls = require('tls');
const proxy = require('express-http-proxy');
const path = require('path');
const features = require('./features');
const MODS = require('./features/mods');

const port = Number(process.env.PORT || 3000);
const SCENARIOS_DIR = path.join(__dirname, 'scenarios');
// Backend real al que se reenvía todo lo que no esté mockeado (cambia de entorno con TARGET_HOST)
const TARGET_HOST = (process.env.TARGET_HOST || 'https://ola.prod.code.seat.cloud.vwgroup.com').replace(/\/+$/, '');
const app = express();
// El JSON solo se interpreta en la API de control: el resto del tráfico se reenvía tal cual, sin tocar el cuerpo
app.use('/api', express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FEATURES = Object.fromEntries(features.map((f) => [f.id, f]));
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// A field is a dropdown (options: [...]) unless it says type: 'number' (free number input; null = not sent)
function isValidValue(fl, v) {
    if (fl.type === 'number') return v === null || (typeof v === 'number' && Number.isFinite(v));
    return fl.options.includes(v);
}
const isNullable = (fl) => fl.type === 'number' || fl.options.includes(null);
// Identity of a route: "GET /v2/vehicles/:vin/status"
const routeKey = (r) => `${String(r.method).toUpperCase()} ${r.path}`;

// ---------------------------------------------------------------------------
// In-memory state: one active scenario (and its state) per feature.
// overrides = routes typed by hand in the JSON editor, one per endpoint ({ "GET /path": route }); each one wins over the
// scenario's fixed route and over the route generated from the selectors for that same endpoint.
// mocking = true by default. false: the feature's requests go to the real backend (the scenario / state are kept for when it is switched on).
// Only the feature's switch (and a reset) changes it: applying a scenario or editing never switches it back on.
// ---------------------------------------------------------------------------
const runtime = {};
// The starting point of a feature: its defaultState and, if it declares one, its `defaultScenario`
// (the name of a file in scenarios/<id>/, without .json). Used at startup and by every reset.
function resetFeature(f) {
    runtime[f.id] = { scenario: null, modified: false, state: { ...f.defaultState }, overrides: {}, mocking: true };
    if (!f.defaultScenario) return;
    const { scenario, errors } = readScenario(f, f.defaultScenario);
    if (scenario) applyScenario(f, f.defaultScenario, scenario);
    else console.warn(`  ⚠ ${f.id}: default scenario "${f.defaultScenario}" could not be applied (${errors.join('; ')})`);
}
features.forEach(resetFeature);

// Master switch: false = every request goes to the real backend, whatever each feature has.
// The features keep their scenario / state / mocking flag, so switching it back on restores everything.
let mockingEnabled = true;

// ---------------------------------------------------------------------------
// Scenarios: scenarios/<feature>/<name>.json (files starting with "_" are ignored)
// They are read from disk on every call, so edits show up without a restart.
// ---------------------------------------------------------------------------
function validateScenario(feature, sc) {
    if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) return ['The file must be a JSON object'];
    const errors = [];
    const byKey = Object.fromEntries(feature.fields.map((fl) => [fl.key, fl]));
    for (const [key, value] of Object.entries(sc.state || {})) {
        // "*" sets every field of the feature at once; the specific keys then override it
        if (key === '*') {
            if (!feature.fields.length || !feature.fields.every((fl) => isValidValue(fl, value))) errors.push(`state.*: ${JSON.stringify(value)} is not valid for every field of ${feature.name}`);
        } else if (!(key in byKey)) errors.push(`state.${key}: unknown field in ${feature.name}`);
        else if (!isValidValue(byKey[key], value)) errors.push(`state.${key}: invalid value (${JSON.stringify(value)})`);
    }
    if (sc.routes !== undefined) errors.push(...validateRoutes(sc.routes));
    if (sc.mods !== undefined && !(Array.isArray(sc.mods) && sc.mods.every((m) => MODS.includes(m)))) {
        errors.push(`mods must be an array with values from: ${MODS.join(', ')}`);
    }
    return errors;
}

function validateRoutes(routes) {
    if (!Array.isArray(routes)) return ['routes must be an array'];
    const errors = [];
    routes.forEach((r, i) => {
        if (typeof r !== 'object' || r === null || Array.isArray(r)) return errors.push(`routes[${i}] must be an object`);
        if (!METHODS.includes(String(r.method).toUpperCase())) errors.push(`routes[${i}].method is not valid`);
        if (typeof r.path !== 'string' || !r.path.startsWith('/')) errors.push(`routes[${i}].path must start with /`);
    });
    return errors;
}

function readScenario(feature, name) {
    // name comes from the URL: only letters, numbers, dashes, dots and underscores (no paths)
    if (!/^[\w.-]+$/.test(name) || name.startsWith('_')) return { errors: [`Invalid scenario name: ${name}`] };
    try {
        const sc = JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, feature.id, `${name}.json`), 'utf8'));
        const errors = validateScenario(feature, sc);
        return errors.length ? { errors } : { scenario: sc };
    } catch (e) {
        return { errors: [e.code === 'ENOENT' ? `Unknown scenario: ${name}` : `Invalid JSON: ${e.message}`] };
    }
}

function loadScenarios(feature) {
    const scenarios = {};
    const errors = {};
    let files = [];
    try {
        files = fs.readdirSync(path.join(SCENARIOS_DIR, feature.id)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
    } catch { /* no folder */ }
    for (const file of files) {
        const name = file.replace(/\.json$/, '');
        const r = readScenario(feature, name);
        if (r.scenario) scenarios[name] = r.scenario;
        else errors[name] = r.errors;
    }
    return { scenarios, errors };
}

// "/v2/vehicles/:vin/status" -> regex. ":x" matches one segment, "*" matches anything
function routeToRegex(p) {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}/?$`);
}
const matches = (route, req) => String(route.method).toUpperCase() === req.method && routeToRegex(route.path).test(req.path);

function fixedRoutesOf(f) {
    const rt = runtime[f.id];
    const fromScenario = rt.scenario ? (readScenario(f, rt.scenario).scenario || {}).routes || [] : [];
    return [...Object.values(rt.overrides), ...fromScenario.filter((r) => !(routeKey(r) in rt.overrides))];
}

// A scenario state may use "*" (every field); the specific keys win over it
function expandState(f, st = {}) {
    if (!('*' in st)) return st;
    const { '*': all, ...rest } = st;
    return { ...Object.fromEntries(f.fields.map((fl) => [fl.key, all])), ...rest };
}

// MOD currently selected in the Global feature
const currentMod = () => (runtime.global ? runtime.global.state.mod : null);
// Global > MOD restrictions = ignore: nothing is filtered by MOD
const ignoreMods = () => Boolean(runtime.global && runtime.global.state.modRestrictions === 'ignore');
// A field marked with mods: [...] is not sent when a MOD outside that list is selected
const isUnavailable = (fl) => Boolean(fl.mods && currentMod() && !ignoreMods() && !fl.mods.includes(currentMod()));
// The state used to build responses: unavailable fields are dropped (null = not sent, or the field's unavailableValue)
function stateFor(f) {
    const s = { ...runtime[f.id].state };
    for (const fl of f.fields) {
        if (!isUnavailable(fl)) continue;
        if ('unavailableValue' in fl) s[fl.key] = fl.unavailableValue;
        else if (isNullable(fl)) s[fl.key] = null;
    }
    return s;
}
// What a route's build() gets besides the state
const buildContext = () => ({ mod: currentMod(), ignoreMods: ignoreMods() });

// Everything this feature answers right now, in the order it is served: fixed routes first,
// then the routes generated from the selectors that no fixed route replaces.
function effectiveRoutes(f) {
    const rt = runtime[f.id];
    const fixed = fixedRoutesOf(f);
    const generated = (f.routes || [])
        .filter((g) => !fixed.some((r) => String(r.method).toUpperCase() === g.method && r.path === g.path))
        .map((g) => ({ method: g.method, path: g.path, status: 200, body: g.build(stateFor(f), {}, buildContext()) }));
    return [...fixed, ...generated];
}

// "Modified" = there is a hand-written JSON, or the state differs from what the scenario (or the default) gives
function recomputeModified(f) {
    const rt = runtime[f.id];
    let base = f.defaultState;
    if (rt.scenario) {
        const { scenario } = readScenario(f, rt.scenario);
        const sc = expandState(f, scenario && scenario.state);
        base = { ...f.defaultState, ...sc };
    }
    rt.modified = Object.keys(rt.overrides).length > 0 || JSON.stringify(rt.state, Object.keys(rt.state).sort()) !== JSON.stringify(base, Object.keys(base).sort());
}

// "Door open (test)" -> "door-open-test". It becomes the file name.
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// ---------------------------------------------------------------------------
// Control API (used by the web UI and, later, by test automation)
// It goes before the mocked routes so a scenario can never override it.
// ---------------------------------------------------------------------------
function describeFeature(f) {
    const rt = runtime[f.id];
    const { scenarios, errors } = loadScenarios(f);
    return {
        id: f.id,
        name: f.name,
        group: f.group || null,
        // Only counts when that scenario exists and is valid (otherwise the feature starts with none)
        defaultScenario: f.defaultScenario && f.defaultScenario in scenarios ? f.defaultScenario : null,
        description: f.description,
        paths: f.paths,
        fields: f.fields.map((fl) => ({ ...fl, unavailable: isUnavailable(fl) })),
        // Global only: the capabilities card (capabilities grouped by the screen of the app they affect)
        capabilityGroups: f.capabilityGroups ? f.capabilityGroups.map((g) => ({
            name: g.name,
            items: g.items.map((i) => ({ key: `cap_${i.id}`, id: i.id, hint: i.hint })),
        })) : null,
        scenario: rt.scenario,
        mocking: rt.mocking,
        modified: rt.modified,
        state: rt.state,
        scenarios: Object.entries(scenarios).map(([key, sc]) => ({ key, name: sc.name || key, description: sc.description || '', mods: sc.mods || null })),
        errors,
        fixedRoutes: fixedRoutesOf(f).map((r) => `${String(r.method).toUpperCase()} ${r.path}`),
        // What is answered right now, as editable route objects (the JSON editor shows this)
        effectiveRoutes: effectiveRoutes(f),
        // Endpoints whose response was typed by hand in the JSON editor
        customKeys: Object.keys(rt.overrides),
        // Every fixed route in force (scenario + hand-written), what a new scenario saves
        currentFixedRoutes: fixedRoutesOf(f),
    };
}

app.get('/api/state', (_req, res) => {
    res.json({ mockingEnabled, target: TARGET_HOST, mod: currentMod(), ignoreMods: ignoreMods(), mods: MODS, features: features.map(describeFeature) });
});

// Change one or more fields: PUT /api/features/rvs/state {"lights":"on","doorFrontLeft":"open"}
app.put('/api/features/:id/state', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    const changes = req.body || {};
    const byKey = Object.fromEntries(f.fields.map((fl) => [fl.key, fl]));
    for (const [key, value] of Object.entries(changes)) {
        if (!(key in byKey)) return res.status(400).json({ error: `Unknown field: ${key}` });
        if (!isValidValue(byKey[key], value)) {
            return res.status(400).json({ error: `Invalid value for ${key}: ${JSON.stringify(value)}`, allowed: byKey[key].options || byKey[key].type });
        }
    }
    const rt = runtime[f.id];
    rt.state = { ...rt.state, ...changes };
    // touching a selector gives control back to the selectors for the endpoints they generate
    for (const g of f.routes || []) delete rt.overrides[routeKey(g)];
    recomputeModified(f);
    res.json({ feature: f.id, scenario: rt.scenario, modified: rt.modified, state: rt.state });
});

// Write the response of ONE endpoint by hand (the JSON editor), over the scenario and the selectors:
//   PUT /api/features/rvs/route {"route":{"method":"GET","path":"/v2/vehicles/:vin/status","status":200,"body":{…}}}
app.put('/api/features/:id/route', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    const route = (req.body || {}).route;
    const errors = validateRoutes([route]);
    if (errors.length) return res.status(400).json({ error: errors.join('; ').replace(/routes\[0\]/g, 'route') });
    runtime[f.id].overrides[routeKey(route)] = route;
    recomputeModified(f);
    console.log(`[route] ${f.id}: custom JSON applied to ${routeKey(route)}`);
    res.json({ feature: f.id, scenario: runtime[f.id].scenario, modified: runtime[f.id].modified });
});

// Discard the hand-written response of one endpoint: DELETE /api/features/rvs/route?method=GET&path=/v2/vehicles/:vin/status
app.delete('/api/features/:id/route', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    delete runtime[f.id].overrides[routeKey({ method: req.query.method, path: req.query.path })];
    recomputeModified(f);
    res.json({ feature: f.id, scenario: runtime[f.id].scenario, modified: runtime[f.id].modified });
});

// Replace ALL the hand-written responses at once: PUT /api/features/rvs/routes {"routes":[…]}
app.put('/api/features/:id/routes', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    const routes = (req.body || {}).routes;
    const errors = validateRoutes(routes);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    runtime[f.id].overrides = Object.fromEntries(routes.map((r) => [routeKey(r), r]));
    recomputeModified(f);
    console.log(`[route] ${f.id}: ${routes.length} custom response${routes.length === 1 ? '' : 's'} applied`);
    res.json({ feature: f.id, scenario: runtime[f.id].scenario, modified: runtime[f.id].modified });
});

// Discard every hand-written response of the feature: DELETE /api/features/rvs/routes
app.delete('/api/features/:id/routes', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    runtime[f.id].overrides = {};
    recomputeModified(f);
    res.json({ feature: f.id, scenario: runtime[f.id].scenario, modified: runtime[f.id].modified });
});

function applyScenario(f, name, scenario) {
    runtime[f.id] = { scenario: name, modified: false, state: { ...f.defaultState, ...expandState(f, scenario.state) }, overrides: {}, mocking: runtime[f.id].mocking };
    console.log(`[scenario] ${f.id}: ${name}`);
}

// Apply a scenario: POST /api/features/rvs/scenario/safe
app.post('/api/features/:id/scenario/:name', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    const { scenario, errors } = readScenario(f, req.params.name);
    if (!scenario) return res.status(404).json({ error: errors.join('; '), available: Object.keys(loadScenarios(f).scenarios) });
    applyScenario(f, req.params.name, scenario);
    res.json({ feature: f.id, scenario: req.params.name, modified: false, state: runtime[f.id].state });
});

// Create a scenario file and apply it:
//   POST /api/features/rvs/scenarios {"name":"Door open","description":"…","state":{…},"routes":[…]}
// The file is written to scenarios/<feature>/<slug-of-name>.json (it never overwrites an existing one).
app.post('/api/features/:id/scenarios', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) return res.status(400).json({ error: 'A name is required (80 characters at most)' });
    const key = slugify(name);
    if (!key) return res.status(400).json({ error: 'The name must contain letters or numbers' });

    const sc = { name };
    if (typeof body.description === 'string' && body.description.trim()) sc.description = body.description.trim();
    if (body.state !== undefined) sc.state = body.state;
    if (body.routes !== undefined) sc.routes = body.routes;
    if (Array.isArray(body.mods) && body.mods.length) sc.mods = body.mods;
    const errors = validateScenario(f, sc);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    if (!f.fields.length && !(sc.routes && sc.routes.length)) {
        return res.status(400).json({ error: `${f.name} scenarios need at least one fixed route` });
    }

    try {
        fs.mkdirSync(path.join(SCENARIOS_DIR, f.id), { recursive: true });
        fs.writeFileSync(path.join(SCENARIOS_DIR, f.id, `${key}.json`), JSON.stringify(sc, null, 2) + '\n', { flag: 'wx' });
    } catch (e) {
        if (e.code === 'EEXIST') return res.status(409).json({ error: `A scenario called "${key}" already exists` });
        return res.status(500).json({ error: `Could not save the scenario: ${e.message}` });
    }
    console.log(`[scenario] created ${f.id}/${key}.json`);
    applyScenario(f, key, sc);
    res.status(201).json({ feature: f.id, scenario: key, modified: false, state: runtime[f.id].state });
});

// Switch a feature's mocks on or off (off = its requests go to the real backend):
//   POST /api/features/rvs/mocking {"enabled": false}
app.post('/api/features/:id/mocking', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    if (typeof (req.body || {}).enabled !== 'boolean') return res.status(400).json({ error: 'Missing "enabled": true|false' });
    runtime[f.id].mocking = req.body.enabled;
    console.log(`[mocking] ${f.id}: ${req.body.enabled ? 'on' : 'off (real backend)'}`);
    res.json({ feature: f.id, mocking: runtime[f.id].mocking });
});

// Leave a feature with no scenario and default state: POST /api/features/rvs/reset
app.post('/api/features/:id/reset', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    resetFeature(f);
    res.json({ feature: f.id, scenario: null, modified: false, state: runtime[f.id].state });
});

// Master switch: POST /api/mocking {"enabled": false} sends everything to the real backend
app.post('/api/mocking', (req, res) => {
    if (typeof (req.body || {}).enabled !== 'boolean') return res.status(400).json({ error: 'Missing "enabled": true|false' });
    mockingEnabled = req.body.enabled;
    console.log(`[mocking] all mocks ${mockingEnabled ? 'on' : 'paused (everything goes to the real backend)'}`);
    res.json({ mockingEnabled });
});

// Reset every feature (and switch the master switch back on)
app.post('/api/reset', (_req, res) => {
    features.forEach(resetFeature);
    mockingEnabled = true;
    console.log('[scenario] all features reset');
    res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Routes the apps call (Charles -> Map Remote -> here)
// ---------------------------------------------------------------------------

// 1) Fixed responses from the active scenarios (any feature, method and path)
app.use((req, res, next) => {
    if (!mockingEnabled) return next();
    for (const f of features) {
        if (!runtime[f.id].mocking) continue;
        const route = fixedRoutesOf(f).find((r) => matches(r, req));
        if (!route) continue;
        console.log(`[fixed] ${f.id}: ${req.method} ${req.path} -> ${route.status || 200} (${runtime[f.id].scenario})`);
        const send = () => {
            if (route.headers) res.set(route.headers);
            res.status(route.status || 200).json(route.body === undefined ? {} : route.body);
        };
        return route.delayMs ? setTimeout(send, route.delayMs) : send();
    }
    next();
});

// 2) Responses generated from each feature's state (selectors)
app.use((req, res, next) => {
    if (!mockingEnabled) return next();
    for (const f of features) {
        if (!runtime[f.id].mocking) continue;
        const route = (f.routes || []).find((r) => matches(r, req));
        if (!route) continue;
        const rt = runtime[f.id];
        console.log(`[generated] ${f.id}: ${req.method} ${req.path} (${rt.scenario || 'default'}${rt.modified ? ', modified' : ''})`);
        return res.json(route.build(stateFor(f), req, buildContext()));
    }
    next();
});

// 3) Everything else goes to the real backend, untouched
const CERT_ERRORS = /CERT|SELF_SIGNED|ISSUER/;
app.use(
    (req, res, next) => {
        res.on('finish', () => console.log(`[real] ${req.method} ${req.originalUrl} -> ${res.statusCode}`));
        next();
    },
    proxy(TARGET_HOST, {
        limit: '20mb',
        timeout: 30000,
        proxyErrorHandler: (err, res) => {
            console.warn(`[real] could not reach ${TARGET_HOST}: ${err.code || err.message}`);
            const hint = CERT_ERRORS.test(err.code || '') ? ' Node does not trust the certificate of that host (corporate TLS inspection?). Start the server with "npm start" so it uses the system certificates.' : '';
            res.status(502).json({ error: `Could not reach the real backend (${TARGET_HOST}): ${err.code || err.message}.${hint}` });
        },
    }),
);

// Opens (and closes) a TLS connection to the real backend to warn early about certificate problems.
// It sends no request.
function checkBackendTls() {
    let u;
    try { u = new URL(TARGET_HOST); } catch { return; }
    if (u.protocol !== 'https:') return;
    const sock = tls.connect({ host: u.hostname, port: Number(u.port) || 443, servername: u.hostname, timeout: 8000 }, () => sock.end());
    sock.on('error', (e) => {
        if (CERT_ERRORS.test(e.code || '')) {
            console.warn(`  ⚠ Node does not trust the certificate of ${u.host} (${e.code}). Corporate TLS inspection? Start with "npm start" (it uses the system certificates) instead of "node app.js".`);
        } else {
            console.warn(`  ⚠ Could not reach ${u.host} to check its certificate (${e.code || e.message}); VPN or network?`);
        }
    });
    sock.on('timeout', () => sock.destroy());
}

app.listen(port, () => {
    console.log(`ola-mocks-tool listening on http://localhost:${port}`);
    console.log(`  Real backend (anything not mocked): ${TARGET_HOST}`);
    checkBackendTls();
    for (const f of features) {
        const { scenarios, errors } = loadScenarios(f);
        console.log(`  ${f.name}: ${Object.keys(scenarios).join(', ') || 'no scenarios'}`);
        for (const [k, e] of Object.entries(errors)) console.warn(`  ⚠ ${f.id}/${k}.json: ${e.join('; ')}`);
    }
});
