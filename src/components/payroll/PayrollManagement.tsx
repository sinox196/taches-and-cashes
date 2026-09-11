import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, Loader2, X, Trash2, Download, Printer, Eye } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { SearchableSelect } from '../SearchableSelect';
import { ExportButton } from '../ExportButton';
import { usePeriodPage, PeriodFilter, PaginationBar, MONTHS_FR } from '../PeriodPager';
import { downloadPayslipPdf, printPayslipPdf } from './payslipPdf';
import type { CompanyBlock } from '../cash/invoicePdf';
import { csvNumber } from '../../utils/exportCsv';

const money = (v: number) =>
  (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

interface Employee {
  id: number; username: string; role: string;
  salaireBrut: number | null; regimeHoraire: number | null;
  matricule: string | null; numCin: string | null; numCnss: string | null;
  qualification: string | null; departement: string | null;
  banque: string | null; numeroCompte: string | null;
  situationFamiliale: string | null; nombreEnfants: number | null;
  categorie: string | null; echelon: string | null; salHeure: number | null;
}

interface Payslip {
  id: number; userId: number; employeeName: string;
  year: number; month: number; periodeDu: string; periodeAu: string;
  matricule: string | null; numCin: string | null; numCnss: string | null;
  qualification: string | null; departement: string | null;
  banque: string | null; numeroCompte: string | null;
  situationFamiliale: string | null; nombreEnfants: number | null;
  categorie: string | null; echelon: string | null; salHeure: number | null;
  nbHeures: number; nHeures: number; joursFeries: number;
  joursConges: number; joursAbsences: number; soldeConge: number | null;
  salaireBase: number; gainsJoursFeries: number;
  primePresence: number; primeTransport: number; primeEncouragement: number;
  salaireBrut: number; tauxCnss: number; retenueCnss: number;
  salaireBrutImposable: number; abattement: number; deductionsCommunes: number;
  imposableIrppAnnuel: number; imposableIrppArrondi: number;
  impotSurLeRevenu: number; contributionSocialeSolidarite: number;
  salaireNet: number; salaireNetAPayer: number; nombreMois: number;
  // Régularisation progressive IRPP/CSS — voir CLAUDE.md « Gestion des paies ».
  // `regularisationProgressive` est `false` (et les trois cumuls `null`) pour
  // le premier bulletin de l'année d'un collaborateur, faute d'historique à
  // régulariser ; `nombreMois` porte alors le sens qu'il a toujours eu.
  regularisationProgressive?: boolean;
  cumulAnterieurImposable?: number | null;
  cumulAnterieurIrpp?: number | null;
  cumulAnterieurCss?: number | null;
}

/** Empty draft used to reset the generation form — mirrors `Payslip`'s editable fields. */
const emptyForm = {
  userId: null as number | null,
  employeeLabel: '',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  nombreMois: 12,
  salaireBase: '' as number | '',
  salHeure: '' as number | '',
  joursFeries: '' as number | '',
  primePresence: '' as number | '',
  primeTransport: '' as number | '',
  primeEncouragement: '' as number | '',
  tauxCnss: 9.68 as number | '',
  nbHeures: '' as number | '',
  nHeures: '' as number | '',
  joursConges: '' as number | '',
  joursAbsences: '' as number | '',
  soldeConge: '' as number | '',
};

const dateOfPayslip = (p: Payslip) => `${p.year}-${String(p.month).padStart(2, '0')}-01`;

interface PayrollManagementProps {
  /**
   * Rendu comme l'onglet « Paie » de GRH & Paie (HRManagement.tsx) plutôt
   * qu'en page autonome : la page hôte porte déjà l'en-tête (icône, titre,
   * sous-titre) et la marge extérieure, donc les deux ne se dupliquent pas
   * ici — seul le contenu (barre d'actions, tableau, modales) reste.
   */
  embedded?: boolean;
}

/**
 * Gestion des paies — un bulletin par (collaborateur, mois). Voir CLAUDE.md
 * pour le détail du moteur de calcul (`computePayslip()` côté serveur, seule
 * implémentation — cet écran n'en porte aucune copie, seulement un aperçu
 * demandé au serveur).
 */
export const PayrollManagement: React.FC<PayrollManagementProps> = ({ embedded = false }) => {
  const { token, hasPermission } = useAuth();
  const canManage = hasPermission('MANAGE_PAYROLL');

  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companyBlock, setCompanyBlock] = useState<CompanyBlock | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [employeeFilter, setEmployeeFilter] = useState('');
  // Le filtre collaborateur doit s'appliquer *avant* la pagination
  // année/mois de `usePeriodPage`, sinon la page affichée et le total
  // « X à Y sur Z » ne compteraient pas les mêmes lignes que ce filtre
  // retient — layer les deux l'un sur l'autre après coup aurait pu montrer
  // moins de lignes qu'une page n'en contient, ou en manquer.
  const employeeFilteredPayslips = useMemo(
    () => (employeeFilter ? payslips.filter(p => String(p.userId) === employeeFilter) : payslips),
    [payslips, employeeFilter],
  );
  const page = usePeriodPage<Payslip>(employeeFilteredPayslips, dateOfPayslip, 15);

  const [isModalOpen, setIsModalOpen] = useState(false);
  useEscapeToClose(() => setIsModalOpen(false), isModalOpen);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [viewing, setViewing] = useState<Payslip | null>(null);

  const fetchPayslips = async (year?: string) => {
    try {
      const res = await fetch(`/api/payslips${year ? `?year=${year}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setPayslips(await res.json());
    } catch { /* laisse la liste précédente affichée plutôt que de la vider */ }
  };

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const [empRes, blockRes] = await Promise.all([
        fetch('/api/payroll/employees', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/payroll/company', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (empRes.ok) setEmployees(await empRes.json());
      if (blockRes.ok) setCompanyBlock(await blockRes.json());
      await fetchPayslips(page.year);
      setIsLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchPayslips(page.year); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page.year]);

  const employeeOptions = useMemo(
    () => employees.map(e => ({ id: String(e.id), label: e.username })),
    [employees],
  );

  const resetForm = () => {
    setForm({ ...emptyForm });
    setSelectedEmployee(null);
    setPreview(null);
    setFormError('');
  };

  const openCreate = () => {
    setEditingId(null);
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (p: Payslip) => {
    setEditingId(p.id);
    setSelectedEmployee({
      id: p.userId, username: p.employeeName, role: '',
      salaireBrut: null, regimeHoraire: null,
      matricule: p.matricule, numCin: p.numCin, numCnss: p.numCnss,
      qualification: p.qualification, departement: p.departement,
      banque: p.banque, numeroCompte: p.numeroCompte,
      situationFamiliale: p.situationFamiliale, nombreEnfants: p.nombreEnfants,
      categorie: p.categorie, echelon: p.echelon, salHeure: p.salHeure,
    });
    setForm({
      userId: p.userId, employeeLabel: p.employeeName,
      year: p.year, month: p.month, nombreMois: p.nombreMois,
      salaireBase: p.salaireBase, salHeure: p.salHeure ?? '',
      joursFeries: p.joursFeries, primePresence: p.primePresence,
      primeTransport: p.primeTransport, primeEncouragement: p.primeEncouragement,
      tauxCnss: p.tauxCnss, nbHeures: p.nbHeures, nHeures: p.nHeures,
      joursConges: p.joursConges, joursAbsences: p.joursAbsences,
      soldeConge: p.soldeConge ?? '',
    });
    setPreview(null);
    setFormError('');
    setIsModalOpen(true);
  };

  const onPickEmployee = (idStr: string) => {
    const emp = employees.find(e => String(e.id) === idStr) || null;
    setSelectedEmployee(emp);
    setForm(f => ({
      ...f,
      userId: emp?.id ?? null,
      employeeLabel: emp?.username ?? '',
      salaireBase: emp?.salaireBrut ?? '',
      salHeure: emp?.salHeure ?? '',
    }));
    setPreview(null);
  };

  const previewPayload = () => ({
    userId: form.userId,
    year: form.year, month: form.month, nombreMois: form.nombreMois === '' ? 12 : Number(form.nombreMois),
    salaireBase: form.salaireBase === '' ? undefined : Number(form.salaireBase),
    salHeure: form.salHeure === '' ? undefined : Number(form.salHeure),
    joursFeries: form.joursFeries === '' ? 0 : Number(form.joursFeries),
    primePresence: form.primePresence === '' ? 0 : Number(form.primePresence),
    primeTransport: form.primeTransport === '' ? 0 : Number(form.primeTransport),
    primeEncouragement: form.primeEncouragement === '' ? 0 : Number(form.primeEncouragement),
    tauxCnss: form.tauxCnss === '' ? undefined : Number(form.tauxCnss),
    nbHeures: form.nbHeures === '' ? 0 : Number(form.nbHeures),
    nHeures: form.nHeures === '' ? 0 : Number(form.nHeures),
    joursConges: form.joursConges === '' ? 0 : Number(form.joursConges),
    joursAbsences: form.joursAbsences === '' ? 0 : Number(form.joursAbsences),
    soldeConge: form.soldeConge === '' ? undefined : Number(form.soldeConge),
  });

  const handlePreview = async () => {
    if (!form.userId) { setFormError('Choisissez un collaborateur.'); return; }
    setIsPreviewing(true);
    setFormError('');
    try {
      const res = await fetch('/api/payslips/preview', {
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
    if (!form.userId) { setFormError('Choisissez un collaborateur.'); return; }
    setIsSaving(true);
    setFormError('');
    try {
      const url = editingId ? `/api/payslips/${editingId}` : '/api/payslips';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(previewPayload()),
      });
      const data = await res.json();
      if (res.ok) {
        setIsModalOpen(false);
        await fetchPayslips(page.year);
      } else {
        setFormError(data.error || 'Une erreur est survenue');
      }
    } catch { setFormError('Erreur de connexion'); }
    finally { setIsSaving(false); }
  };

  const handleDelete = async (p: Payslip) => {
    if (!confirm(`Supprimer le bulletin de ${p.employeeName} — ${MONTHS_FR[p.month - 1]} ${p.year} ?`)) return;
    const res = await fetch(`/api/payslips/${p.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setPayslips(prev => prev.filter(x => x.id !== p.id));
      if (viewing?.id === p.id) setViewing(null);
    }
  };

  if (!hasPermission('VIEW_PAYROLL')) {
    return (
      <div className="p-8 text-center text-gray-500">
        Vous n'avez pas l'autorisation d'accéder à cette page.
      </div>
    );
  }

  const shownPreview = preview; // aperçu serveur uniquement — pas de second calcul côté client

  return (
    <div className={`flex-1 min-h-0 flex flex-col space-y-4 sm:space-y-6 max-w-[1300px] w-full mx-auto ${embedded ? '' : 'p-4 sm:p-6 lg:p-8'}`}>
      <div className={`flex flex-col sm:flex-row sm:items-start gap-4 ${embedded ? 'justify-end' : 'justify-between'}`}>
        {!embedded && (
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5 text-gray-800" />
            </div>
            <div>
              <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">Gestion des paies</h1>
              <p className="text-[12px] text-gray-500 mt-1">
                Bulletins de paie mensuels — CNSS, IRPP et contribution sociale de solidarité calculés automatiquement.
              </p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            fileName="bulletins-de-paie"
            rows={page.filtered}
            columns={[
              { header: 'Collaborateur', value: (p: Payslip) => p.employeeName },
              { header: 'Période', value: (p: Payslip) => `${MONTHS_FR[p.month - 1]} ${p.year}` },
              { header: 'Salaire brut', value: (p: Payslip) => csvNumber(p.salaireBrut) },
              { header: 'Retenue CNSS', value: (p: Payslip) => csvNumber(p.retenueCnss) },
              { header: 'Impôt sur le revenu', value: (p: Payslip) => csvNumber(p.impotSurLeRevenu) },
              { header: 'CSS', value: (p: Payslip) => csvNumber(p.contributionSocialeSolidarite) },
              { header: 'Salaire net à payer', value: (p: Payslip) => csvNumber(p.salaireNetAPayer) },
            ]}
          />
          {canManage && (
            <button
              onClick={openCreate}
              className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" /> Nouveau bulletin
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between shrink-0">
          <PeriodFilter page={page} />
          <div className="w-56">
            <SearchableSelect
              value={employeeFilter}
              onChange={setEmployeeFilter}
              options={[{ id: '', label: 'Tous les collaborateurs' }, ...employeeOptions]}
              placeholder="Tous les collaborateurs"
              size="sm"
            />
          </div>
        </div>

        <div className="overflow-auto flex-1 min-h-0 sm:min-h-[260px]">
          {isLoading ? (
            <div className="p-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : page.filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-[13px]">Aucun bulletin pour cette période.</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-2.5 font-semibold">Collaborateur</th>
                  <th className="px-4 py-2.5 font-semibold">Période</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Salaire brut</th>
                  <th className="px-4 py-2.5 font-semibold text-right">CNSS</th>
                  <th className="px-4 py-2.5 font-semibold text-right">IRPP</th>
                  <th className="px-4 py-2.5 font-semibold text-right">CSS</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Net à payer</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {page.pageRows.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{p.employeeName}</td>
                    <td className="px-4 py-2.5 text-gray-600">{MONTHS_FR[p.month - 1]} {p.year}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{money(p.salaireBrut)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-500">{money(p.retenueCnss)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-500">{money(p.impotSurLeRevenu)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-500">{money(p.contributionSocialeSolidarite)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-gray-900">{money(p.salaireNetAPayer)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button title="Voir / imprimer" onClick={() => setViewing(p)} className="p-1.5 text-gray-500 hover:text-navy hover:bg-gray-100 rounded-md">
                          <Eye className="w-4 h-4" />
                        </button>
                        {canManage && (
                          <button title="Supprimer" onClick={() => handleDelete(p)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <PaginationBar page={page} unit="bulletins" />
      </div>

      {/* Modale de génération / édition */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h2 className="text-[16px] font-bold text-gray-900">
                {editingId ? 'Modifier le bulletin' : 'Nouveau bulletin de paie'}
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
                <div className="sm:col-span-2">
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Collaborateur</label>
                  {editingId ? (
                    <div className="px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-[13px] text-gray-700">{form.employeeLabel}</div>
                  ) : (
                    <SearchableSelect
                      value={form.userId ? String(form.userId) : ''}
                      onChange={onPickEmployee}
                      options={employeeOptions}
                      placeholder="Rechercher un collaborateur…"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nombre de mois</label>
                  <input
                    type="number" min="1" max="12" step="1"
                    value={form.nombreMois}
                    onChange={e => setForm(f => ({ ...f, nombreMois: e.target.value === '' ? '' as any : parseInt(e.target.value, 10) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                  />
                  <p className="text-[10.5px] text-gray-500 mt-1">
                    {shownPreview?.regularisationProgressive
                      ? "Ignoré : régularisation progressive sur l'historique du collaborateur cette année (voir l'aperçu)."
                      : 'Annualisation IRPP/CSS — 12 par défaut.'}
                  </p>
                </div>
              </div>

              {selectedEmployee && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-[11.5px]">
                  {[
                    ['Matricule', selectedEmployee.matricule], ['N° CIN', selectedEmployee.numCin],
                    ['N° CNSS', selectedEmployee.numCnss], ['Qualification', selectedEmployee.qualification],
                    ['Département', selectedEmployee.departement], ['Banque / Poste', selectedEmployee.banque],
                    ['Numéro de compte', selectedEmployee.numeroCompte], ['Situation familiale', selectedEmployee.situationFamiliale],
                    ["Nombre d'enfants", selectedEmployee.nombreEnfants], ['Catégorie', selectedEmployee.categorie],
                    ['Échelon', selectedEmployee.echelon],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <span className="text-gray-500">{label} : </span>
                      <span className="font-medium text-gray-800">{value ?? '—'}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Année</label>
                  <select
                    value={form.year}
                    disabled={!!editingId}
                    onChange={e => setForm(f => ({ ...f, year: parseInt(e.target.value, 10) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Mois</label>
                  <select
                    value={form.month}
                    disabled={!!editingId}
                    onChange={e => setForm(f => ({ ...f, month: parseInt(e.target.value, 10) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    {MONTHS_FR.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-[13px] font-bold text-gray-800 mb-3">Gains du mois</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Salaire de base (DT)</label>
                    <input
                      type="number" step="0.001"
                      value={form.salaireBase}
                      onChange={e => setForm(f => ({ ...f, salaireBase: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                    <p className="text-[10.5px] text-gray-500 mt-1">Prérempli depuis Équipe, modifiable pour ce bulletin.</p>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Jours fériés</label>
                    <input
                      type="number" min="0" step="1"
                      value={form.joursFeries}
                      onChange={e => setForm(f => ({ ...f, joursFeries: e.target.value === '' ? '' : parseInt(e.target.value, 10) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Taux CNSS (%)</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={form.tauxCnss}
                      onChange={e => setForm(f => ({ ...f, tauxCnss: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Prime de présence (DT)</label>
                    <input
                      type="number" step="0.001"
                      value={form.primePresence}
                      onChange={e => setForm(f => ({ ...f, primePresence: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Prime de transport (DT)</label>
                    <input
                      type="number" step="0.001"
                      value={form.primeTransport}
                      onChange={e => setForm(f => ({ ...f, primeTransport: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Prime d'encouragement (DT)</label>
                    <input
                      type="number" step="0.001"
                      value={form.primeEncouragement}
                      onChange={e => setForm(f => ({ ...f, primeEncouragement: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-[13px] font-bold text-gray-800 mb-1">Informations du bas de bulletin</h3>
                <p className="text-[10.5px] text-gray-500 mb-3">Purement informatif — n'entrent dans aucun calcul.</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nb Heures</label>
                    <input type="number" min="0" value={form.nbHeures}
                      onChange={e => setForm(f => ({ ...f, nbHeures: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">N Heures</label>
                    <input type="number" min="0" value={form.nHeures}
                      onChange={e => setForm(f => ({ ...f, nHeures: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">J.Congés</label>
                    <input type="number" min="0" value={form.joursConges}
                      onChange={e => setForm(f => ({ ...f, joursConges: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">J.Absences</label>
                    <input type="number" min="0" value={form.joursAbsences}
                      onChange={e => setForm(f => ({ ...f, joursAbsences: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy" />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Solde Congé</label>
                    <input type="number" value={form.soldeConge}
                      onChange={e => setForm(f => ({ ...f, soldeConge: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
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
                {shownPreview ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden text-[12.5px]">
                    {shownPreview.regularisationProgressive && (
                      <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 text-[11px] text-indigo-800">
                        Régularisation progressive : {shownPreview.nombreMois - 1} bulletin(s) antérieur(s) cette année
                        cumulant {money(shownPreview.cumulAnterieurImposable)} DT imposable et
                        {' '}{money(shownPreview.cumulAnterieurIrpp)} DT d'IRPP déjà retenu — la retenue de ce mois
                        rattrape la différence avec l'impôt réestimé sur {shownPreview.nombreMois} mois.
                      </div>
                    )}
                    {[
                      ['Salaire brut', shownPreview.salaireBrut],
                      ['Retenue CNSS', -shownPreview.retenueCnss],
                      ['Salaire brut imposable', shownPreview.salaireBrutImposable],
                      ['Impôt sur le revenu', -shownPreview.impotSurLeRevenu],
                      ['Contribution sociale de solidarité', -shownPreview.contributionSocialeSolidarite],
                      ['Salaire net', shownPreview.salaireNet],
                    ].map(([label, value]) => (
                      <div key={label as string} className="flex justify-between px-3 py-1.5 odd:bg-gray-50">
                        <span className="text-gray-600">{label}</span>
                        <span className="font-mono text-gray-800">{money(value as number)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between px-3 py-2 bg-navy text-white font-bold">
                      <span>Salaire net à payer</span>
                      <span className="font-mono">{money(shownPreview.salaireNetAPayer)} DT</span>
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
                  {editingId ? 'Enregistrer' : 'Générer le bulletin'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Aperçu / impression du bulletin enregistré */}
      {viewing && (
        <PayslipViewer payslip={viewing} companyBlock={companyBlock} onClose={() => setViewing(null)} />
      )}
    </div>
  );
};

const PayslipViewer: React.FC<{ payslip: Payslip; companyBlock: CompanyBlock | null; onClose: () => void }> = ({ payslip, companyBlock, onClose }) => {
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl my-4">
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2 justify-between items-center">
          <h2 className="text-[14px] font-bold text-gray-900">
            {payslip.employeeName} — {MONTHS_FR[payslip.month - 1]} {payslip.year}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadPayslipPdf(payslip, companyBlock)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Télécharger PDF
            </button>
            <button
              onClick={() => printPayslipPdf(payslip, companyBlock)}
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
            ['Salaire de base', payslip.salaireBase], ['Jours fériés', payslip.gainsJoursFeries],
            ['Prime de présence', payslip.primePresence], ['Prime de transport', payslip.primeTransport],
            ["Prime d'encouragement", payslip.primeEncouragement],
            ['Salaire brut', payslip.salaireBrut],
            [`CNSS (${money(payslip.tauxCnss)} %)`, -payslip.retenueCnss],
            ['Salaire brut imposable', payslip.salaireBrutImposable],
            ['Impôt sur le revenu', -payslip.impotSurLeRevenu],
            ['Contribution sociale de solidarité', -payslip.contributionSocialeSolidarite],
            ['Salaire net', payslip.salaireNet],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between px-1 py-1.5 border-b border-gray-100">
              <span className="text-gray-600">{label}</span>
              <span className="font-mono text-gray-800">{money(value as number)}</span>
            </div>
          ))}
          <div className="flex justify-between px-3 py-2.5 mt-2 bg-navy text-white rounded-lg font-bold">
            <span>Salaire net à payer</span>
            <span className="font-mono">{money(payslip.salaireNetAPayer)} DT</span>
          </div>
        </div>
      </div>
    </div>
  );
};
