# Feuille de route — fonctionnalités restant à développer

_État au 30 octobre 2026 (version 0.1.0)._

## 1. Dette technique et finitions de la V0.1

| # | Élément | Priorité | Notes |
|---|---|---|---|
| D-01 | Réinitialisation de mot de passe (e-mail transactionnel) | Haute | Nécessite un fournisseur SMTP et des jetons à usage unique |
| D-02 | Authentification à deux facteurs (TOTP) | Haute | Pour les rôles admin/owner |
| D-03 | Purge automatique des sessions et des tentatives de connexion | Moyenne | Tâche planifiée |
| D-04 | Test de l'upload de justificatifs (intégration) | Moyenne | Écriture disque temporaire isolée |
| D-05 | Police embarquée (Unicode complet) pour les PDF | Moyenne | Accents/typographie FR, caractères spéciaux |
| D-06 | Export XLSX natif (en plus du CSV) | Moyenne | Excel FR/EN |
| D-07 | Pagination du grand livre par compte | Moyenne | Volumes > 5 000 lignes |
| D-08 | OpenAPI / Swagger auto-généré | Moyenne | `@fastify/swagger` |
| D-09 | Tests E2E Playwright (connexion, saisie, exports) | Haute | Sur Android et desktop |
| D-10 | Accessibilité (WCAG 2.1 AA) | Moyenne | Audit + corrections |
| D-11 | Sauvegarde/restauration intégrée + export complet par société | Haute | Avant toute production |
| D-12 | Journal d'audit inaltérable (chaînage cryptographique) | Basse | Conformité renforcée |
| D-13 | Rate limiting global par IP | Moyenne | `@fastify/rate-limit` |
| D-14 | Chiffrement au repos des justificatifs | Moyenne | Champs sensibles / disque |

## 2. Mission 2 — Facturation et TVA (proposition)

Objectif : transformer les écritures en documents commerciaux et préparer la TVA, **sans
coder une règle fiscale non validée**.

1. **Tiers** (clients/fournisseurs) : coordonnées, BRN/TVA, conditions de paiement, devise.
2. **Factures / avoirs** : brouillon → validée (immuable) → comptabilisée, numérotation par
   série, mentions paramétrables (dont les mentions **obligatoires à confirmer** auprès de la
   MRA), PDF bilingue, envoi par e-mail.
3. **Règlements** : lettrage partiel, écarts, relances, âge de la dette.
4. **TVA paramétrable** :
   - table `vat_codes` versionnée (`effective_from`, `effective_to`, `legal_reference`) ;
   - aucun taux par défaut tant que le registre n'est pas `CONFIRMÉ` ;
   - calcul par ligne, arrondis documentés et testés ;
   - déclaration : snapshot immuable, export de contrôle, **pas** de télédéclaration non validée.
5. **Paramétrage** : séries de documents, modèles PDF, conditions de règlement, devises.

**Prérequis bloquants** : lignes `VAT-01` à `VAT-05` du registre passées en `CONFIRMÉ` avec
textes MRA archivés et relecture par un expert-comptable mauricien.

## 3. Mission 3 — Clôtures, états financiers complets, immobilisations

- Écritures de clôture et à-nouveaux, report à nouveau, affectation du résultat.
- Notes annexes structurées, états comparatifs N-1, tableau des flux de trésorerie.
- Immobilisations et amortissements (IAS 16/38), dépréciations (IAS 36).
- Stocks (IAS 2), provisions (IAS 37), reconnaissance du revenu (IFRS 15).
- Impôts différés et rapprochement résultat comptable / base imposable (sans automatiser
  l'impôt tant que `CIT-*` n'est pas `CONFIRMÉ`).

## 4. Mission 4 — Paie mauricienne

- Salariés (données minimisées), contrats, temps de travail.
- Moteur de paie **daté et versionné** (barèmes, cotisations, plafonds) alimenté par des
  paramètres validés.
- Bulletins immuables, régularisations, journal de paie, écritures comptables générées.
- Déclarations : formats officiels uniquement après validation des spécifications MRA.
- Renforcement : cloisonnement des données de paie, chiffrement, audit des accès.

## 5. Mission 5 — Déclarations MRA et tableau de bord de conformité

- Calendrier des obligations (TVA, IS, PAYE/CSG, ROE) **paramétré par texte officiel**.
- Préparation de déclarations, contrôles de cohérence, exports de travail.
- Suivi des échéances, alertes, historique des dépôts (références, accusés).
- Aucune transmission automatique à la MRA avant validation du canal et du format officiels.

## 6. Mission 6 — Multi-société avancé et cabinet comptable

- Vue cabinet : portefeuille de sociétés, échéances consolidées, rôles par cabinet.
- Changement de société rapide, recherche transverse, modèles réutilisables.
- Import de balances (CSV), reprise de données, contrôles d'intégrité.
- Consolidation et éliminations intra-groupe (à cadrer).

## 7. Missions transverses

| Sujet | Contenu |
|---|---|
| Sécurité | MFA, politique de mot de passe, rotation de session, revue de code, pentest |
| Exploitation | sauvegardes chiffrées, supervision, alertes, plan de reprise |
| Performance | indexation, pagination, cache de rapports, tests de charge |
| Conformité | registre de conformité complet, archivage des sources officielles, validation par un professionnel |
| Intégrations | OCR (ScanPro AI, sous réserve de droits), import bancaire (formats à confirmer), e-mailing |

## 8. Ordre recommandé

```text
1. Finitions V0.1 (D-09, D-11, D-01, D-02, D-14)
2. Tiers + facturation (sans TVA codée)
3. Validation réglementaire TVA → activation progressive des taux
4. Clôtures + états complets + immobilisations
5. Paie (mission dédiée, avec validation annuelle des barèmes)
6. Déclarations et conformité
7. Cabinet / consolidation
```
