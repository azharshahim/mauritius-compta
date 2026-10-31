/**
 * Politique commune de sélection de fichiers (mission 9 — correctif Android).
 *
 * Le filtre `accept` doit couvrir les MIME réellement renvoyés par Samsung
 * "My Files" / Android Downloads, mais la validation après sélection reste
 * stricte. Aucun fichier n'est lu par ces tests.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_UPLOAD_ACCEPT,
  accountingFileFormat,
  fileExtension,
  validateAccountingUpload,
} from '../src/lib/upload';

const file = (name: string, size = 100, type = '') => ({ name, size, type });

describe('politique d’upload comptable', () => {
  it('annonce les extensions des deux modules et tous les MIME Android connus', () => {
    for (const token of ['.csv', '.tsv', '.txt', '.xlsx']) {
      expect(ACCOUNTING_UPLOAD_ACCEPT.split(',')).toContain(token);
    }
    for (const mime of [
      'text/*',
      'text/csv',
      'text/comma-separated-values',
      'text/plain',
      'text/tab-separated-values',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ]) {
      expect(ACCOUNTING_UPLOAD_ACCEPT).toContain(mime);
    }
    expect(ACCOUNTING_UPLOAD_ACCEPT).not.toContain('image/');
  });

  it('accepte un CSV téléchargé dont le MIME Android est générique ou absent', () => {
    expect(accountingFileFormat(file('releve.csv', 100, 'application/octet-stream'))).toBe('csv');
    expect(accountingFileFormat(file('releve.csv', 100, ''))).toBe('csv');
    expect(accountingFileFormat(file('RELEVE.CSV', 100, 'text/plain'))).toBe('csv');
    expect(accountingFileFormat(file('releve.csv', 100, 'text/comma-separated-values'))).toBe(
      'csv',
    );
    expect(accountingFileFormat(file('releve.xlsx', 100, 'application/octet-stream'))).toBe(
      'xlsx',
    );
    expect(accountingFileFormat(file('releve.tsv', 100, 'text/plain'))).toBe('tsv');
    expect(accountingFileFormat(file('releve.txt', 100, 'application/octet-stream'))).toBe('txt');
  });

  it('accepte un fichier sans extension uniquement si son MIME est explicite', () => {
    expect(accountingFileFormat(file('sans-extension', 100, 'text/csv'))).toBe('csv');
    expect(accountingFileFormat(file('sans-extension', 100, 'text/plain'))).toBe('txt');
    expect(accountingFileFormat(file('sans-extension', 100, 'application/octet-stream'))).toBeNull();
  });

  it('refuse les faux formats même quand le MIME est générique', () => {
    expect(accountingFileFormat(file('facture.pdf', 100, 'application/octet-stream'))).toBeNull();
    expect(accountingFileFormat(file('ancien.xls', 100, 'application/vnd.ms-excel'))).toBeNull();
    expect(accountingFileFormat(file('macro.xlsm', 100, 'application/octet-stream'))).toBeNull();
    expect(accountingFileFormat(file('archive.zip', 100, 'application/zip'))).toBeNull();
    expect(accountingFileFormat(file('releve.csv.exe', 100, 'text/csv'))).toBeNull();
  });

  it('rejette vide, trop volumineux et non pris en charge avant lecture', () => {
    expect(validateAccountingUpload(file('vide.csv', 0), 1024)).toBe('empty');
    expect(validateAccountingUpload(file('gros.csv', 2048), 1024)).toBe('too-large');
    expect(validateAccountingUpload(file('facture.pdf', 100), 1024)).toBe('unsupported');
    expect(validateAccountingUpload(file('releve.csv', 100, 'application/octet-stream'), 1024)).toBeNull();
  });

  it('extrait l’extension sans tenir compte de la casse ni des espaces', () => {
    expect(fileExtension(' Relevé.CSV ')).toBe('csv');
    expect(fileExtension('releve.csv.backup')).toBe('backup');
    expect(fileExtension('releve')).toBeNull();
  });
});
