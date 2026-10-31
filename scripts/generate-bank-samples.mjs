/**
 * Generates the fictional bank statement samples published with the demo.
 * Every name, amount and reference is invented; no real bank data is used.
 * Run: npm run samples:bank
 */
import { writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';

const OUT = 'apps/web/public/samples';

const main = [
  'Date;Libellé;Référence;Débit;Crédit;Devise;Solde',
  '01/08/2025;Loyer du mois d’août;LOYER-AOUT;15000,00;;MUR;380000,00',
  '05/08/2025;Encaissement client FA-2025-001;FA-2025-001;;125000,00;MUR;505000,00',
  '07/08/2025;Frais bancaires du mois;FRAIS-08;2500,00;;MUR;502500,00',
  '08/08/2025;Virement salaires août;SAL-08;45000,00;;MUR;457500,00',
  '09/08/2025;Paiement fournisseur AC-2025-001;AC-2025-001;32000,00;;MUR;425500,00',
  '10/08/2025;Opération sans correspondance (fictive);INCONNU-01;7500,00;;MUR;418000,00',
  '01/09/2025;Frais de tenue de compte (fictifs);FRAIS-09;1200,00;;MUR;416800,00',
  '02/09/2025;Encaissement client fictif FA-2025-002;FA-2025-002;;50000,00;MUR;466800,00',
].join('\r\n');

const duplicates = [
  'Date;Libellé;Référence;Débit;Crédit;Devise',
  '05/08/2025;Encaissement fictif doublon;DUP-FICTIF-1;;10000,00;MUR',
  '05/08/2025;Encaissement fictif doublon;DUP-FICTIF-1;;10000,00;MUR',
].join('\r\n');

const errors = [
  'Date;Libellé;Référence;Débit;Crédit;Devise;Solde',
  '31/02/2025;Date impossible (fictive);ERR-DATE;1000,00;;MUR;1000,00',
  '05/08/2025;Devise incompatible (fictive);ERR-CURRENCY;1000,00;;USD;0,00',
  '03/08/2025;Opération valide mais solde incohérent (fictive);ERR-BALANCE-1;1000,00;;MUR;1000,00',
  '04/08/2025;Solde incohérent (fictif);ERR-BALANCE-2;500,00;;MUR;9999,00',
].join('\r\n');

writeFileSync(`${OUT}/releve-bancaire-fictif.csv`, `\uFEFF${main}\r\n`, 'utf8');
writeFileSync(`${OUT}/releve-bancaire-doublons.csv`, `\uFEFF${duplicates}\r\n`, 'utf8');
writeFileSync(`${OUT}/releve-bancaire-erreurs.csv`, `\uFEFF${errors}\r\n`, 'utf8');

const escape = (v) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => String.fromCharCode(65 + i);
const rows = [
  ['Date', 'Libellé', 'Référence', 'Débit', 'Crédit', 'Devise', 'Solde'],
  ['05/08/2025', 'Encaissement client fictif', 'FA-2025-001', '', '125000.00', 'MUR', '505000.00'],
  ['06/08/2025', 'Loyer fictif', 'LOYER-AOUT', '15000.00', '', 'MUR', '490000.00'],
  ['07/08/2025', 'Frais bancaires fictifs', 'FRAIS-08', '2500.00', '', 'MUR', '487500.00'],
];
const sheetRows = rows
  .map((values, index) => {
    const rowNo = index + 1;
    const cells = values
      .map((value, i) => {
        const ref = `${col(i)}${rowNo}`;
        return /^-?\d+(\.\d+)?$/.test(value)
          ? `<c r="${ref}"><v>${value}</v></c>`
          : `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
      })
      .join('');
    return `<row r="${rowNo}">${cells}</row>`;
  })
  .join('');
const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
const files = {
  '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
  '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
  'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Relevé fictif" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
  'xl/worksheets/sheet1.xml': strToU8(sheet),
};
writeFileSync(`${OUT}/releve-bancaire-fictif.xlsx`, Buffer.from(zipSync(files)));
console.log('Generated 4 fictional bank samples in', OUT);
