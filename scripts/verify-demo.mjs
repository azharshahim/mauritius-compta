#!/usr/bin/env node
/**
 * COMPTAI — verification of the demo publication (Mission 31).
 *
 * The old GitHub Pages workflow assumed that every marker lived in the single
 * JavaScript file referenced by index.html. Since Mission 30 the demo engine is
 * a dynamically imported chunk (`runtime-*.js`), so this verifier builds a
 * corpus from every JS chunk reachable from the entry bundle and validates:
 *
 *   - the HTML entry, its JS/CSS assets and the /mauritius-compta/ base path;
 *   - the PWA manifest, icons (192/512 + maskable), favicon, sw.js and 404.html;
 *   - the fictional samples and the demo markers (including dynamic chunks);
 *   - the absence of the legacy "Mauritius Business Suite" brand;
 *   - the published version/commit and the security scan for secrets.
 *
 * It works either against a local build (`--dist`) or the real HTTPS site
 * (`--url`), and provides an explicit failure line for every control:
 *   ::error title=<control>::<resource> — <message>
 *
 * No dependency is required beyond Node 20+ (fetch is built in).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const SAMPLE_FILES = [
  'balance-ouverture-fictive.csv',
  'clients-fictifs.csv',
  'export-sage-fictif.csv',
  'export-sap-fictif-semicolon.csv',
  'export-sap-fictif.csv',
  'fichier-incorrect.csv',
  'journal-fictif.csv',
  'plan-comptable-fictif.csv',
  'plan-comptable-fictif.xlsx',
  'releve-bancaire-doublons.csv',
  'releve-bancaire-erreurs.csv',
  'releve-bancaire-fictif.csv',
  'releve-bancaire-fictif.xlsx',
];

const DEMO_TOKEN_GROUPS = {
  'marqueurs de démonstration': ['MODE DÉMONSTRATION', 'Simulation IA'],
  'état local fictif': ['mc.demo.state.v1'],
  'TVA et paramètres de démonstration': [
    'Taux de démonstration 15',
    'Paramètres société',
    'VAT_SOURCE_REQUIRED',
  ],
  'migration fictive': [
    'Assistant de migration comptable',
    'Importation & migration',
    'MIGRATION_BLOCKED',
  ],
  'banque et rapprochement': [
    'Banque & rapprochement',
    'Banque et trésorerie',
    'Importer un relevé MCB',
    'Importer un relevé bancaire PDF',
    'Import bank statement',
    'Retour au Journal de banque',
    'Confirmer le rapprochement',
    'Libellé de paie détecté',
    'Import bloqué',
  ],
  'documents et données fictives': [
    'Documents — consultation et archives',
    'ACME OFFICE SUPPLIES LTD',
    'PLH-2210',
    'Vieux Grand Port Logistics',
    'FAC-DEMO-0002',
    'FA-2025-0001',
    'Pick-up utilitaire',
    'Local en construction',
  ],
  'missions 24 à 27': [
    'Assistant IA',
    'Immobilisations et amortissements',
    'Mappings comptables',
    'Proposer les mouvements de stock',
    'MRA e-Invoicing — À venir',
    'MRA e-Invoicing — Coming Soon',
    'Intégration MRA non activée',
    'MRA integration is not enabled',
    'Journal des achats',
    'Importer une facture d’achat',
    'Balance âgée',
    'Écritures proposées',
    'AI_PROPOSAL_NOT_VALIDATED',
    'SETTINGS_FINANCIAL_YEAR_LOCKED',
    'text/comma-separated-values',
    'application/octet-stream',
  ],
};

const SECRET_PATTERN = /sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Argument inattendu : ${token}`);
    const key = token.slice(2);
    if (key === 'help') {
      args.help = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Valeur manquante pour --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function normalizeBase(value) {
  const base = (value || '/mauritius-compta/').trim();
  const withLeading = base.startsWith('/') ? base : `/${base}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function escapeAnnotation(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function attr(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function resolvePath(reference, documentPath) {
  const url = new URL(reference, `https://comptai.invalid${documentPath}`);
  return `${url.pathname}${url.search}${url.hash}`;
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.subarray(1, 4).toString('ascii') !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

class Verifier {
  constructor() {
    this.passed = 0;
    this.failures = [];
  }

  async check(name, resource, fn) {
    try {
      const detail = await fn();
      this.passed += 1;
      console.log(`OK   ${name} — ${resource}${detail ? ` — ${detail}` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failures.push({ name, resource, message });
      console.error(`FAIL ${name} — ${resource} — ${message}`);
      console.error(`::error title=${escapeAnnotation(name)}::${escapeAnnotation(`${resource} — ${message}`)}`);
    }
  }

  summary() {
    console.log(`\n${this.passed} contrôle(s) réussi(s), ${this.failures.length} échec(s).`);
    for (const failure of this.failures) {
      console.error(`- ${failure.name} — ${failure.resource} — ${failure.message}`);
    }
    if (this.failures.length > 0) process.exitCode = 1;
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

class LocalSource {
  constructor(root) {
    this.root = resolve(root);
    this.label = `build local ${this.root}`;
  }

  pathFor(pathname) {
    const withoutQuery = pathname.split('?')[0];
    const base = '/mauritius-compta/';
    const relativePath = withoutQuery.startsWith(base)
      ? withoutQuery.slice(base.length)
      : withoutQuery.replace(/^\/+/, '');
    const file = resolve(this.root, relativePath || 'index.html');
    requireCondition(file === this.root || file.startsWith(`${this.root}/`), `Chemin hors du build : ${pathname}`);
    return file;
  }

  async get(pathname) {
    const file = this.pathFor(pathname);
    if (existsSync(file) && statSync(file).isDirectory()) {
      const index = join(file, 'index.html');
      if (existsSync(index)) return { status: 200, body: readFileSync(index), contentType: 'text/html', url: pathname };
    }
    if (existsSync(file)) {
      return { status: 200, body: readFileSync(file), contentType: '', url: pathname };
    }
    const notFound = join(this.root, '404.html');
    return {
      status: 404,
      body: existsSync(notFound) ? readFileSync(notFound) : Buffer.from(''),
      contentType: 'text/html',
      url: pathname,
    };
  }
}

class RemoteSource {
  constructor(siteUrl) {
    this.site = new URL(siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`);
    this.label = this.site.toString();
  }

  urlFor(pathname) {
    return new URL(pathname, this.site).toString();
  }

  async get(pathname, { retry = 0 } = {}) {
    const url = this.urlFor(pathname);
    let lastError;
    for (let attempt = 0; attempt <= retry; attempt += 1) {
      try {
        const response = await this.fetchOnce(url);
        // Return the last HTTP response even for 404/5xx: callers need the
        // status and body (the /entries fallback is expected to answer 404).
        if (response.status === 200 || attempt === retry) return response;
      } catch (error) {
        lastError = error;
      }
      if (attempt < retry) await sleep(2500);
    }
    throw lastError ?? new Error(`Échec de récupération de ${url}`);
  }

  async fetchOnce(url) {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
      headers: { 'user-agent': 'COMPTAI-pages-verifier/1.0' },
    });
    return {
      status: response.status,
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || '',
      url: response.url,
    };
  }
}

async function waitForIndex(source, waitSeconds) {
  if (source instanceof LocalSource) {
    const response = await source.get('/mauritius-compta/index.html');
    return response;
  }
  const deadline = Date.now() + waitSeconds * 1000;
  let attempt = 0;
  let last;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      last = await source.get('/mauritius-compta/');
      console.log(`Attente GitHub Pages — tentative ${attempt}: HTTP ${last.status}`);
      if (last.status === 200) return last;
    } catch (error) {
      last = { status: 'network', body: Buffer.from(''), url: source.urlFor('/mauritius-compta/'), error };
      console.log(`Attente GitHub Pages — tentative ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(5000);
  }
  throw new Error(
    `index.html toujours indisponible après ${waitSeconds}s — dernier statut : ${last?.status ?? 'inconnu'}`,
  );
}

function htmlLinks(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => attr(match[0], 'src'))
    .filter(Boolean);
  const styles = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((match) => /\brel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet)/i.test(match[0]))
    .map((match) => attr(match[0], 'href'))
    .filter(Boolean);
  const icons = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((match) => /\brel\s*=\s*(?:"[^"]*\bicon\b[^"]*"|'[^']*\bicon\b[^']*'|[^\s>]*icon[^\s>]*)/i.test(match[0]))
    .map((match) => ({ rel: attr(match[0], 'rel'), href: attr(match[0], 'href'), sizes: attr(match[0], 'sizes') }))
    .filter((link) => link.href);
  const manifest = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((match) => /\brel\s*=\s*(?:"manifest"|'manifest'|manifest)/i.test(match[0]))
    .map((match) => attr(match[0], 'href'))
    .filter(Boolean);
  const browserConfig = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .filter((match) => /\bname\s*=\s*(?:"msapplication-config"|'msapplication-config'|msapplication-config)/i.test(match[0]))
    .map((match) => attr(match[0], 'content'))
    .filter(Boolean);
  return { scripts, styles, icons, manifest, browserConfig };
}

function isUnderBase(pathname, base) {
  return pathname === base.slice(0, -1) || pathname.startsWith(base);
}

async function verifyDemo(source, options) {
  const verifier = new Verifier();
  const { base, expectedCommit } = options;

  let index;
  try {
    index = await waitForIndex(source, options.waitSeconds);
  } catch (error) {
    console.error(`::error title=Publication inaccessible::${escapeAnnotation(String(error))}`);
    console.error(String(error));
    process.exit(1);
  }

  const indexHtml = index.body.toString('utf8');
  const indexPath = `${base}index.html`;
  const links = htmlLinks(indexHtml);

  await verifier.check('index.html accessible', source.label, async () => {
    requireCondition(index.status === 200, `HTTP ${index.status} (attendu 200)`);
    return `HTTP 200, ${index.body.length} octets`;
  });

  await verifier.check('Titre et marque COMPTAI', indexPath, async () => {
    requireCondition(/<title>\s*COMPTAI\s*<\/title>/i.test(indexHtml), 'titre COMPTAI absent');
    requireCondition(indexHtml.includes('COMPTAI'), 'marque COMPTAI absente de index.html');
  });

  await verifier.check('Manifeste référencé par index.html', indexPath, async () => {
    requireCondition(links.manifest.length > 0, 'aucun <link rel="manifest">');
    return links.manifest.join(', ');
  });

  const assets = [];
  for (const reference of [...links.scripts, ...links.styles]) {
    const assetPath = resolvePath(reference, indexPath);
    await verifier.check(`Ressource référencée ${basename(assetPath)}`, assetPath, async () => {
      requireCondition(isUnderBase(assetPath, base), `chemin hors du préfixe ${base}`);
      const response = await source.get(assetPath, { retry: source instanceof RemoteSource ? 3 : 0 });
      requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
      requireCondition(response.body.length > 0, 'fichier vide');
      assets.push({ path: assetPath, body: response.body, contentType: response.contentType });
      return `HTTP 200, ${response.body.length} octets`;
    });
  }

  const entry = assets.find((asset) => asset.path.endsWith('.js'));
  if (!entry) {
    console.error('::error title=Bundle principal::Aucun script JavaScript accessible depuis index.html');
    process.exit(1);
  }

  const jsCorpus = new Map([[entry.path, entry.body.toString('utf8')]]);
  const queue = [{ path: entry.path, text: jsCorpus.get(entry.path) }];
  while (queue.length > 0) {
    const current = queue.shift();
    const references = new Set();
    for (const match of current.text.matchAll(/["'](\.\/[A-Za-z0-9._-]+\.js)["']/g)) references.add(match[1]);
    for (const match of current.text.matchAll(/["'](\/mauritius-compta\/assets\/[A-Za-z0-9._-]+\.js)["']/g)) references.add(match[1]);
    for (const reference of references) {
      const chunkPath = resolvePath(reference, current.path);
      if (jsCorpus.has(chunkPath)) continue;
      await verifier.check(`Chunk JavaScript dynamique ${basename(chunkPath)}`, chunkPath, async () => {
        requireCondition(isUnderBase(chunkPath, base), `chemin hors du préfixe ${base}`);
        const response = await source.get(chunkPath, { retry: source instanceof RemoteSource ? 3 : 0 });
        requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
        requireCondition(response.body.length > 0, 'fichier vide');
        const text = response.body.toString('utf8');
        jsCorpus.set(chunkPath, text);
        queue.push({ path: chunkPath, text });
        return `HTTP 200, ${response.body.length} octets`;
      });
    }
  }

  const allJs = [...jsCorpus.values()].join('\n');
  const jsFiles = [...jsCorpus.keys()].map((path) => basename(path)).join(', ');
  const runtimePath = [...jsCorpus.keys()].find((path) => /(?:^|\/)runtime-[^/]+\.js$/.test(path));
  const runtimeText = runtimePath ? jsCorpus.get(runtimePath) : '';

  await verifier.check('Marque COMPTAI dans le bundle', entry.path, async () => {
    requireCondition(jsCorpus.get(entry.path).includes('COMPTAI'), 'COMPTAI absent du bundle principal');
  });

  await verifier.check('Ancienne marque MBS absente', 'tous les chunks JS', async () => {
    requireCondition(!/Mauritius Business Suite|Mauritius Compta/.test(allJs), 'ancienne marque encore présente dans le bundle');
  });

  await verifier.check('Version et commit publiés', entry.path, async () => {
    requireCondition(jsCorpus.get(entry.path).includes('Version'), 'libellé Version absent');
    if (expectedCommit) {
      const shortCommit = expectedCommit.slice(0, 7);
      requireCondition(jsCorpus.get(entry.path).includes(shortCommit), `commit attendu ${shortCommit} absent`);
      return `commit ${shortCommit}`;
    }
    return 'commit non fourni (mode local)';
  });

  await verifier.check('Chargement différé du moteur de démonstration', jsFiles, async () => {
    requireCondition(Boolean(runtimePath), 'aucun chunk runtime-*.js découvert depuis le bundle principal');
    requireCondition(runtimeText.includes('mc.demo.state.v1'), 'état de démonstration absent du chunk runtime');
    return runtimePath;
  });

  for (const [group, tokens] of Object.entries(DEMO_TOKEN_GROUPS)) {
    await verifier.check(`Fonctionnalités — ${group}`, jsFiles, async () => {
      const missing = tokens.filter((token) => !allJs.includes(token));
      requireCondition(missing.length === 0, `introuvable(s) : ${missing.join(', ')}`);
    });
  }

  await verifyManifest(verifier, source, base, links, indexPath);
  await verifyStaticPwa(verifier, source, base, links);
  await verifySamples(verifier, source, base);
  await verifyNotFound(verifier, source, base);
  await verifySecrets(verifier, allJs, indexHtml, jsCorpus.size);

  verifier.summary();
  return verifier;
}

async function verifyManifest(verifier, source, base, links, indexPath) {
  const manifestHref = links.manifest[0];
  if (!manifestHref) return;
  const manifestPath = resolvePath(manifestHref, indexPath);
  let manifest;
  await verifier.check('Manifeste PWA accessible', manifestPath, async () => {
    requireCondition(isUnderBase(manifestPath, base), `chemin hors du préfixe ${base}`);
    const response = await source.get(manifestPath, { retry: source instanceof RemoteSource ? 3 : 0 });
    requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
    try {
      manifest = JSON.parse(response.body.toString('utf8'));
    } catch (error) {
      throw new Error(`JSON invalide : ${error instanceof Error ? error.message : String(error)}`);
    }
    return `HTTP 200, ${response.body.length} octets`;
  });
  if (!manifest) return;

  await verifier.check('Nom du manifeste', manifestPath, async () => {
    requireCondition(manifest.name === 'COMPTAI', `name="${manifest.name}" (attendu COMPTAI)`);
    requireCondition(manifest.short_name === 'COMPTAI', `short_name="${manifest.short_name}" (attendu COMPTAI)`);
    requireCondition(manifest.display === 'standalone', `display="${manifest.display}"`);
  });

  await verifier.check('Portée et démarrage du manifeste', manifestPath, async () => {
    for (const field of ['start_url', 'scope']) {
      requireCondition(typeof manifest[field] === 'string' && manifest[field].length > 0, `${field} absent`);
      const resolved = resolvePath(manifest[field], manifestPath);
      requireCondition(isUnderBase(resolved, base), `${field}="${manifest[field]}" hors de ${base}`);
    }
    return `start_url=${manifest.start_url}, scope=${manifest.scope}`;
  });

  const requiredIcons = [
    { sizes: '192x192', purpose: 'any' },
    { sizes: '512x512', purpose: 'any' },
    { sizes: '192x192', purpose: 'maskable' },
    { sizes: '512x512', purpose: 'maskable' },
  ];
  for (const required of requiredIcons) {
    const icon = (manifest.icons || []).find(
      (candidate) => candidate.sizes === required.sizes && String(candidate.purpose || 'any').includes(required.purpose),
    );
    const label = `Icône ${required.sizes} ${required.purpose}`;
    await verifier.check(label, icon?.src || manifestPath, async () => {
      requireCondition(Boolean(icon), `icône ${required.sizes} (${required.purpose}) absente du manifeste`);
      const iconPath = resolvePath(icon.src, manifestPath);
      requireCondition(isUnderBase(iconPath, base), `chemin hors du préfixe ${base}`);
      const response = await source.get(iconPath, { retry: source instanceof RemoteSource ? 3 : 0 });
      requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
      const dimensions = pngSize(response.body);
      requireCondition(Boolean(dimensions), 'signature PNG absente');
      const [width, height] = required.sizes.split('x').map(Number);
      requireCondition(
        dimensions.width === width && dimensions.height === height,
        `dimensions ${dimensions.width}x${dimensions.height} (attendu ${required.sizes})`,
      );
      return `HTTP 200, ${dimensions.width}x${dimensions.height}`;
    });
  }

  await verifier.check('Raccourcis Android/Windows', manifestPath, async () => {
    const shortcuts = Array.isArray(manifest.shortcuts) ? manifest.shortcuts : [];
    requireCondition(shortcuts.length >= 2, 'moins de deux raccourcis');
    const urls = shortcuts.map((shortcut) => resolvePath(shortcut.url, manifestPath));
    requireCondition(urls.some((url) => url.includes('#/accounting')), 'raccourci Comptabilité absent');
    requireCondition(urls.some((url) => url.includes('#/accounting/banking')), 'raccourci Banque absent');
    return urls.join(', ');
  });
}

async function verifyStaticPwa(verifier, source, base, links) {
  for (const link of links.icons) {
    const iconPath = resolvePath(link.href, `${base}index.html`);
    await verifier.check(`Favicon / icône ${link.rel}${link.sizes ? ` ${link.sizes}` : ''}`, iconPath, async () => {
      requireCondition(isUnderBase(iconPath, base), `chemin hors du préfixe ${base}`);
      const response = await source.get(iconPath, { retry: source instanceof RemoteSource ? 3 : 0 });
      requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
      requireCondition(response.body.length > 0, 'fichier vide');
      return `HTTP 200, ${response.body.length} octets`;
    });
  }

  await verifier.check('favicon.ico accessible', `${base}favicon.ico`, async () => {
    const response = await source.get(`${base}favicon.ico`, { retry: source instanceof RemoteSource ? 3 : 0 });
    requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
    requireCondition(response.body.length > 4, 'fichier vide');
  });

  for (const href of links.browserConfig) {
    const configPath = resolvePath(href, `${base}index.html`);
    await verifier.check('browserconfig.xml Windows', configPath, async () => {
      const response = await source.get(configPath, { retry: source instanceof RemoteSource ? 3 : 0 });
      requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
      requireCondition(response.body.toString('utf8').includes('mstile-150.png'), 'tuile mstile-150.png absente');
    });
  }

  await verifier.check('mstile-150.png accessible', `${base}icons/mstile-150.png`, async () => {
    const response = await source.get(`${base}icons/mstile-150.png`, { retry: source instanceof RemoteSource ? 3 : 0 });
    requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
    requireCondition(Boolean(pngSize(response.body)), 'signature PNG absente');
  });

  await verifier.check('Service worker sw.js', `${base}sw.js`, async () => {
    const response = await source.get(`${base}sw.js`, { retry: source instanceof RemoteSource ? 3 : 0 });
    requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
    const text = response.body.toString('utf8');
    requireCondition(text.includes('comptai-shell-v1'), 'version du service worker absente');
    requireCondition(text.includes("addEventListener('fetch'"), 'gestionnaire fetch absent');
    return `HTTP 200, ${response.body.length} octets`;
  });
}

async function verifySamples(verifier, source, base) {
  for (const sample of SAMPLE_FILES) {
    await verifier.check(`Fichier fictif ${sample}`, `${base}samples/${sample}`, async () => {
      const response = await source.get(`${base}samples/${sample}`, { retry: source instanceof RemoteSource ? 3 : 0 });
      requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
      requireCondition(response.body.length > 0, 'fichier vide');
      if (sample.endsWith('.xlsx')) {
        requireCondition(response.body.subarray(0, 2).toString('ascii') === 'PK', 'signature XLSX absente');
      }
      return `HTTP 200, ${response.body.length} octets`;
    });
  }
}

async function verifyNotFound(verifier, source, base) {
  await verifier.check('404.html accessible', `${base}404.html`, async () => {
    const response = await source.get(`${base}404.html`, { retry: source instanceof RemoteSource ? 3 : 0 });
    requireCondition(response.status === 200, `HTTP ${response.status} (attendu 200)`);
    requireCondition(response.body.toString('utf8').includes('COMPTAI'), 'marque COMPTAI absente de 404.html');
  });

  await verifier.check('Lien profond /entries servi par le fallback', `${base}entries`, async () => {
    const response = await source.get(`${base}entries`, { retry: source instanceof RemoteSource ? 3 : 0 });
    requireCondition([200, 404].includes(response.status), `HTTP ${response.status} inattendu`);
    const text = response.body.toString('utf8');
    requireCondition(/Redirection vers la d[ée]monstration/i.test(text), 'redirection de démonstration absente');
    return `HTTP ${response.status}`;
  });
}

async function verifySecrets(verifier, allJs, indexHtml, jsCount) {
  await verifier.check('Aucun secret dans les ressources publiques', 'HTML et JavaScript', async () => {
    const match = SECRET_PATTERN.exec(`${indexHtml}\n${allJs}`);
    if (match) {
      const redacted = `${match[0].slice(0, 6)}…`;
      throw new Error(`motif ressemblant à un secret (${redacted})`);
    }
    return `index.html + ${jsCount} fichier(s) JavaScript vérifiés`;
  });
}

async function verifyRealDist(dist) {
  const verifier = new Verifier();
  const root = resolve(dist);
  if (!existsSync(join(root, 'index.html'))) {
    console.error(`::error title=Build réel::${join(root, 'index.html')} introuvable`);
    process.exit(1);
  }
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  await verifier.check('Build réel — titre COMPTAI', join(root, 'index.html'), async () => {
    requireCondition(/<title>\s*COMPTAI\s*<\/title>/i.test(html), 'titre COMPTAI absent');
  });
  const assetsDir = join(root, 'assets');
  const jsFiles = existsSync(assetsDir) ? readdirSync(assetsDir).filter((name) => name.endsWith('.js')) : [];
  await verifier.check('Build réel — aucun chunk de démonstration', 'assets/', async () => {
    requireCondition(jsFiles.length > 0, 'aucun fichier JavaScript');
    requireCondition(!jsFiles.some((name) => name.startsWith('runtime-')), 'chunk runtime-*.js présent dans le build réel');
    return `${jsFiles.length} fichier(s) JS`;
  });
  const forbidden = {
    'identifiant de démonstration': ['DemoPassw0rd2026', 'demo@mauritius-compta.test'],
    'état local de démonstration': ['mc.demo.state.v1'],
    'données fictives': ['Mauritius Demo Services', 'ACME OFFICE SUPPLIES LTD', '000123456789'],
  };
  const jsText = jsFiles.map((name) => readFileSync(join(assetsDir, name), 'utf8')).join('\n');
  for (const [label, tokens] of Object.entries(forbidden)) {
    await verifier.check(`Build réel — ${label} exclu`, 'assets/*.js', async () => {
      const found = tokens.filter((token) => jsText.includes(token));
      requireCondition(found.length === 0, `présent(s) : ${found.join(', ')}`);
    });
  }
  verifier.summary();
  return verifier;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error));
    console.error('Usage : node scripts/verify-demo.mjs --dist apps/web/dist --base /mauritius-compta/ --expect-commit <sha>');
    process.exit(2);
  }
  if (args.help) {
    console.log('Usage : node scripts/verify-demo.mjs (--dist <dir> | --url <url> | --real-dist <dir>) [--base /mauritius-compta/] [--expect-commit <sha>] [--wait 180]');
    return;
  }
  if (args['real-dist']) {
    await verifyRealDist(args['real-dist']);
    return;
  }
  let source;
  if (args.dist) source = new LocalSource(args.dist);
  else if (args.url) source = new RemoteSource(args.url);
  else {
    console.error('Une source est requise : --dist, --url ou --real-dist.');
    process.exit(2);
  }
  await verifyDemo(source, {
    base: normalizeBase(args.base),
    expectedCommit: args['expect-commit'] || process.env.GITHUB_SHA || '',
    waitSeconds: Number(args.wait || 180),
  });
}

await main();
