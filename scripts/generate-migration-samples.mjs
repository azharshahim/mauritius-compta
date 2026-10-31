#!/usr/bin/env node
/**
 * Generates the fictional sample files offered by the migration assistant.
 *
 * Every value below is invented: no real company, no real account, no real
 * customer, no legal or tax reference. The Sage and SAP files are *fictional
 * reconstructions* of published export layouts, never exports of a real
 * system, and they are not certified by Sage or SAP.
 *
 * Usage: node scripts/generate-migration-samples.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'apps/web/public/samples');
mkdirSync(out, { recursive: true });

const write = (name, content) => {
  writeFileSync(resolve(out, name), content, 'utf8');
  console.log(`wrote ${name} (${Buffer.byteLength(content)} bytes)`);
};

const BOM = '\uFEFF';

/* ------------------------------------------------------------------ CSV FR */

write(
  'plan-comptable-fictif.csv',
  BOM +
    [
      'Code;Intitulé;Type;Devise;Actif;Description',
      '8100;Banque secondaire — fictif;Actif;MUR;Oui;Fichier fictif de démonstration',
      '8110;Clients export — fictif;Actif;MUR;Oui;Fichier fictif de démonstration',
      '8200;Fournisseurs export — fictif;Passif;MUR;Oui;Fichier fictif de démonstration',
      '8300;Capital export — fictif;Capitaux propres;MUR;Oui;Fichier fictif de démonstration',
      '8400;Ventes export — fictif;Produit;MUR;Oui;Fichier fictif de démonstration',
      '8500;Achats export — fictif;Charge;MUR;Oui;Fichier fictif de démonstration',
      '8510;Loyer export — fictif;Charge;MUR;Oui;Fichier fictif de démonstration',
      '8999;Compte obsolète — fictif;Actif;MUR;Non;Fichier fictif de démonstration',
    ].join('\r\n') +
    '\r\n',
);

write(
  'balance-ouverture-fictive.csv',
  BOM +
    [
      'Compte;Débit;Crédit;Libellé',
      '1010;250 000,00;;Solde d’ouverture — banque fictive',
      '1100;120 000,00;;Solde d’ouverture — clients fictifs',
      '2000;;70 000,00;Solde d’ouverture — fournisseurs fictifs',
      '3000;;300 000,00;Solde d’ouverture — capital fictif',
    ].join('\r\n') +
    '\r\n',
);

write(
  'journal-fictif.csv',
  BOM +
    [
      'Pièce;Date;Journal;Compte;Libellé;Débit;Crédit;Devise;Taux',
      'MIG-001;05/07/2025;BQ;1100;Facture fictive client;48 000,00;;MUR;',
      'MIG-001;05/07/2025;BQ;4000;Facture fictive client;;48 000,00;MUR;',
      'MIG-002;12/07/2025;BQ;5100;Loyer fictif de juillet;15 000,00;;MUR;',
      'MIG-002;12/07/2025;BQ;1010;Loyer fictif de juillet;;15 000,00;MUR;',
      'MIG-003;20/07/2025;OD;1100;Facture fictive en euros;1 000,00;;EUR;48,50000000',
      'MIG-003;20/07/2025;OD;4000;Facture fictive en euros;;1 000,00;EUR;48,50000000',
    ].join('\r\n') +
    '\r\n',
);

/* -------------------------------------------------------------- Sage / SAP */

write(
  'export-sage-fictif.csv',
  BOM +
    [
      'Compte;Intitulé du compte;Date;Code journal;N° pièce;Libellé;Débit;Crédit;Devise',
      '1100;Clients — fictif;05/07/2025;BQ;SAGE-0001;Vente fictive;24 000,00;;MUR',
      '4000;Ventes — fictif;05/07/2025;BQ;SAGE-0001;Vente fictive;;24 000,00;MUR',
      '5000;Achats — fictif;10/07/2025;PUR;SAGE-0002;Achat fictif;9 500,00;;MUR',
      '2000;Fournisseurs — fictif;10/07/2025;PUR;SAGE-0002;Achat fictif;;9 500,00;MUR',
    ].join('\r\n') +
    '\r\n',
);

write(
  'export-sap-fictif.csv',
  [
    'Company Code;G/L Account;Posting Date;Document Date;Document Number;Debit/Credit Indicator;Amount;Currency;Cost Center;Item Text',
    'FICTIF-01;1100;05.07.2025;04.07.2025;SAP-FICTIF-0001;D;36000,00;MUR;CC-FICTIF;Client fictif',
    'FICTIF-01;4000;05.07.2025;04.07.2025;SAP-FICTIF-0001;C;36000,00;MUR;CC-FICTIF;Client fictif',
    'FICTIF-01;5100;15.07.2025;14.07.2025;SAP-FICTIF-0002;D;12000,00;MUR;CC-FICTIF;Loyer fictif',
    'FICTIF-01;1010;15.07.2025;14.07.2025;SAP-FICTIF-0002;C;12000,00;MUR;CC-FICTIF;Loyer fictif',
  ].join('\r\n') +
    '\r\n',
  );
write(
  'export-sap-fictif-semicolon.csv',
  BOM +
    [
      'Company Code;G/L Account;Posting Date;Document Date;Document Number;Debit/Credit Indicator;Amount;Currency;Cost Center;Item Text',
      'FICTIF-01;1100;05.07.2025;04.07.2025;SAP-FICTIF-0001;D;36000,00;MUR;CC-FICTIF;Client fictif',
      'FICTIF-01;4000;05.07.2025;04.07.2025;SAP-FICTIF-0001;C;36000,00;MUR;CC-FICTIF;Client fictif',
    ].join('\r\n') +
    '\r\n',
);

/* -------------------------------------------------------------- incorrect */

write(
  'fichier-incorrect.csv',
  BOM +
    [
      'Compte;Libellé;Débit;Crédit;Date;Pièce;Note',
      '1100;Ligne volontairement déséquilibrée;100,00;;31/02/2025;ERR-001;FICHIER FICTIF VOLONTAIREMENT INCORRECT',
      '4000;Contrepartie insuffisante;;90,00;31/02/2025;ERR-001;FICHIER FICTIF VOLONTAIREMENT INCORRECT',
      '9999;Compte inconnu;50,00;;05/07/2025;ERR-002;FICHIER FICTIF VOLONTAIREMENT INCORRECT',
      '1100;Sans contrepartie;25,00;;05/07/2025;ERR-003;FICHIER FICTIF VOLONTAIREMENT INCORRECT',
    ].join('\r\n') +
    '\r\n',
);

/* ------------------------------------------------------------------- XLSX */

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i) => String.fromCharCode(65 + i);

const sheetXml = (rows) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
  .map(
    (cells, r) =>
      `<row r="${r + 1}">${cells
        .map(
          (value, c) =>
            `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`,
        )
        .join('')}</row>`,
  )
  .join('')}</sheetData></worksheet>`;

const XLSX = {
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Lisez-moi" sheetId="1" r:id="rId1"/><sheet name="Plan comptable" sheetId="2" r:id="rId2"/></sheets>
</workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`,
  'xl/worksheets/sheet1.xml': sheetXml([
    ['Classeur fictif — migration comptable', 'Aucune donnée réelle'],
    ['Feuille « Plan comptable »', 'À sélectionner dans l’assistant'],
    ['Mission 8', 'Mauritius Business Suite'],
  ]),
  'xl/worksheets/sheet2.xml': sheetXml([
    ['Code', 'Intitulé', 'Type', 'Devise', 'Actif'],
    ['7101', 'Matériel informatique — fictif', 'Actif', 'MUR', 'Oui'],
    ['7102', 'Amortissements — fictif', 'Passif', 'MUR', 'Oui'],
    ['7201', 'Services extérieurs — fictif', 'Charge', 'MUR', 'Oui'],
    ['7301', 'Subventions — fictif', 'Produit', 'MUR', 'Oui'],
  ]),
};
writeFileSync(
  resolve(out, 'plan-comptable-fictif.xlsx'),
  Buffer.from(zipSync(Object.fromEntries(Object.entries(XLSX).map(([k, v]) => [k, strToU8(v)])))),
);
console.log('wrote plan-comptable-fictif.xlsx');

/* ---------------------------------------------------------------- clients */

write(
  'clients-fictifs.csv',
  BOM +
    [
      'Nom;BRN;N° TVA;Courriel;Téléphone;Adresse;Ville;Pays;Délai de paiement',
      'Client Alpha (fictif);BRN-FICTIF-ALPHA;VAT-FICTIF-A;alpha@example.test;+230 000 0001;1 rue fictive;Port-Louis;MU;30',
      'Client Beta (fictif);BRN-FICTIF-BETA;VAT-FICTIF-B;beta@example.test;+230 000 0002;2 rue fictive;Curepipe;MU;15',
    ].join('\r\n') +
    '\r\n',
);

console.log(`\nSamples written to ${out}`);
