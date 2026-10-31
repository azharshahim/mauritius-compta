# Sécurité de l'IA — clés, permissions, données

> Cette page décrit ce qui **est implémenté**. Aucune conformité juridique n'est
> revendiquée : la qualification au regard du *Data Protection Act 2017* mauricien et des
> transferts internationaux reste **à vérifier** avec un conseil compétent.

## 1. Clés API (BYOK)

### Stockage
- Table `ai_credentials` : `ciphertext`, `key_version`, `created_by`, `created_at`,
  `rotated_at`, `revoked_at`.
- **AES-256-GCM**, IV aléatoire de 96 bits par clé, tag d'authentification vérifié au
  déchiffrement (une valeur altérée est rejetée, pas retournée).
- Clé de chiffrement **distincte** : `AI_ENCRYPTION_KEY` (32 octets, hex ou base64).
  Elle n'est ni en base, ni dans le dépôt, ni dans un `.env` versionné.
- **Données authentifiées additionnelles** : `cabinet_id`, `provider`, `key_version`.
  Copier un blob chiffré dans un autre cabinet ou sous un autre fournisseur fait échouer
  le déchiffrement (prouvé par test).
- Sans `AI_ENCRYPTION_KEY`, l'API refuse l'enregistrement (`503 AI_ENCRYPTION_NOT_CONFIGURED`)
  et n'écrit **jamais** de clé en clair.

### Non-divulgation
- Aucune route ne renvoie la clé, ni ses derniers caractères, ni sa longueur, ni une
  empreinte exploitable. L'interface n'affiche que « Clé configurée » / « Clé non configurée ».
- La clé n'est jamais journalisée : ni dans les logs Fastify (`redact` sur les en-têtes),
  ni dans `ai_request_log`, ni dans `audit_log`, ni dans les messages d'erreur.
- Elle n'est **jamais** envoyée au navigateur après enregistrement et n'est **jamais**
  placée dans `localStorage` (la démonstration refuse toute clé : `DEMO_KEY_NOT_ACCEPTED`).
- Les erreurs fournisseur sont traduites en codes stables (`AI_PROVIDER_ERROR`,
  `AI_KEY_MISSING`, …) sans reprendre le corps de la réponse HTTP distante.

### Cycle de vie et rotation
1. `PUT /api/cabinet/ai/credentials/:provider` révoque l'ancienne ligne
   (`revoked_at = now()`) et insère la nouvelle dans la même transaction.
2. `DELETE` révoque (aucune suppression physique : l'historique reste auditable).
3. Rotation de la clé de chiffrement : générer une nouvelle valeur, la déclarer dans
   `AI_ENCRYPTION_KEY` avec `AI_ENCRYPTION_KEY_VERSION`, placer l'ancienne dans
   `AI_ENCRYPTION_PREVIOUS_KEYS="v0:<ancienne>"`, puis ré-enregistrer progressivement les
   clés ; enfin retirer l'ancienne valeur. Le déchiffrement accepte les deux versions
   pendant la transition (test dédié).

## 2. Permissions

| Opération | Contrôle |
|---|---|
| Réglages IA, clés, test de connexion, consommation | `cabinet_admin` (ou `owner`/`admin`) — sinon `403 AI_FORBIDDEN` |
| Cabinet d'un autre utilisateur | `404 CABINET_NOT_FOUND` (aucune divulgation) |
| Suggestion de compte | `accounting` en écriture sur la société |
| Lecture de l'historique / des règles | `accounting` en lecture |
| Décision (accepter/modifier/refuser) | `accounting` en écriture |
| Société non membre | `404 COMPANY_NOT_FOUND` |

Les permissions du moteur réutilisent `requireModuleAccess`, donc les mêmes règles que le
reste de la suite (paie séparée de la comptabilité, dossiers archivés en lecture seule).

## 3. Données envoyées aux fournisseurs

- Seuls le **texte saisi** (≤ `AI_MAX_INPUT_CHARS`, 2 000 caractères par défaut), le
  montant/la devise facultatifs et la **liste des comptes** du dossier sont transmis.
- Aucun nom de client, aucune pièce jointe, aucune donnée de paie, aucun identifiant de
  session, aucun nom d'utilisateur.
- Les fonctionnalités à documents (OCR, relevés bancaires) ne sont **pas** implémentées :
  aucun document n'est envoyé aujourd'hui.
- Rien n'est transmis tant que le cabinet n'a pas activé l'IA **et** le module concerné.

## 4. Journalisation et minimisation

- `ai_request_log` : cabinet, société, utilisateur, module, fonctionnalité, fournisseur,
  modèle, statut, code d'erreur, latence, tokens. **Aucun prompt, aucune réponse.**
- `ai_usage` : une ligne par appel avec le coût éventuel et sa source
  (`catalogue` / `unknown`).
- `audit_log` : `ai.settings.update`, `ai.credential.set`, `ai.credential.delete`,
  `ai.request`, `ai.suggestion.*`, `ai.rule.delete`.
- Les annotations CI et les journaux d'exécution ne contiennent jamais de secret ; les
  tests utilisent des clés de chiffrement de test dérivées d'une chaîne publique.

## 5. Réponses considérées comme non fiables

| Risque | Contre-mesure |
|---|---|
| Injection d'instructions dans la description | Le prompt système interdit explicitement de suivre les instructions du texte utilisateur ; la réponse est validée quoi qu'il arrive |
| Compte inventé | Le code proposé doit exister dans le plan comptable **de la société** ; sinon rejet `422 AI_INVALID_RESPONSE` après une tentative corrective (testé) |
| Montant ou écriture fabriqués | Le schéma ne contient ni montant ni ligne d'écriture ; `entryCreated` est toujours `false` ; le moteur n'a aucun accès en écriture à `journal_entries` |
| Compte d'une autre société | Contrôle SQL `accounts.company_id = :companyId AND is_active` à la décision (`400 AI_ACCOUNT_NOT_IN_CHART`) |
| Élévation de privilèges | Aucune valeur de la réponse n'est utilisée pour une décision d'autorisation |
| Rejeu d'une suggestion | `status` doit valoir `proposed`; une seconde décision renvoie `409 AI_SUGGESTION_DECIDED` |
| SSRF via URL de fournisseur | Schéma http(s) imposé, hôtes privés refusés par défaut, URL non configurable si le fournisseur ne le prévoit pas |
| Fuite de secret dans les logs | Aucun journal ne reçoit la clé ; les erreurs sont converties en codes |

## 6. Conservation

- Les réglages, clés et usages sont conservés tant que le cabinet existe ; les clés
  révoquées restent en base pour l'audit mais sont inutilisables.
- Les suggestions et règles peuvent être supprimées par un utilisateur habilité
  (`DELETE /ai/rules/:id`) ; les suggestions restent en historique (traçabilité des décisions).
- Aucune purge automatique n'est programmée : une durée de conservation configurable
  reste **à définir** avec les cabinets (voir « limites » du rapport de mission).

## 7. Ce qui reste à faire avant une commercialisation

1. Revue juridique : base légale du traitement, information des clients des cabinets,
   transferts hors Maurice vers chaque fournisseur, durées de conservation.
2. Chiffrement au repos de la base entière (Transparent Data Encryption ou disque chiffré),
   en complément du chiffrement applicatif des clés.
3. Gestion de secret externalisée (KMS/Vault) pour `AI_ENCRYPTION_KEY`, avec rotation
   automatisée et double contrôle.
4. Journalisation d'accès aux secrets et alertes sur les pics de consommation.
5. Test d'intrusion sur les routes `/cabinet/ai/*` et `/companies/:id/ai/*`.

Tant que ces points ne sont pas traités, **aucune mention de conformité ne doit être
affichée**.
