#!/usr/bin/env node
/**
 * Starts all frontend dev servers in a single container.
 *
 * - Ember admin: `pnpm dev` (its own server, critical — if it dies, container dies)
 * - UMD apps: `pnpm build:watch` + a lightweight static file server
 *   for the generated `umd/` directory
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '../..');

// UMD apps config — ports match what Caddy proxies to
const umdApps = [
    {
        name: 'Portal',
        cwd: path.join(rootDir, 'apps/portal'),
        previewPort: 5173,
        buildOutput: 'umd/portal.min.js',
        // true = use `pnpm build:watch`, array = use individual scripts, false = use direct vite command
        buildCmd: 'build:watch',
        extraScripts: [],
    },
    {
        name: 'Comments UI',
        cwd: path.join(rootDir, 'apps/comments-ui'),
        previewPort: 5174,
        buildOutput: 'umd/comments-ui.min.js',
        buildCmd: 'build:watch',
        extraScripts: [],
    },
    {
        name: 'Signup Form',
        cwd: path.join(rootDir, 'apps/signup-form'),
        previewPort: 5175,
        buildOutput: 'umd/signup-form.min.js',
        buildCmd: ['exec', 'vite', 'build', '--watch'],  // no standalone build:watch script
        extraScripts: [],
    },
    {
        name: 'Sodo Search',
        cwd: path.join(rootDir, 'apps/sodo-search'),
        previewPort: 5176,
        buildOutput: 'umd/sodo-search.min.js',
        buildCmd: 'build:watch',
        extraScripts: ['tailwind'],
    },
    {
        name: 'Announcement Bar',
        cwd: path.join(rootDir, 'apps/announcement-bar'),
        previewPort: 5177,
        buildOutput: 'umd/announcement-bar.min.js',
        buildCmd: 'build:watch',
        extraScripts: [],
    },
];

/**
 * Start a background process. Logs output but does NOT kill the parent on exit.
 */
function startBackground(label, cwd, cmd, args) {
    const child = spawn(cmd, args, {
        cwd,
        stdio: 'inherit',
        env: { ...process.env },
    });
    child.on('error', (err) => console.error(`[${label}] Error: ${err.message}`));
    child.on('exit', (code, signal) =>
        console.log(`[${label}] Exited (non-fatal): code=${code} signal=${signal}`)
    );
    return child;
}

/**
 * Start a critical process. If it exits, the whole container shuts down.
 */
function startCritical(label, cwd, cmd, args) {
    const child = spawn(cmd, args, {
        cwd,
        stdio: 'inherit',
        env: { ...process.env },
    });
    child.on('error', (err) => {
        console.error(`[${label}] Fatal error: ${err.message}`);
        process.exit(1);
    });
    child.on('exit', (code, signal) => {
        console.log(`[${label}] Exited — shutting down container. code=${code} signal=${signal}`);
        process.exit(code ?? 1);
    });
    return child;
}

function getContentType(filePath) {
    const ext = path.extname(filePath);

    switch (ext) {
    case '.js':
        return 'application/javascript; charset=utf-8';
    case '.css':
        return 'text/css; charset=utf-8';
    case '.json':
    case '.map':
        return 'application/json; charset=utf-8';
    case '.svg':
        return 'image/svg+xml';
    case '.png':
        return 'image/png';
    default:
        return 'application/octet-stream';
    }
}

function startStaticServer(label, rootDir, port) {
    const resolvedRoot = path.resolve(rootDir);

    const server = http.createServer((req, res) => {
        const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const relativePath = requestPath.replace(/^\/+/, '');
        const filePath = path.resolve(resolvedRoot, relativePath);

        if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, file) => {
            if (err) {
                res.writeHead(err.code === 'ENOENT' ? 404 : 500);
                res.end(err.code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
                return;
            }

            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': getContentType(filePath)
            });
            res.end(file);
        });
    });

    server.on('error', (err) => {
        console.error(`[${label}] Error: ${err.message}`);
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`[${label}] Serving ${resolvedRoot} on port ${port}`);
    });
}

/**
 * Poll until a file exists, then call cb. Timeout after `timeoutMs`.
 */
function waitForFile(filePath, intervalMs, timeoutMs, cb) {
    const start = Date.now();
    const timer = setInterval(() => {
        if (fs.existsSync(filePath)) {
            clearInterval(timer);
            cb(null);
        } else if (Date.now() - start > timeoutMs) {
            clearInterval(timer);
            cb(new Error(`Timed out waiting for ${filePath}`));
        }
    }, intervalMs);
}

console.log('=== Starting all frontend dev servers in container ===\n');

// ── Ember admin (build watcher) ────────────────────────────────────────────
// Ember rebuilds to ghost/admin/dist on file changes; apps/admin picks up
// those assets via vite-ember-assets.ts. Not the primary /ghost* server.
console.log('[Admin (Ember)] Starting build watcher on port 4200…');
startBackground('Admin (Ember)', path.join(rootDir, 'ghost/admin'), 'pnpm', ['dev']);

// ── React admin shell (critical) ───────────────────────────────────────────
// apps/admin embeds Ember assets via vite-ember-assets.ts which reads
// ghost/admin/dist/index.html on every request. Start only after Ember's
// first build completes so assets are available immediately.
const emberDistIndex = path.join(rootDir, 'ghost/admin/dist/index.html');
console.log('[Admin (React)] Waiting for Ember first build (ghost/admin/dist/index.html)…');
waitForFile(emberDistIndex, 2000, 300000, (err) => {
    if (err) {
        console.error(`[Admin (React)] ${err.message} — cannot start React admin shell`);
        process.exit(1);
    }
    console.log('[Admin (React)] Ember build ready, starting React admin shell on port 5178…');
    startCritical('Admin (React)', path.join(rootDir, 'apps/admin'), 'pnpm', ['dev']);
});

// ── Koenig Lexical bundle (served from installed package dist) ────────────────
const koenigLexicalDist = path.join(rootDir, 'node_modules/@tryghost/koenig-lexical/dist');
if (fs.existsSync(koenigLexicalDist)) {
    startStaticServer('Koenig Lexical static', koenigLexicalDist, 4173);
} else {
    console.log('[Koenig Lexical] dist not found, skipping static server');
}

// ── UMD apps (non-critical — individual crashes won't kill Ember) ───────────
for (const app of umdApps) {
    const outputFile = path.join(app.cwd, app.buildOutput);

    // Build watcher — runs continuously in background
    const buildCmd = app.buildCmd;
    if (Array.isArray(buildCmd)) {
        startBackground(`${app.name} build:watch`, app.cwd, 'pnpm', buildCmd);
    } else {
        startBackground(`${app.name} build:watch`, app.cwd, 'pnpm', [buildCmd]);
    }

    // Extra watchers (e.g. tailwind for sodo-search)
    for (const script of app.extraScripts) {
        startBackground(`${app.name} ${script}`, app.cwd, 'pnpm', [script]);
    }

    // Static server — wait for first build output, then start
    console.log(`[${app.name}] Waiting for first build (${app.buildOutput})…`);
    waitForFile(outputFile, 2000, 300000, (err) => {
        if (err) {
            console.error(`[${app.name}] ${err.message} — skipping static server`);
            return;
        }
        console.log(`[${app.name}] Build ready, starting static server on port ${app.previewPort}`);
        startStaticServer(`${app.name} static`, path.dirname(outputFile), app.previewPort);
    });
}

console.log('\n=== Dev servers starting (UMD static servers come up after first build) ===');
console.log('Ghost frontend: http://localhost:2368');
console.log('Ghost admin:    http://localhost:2368/ghost/  (React shell → port 5178, Ember watcher → port 4200)');

process.on('SIGINT', () => { console.log('\nShutting down…'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\nShutting down…'); process.exit(0); });
