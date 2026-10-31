# Protection des données — Data Protection (Mauritius)

> **Statut : principes appliqués dans le code, conformité juridique À VÉRIFIER.**
> Ce document décrit (1) ce que l'application fait techniquement, (2) les points à valider
> avec le Data Protection Office (DPO) et un conseil juridique.

## 1. Cadre visé

Maurice dispose d'une loi de protection des données (Data Protection Act 2017, telle que
modifiée) dont l'autorité de contrôle est le **Data Protection Office**.
👉 **À VÉRIFIER et à archiver** : texte consolidé, date d'entrée en vigueur, obligations
d'enregistrement des contrôleurs, durées, formalités de transfert transfrontalier.
Source officielle : <https://dataprotection.govmu.org> (voir `official-sources.md`).

> ⚠️ Ce document ne cite volontairement aucun article, plafond d'amende ou délai de
> notification non vérifié. Ils seront ajoutés au registre de conformité après lecture du
> texte officiel.

## 2. Catégories de données traitées (V0.1.0)

| Catégorie | Exemples | Base de traitement (à valider) | Champs concernés |
|---|---|---|---|
| Identité des utilisateurs | Nom, adresse e-mail | Exécution du contrat / intérêt légitime | `app_users.full_name`, `app_users.email` |
| Authentification | Empreinte de mot de passe (scrypt), jeton de session haché | Sécurité du service | `app_users.password_hash`, `sessions.token_hash` |
| Journalisation | Adresse IP, user-agent, actions sensibles | Intérêt légitime / sécurité | `audit_log.ip`, `sessions.ip` |
| Données comptables | Écritures, tiers, montants, justificatifs | Obligation légale et comptable | `journal_entries`, `journal_lines`, `attachments` |
| Données de paie | **Aucune** en V0.1.0 | — | — |

## 3. Mesures techniques en place

1. **Minimisation** : pas de date de naissance, pas de numéro d'identité, pas de données de
   paie dans cette version.
2. **Mots de passe** : hachage scrypt (N=16384, r=8, p=1, sel aléatoire 16 octets, 64 octets de
   clé). Jamais stockés en clair, jamais journalisés.
3. **Sessions** : jeton aléatoire 256 bits ; seul le SHA-256 est stocké ; cookie `HttpOnly`,
   `SameSite=Lax`, `Secure` en production ; expiration configurable.
4. **Cloisonnement** : chaque donnée métier est rattachée à une société ; l'accès exige une
   appartenance vérifiée côté serveur à chaque requête.
5. **Journal d'audit** : création/modification/suppression, validation d'écriture, clôture de
   période, gestion des accès, connexions échouées.
6. **Justificatifs** : stockage hors base dans un répertoire dédié, nom de fichier aléatoire,
   empreinte SHA-256, types MIME limités (PDF/JPEG/PNG), taille plafonnée, accès authentifié.
7. **Secrets** : uniquement via variables d'environnement (`.env`, non versionné) ;
   `.env.example` ne contient aucun secret réel.
8. **Pas de transfert vers des tiers** : aucune télémétrie, aucun appel à un service externe
   pour les données comptables. Les exports PDF/CSV sont générés côté serveur, sans service
   tiers.

## 4. Points ouverts (À VÉRIFIER)

| # | Sujet | Statut | Action |
|---|---|---|---|
| DP-01 | Enregistrement du contrôleur auprès du DPO | **À VÉRIFIER** | Vérifier l'obligation et le formulaire officiel |
| DP-02 | Durées de conservation (comptabilité, journaux, sessions) | **À VÉRIFIER** | Fixer une politique documentée et paramétrable |
| DP-03 | Droit d'accès, de rectification, d'effacement des utilisateurs | **À VÉRIFIER** | Prévoir une procédure (purge/anonymisation) |
| DP-04 | Notification de violation de données (délai, destinataire, contenu) | **À VÉRIFIER** | Rédiger une procédure interne |
| DP-05 | Transferts transfrontaliers (hébergement du VPS) | **À VÉRIFIER** | Clarifier la localisation de l'hébergement et les garanties |
| DP-06 | Sous-traitants (hébergeur, sauvegardes) | **À VÉRIFIER** | Contrat de sous-traitance, mesures de sécurité |
| DP-07 | Chiffrement au repos | **NON IMPLÉMENTÉ** | Chiffrement disque du VPS + sauvegardes chiffrées |
| DP-08 | Politique de mot de passe / MFA | **NON IMPLÉMENTÉ (MFA)** | Ajouter TOTP en mission 2 |
| DP-09 | Purge automatique des sessions expirées | **À VÉRIFIER** | Tâche planifiée |
| DP-10 | Registre des activités de traitement | **À VÉRIFIER** | Document à établir avec le client |

## 5. Recommandations d'exploitation

- Héberger dans une juridiction et chez un prestataire validés par le client.
- Activer `COOKIE_SECURE=true` et HTTPS obligatoire (Nginx).
- Restreindre l'accès à la base PostgreSQL (réseau privé, mot de passe fort, `pg_hba.conf`).
- Sauvegardes chiffrées + test de restauration périodique.
- Journaliser les accès administrateur, séparer les rôles.
- Interdire l'usage de données réelles dans les environnements de test.

## 6. Données de démonstration

Toutes les données livrées sont **fictives** : « Lagon Bleu Trading Ltd (DEMO) »,
BRN `DEMO-BRN-0001`, TVA `DEMO-VAT-0001`, adresses et montants inventés. Le mot de passe de
démonstration est public et ne doit jamais être utilisé sur une instance accessible.
