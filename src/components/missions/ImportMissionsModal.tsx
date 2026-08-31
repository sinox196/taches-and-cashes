import React, { useRef, useState } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { X, Loader, Upload, Trash2, FileSpreadsheet, Check, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { friendlyError } from '../../utils/errors';
import { SECTEURS } from '../../constants/secteurs';
import { parseMissionsWorkbook, type ParsedMission } from './parseMissionsExcel';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

/**
 * Crée missions et types de tâches en masse depuis le tableur du cabinet.
 *
 * Le fichier est lu **dans le navigateur**, comme l'import des clients : le
 * serveur ne reçoit que la liste relue et confirmée ici, et n'a donc besoin
 * d'aucun middleware d'upload.
 *
 * L'écran d'aperçu est modifiable avant d'importer — le tableur d'un cabinet
 * contient toujours une ligne de trop, et corriger après coup mission par
 * mission serait autrement long.
 */
export const ImportMissionsModal: React.FC<Props> = ({ onClose, onImported }) => {
  useEscapeToClose(onClose);
  const { token, user } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [missions, setMissions] = useState<ParsedMission[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<null | { missionsCreated: number; missionsSkipped: number; typesCreated: number; sectorSaved: boolean }>(null);

  /** Poser le catalogue en modèle du secteur engage toutes les entreprises : exploitant seulement. */
  const isPlatformAdmin = !!user?.isPlatformAdmin;
  const [setAsSectorDefault, setSetAsSectorDefault] = useState(false);
  const [secteur, setSecteur] = useState('CABINET');

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setFileName(file.name);
    setParsing(true);
    try {
      setMissions(await parseMissionsWorkbook(file));
    } catch (e: any) {
      setMissions([]);
      setError(friendlyError(e, 'Fichier illisible.'));
    } finally {
      setParsing(false);
    }
  };

  const removeMission = (i: number) => setMissions(prev => prev.filter((_, idx) => idx !== i));
  const removeType = (mi: number, ti: number) =>
    setMissions(prev => prev.map((m, i) => (i === mi ? { ...m, taskTypes: m.taskTypes.filter((_, x) => x !== ti) } : m)));

  const handleImport = async () => {
    if (missions.length === 0) return;
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/services/import', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          missions,
          setAsSectorDefault: isPlatformAdmin && setAsSectorDefault,
          secteur,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "L'import a échoué.");
      setResult(data);
      onImported();
    } catch (e: any) {
      setError(friendlyError(e, "L'import a échoué."));
    } finally {
      setSaving(false);
    }
  };

  const totalTypes = missions.reduce((n, m) => n + m.taskTypes.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-bold text-navy">Importer des missions</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {result ? (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-turquoise/10 text-turquoise flex items-center justify-center mx-auto mb-4">
              <Check className="w-7 h-7" />
            </div>
            <p className="text-[14.5px] font-semibold text-gray-900 mb-2">Import terminé</p>
            <ul className="text-[13px] text-gray-600 space-y-1">
              <li>{result.missionsCreated} mission(s) créée(s)</li>
              <li>{result.typesCreated} type(s) de tâche ajouté(s)</li>
              {result.missionsSkipped > 0 && (
                <li className="text-amber-700">
                  {result.missionsSkipped} mission(s) déjà existante(s), non dupliquée(s)
                </li>
              )}
              {result.sectorSaved && (
                <li className="text-emerald-700">Enregistré comme catalogue par défaut du secteur</li>
              )}
            </ul>
            <button onClick={onClose} className="mt-6 px-5 py-2.5 bg-navy text-white rounded-lg text-[13.5px] font-semibold hover:bg-navy-hover">
              Fermer
            </button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <p className="text-[12.5px] text-gray-500 bg-canvas rounded-lg px-3 py-2.5 leading-relaxed">
                Une colonne pour la mission, la ou les suivantes pour ses types de tâches. Une première cellule
                vide rattache la ligne à la mission précédente. Une ligne d'en-tête est reconnue si elle est là.
                Une mission déjà présente n'est jamais dupliquée.
              </p>

              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded-md">
                  <p className="text-[12.5px] text-red-700 font-medium">{error}</p>
                </div>
              )}

              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={e => pickFile(e.target.files?.[0])}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-300 rounded-xl px-4 py-6 text-center hover:border-navy hover:bg-gray-50 transition-colors"
                >
                  {parsing ? (
                    <Loader className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                      <p className="text-[13px] font-medium text-gray-700">
                        {fileName || 'Choisir un fichier Excel ou CSV'}
                      </p>
                      <p className="text-[11.5px] text-gray-400 mt-0.5">.xlsx, .xls ou .csv</p>
                    </>
                  )}
                </button>
              </div>

              {missions.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    {missions.length} mission(s) · {totalTypes} type(s) de tâche
                  </div>
                  <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-72 overflow-y-auto">
                    {missions.map((m, mi) => (
                      <div key={mi} className="px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-gray-900 text-[13px] min-w-0 break-words">{m.name}</div>
                          <button
                            onClick={() => removeMission(mi)}
                            className="p-1 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded shrink-0"
                            title="Retirer cette mission de l'import"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {m.taskTypes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {m.taskTypes.map((t, ti) => (
                              <span key={ti} className="group bg-gray-50 border border-gray-200 text-gray-700 text-[11.5px] pl-2.5 pr-1 py-1 rounded-md flex items-center gap-1">
                                {t}
                                <button
                                  onClick={() => removeType(mi, ti)}
                                  className="text-gray-300 hover:text-red-600"
                                  title="Retirer ce type"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Réservé à l'exploitant : ce choix s'applique à toutes les
                  entreprises du secteur, pas seulement à la sienne. */}
              {isPlatformAdmin && missions.length > 0 && (
                <div className="border border-gray-200 rounded-xl px-3 py-3 bg-gray-50/60">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setAsSectorDefault}
                      onChange={e => setSetAsSectorDefault(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="text-[13px] font-medium text-gray-800">
                        Définir aussi comme catalogue par défaut d'un secteur
                      </span>
                      <span className="block text-[11.5px] text-gray-500 leading-relaxed mt-0.5">
                        Chaque entreprise de ce secteur en recevra une copie à sa prochaine connexion, une seule
                        fois. Elle pourra ensuite la modifier et ajouter ses propres missions.
                      </span>
                    </span>
                  </label>
                  {setAsSectorDefault && (
                    <select
                      value={secteur}
                      onChange={e => setSecteur(e.target.value)}
                      className="mt-2.5 w-full px-3 py-2 border border-gray-300 rounded-lg text-[12.5px] bg-white"
                    >
                      {SECTEURS.map(sx => <option key={sx.id} value={sx.id}>{sx.label}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
              <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50">
                Annuler
              </button>
              <button
                onClick={handleImport}
                disabled={missions.length === 0 || saving}
                className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-semibold hover:bg-navy-hover disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Importer {missions.length > 0 ? `${missions.length} mission(s)` : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
