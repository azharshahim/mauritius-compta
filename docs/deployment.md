# Préparation du déploiement — VPS Ubuntu + Nginx

> ⚠️ **Aucun déploiement n'a été effectué dans le cadre de la mission V0.1.0.**
> Ce document prépare une installation future ; le propriétaire garde le contrôle total des
> fusions et des déploiements.

## 1. Prérequis serveur

- Ubuntu 22.04/24.04 LTS, accès SSH par clé, utilisateur non-root avec `sudo`.
- Node.js 20+ (LTS), npm 10+.
- PostgreSQL 14+ (16 recommandé).
- Nginx, certificat TLS (Let's Encrypt), pare-feu (ufw) : 22/80/443.

## 2. Base de données

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE mc_app LOGIN PASSWORD 'REMPLACER_PAR_UN_SECRET_FORT';
CREATE DATABASE mauritius_compta OWNER mc_app;
\c mauritius_compta
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO mc_app;
SQL
```

- Écouter uniquement en local (`listen_addresses = 'localhost'`).
- Sauvegardes chiffrées quotidiennes (`pg_dump` + GPG) hors du serveur, avec test de
  restauration.

## 3. Application

```bash
sudo useradd -r -m -d /opt/mauritius-compta mcapp
sudo -u mcapp git clone <dépôt> /opt/mauritius-compta
cd /opt/mauritius-compta
sudo -u mcapp npm ci
sudo -u mcapp npm run build
```

`/opt/mauritius-compta/.env` (chmod 600, propriétaire `mcapp`) :

```dotenv
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
APP_URL=https://compta.example.mu
DATABASE_URL=postgresql://mc_app:...@127.0.0.1:5432/mauritius_compta
DATABASE_SSL=false
SESSION_COOKIE_NAME=mc_session
SESSION_TTL_HOURS=168
COOKIE_SECURE=true
PASSWORD_MIN_LENGTH=12
LOGIN_MAX_ATTEMPTS=8
ALLOW_REGISTRATION=false
STORAGE_DIR=/var/lib/mauritius-compta/storage
MAX_UPLOAD_BYTES=10485760
DEFAULT_LOCALE=fr
```

Migrations puis démarrage :

```bash
sudo -u mcapp npm run db:migrate
sudo -u mcapp npm run start      # node apps/api/dist/index.js
```

L'API sert aussi le front compilé (`apps/web/dist`) avec repli SPA.

## 4. service systemd

`/etc/systemd/system/mauritius-compta.service` :

```ini
[Unit]
Description=Mauritius Compta
After=network.target postgresql.service

[Service]
Type=simple
User=mcapp
WorkingDirectory=/opt/mauritius-compta
EnvironmentFile=/opt/mauritius-compta/.env
ExecStart=/usr/bin/node apps/api/dist/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/mauritius-compta
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now mauritius-compta
```

## 5. Nginx (reverse proxy + TLS)

```nginx
server {
    listen 80;
    server_name compta.example.mu;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name compta.example.mu;

    ssl_certificate     /etc/letsencrypt/live/compta.example.mu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/compta.example.mu/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

> `COOKIE_SECURE=true` est obligatoire derrière HTTPS. `APP_URL` doit correspondre à l'origine
> publique (contrôle CSRF).

## 6. Checklist avant mise en production

- [ ] Autorisation explicite du propriétaire pour le déploiement.
- [ ] `COOKIE_SECURE=true`, HTTPS valide, HSTS actif.
- [ ] `ALLOW_REGISTRATION=false` et comptes créés manuellement.
- [ ] Mot de passe de démonstration supprimé / compte de démo supprimé.
- [ ] Données de démonstration purgées de la base de production.
- [ ] Sauvegardes chiffrées + restauration testée.
- [ ] Journalisation centralisée et rétention définie.
- [ ] Politique de conservation des données validée (DPO).
- [ ] Registre de conformité à jour (`docs/mauritius-regulations/compliance-register.md`).
- [ ] Supervision (systemd + monitoring HTTP `/api/health`).
- [ ] Test de montée en charge minimal et revue de sécurité.

---

## Démonstration GitHub Pages

> Déploiement **automatique, sans serveur applicatif** : seul un bundle statique est publié.
> Aucune base de données, aucun secret, aucun accès PostgreSQL. Le propriétaire conserve le
> contrôle : le workflow part de la branche de développement et ne touche ni `main` ni la PR.

### Principe

- `.github/workflows/pages.yml` (déclencheur : `push` sur
  `arena/b0b62798-mauritius-compta`, ou `workflow_dispatch`).
- Job `build` : `npm ci` → `typecheck` web → **tests web (jsdom)** → `VITE_DEMO_MODE=true
  npm run build:demo` → vérification que le bundle référence `/mauritius-compta/assets/…`,
  contient le bandeau de démonstration, **les quatre modules** et les dossiers fictifs →
  `actions/upload-pages-artifact`.
- Job `deploy` : `actions/configure-pages` + `actions/deploy-pages`, permissions
  `pages: write` / `id-token: write`, puis **smoke test HTTPS exécuté depuis le runner**
  (page 200, bundle JS, `404.html`, lien profond). Pas de bloc `environment:` : la démo part
  de la branche de développement, alors que l'environnement `github-pages` n'autorise que
  les branches protégées.
- URL : `https://azharshahim.github.io/mauritius-compta/`.

### Base d'URL et routage

- `vite.config.ts` : `base = '/mauritius-compta/'` **uniquement** si `VITE_DEMO_MODE=true`.
- `HashRouter` en démo (`#/entries`), `BrowserRouter` en production.
- `apps/web/public/404.html` redirige `/mauritius-compta/<chemin>` vers
  `/mauritius-compta/#/<chemin>` (GitHub Pages ne réécrit pas les URL).

### Activation initiale (une seule fois, par le propriétaire)

`Settings` → `Pages` → `Source: GitHub Actions`. Sans cette activation, le job `deploy`
échoue avec `Resource not accessible by integration` (le jeton d'automatisation n'a pas les
droits d'administration). Aucune autre action n'est requise : le workflow reprend ensuite à
chaque `push`.

### Ce qui n'est jamais publié

- `apps/api/**`, `.env*`, `apps/api/.data/**` (base PGlite), `node_modules`, secrets.
- Le dossier publié est exactement `apps/web/dist` (HTML + JS + CSS + `404.html`).

### Vérification (résultat du 31/10/2026, mission 4)

`index 200` · bundle JS 200 (**460 465 octets**, quatre modules + cabinet présents) ·
`404.html 200` ·
lien profond `/entries` → 404 servi par notre page de redirection `#/entries`.
Job `Verify the published HTTPS URL` : succès (run 41146643105).

```bash
curl -sI https://azharshahim.github.io/mauritius-compta/            # 200 text/html
curl -s  https://azharshahim.github.io/mauritius-compta/ | grep -o '/mauritius-compta/assets/[^"]*'
curl -sI https://azharshahim.github.io/mauritius-compta/<asset>     # 200 application/javascript
```


## Intelligence artificielle (optionnelle)

Le moteur IA est **désactivé par défaut par cabinet** : aucune clé n'est livrée et aucun
appel externe n'a lieu sans configuration explicite.

Variables à renseigner uniquement si l'IA doit être utilisée :

| Variable | Rôle |
|---|---|
| `AI_ENCRYPTION_KEY` | clé de chiffrement des clés API (32 octets, hex ou base64). **Sans elle, l'enregistrement d'une clé est refusé (503).** |
| `AI_ENCRYPTION_KEY_VERSION` | version de la clé (`v1`), utilisée pour la rotation |
| `AI_CATALOGUE_PATH` | catalogue de fournisseurs alternatif |
| `AI_ALLOW_SIMULATED` | autorise le fournisseur fictif (faux en production par défaut) |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_RATE_LIMIT_PER_MINUTE` | garde-fous d'appel |

Aucune clé de fournisseur IA ne doit figurer dans `.env.example`, dans le dépôt ou dans un
workflow GitHub : les clés sont saisies par chaque cabinet dans l'interface et chiffrées en
base avec `AI_ENCRYPTION_KEY`.
