import React, { useEffect, useState } from 'react';
import { Landmark, Plus, Loader2, X, Trash2, Download, Printer, Eye, Pencil } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { downloadCnssDeclarationPdf, printCnssDeclarationPdf } from './cnssDeclarationPdf';
import type { CompanyBlock } from '../cash/invoicePdf';

const money = (v: number) =>
  (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

interface CnssLigne {
  userId: number | null;
  matriculeCnss: string;
  identite: string;
  numInterne: string;
  numCin: string;
  mois1: number | '';
  mois2: number | '';
  mois3: number | '';
}

interface CnssDeclaration {
  id: number;
  year: number;
  quarter: number;
  companyName: string;
  companyAddress: string;
  numeroEmployeur: string;
  lignes: Array<CnssLigne & { ordre: number; total: number }>;
  totalMois1: number; totalMois2: number; totalMois3: number; salairesDeclares: number;
  tauxChargeSalariale: number; tauxChargePatronale: number; tauxSecuriteSociale: number; tauxAccidentTravail: number;
  montantSecuriteSociale: number; montantAccidentTravail: number; cotisations: number; penalites: number; totalAPayer: number;
  modeReglement: string; modeReglementRef: string; datePaiement: string;
  lieuSignature: string; dateSignature: string;
}

const emptyLigne = (): CnssLigne => ({
  userId: null, matriculeCnss: '', identite: '', numInterne: '', numCin: '', mois1: '', mois2: '', mois3: '',
});

const currentQuarter = () => Math.ceil((new Date().getMonth() + 1) / 3);

const emptyForm = () => ({
  year: new Date().getFullYear(),
  quarter: currentQuarter(),
  lignes: [] as CnssLigne[],
  tauxChargeSalariale: 9.68 as number | '',
  tauxChargePatronale: 17.07 as number | '',
  tauxAccidentTravail: 2.4 as number | '',
  penalites: 0 as number | '',
  modeReglement: '',
  modeReglementRef: '',
  datePaiement: '',
  lieuSignature: '',
  dateSignature: new Date().toISOString().slice(0, 10),
});

interface CnssDeclarationManagementProps {
  /** Même raison que `PayrollManagement`'s `embedded` — monté comme onglet de GRH & Paie, la page hôte porte déjà l'en-tête. */
  embedded?: boolean;
}

/**
 * Déclaration CNSS — la déclaration trimestrielle des salaires et des
 * salariés, un trimestre à la fois (au plus quatre par an). Reproduit le
 * classeur Excel du cabinet : voir `cnssDeclarationPdf.ts` pour le rendu et
 * `computeCnssDeclaration()` côté serveur (server.ts) pour l'unique
 * implémentation du calcul — cet écran n'en porte aucune copie, seulement un
 * aperçu demandé au serveur, comme la Gestion des paies juste à côté.
 */
export const CnssDeclarationManagement: React.FC<CnssDeclarationManagementProps> = ({ embedded = false }) => {
  const { token, hasPermission } = useAuth();
  const canManage = hasPermission('MANAGE_PAYROLL');

  const [declarations, setDeclarations] = useState<CnssDeclaration[]>([]);
  const [companyBlock, setCompanyBlock] = useState<CompanyBlock | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());

  const [isModalOpen, setIsModalOpen] = useState(false);
  useEscapeToClose(() => setIsModalOpen(false), isModalOpen);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [preview, setPreview] = useState<any | null>(null);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [viewing, setViewing] = useState<CnssDeclaration | null>(null);

  const fetchDeclarations = async (y?: number) => {
    try {
      const res = await fetch(`/api/cnss-declarations${y ? `?year=${y}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setDeclarations(await res.json());
    } catch { /* laisse la liste précédente affichée plutôt que de la vider */ }
  };

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const blockRes = await fetch('/api/payroll/company', { headers: { Authorization: `Bearer ${token}` } });
      if (blockRes.ok) setCompanyBlock(await blockRes.json());
      await fetchDeclarations(year);
      setIsLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchDeclarations(year); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year]);

  const resetForm = () => {
    setForm(emptyForm());
    setPreview(null);
    setFormError('');
  };

  const openCreate = () => {
    setEditingId(null);
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (d: CnssDeclaration) => {
    setEditingId(d.id);
    setForm({
      year: d.year, quarter: d.quarter,
      lignes: d.lignes.map(l => ({
        userId: l.userId, matriculeCnss: l.matriculeCnss, identite: l.identite,
        numInterne: l.numInterne, numCin: l.numCin, mois1: l.mois1, mois2: l.mois2, mois3: l.mois3,
      })),
      tauxChargeSalariale: d.tauxChargeSalariale, tauxChargePatronale: d.tauxChargePatronale,
      tauxAccidentTravail: d.tauxAccidentTravail, penalites: d.penalites,
      modeReglement: d.modeReglement, modeReglementRef: d.modeReglementRef, datePaiement: d.datePaiement,
      lieuSignature: d.lieuSignature, dateSignature: d.dateSignature,
    });
    setPreview(null);
    setFormError('');
    setIsModalOpen(true);
  };

  const previewPayload = () => ({
    year: form.year, quarter: form.quarter,
    lignes: form.lignes.map(l => ({
      ...l,
      mois1: l.mois1 === '' ? 0 : Number(l.mois1),
      mois2: l.mois2 === '' ? 0 : Number(l.mois2),
      mois3: l.mois3 === '' ? 0 : Number(l.mois3),
    })),
    tauxChargeSalariale: form.tauxChargeSalariale === '' ? undefined : Number(form.tauxChargeSalariale),
    tauxChargePatronale: form.tauxChargePatronale === '' ? undefined : Number(form.tauxChargePatronale),
    tauxAccidentTravail: form.tauxAccidentTravail === '' ? undefined : Number(form.tauxAccidentTravail),
    penalites: form.penalites === '' ? 0 : Number(form.penalites),
    modeReglement: form.modeReglement, modeReglementRef: form.modeReglementRef, datePaiement: form.datePaiement,
    lieuSignature: form.lieuSignature, dateSignature: form.dateSignature,
  });

  /** Charge les salariés et préremplit les trois mois depuis les bulletins déjà générés — voir `buildCnssDeclarationDraft()` côté serveur. */
  const loadEmployees = async () => {
    setIsLoadingEmployees(true);
    setFormError('');
    try {
      const res = await fetch('/api/cnss-declarations/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ year: form.year, quarter: form.quarter }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || 'Erreur de chargement'); return; }
      setForm(f => ({ ...f, lignes: data.lignes.map((l: any) => ({ ...l })) }));
      setPreview(data);
    } catch { setFormError('Erreur de connexion'); }
    finally { setIsLoadingEmployees(false); }
  };

  const handlePreview = async () => {
    setIsPreviewing(true);
    setFormError('');
    try {
      const res = await fetch('/api/cnss-declarations/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(previewPayload()),
      });
      const data = await res.json();
      if (res.ok) setPreview(data); else setFormError(data.error || 'Erreur de calcul');
    } catch { setFormError('Erreur de connexion'); }
    finally { setIsPreviewing(false); }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setFormError('');
    try {
      const url = editingId ? `/api/cnss-declarations/${editingId}` : '/api/cnss-declarations';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(previewPayload()),
      });
      const data = await res.json();
      if (res.ok) {
        setIsModalOpen(false);
        await fetchDeclarations(year);
      } else {
        setFormError(data.error || 'Une erreur est survenue');
      }
    } catch { setFormError('Erreur de connexion'); }
    finally { setIsSaving(false); }
  };

  const handleDelete = async (d: CnssDeclaration) => {
    if (!confirm(`Supprimer la déclaration CNSS T${d.quarter} ${d.year} ?`)) return;
    const res = await fetch(`/api/cnss-declarations/${d.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setDeclarations(prev => prev.filter(x => x.id !== d.id));
      if (viewing?.id === d.id) setViewing(null);
    }
  };

  const updateLigne = (i: number, patch: Partial<CnssLigne>) =>
    setForm(f => ({ ...f, lignes: f.lignes.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  const removeLigne = (i: number) => setForm(f => ({ ...f, lignes: f.lignes.filter((_, idx) => idx !== i) }));
  const addLigne = () => setForm(f => ({ ...f, lignes: [...f.lignes, emptyLigne()] }));

  if (!hasPermission('VIEW_PAYROLL')) {
    return (
      <div className="p-8 text-center text-gray-500">
        Vous n'avez pas l'autorisation d'accéder à cette page.
      </div>
    );
  }

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i);
  const tdCls = 'px-2 py-1.5';
  const inputCls = 'w-full px-2 py-1 border border-turquoise/30 rounded text-[11.5px] bg-turquoise/10 focus:outline-none focus:border-navy';

  return (
    <div className={`flex-1 min-h-0 flex flex-col space-y-4 sm:space-y-6 max-w-[1300px] w-full mx-auto ${embedded ? '' : 'p-4 sm:p-6 lg:p-8'}`}>
      <div className={`flex flex-col sm:flex-row sm:items-start gap-4 ${embedded ? 'justify-end' : 'justify-between'}`}>
        {!embedded && (
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-gray-800" />
            </div>
            <div>
              <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">Déclaration CNSS</h1>
              <p className="text-[12px] text-gray-500 mt-1">
                Déclaration trimestrielle des salaires et des salariés, et son état récapitulatif.
              </p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={year}
            onChange={e => setYear(parseInt(e.target.value, 10))}
            className="px-2.5 py-2 text-[12px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-gray-400"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {canManage && (
            <button
              onClick={openCreate}
              className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" /> Nouvelle déclaration
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0 sm:min-h-[260px]">
          {isLoading ? (
            <div className="p-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : declarations.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-[13px]">Aucune déclaration CNSS pour {year}.</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-emerald-50 border-b border-emerald-100">
                <tr className="text-left text-emerald-700">
                  <th className="px-4 py-2.5 font-semibold">Trimestre</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Salariés</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Salaires déclarés</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Cotisations</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Total à payer</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {declarations.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">T{d.quarter} {d.year}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-600">{d.lignes.length}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{money(d.salairesDeclares)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-500">{money(d.cotisations)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-gray-900">{money(d.totalAPayer)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button title="Voir / imprimer" onClick={() => setViewing(d)} className="p-1.5 text-gray-500 hover:text-navy hover:bg-gray-100 rounded-md">
                          <Eye className="w-4 h-4" />
                        </button>
                        {canManage && (
                          <>
                            <button title="Modifier" onClick={() => openEdit(d)} className="p-1.5 text-gray-500 hover:text-navy hover:bg-gray-100 rounded-md">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button title="Supprimer" onClick={() => handleDelete(d)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modale de génération / édition */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h2 className="text-[16px] font-bold text-gray-900">
                {editingId ? 'Modifier la déclaration' : 'Nouvelle déclaration CNSS'}
              </h2>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-5">
              {formError && (
                <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Année</label>
                  <select
                    value={form.year}
                    disabled={!!editingId}
                    onChange={e => setForm(f => ({ ...f, year: parseInt(e.target.value, 10) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Trimestre</label>
                  <select
                    value={form.quarter}
                    disabled={!!editingId}
                    onChange={e => setForm(f => ({ ...f, quarter: parseInt(e.target.value, 10) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    {[1, 2, 3, 4].map(q => <option key={q} value={q}>T{q}</option>)}
                  </select>
                </div>
                {!editingId && (
                  <div className="flex items-end">
                    <button
                      type="button" onClick={loadEmployees} disabled={isLoadingEmployees}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-1.5 disabled:opacity-60"
                    >
                      {isLoadingEmployees && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Charger les salariés
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[13px] font-bold text-gray-800">Salariés déclarés</h3>
                  <button type="button" onClick={addLigne} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-[11.5px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Ajouter une ligne
                  </button>
                </div>
                {form.lignes.length === 0 ? (
                  <p className="text-[12px] text-gray-400 italic border border-dashed border-gray-300 rounded-lg p-4 text-center">
                    Aucun salarié — « Charger les salariés » préremplit depuis l'équipe et les bulletins de paie du trimestre, ou ajoutez une ligne à la main.
                  </p>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-[11.5px] whitespace-nowrap">
                      <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                        <tr>
                          <th className={tdCls}>Matricule CNSS</th>
                          <th className={`${tdCls} min-w-[160px]`}>Identité du salarié</th>
                          <th className={tdCls}>N° interne</th>
                          <th className={tdCls}>N° CIN</th>
                          <th className={`${tdCls} text-right`}>1er mois</th>
                          <th className={`${tdCls} text-right`}>2e mois</th>
                          <th className={`${tdCls} text-right`}>3e mois</th>
                          <th className={tdCls} />
                        </tr>
                      </thead>
                      <tbody>
                        {form.lignes.map((l, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className={tdCls}><input value={l.matriculeCnss} onChange={e => updateLigne(i, { matriculeCnss: e.target.value })} className={inputCls} /></td>
                            <td className={tdCls}><input value={l.identite} onChange={e => updateLigne(i, { identite: e.target.value })} className={inputCls} /></td>
                            <td className={tdCls}><input value={l.numInterne} onChange={e => updateLigne(i, { numInterne: e.target.value })} className={inputCls} /></td>
                            <td className={tdCls}><input value={l.numCin} onChange={e => updateLigne(i, { numCin: e.target.value })} className={inputCls} /></td>
                            <td className={tdCls}><input type="number" step="0.001" value={l.mois1} onChange={e => updateLigne(i, { mois1: e.target.value === '' ? '' : parseFloat(e.target.value) })} className={`${inputCls} text-right`} /></td>
                            <td className={tdCls}><input type="number" step="0.001" value={l.mois2} onChange={e => updateLigne(i, { mois2: e.target.value === '' ? '' : parseFloat(e.target.value) })} className={`${inputCls} text-right`} /></td>
                            <td className={tdCls}><input type="number" step="0.001" value={l.mois3} onChange={e => updateLigne(i, { mois3: e.target.value === '' ? '' : parseFloat(e.target.value) })} className={`${inputCls} text-right`} /></td>
                            <td className={tdCls}>
                              <button type="button" onClick={() => removeLigne(i)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-[13px] font-bold text-gray-800 mb-1">Taux de cotisation</h3>
                <p className="text-[10.5px] text-gray-500 mb-3">
                  Propres à votre entreprise (catégorie de risque CNSS) — entièrement paramétrables.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Charge salariale (%)</label>
                    <input type="number" min="0" step="0.01" value={form.tauxChargeSalariale}
                      onChange={e => setForm(f => ({ ...f, tauxChargeSalariale: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Charge patronale (%)</label>
                    <input type="number" min="0" step="0.01" value={form.tauxChargePatronale}
                      onChange={e => setForm(f => ({ ...f, tauxChargePatronale: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Accident de travail (%)</label>
                    <input type="number" min="0" step="0.01" value={form.tauxAccidentTravail}
                      onChange={e => setForm(f => ({ ...f, tauxAccidentTravail: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Pénalités (DT)</label>
                    <input type="number" min="0" step="0.001" value={form.penalites}
                      onChange={e => setForm(f => ({ ...f, penalites: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-[13px] font-bold text-gray-800 mb-3">Règlement et signature</h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Mode de règlement</label>
                    <select value={form.modeReglement} onChange={e => setForm(f => ({ ...f, modeReglement: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy">
                      <option value="">—</option>
                      <option value="ESPECES">Espèces</option>
                      <option value="CHEQUE">Chèque</option>
                      <option value="VIREMENT">Virement</option>
                      <option value="MANDAT">Mandat</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Référence</label>
                    <input value={form.modeReglementRef} onChange={e => setForm(f => ({ ...f, modeReglementRef: e.target.value }))}
                      placeholder="N° chèque, banque…"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Date de paiement</label>
                    <input type="date" value={form.datePaiement} onChange={e => setForm(f => ({ ...f, datePaiement: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Fait à</label>
                    <input value={form.lieuSignature} onChange={e => setForm(f => ({ ...f, lieuSignature: e.target.value }))}
                      placeholder="Ville"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[13px] font-bold text-gray-800">Aperçu du calcul</h3>
                  <button
                    type="button" onClick={handlePreview} disabled={isPreviewing}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {isPreviewing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Calculer l'aperçu
                  </button>
                </div>
                {preview ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden text-[12.5px]">
                    {[
                      ['Salaires déclarés', preview.salairesDeclares],
                      ['Sécurité sociale', preview.montantSecuriteSociale],
                      ['Accident de travail', preview.montantAccidentTravail],
                      ['Cotisations', preview.cotisations],
                      ['Pénalités', preview.penalites],
                    ].map(([label, value]) => (
                      <div key={label as string} className="flex justify-between px-3 py-1.5 odd:bg-gray-50">
                        <span className="text-gray-600">{label}</span>
                        <span className="font-mono text-gray-800">{money(value as number)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between px-3 py-2 bg-navy text-white font-bold">
                      <span>Total à payer</span>
                      <span className="font-mono">{money(preview.totalAPayer)} DT</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[12px] text-gray-400 italic">Cliquez « Calculer l'aperçu » pour voir le détail avant d'enregistrer.</p>
                )}
              </div>

              <div className="pt-4 border-t border-gray-200 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white">
                  Annuler
                </button>
                <button
                  type="button" onClick={handleSave} disabled={isSaving}
                  className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover flex items-center gap-2 disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingId ? 'Enregistrer' : 'Générer la déclaration'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Aperçu / impression de la déclaration enregistrée */}
      {viewing && (
        <CnssDeclarationViewer declaration={viewing} companyBlock={companyBlock} onClose={() => setViewing(null)} />
      )}
    </div>
  );
};

const CnssDeclarationViewer: React.FC<{ declaration: CnssDeclaration; companyBlock: CompanyBlock | null; onClose: () => void }> = ({ declaration, companyBlock, onClose }) => {
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl my-4">
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2 justify-between items-center">
          <h2 className="text-[14px] font-bold text-gray-900">
            Déclaration CNSS — T{declaration.quarter} {declaration.year}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadCnssDeclarationPdf(declaration, companyBlock)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Télécharger PDF
            </button>
            <button
              onClick={() => printCnssDeclarationPdf(declaration, companyBlock)}
              className="px-3 py-1.5 bg-navy text-white rounded-lg text-[12px] font-medium hover:bg-navy-hover flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" /> Imprimer / PDF
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="p-5 text-[12.5px]">
          {[
            ['Salariés déclarés', declaration.lignes.length],
            ['Salaires déclarés', money(declaration.salairesDeclares)],
            ['Sécurité sociale', money(declaration.montantSecuriteSociale)],
            ['Accident de travail', money(declaration.montantAccidentTravail)],
            ['Cotisations', money(declaration.cotisations)],
            ['Pénalités', money(declaration.penalites)],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between px-1 py-1.5 border-b border-gray-100">
              <span className="text-gray-600">{label}</span>
              <span className="font-mono text-gray-800">{value}</span>
            </div>
          ))}
          <div className="flex justify-between px-3 py-2.5 mt-2 bg-navy text-white rounded-lg font-bold">
            <span>Total à payer</span>
            <span className="font-mono">{money(declaration.totalAPayer)} DT</span>
          </div>
        </div>
      </div>
    </div>
  );
};
