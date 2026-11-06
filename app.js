const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const features = require('./features');

const port = Number(process.env.PORT || 3000);
const SCENARIOS_DIR = path.join(__dirname, 'scenarios');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FEATURES = Object.fromEntries(features.map((f) => [f.id, f]));
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// ---------------------------------------------------------------------------
// In-memory state: one active scenario (and its state) per feature.
// override = routes typed by hand in the JSON editor; while set, they replace the scenario's fixed routes.
// ---------------------------------------------------------------------------
const runtime = {};
function resetFeature(f) {
    runtime[f.id] = { scenario: null, modified: false, state: { ...f.defaultState }, override: null };
}
features.forEach(resetFeature);

// ---------------------------------------------------------------------------
// Scenarios: scenarios/<feature>/<name>.json (files starting with "_" are ignored)
// They are read from disk on every call, so edits show up without a restart.
// ---------------------------------------------------------------------------
function validateScenario(feature, sc) {
    if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) return ['The file must be a JSON object'];
    const errors = [];
    const allowed = Object.fromEntries(feature.fields.map((fl) => [fl.key, fl.options]));
    for (const [key, value] of Object.entries(sc.state || {})) {
        if (!(key in allowed)) errors.push(`state.${key}: unknown field in ${feature.name}`);
        else if (!allowed[key].includes(value)) errors.push(`state.${key}: invalid value (${JSON.stringify(value)})`);
    }
    if (sc.routes !== undefined) errors.push(...validateRoutes(sc.routes));
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
    if (rt.override) return rt.override;
    if (!rt.scenario) return [];
    const { scenario } = readScenario(f, rt.scenario);
    return scenario && scenario.routes ? scenario.routes : [];
}

// Everything this feature answers right now, in the order it is served: fixed routes first,
// then the routes generated from the selectors that no fixed route replaces.
function effectiveRoutes(f) {
    const rt = runtime[f.id];
    const fixed = fixedRoutesOf(f);
    const generated = (f.routes || [])
        .filter((g) => !fixed.some((r) => String(r.method).toUpperCase() === g.method && r.path === g.path))
        .map((g) => ({ method: g.method, path: g.path, status: 200, body: g.build(rt.state, {}) }));
    return [...fixed, ...generated];
}

// "Modified" = there is a hand-written JSON, or the state differs from what the scenario (or the default) gives
function recomputeModified(f) {
    const rt = runtime[f.id];
    let base = f.defaultState;
    if (rt.scenario) {
        const { scenario } = readScenario(f, rt.scenario);
        base = { ...f.defaultState, ...((scenario && scenario.state) || {}) };
    }
    rt.modified = rt.override !== null || JSON.stringify(rt.state, Object.keys(rt.state).sort()) !== JSON.stringify(base, Object.keys(base).sort());
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
        description: f.description,
        paths: f.paths,
        fields: f.fields,
        scenario: rt.scenario,
        modified: rt.modified,
        state: rt.state,
        scenarios: Object.entries(scenarios).map(([key, sc]) => ({ key, name: sc.name || key, description: sc.description || '' })),
        errors,
        fixedRoutes: fixedRoutesOf(f).map((r) => `${String(r.method).toUpperCase()} ${r.path}`),
        // What is answered right now, as editable route objects (the JSON editor shows this)
        effectiveRoutes: effectiveRoutes(f),
        // Routes typed by hand in the JSON editor (null when the selectors / scenario are in control)
        overrideRoutes: rt.override,
        previews: effectiveRoutes(f).map((r) => ({ route: `${String(r.method).toUpperCase()} ${r.path}`, body: r.body })),
    };
}

app.get('/api/state', (_req, res) => {
    res.json({ features: features.map(describeFeature) });
});

// Change one or more fields: PUT /api/features/rvs/state {"lights":"on","doorFrontLeft":"open"}
app.put('/api/features/:id/state', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    const changes = req.body || {};
    const allowed = Object.fromEntries(f.fields.map((fl) => [fl.key, fl.options]));
    for (const [key, value] of Object.entries(changes)) {
        if (!(key in allowed)) return res.status(400).json({ error: `Unknown field: ${key}` });
        if (!allowed[key].includes(value)) return res.status(400).json({ error: `Invalid value for ${key}: ${value}`, allowed: allowed[key] });
    }
    const rt = runtime[f.id];
    rt.state = { ...rt.state, ...changes };
    rt.override = null; // touching a selector gives control back to the selectors
    recomputeModified(f);
    res.json({ feature: f.id, scenario: rt.scenario, modified: rt.modified, state: rt.state });
});

// Replace what the feature answers with routes written by hand (the JSON editor):
//   PUT /api/features/rvs/routes {"routes":[{"method":"GET","path":"/v2/vehicles/:vin/status","status":200,"body":{…}}]}
app.put('/api/features/:id/routes', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    const routes = (req.body || {}).routes;
    const errors = validateRoutes(routes);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    runtime[f.id].override = routes;
    recomputeModified(f);
    console.log(`[routes] ${f.id}: custom JSON applied (${routes.length} route${routes.length === 1 ? '' : 's'})`);
    res.json({ feature: f.id, scenario: runtime[f.id].scenario, modified: runtime[f.id].modified });
});

// Discard the hand-written JSON and go back to the selectors / scenario: DELETE /api/features/rvs/routes
app.delete('/api/features/:id/routes', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    runtime[f.id].override = null;
    recomputeModified(f);
    res.json({ feature: f.id, scenario: runtime[f.id].scenario, modified: runtime[f.id].modified });
});

function applyScenario(f, name, scenario) {
    runtime[f.id] = { scenario: name, modified: false, state: { ...f.defaultState, ...(scenario.state || {}) }, override: null };
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

// Leave a feature with no scenario and default state: POST /api/features/rvs/reset
app.post('/api/features/:id/reset', (req, res) => {
    const f = FEATURES[req.params.id];
    if (!f) return res.status(404).json({ error: `Unknown feature: ${req.params.id}` });
    resetFeature(f);
    res.json({ feature: f.id, scenario: null, modified: false, state: runtime[f.id].state });
});

// Reset every feature
app.post('/api/reset', (_req, res) => {
    features.forEach(resetFeature);
    console.log('[scenario] all features reset');
    res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Charles control (Web Interface: http://control.charles/)
// Enables/disables the whole Map Remote tool. It has to talk to Charles through
// its own proxy, which is why it connects to CHARLES_HOST:CHARLES_PORT.
// ---------------------------------------------------------------------------
const CHARLES_HOST = process.env.CHARLES_HOST || '127.0.0.1';
const CHARLES_PORT = Number(process.env.CHARLES_PORT || 8888);

function charlesRequest(urlPath) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: CHARLES_HOST, port: CHARLES_PORT, method: 'GET', path: `http://control.charles${urlPath}`, headers: { Host: 'control.charles' }, timeout: 3000 },
            (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => resolve({ status: res.statusCode, body }));
            },
        );
        req.on('timeout', () => req.destroy(new Error('Charles is not responding (timeout)')));
        req.on('error', reject);
        req.end();
    });
}

async function getMapRemote() {
    const { body } = await charlesRequest('/tools/map-remote/');
    const match = body.match(/Status:\s*(Enabled|Disabled)/i);
    if (!match) throw new Error("Could not read the Map Remote status (is Charles' Web Interface enabled?)");
    return match[1].toLowerCase() === 'enabled';
}

const charlesError = (e) => `Could not talk to Charles at ${CHARLES_HOST}:${CHARLES_PORT}: ${e.message}`;

app.get('/api/charles', async (_req, res) => {
    try {
        res.json({ available: true, mapRemote: await getMapRemote() });
    } catch (e) {
        res.json({ available: false, error: charlesError(e) });
    }
});

// POST /api/charles/map-remote {"enabled": true|false}
app.post('/api/charles/map-remote', async (req, res) => {
    if (typeof (req.body || {}).enabled !== 'boolean') return res.status(400).json({ error: 'Missing "enabled": true|false' });
    try {
        await charlesRequest(`/tools/map-remote/${req.body.enabled ? 'enable' : 'disable'}`);
        const mapRemote = await getMapRemote();
        console.log(`[charles] Map Remote ${mapRemote ? 'enabled' : 'disabled'}`);
        res.json({ available: true, mapRemote });
    } catch (e) {
        res.status(502).json({ available: false, error: charlesError(e) });
    }
});

// ---------------------------------------------------------------------------
// Routes the apps call (Charles -> Map Remote -> here)
// ---------------------------------------------------------------------------

// 1) Fixed responses from the active scenarios (any feature, method and path)
app.use((req, res, next) => {
    for (const f of features) {
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
    for (const f of features) {
        const route = (f.routes || []).find((r) => matches(r, req));
        if (!route) continue;
        const rt = runtime[f.id];
        console.log(`[generated] ${f.id}: ${req.method} ${req.path} (${rt.scenario || 'default'}${rt.modified ? ', modified' : ''})`);
        return res.json(route.build(rt.state, req));
    }
    next();
});

app.listen(port, () => {
    console.log(`ola-mocks listening on http://localhost:${port}`);
    for (const f of features) {
        const { scenarios, errors } = loadScenarios(f);
        console.log(`  ${f.name}: ${Object.keys(scenarios).join(', ') || 'no scenarios'}`);
        for (const [k, e] of Object.entries(errors)) console.warn(`  ⚠ ${f.id}/${k}.json: ${e.join('; ')}`);
    }
});
