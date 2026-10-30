# Sources officielles — Official sources

> Ce document recense les sources **officielles** à utiliser pour valider toute règle
> fiscale, sociale ou comptable. Il ne contient aucune interprétation.
> **Règle du projet** : aucune règle n'entre dans le code sans une ligne correspondante dans
> [`compliance-register.md`](./compliance-register.md) précisant la date d'entrée en vigueur
> et une référence officielle archivée.

## 1. Autorités et institutions

| Institution | Rôle | Site officiel | Vérifié le |
|---|---|---|---|
| Mauritius Revenue Authority (MRA) | Impôts directs (IS, IR), TVA, douanes, PAYE, cotisations collectées | <https://mra.mu/> | 2026-10-30 |
| Corporate and Business Registration Department (CBRD) | Registre des sociétés, BRN, dépôts légaux | <https://companies.govmu.org/> | 2026-10-30 |
| CBRIS (guichet d'enregistrement en ligne) | Enregistrement d'entreprises et de sociétés | <https://portalmns.mu/cbris/> | 2026-10-30 |
| Financial Services Commission (FSC) | Régulateur non-bancaire, sociétés agréées, normes de reporting | <https://www.fscmauritius.org/> | 2026-10-30 |
| Bank of Mauritius | Banque centrale, statistiques et taux de référence | <https://www.bom.mu/> | 2026-10-30 |
| Data Protection Office (DPO) | Protection des données personnelles | <https://dataprotection.govmu.org/> | 2026-10-30 |
| Ministry of Labour / Industrial Relations | Travail, salaires, conditions d'emploi | <https://labour.govmu.org/> | 2026-10-30 |
| IFRS Foundation | Normes IFRS et IAS | <https://www.ifrs.org/> | 2026-10-30 |
| Government of Mauritius (portail) | Publications légales, lois de finances, budget | <https://govmu.org/> | 2026-10-30 |

> Les URLs ci-dessus ont été vérifiées comme points d'entrée institutionnels à la date
> indiquée. Elles doivent être **ré-archivées** (PDF + capture horodatée) lors de chaque
> validation réglementaire.

## 2. Textes de référence à obtenir auprès des sources officielles

Cette liste indique **quels textes demander** ; le contenu n'est pas reproduit ici et ne doit
pas être considéré comme validé avant archivage.

| Domaine | Texte à obtenir | Où |
|---|---|---|
| Comptabilité / sociétés | Companies Act 2001 et règlements associés | CBRD / Government Printer |
| Comptabilité | Normes IFRS telles qu'adoptées à Maurice | FSC / IFRS Foundation |
| TVA | Value Added Tax Act 1998 et amendements, notes de pratique | MRA |
| Impôt sur les sociétés | Income Tax Act 1995, Finance Acts, notes de pratique | MRA |
| Paie | Textes relatifs à PAYE, cotisations sociales, Workers' Rights Act | MRA / Ministry of Labour |
| Données personnelles | Data Protection Act 2017 et amendements | DPO / Government Printer |
| Change | Règles de contrôle des changes applicables (le cas échéant) | Bank of Mauritius |

## 3. Hiérarchie des sources (à respecter impérativement)

1. **Texte légal consolidé** (Act, règlement, Finance Act) — source primaire.
2. **Publication de l'autorité** (note de pratique, communiqué, guide MRA/DPO/FSC) — source
   secondaire officielle, à citer avec sa date de publication.
3. **Documentation professionnelle** (Institute of Chartered Accountants, cabinets) — usage
   indicatif **uniquement**, jamais comme base d'implémentation.
4. **Sites commerciaux, blogs, agrégateurs** — **interdits** comme référence réglementaire.

## 4. Processus de validation d'une règle

```text
1. Récupérer le texte officiel (PDF) et le communiqué éventuel.
2. Archiver : fichier + URL + date de consultation + empreinte SHA-256.
3. Renseigner la ligne dans compliance-register.md :
   - identifiant, domaine, règle, statut (CONFIRMÉ / À VÉRIFIER / NON IMPLÉMENTÉ),
   - date d'entrée en vigueur, date de fin (si applicable),
   - référence officielle précise (section/article),
   - impact technique, tests requis.
4. Écrire les tests AVANT le code (cas nominal + cas limites + historique).
5. Faire relire par un professionnel mauricien (expert-comptable / juriste).
6. Passer le statut à CONFIRMÉ et versionner la règle dans la base (avec sa référence).
```

## 5. Ce que l'application ne fait pas

- Elle **ne cite pas** de taux, de seuil ou de délai non vérifié.
- Elle **ne télécharge pas** de données depuis ces sites (pas de scraping, pas d'appel réseau
  sortant pour des règles fiscales).
- Elle **ne remplace pas** l'avis d'un professionnel.

## 6. Liens internes

- [Registre de conformité](./compliance-register.md)
- [Comptabilité](./accounting.md) · [TVA](./vat.md) · [Impôt sur les sociétés](./corporate-tax.md)
- [Paie](./payroll.md) · [Protection des données](./data-protection.md)
