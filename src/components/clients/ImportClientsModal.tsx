import React, { useState } from 'react';
import { X, Upload, FileSpreadsheet, Loader, Check, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';
import {
  parseClientsWorkbook,
  guessMapping,
  NATIVE_FIELDS,
  NativeFieldKey,
  ParsedSheet,
} from './parseClientsExcel';

/**
 * Bulk-import clients from a spreadsheet.
 *
 * The file is parsed entirely in the browser (SheetJS) — the server never
 * receives the file itself, only the already-mapped rows a normal
 * POST /api/clients would also accept. That keeps a corrupt or oversized
 * spreadsheet from ever reaching the server, and means the mapping the user
 * chose here is exactly what gets imported: no second interpretation on the
 * server side to disagree with what the preview showed.
 *
 * Any Excel column not mapped to a native field becomes a customField —
 * the same free-form column set the Clients screen has always supported, so
 * a sheet's extra columns (RNE, gérant, CNSS…) show up exactly like a
 * hand-added custom field, and the union of every client's keys is what
 * already drives the Clients table's optional columns.
 */

type Step = 'upload' | 'mapping' | 'result';

interface ImportResult {
  created: number;
  skipped: number;
  invalid: number;
  skippedDetails: { row: number; reason: string; name: string }[];
  invalidDetails: { row: number; reason: string }[];
}

export const ImportClientsModal: React.FC<{ onClose: () => void; onImported: () => void }> = ({
  onClose,
  onImported,
}) => {
  const { token } = useAuth();
  const [step, setStep] = useState<Step>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');

  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<NativeFieldKey, string>>>({});
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setParsing(true);
    try {
      const parsed = await parseClientsWorkbook(file);
      setSheet(parsed);
      setMapping(guessMapping(parsed.headers));
      setStep('mapping');
    } catch (e: any) {
      setError(friendlyError(e, 'Fichier illisible. Vérifiez que c’est bien un fichier Excel (.xlsx, .xls) ou CSV.'));
    } finally {
      setParsing(false);
    }
  };

  // Each header may back at most one native field, so picking it for "Nom"
  // clears it from wherever it was previously assigned (e.g. "Ville").
  const setFieldMapping = (field: NativeFieldKey, header: string) => {
    setMapping((prev) => {
      const next: typeof prev = { ...prev };
      if (!header) { delete next[field]; return next; }
      for (const k of Object.keys(next) as NativeFieldKey[]) {
        if (next[k] === header) delete next[k];
      }
      next[field] = header;
      return next;
    });
  };

  const mappedHeaders = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const customHeaders = (sheet?.headers ?? []).filter((h) => !mappedHeaders.has(h));
  const nameMapped = !!mapping.name;

  const runImport = async () => {
    if (!sheet || !nameMapped) return;
    setImporting(true);
    setError('');
    try {
      const rows = sheet.rows.map((r) => {
        const row: Record<string, any> = { customFields: {} as Record<string, string> };
        for (const field of NATIVE_FIELDS) {
          const header = mapping[field.key];
          if (header) row[field.key] = r[header] ?? '';
        }
        for (const header of customHeaders) {
          const value = r[header];
          if (value) row.customFields[header] = value;
        }
        return row;
      });

      const res = await fetch('/api/clients/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows, skipDuplicates }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Import impossible.');
      setResult(body);
      setStep('result');
      onImported();
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setImporting(false);
    }
  };

  const selectClass =
    'w-full px-2.5 py-2 border border-gray-300 rounded-lg text-[12.5px] focus:outline-none focus:border-gray-400 bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-4">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-4 h-4 text-gray-500" />
            <div>
              <h2 className="text-[14px] font-bold text-gray-900">Importer des clients</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">
                À partir d'un fichier Excel (.xlsx, .xls) ou CSV.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 'upload' && (
          <div className="p-5">
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
              className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-12 cursor-pointer transition-colors ${
                dragOver ? 'border-navy bg-gray-50' : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
              />
              {parsing ? (
                <>
                  <Loader className="w-6 h-6 text-gray-400 animate-spin" />
                  <span className="text-[13px] text-gray-500">Lecture du fichier…</span>
                </>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-gray-400" />
                  <span className="text-[13px] font-medium text-gray-700">
                    Cliquez pour choisir un fichier, ou déposez-le ici
                  </span>
                  <span className="text-[11px] text-gray-400">.xlsx, .xls ou .csv</span>
                </>
              )}
            </label>
            {error && (
              <div className="mt-3 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
                {error}
              </div>
            )}
          </div>
        )}

        {step === 'mapping' && sheet && (
          <div className="p-5 space-y-5">
            <div className="text-[11px] text-gray-500">
              <span className="font-semibold text-gray-700">{sheet.rows.length}</span> ligne
              {sheet.rows.length > 1 ? 's' : ''} détectée{sheet.rows.length > 1 ? 's' : ''} dans « {sheet.sheetName} ».
            </div>

            <section className="space-y-2.5">
              <h3 className="text-[11px] font-extrabold text-gray-800 uppercase tracking-[0.05em]">
                Correspondance des colonnes
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {NATIVE_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={(e) => setFieldMapping(field.key, e.target.value)}
                      className={selectClass}
                    >
                      <option value="">— Aucune —</option>
                      {sheet.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {!nameMapped && (
                <p className="text-[11.5px] text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Associez une colonne à « Nom / Raison sociale » pour continuer.
                </p>
              )}
            </section>

            <section>
              <h3 className="text-[11px] font-extrabold text-gray-800 uppercase tracking-[0.05em] mb-1.5">
                Champs personnalisés ({customHeaders.length})
              </h3>
              <p className="text-[11px] text-gray-500 mb-2">
                Les colonnes restantes seront importées comme champs personnalisés, visibles sur chaque fiche client.
              </p>
              {customHeaders.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {customHeaders.map((h) => (
                    <span key={h} className="px-2 py-1 bg-gray-100 text-gray-600 rounded-md text-[11px]">
                      {h}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-300 italic">Toutes les colonnes sont associées.</p>
              )}
            </section>

            <label className="flex items-center gap-2 text-[12.5px] text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(e) => setSkipDuplicates(e.target.checked)}
                className="rounded border-gray-300"
              />
              Ne pas réimporter les clients déjà existants (selon le matricule fiscal ou le nom)
            </label>

            {error && (
              <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
                {error}
              </div>
            )}
          </div>
        )}

        {step === 'result' && result && (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl">
              <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Check className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[14px] font-bold text-emerald-900">
                  {result.created} client{result.created > 1 ? 's' : ''} importé{result.created > 1 ? 's' : ''}
                </div>
                <div className="text-[11.5px] text-emerald-700 mt-0.5">
                  {result.skipped > 0 && `${result.skipped} doublon${result.skipped > 1 ? 's' : ''} ignoré${result.skipped > 1 ? 's' : ''}. `}
                  {result.invalid > 0 && `${result.invalid} ligne${result.invalid > 1 ? 's' : ''} invalide${result.invalid > 1 ? 's' : ''}.`}
                  {result.skipped === 0 && result.invalid === 0 && 'Aucune ligne ignorée.'}
                </div>
              </div>
            </div>

            {result.invalidDetails.length > 0 && (
              <div>
                <h4 className="text-[11px] font-extrabold text-gray-800 uppercase tracking-[0.05em] mb-1.5">
                  Lignes invalides
                </h4>
                <ul className="text-[12px] text-gray-600 space-y-0.5">
                  {result.invalidDetails.map((d, i) => (
                    <li key={i}>Ligne {d.row} : {d.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.skippedDetails.length > 0 && (
              <div>
                <h4 className="text-[11px] font-extrabold text-gray-800 uppercase tracking-[0.05em] mb-1.5">
                  Doublons ignorés
                </h4>
                <ul className="text-[12px] text-gray-600 space-y-0.5">
                  {result.skippedDetails.map((d, i) => (
                    <li key={i}>Ligne {d.row} — {d.name} : {d.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white rounded-b-xl flex justify-between items-center gap-3">
          {step === 'mapping' ? (
            <button
              onClick={() => { setStep('upload'); setSheet(null); setError(''); }}
              className="px-3 py-2 text-gray-500 hover:text-gray-700 text-[13px] font-medium flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Changer de fichier
            </button>
          ) : <span />}

          <div className="flex gap-3">
            {step === 'result' ? (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover"
              >
                Terminer
              </button>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white"
                >
                  Annuler
                </button>
                {step === 'mapping' && (
                  <button
                    onClick={runImport}
                    disabled={!nameMapped || importing}
                    className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {importing && <Loader className="w-4 h-4 animate-spin" />}
                    Importer {sheet ? `${sheet.rows.length} ligne${sheet.rows.length > 1 ? 's' : ''}` : ''}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
