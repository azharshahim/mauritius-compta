# Guide utilisateur — Banque & rapprochement

## 1. Ajouter un compte bancaire

Comptabilité → **Banque & rapprochement** → **Comptes bancaires**.

Renseignez le nom du compte, la banque, la devise, le **compte comptable
d'actif associé** (par exemple `1010`) et éventuellement les quatre derniers
caractères de la référence. Le compte physique et le compte comptable sont
deux objets différents.

## 2. Importer un relevé

Onglet **Importer un relevé** : choisissez le compte, puis un fichier CSV,
TSV/TXT ou XLSX. Cliquez sur **Analyser le fichier**.

- La prévisualisation **n'enregistre rien**.
- La synthèse indique les opérations importables, les doublons, les
  avertissements et les erreurs bloquantes.
- Les détails techniques sont repliés dans **Détails techniques** ; les codes
  restent visibles pour le support.
- Corrigez le fichier si l'import est bloqué. Aucune correction n'est faite
  automatiquement.
- Cochez **Je vérifie la proposition avant de poursuivre**, puis
  **Confirmer l'import**.

Après confirmation, l'historique affiche le fichier, le nombre de lignes
créées et les doublons ignorés. Réimporter le même fichier ne crée rien.

## 3. Rapprocher

Onglet **Transactions** : ouvrez une opération.

- Les **correspondances proposées** listent les écritures existantes avec leur
  justification. Une opération ambiguë demande de choisir la bonne ligne.
- Cochez la confirmation humaine, puis **Confirmer le rapprochement**.
- Pour un paiement en plusieurs lignes (1↔n), sélectionnez les lignes dont le
  total égale le montant bancaire.
- **Refuser / à examiner** marque l'opération comme écartée ; elle reste dans
  l'historique.

## 4. Comptabiliser une opération sans écriture

La section **Imputation proposée** affiche un compte existant et sa
justification. Vous pouvez :

- **Préparer une proposition** : un brouillon est créé, sans écriture ;
- **Accepter et comptabiliser** : l'écriture n'est créée qu'après confirmation,
  période ouverte et, si nécessaire, taux de change explicite ;
- **Refuser la proposition**.

Si aucun compte n'est proposé, choisissez-en un manuellement : aucun compte
n'est inventé. Pour un libellé de paie, l'application ne calcule ni salaire ni
charge ; elle propose seulement une écriture vers un compte de dette existant.

## 5. Règles

Onglet **Règles** ou **Créer une règle depuis ce libellé** dans le détail d'une
transaction. La règle est versionnée, désactivable et auditée. Elle ne
s'applique qu'après enregistrement explicite.

## 6. Rapport

Onglet **Rapport** : choisissez le compte et éventuellement une période. Le
rapport indique les soldes, les rapprochements et les écarts. Il n'est marqué
**Rapproché** que si aucun écart inexpliqué ne subsiste. Téléchargez le CSV
pour le classeur de travail. Aucun PDF n'est promis pour ce rapport.

## Limites

OFX, PDF/OCR et les connexions bancaires ne sont pas implémentés. Les cas
1↔n sont acceptés après sélection humaine ; les cas n↔1, partiels et écarts de
change sont bloqués en revue humaine. Voir `docs/bank-import.md` et
`docs/bank-reconciliation.md`.
