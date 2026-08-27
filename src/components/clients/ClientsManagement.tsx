import React, { useState, useEffect } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useAuth } from '../../context/AuthContext';
import { Plus, Search, Filter, Columns, Check, MoreVertical, Pencil, Trash2, Building2, User as UserIcon, Loader2, X, ChevronRight, Mail, Phone, MapPin, Briefcase, FileSpreadsheet } from 'lucide-react';
import { ImportClientsModal } from './ImportClientsModal';
import { MultiSelectAutocomplete } from '../dashboard/MultiSelectAutocomplete';
import { formatCostTND } from '../../utils/formatters';
import { paymentModeLabel } from '../../constants/paymentModes';

export interface EncaissementEntry {
  id: string;
  amount: number;
  date: string;
  note?: string;
  /** Present only on entries merged in from the Brouillard de caisse. */
  source?: 'BROUILLARD';
  /** Mode de règlement, on entries recorded in Cash. */
  paymentMethod?: string;
  /** Whether the money actually passed through the till. Set server-side from
   *  the mode: a virement is an encaissement but not a caisse movement. */
  isCaisse?: boolean;
}

export interface Client {
  id: number;
  name: string;
  type: 'Individual' | 'Company';
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  taxId: string;
  status: 'Active' | 'Inactive';
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: number;
  missionCount?: number;
  customFields?: Record<string, string>;
  /** Manually typed by the admin — a running ledger, not derived from anything. */
  soldeAnterieur: number;
  /** A client can be paid in several instalments, so this is a list — the
   *  displayed total is the sum of these entries' amounts. */
  encaissements: EncaissementEntry[];
  /** Encaissements coming from the Brouillard de caisse (Cash). Attached
   *  server-side and NOT editable here: the journal owns them, and the
   *  movement is recorded once, there. */
  journalEncaissements?: EncaissementEntry[];
  /** Derived server-side: the sum of this client's own invoices' totals. */
  montantFacture?: number;
  /** Derived server-side: soldeAnterieur - sum(encaissements) + montantFacture. */
  resteAPayer?: number;
}

// A client saved before this list existed has `encaissements` stored as a
// bare number — summed as-is rather than crashing, so existing data (this
// app's own production included) still reads correctly.
/** The ledger columns — right-aligned, tinted, and summed in the totals row. */
const FINANCIAL_KEYS = ['soldeAnterieur', 'montantFacture', 'encaissements', 'resteAPayer'];

const sumEncaissements = (entries: EncaissementEntry[] | number | undefined): number =>
  Array.isArray(entries) ? entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0) : (Number(entries) || 0);

/** Same legacy shape recovery, applied when a client is loaded into the edit
 *  form — the old total becomes one editable, dated entry instead of being
 *  silently dropped. */
const encaissementsForEditing = (client: Pick<Client, 'encaissements' | 'updatedAt' | 'createdAt' | 'id'>): EncaissementEntry[] => {
  if (Array.isArray(client.encaissements)) return client.encaissements;
  const amount = Number(client.encaissements) || 0;
  if (amount === 0) return [];
  const date = (client.updatedAt || client.createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  return [{ id: `legacy-${client.id}`, amount, date, note: 'Ancien montant (migré)' }];
};

export const ClientsManagement: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Active' | 'Inactive'>('ALL');
  /** Several specific clients at once, alongside (not instead of) free-text search. */
  const [selectedClients, setSelectedClients] = useState<{ id: number; name: string }[]>([]);
  const [totals, setTotals] = useState({ soldeAnterieur: 0, montantFacture: 0, encaissements: 0, resteAPayer: 0 });
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  useEscapeToClose(() => setIsModalOpen(false), isModalOpen);
  useEscapeToClose(() => setViewingClient(null), !!viewingClient);

  // Form State
  const [formData, setFormData] = useState<Partial<Client>>({
    customFields: {},
    name: '', type: 'Company', email: '', phone: '', address: '', city: '', country: '', taxId: '', status: 'Active', notes: '',
    soldeAnterieur: '' as any, encaissements: [],
  });
  const [formError, setFormError] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Pagination & Filters State
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [sortField, setSortField] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: string) => {
    if (sortField === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(key);
      setSortDir('asc');
    }
  };

  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  useEscapeToClose(() => setIsFilterOpen(false), isFilterOpen);
  useEscapeToClose(() => setIsColumnsOpen(false), isColumnsOpen);

  // Default visible columns
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('clientsVisibleColumns');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return ['name', 'soldeAnterieur', 'montantFacture', 'encaissements', 'resteAPayer', 'taxId', 'contact', 'status']; // Default columns
  });

  const toggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      const newCols = prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key];
      localStorage.setItem('clientsVisibleColumns', JSON.stringify(newCols));
      return newCols;
    });
  };

  const [filterKey, setFilterKey] = useState<string>('name');
  const [filterValue, setFilterValue] = useState<string>('');
  /** The "Champ" picker is searchable rather than a plain <select> — there
   *  can be dozens of custom fields once client-defined columns pile up. */
  const [champQuery, setChampQuery] = useState('');
  const [champOpen, setChampOpen] = useState(false);
  /** The values that field actually holds, so "Valeur" is a pick, not a guess. */
  const [valueOptions, setValueOptions] = useState<string[]>([]);
  const [valueOpen, setValueOpen] = useState(false);

  const limit = 20;

  useEffect(() => {
    fetchAvailableFields();
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchClients();
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [page, searchTerm, activeFilters, statusFilter, sortField, sortDir, selectedClients]);

  // Suggestions for the filter's "Valeur" box. Debounced and server-side, the
  // same way the client search is — the value set of a free-form custom field
  // is unbounded, so it is never held in full on the client.
  useEffect(() => {
    if (!isFilterOpen || !filterKey || ['status', 'type'].includes(filterKey)) {
      setValueOptions([]);
      return;
    }
    let cancelled = false;
    const h = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ field: filterKey, q: filterValue });
        const res = await fetch(`/api/clients/field-values?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json();
        if (!cancelled) setValueOptions(Array.isArray(body) ? body : []);
      } catch { if (!cancelled) setValueOptions([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [isFilterOpen, filterKey, filterValue, token]);

  const fetchAvailableFields = async () => {
    try {
      const res = await fetch('/api/clients/fields', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableFields(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchClients = async () => {
    setIsLoading(true);
    try {
      const combinedFilters = { ...activeFilters };
      if (statusFilter !== 'ALL') {
        combinedFilters.status = statusFilter;
      }

      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        q: searchTerm,
        sortField,
        sortDir,
        filters: JSON.stringify(combinedFilters)
      });
      if (selectedClients.length > 0) {
        params.set('clientIds', selectedClients.map(c => c.id).join(','));
      }

      const res = await fetch(`/api/clients?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.data) {
          setClients(data.data);
          setTotalCount(data.total);
          setTotals(data.totals || { soldeAnterieur: 0, montantFacture: 0, encaissements: 0, resteAPayer: 0 });
        } else if (Array.isArray(data)) {
          setClients(data);
          setTotalCount(data.length);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddFilter = () => {
    if (!filterKey || (!filterValue.trim() && !['status', 'type'].includes(filterKey))) return;
    setActiveFilters(prev => ({ ...prev, [filterKey]: filterValue }));
    setFilterValue('');
    setPage(1);
    setIsFilterOpen(false);
  };

  const removeFilter = (key: string) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPage(1);
  };

  const clearAllFilters = () => {
    setActiveFilters({});
    setStatusFilter('ALL');
    setSearchTerm('');
    setSelectedClients([]);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  const standardColumns = [
    { key: 'name', label: 'Client / Nom' },
    { key: 'soldeAnterieur', label: 'Solde antérieur' },
    { key: 'montantFacture', label: 'Montant de facture' },
    { key: 'encaissements', label: 'Encaissements' },
    { key: 'resteAPayer', label: 'Reste à payer' },
    { key: 'taxId', label: 'Matricule' },
    { key: 'address', label: 'Adresse' },
    { key: 'contact', label: 'Contact (Email/Tél)' },
    { key: 'city', label: 'Ville' },
    { key: 'country', label: 'Pays' },
    { key: 'status', label: 'Statut' },
  ];

  const allFilterableFields = [
    { key: 'name', label: 'Client / Nom' },
    { key: 'type', label: 'Type de client' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Téléphone' },
    { key: 'taxId', label: 'Matricule' },
    { key: 'address', label: 'Adresse' },
    { key: 'city', label: 'Ville' },
    { key: 'country', label: 'Pays' },
    { key: 'status', label: 'Statut' },
    ...availableFields.map(f => ({ key: f, label: f }))
  ].sort((a, b) => a.label.localeCompare(b.label));

  const allTableColumns = [
    ...standardColumns,
    ...availableFields.map(f => ({ key: f, label: f, isCustom: true }))
  ];

  // The "Affichage des colonnes" picker lists choices alphabetically for easy
  // scanning, but the table's own column order (name first, actions last)
  // is unrelated and stays exactly as defined in allTableColumns above.
  const columnsPickerList = [...allTableColumns].sort((a, b) => a.label.localeCompare(b.label));

  const filteredClients = clients;

  const handleOpenCreate = () => {
    setEditingClient(null);
    setFormData({ name: '', type: 'Company', email: '', phone: '', address: '', city: '', country: '', taxId: '', status: 'Active', notes: '', customFields: {}, soldeAnterieur: '' as any, encaissements: [] });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingClient(client);
    setFormData({ ...client, encaissements: encaissementsForEditing(client) });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Êtes-vous sûr de vouloir désactiver ce client ?')) return;
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setClients(clients.map(c => c.id === id ? { ...c, status: 'Inactive' } : c));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleFormChange = (field: keyof Client, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  /**
   * What the form shows for Encaissements — a read-only total and nothing
   * else, covering both the entries stored on the client and the ones merged
   * in from Cash. The manual
   * editor that used to sit here is gone: encaissements are recorded in Cash
   * (Règlements clients), so there is one place to enter a payment and one
   * record of it. Entries already stored on a client are still counted, still
   * listed in the drawer, and still round-trip through save untouched.
   */
  const totalEncaissements =
    sumEncaissements(formData.encaissements) + sumEncaissements(formData.journalEncaissements);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSaving(true);

    if (!formData.name?.trim()) {
      setFormError('Le nom du client est requis.');
      setIsSaving(false);
      return;
    }

    if (formData.email && !/^\S+@\S+\.\S+$/.test(formData.email)) {
      setFormError('L\'adresse email est invalide.');
      setIsSaving(false);
      return;
    }

    try {
      const url = editingClient ? `/api/clients/${editingClient.id}` : '/api/clients';
      const method = editingClient ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        const data = await res.json();
        if (editingClient) {
          setClients(clients.map(c => c.id === data.id ? data : c));
        } else {
          setClients([...clients, data]);
        }
        setIsModalOpen(false);
      } else {
        const err = await res.json();
        setFormError(err.error || 'Une erreur est survenue');
      }
    } catch (err) {
      setFormError('Erreur de connexion');
    } finally {
      setIsSaving(false);
    }
  };

  if (!hasPermission('VIEW_CLIENTS')) {
    return (
      <div className="p-8 text-center text-gray-500">
        Vous n'avez pas l'autorisation d'accéder à cette page.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-4 sm:space-y-6 max-w-[1200px] w-full mx-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-gray-800 tracking-tight">Clients</h1>
          <p className="text-[12px] text-gray-500 mt-1">Gérez votre base de clients, entreprises et particuliers.</p>
        </div>
        {hasPermission('CREATE_CLIENTS') && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsImportOpen(true)}
              title="Importer une liste de clients depuis un fichier Excel"
              className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Importer</span>
            </button>
            <button
              onClick={handleOpenCreate}
              className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Nouveau client</span>
            </button>
          </div>
        )}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher par nom, email, téléphone ou matricule..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent transition-all outline-none"
            />
          </div>

          <MultiSelectAutocomplete
            placeholder="Filtrer par client(s)…"
            endpoint="/api/clients"
            selectedItems={selectedClients}
            onChange={(items) => { setSelectedClients(items); setPage(1); }}
          />

          <div className="flex gap-2 relative">
            <div className="relative">
              <button
                onClick={() => {
                  const opening = !isFilterOpen;
                  setIsFilterOpen(opening);
                  setIsColumnsOpen(false);
                  // Opens blank so the whole field list is offered — pre-filling
                  // it with the current field's label filtered everything else out.
                  if (opening) { setChampQuery(''); setFilterValue(''); }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Filter className="w-4 h-4" />
                Filtres
              </button>

              {isFilterOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-[13px] font-bold text-gray-900">Ajouter un filtre</h3>
                    <button onClick={() => setIsFilterOpen(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="relative">
                      <label className="block text-[12px] font-medium text-gray-700 mb-1">Champ</label>
                      <input
                        type="text"
                        value={champQuery}
                        onChange={(e) => { setChampQuery(e.target.value); setChampOpen(true); }}
                        onFocus={() => setChampOpen(true)}
                        onBlur={() => setTimeout(() => setChampOpen(false), 150)}
                        placeholder="Rechercher un champ..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-navy"
                      />
                      {champOpen && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {allFilterableFields.filter(f => f.label.toLowerCase().includes(champQuery.toLowerCase())).length === 0 ? (
                            <div className="px-3 py-2 text-[12px] text-gray-500 italic">Aucun champ trouvé.</div>
                          ) : allFilterableFields
                            .filter(f => f.label.toLowerCase().includes(champQuery.toLowerCase()))
                            .map(f => (
                              <div
                                key={f.key}
                                onMouseDown={(e) => { e.preventDefault(); setFilterKey(f.key); setChampQuery(f.label); setChampOpen(false); setFilterValue(''); }}
                                className={`px-3 py-2 text-[13px] cursor-pointer hover:bg-gray-50 ${f.key === filterKey ? 'bg-gray-50 font-semibold text-navy' : 'text-gray-700'}`}
                              >
                                {f.label}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-[12px] font-medium text-gray-700 mb-1">Valeur</label>
                      {filterKey === 'status' ? (
                        <select
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-navy"
                        >
                          <option value="">Sélectionner...</option>
                          <option value="Active">Actif</option>
                          <option value="Inactive">Inactif</option>
                        </select>
                      ) : filterKey === 'type' ? (
                        <select
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-navy"
                        >
                          <option value="">Sélectionner...</option>
                          <option value="Individual">Particulier</option>
                          <option value="Company">Entreprise</option>
                        </select>
                      ) : (
                        // Free-text, but suggesting the values this field
                        // actually holds — typing stays possible for a partial
                        // match, while the list turns guesswork into a pick.
                        <div className="relative">
                          <input
                            type="text"
                            value={filterValue}
                            onChange={(e) => { setFilterValue(e.target.value); setValueOpen(true); }}
                            onFocus={() => setValueOpen(true)}
                            onBlur={() => setTimeout(() => setValueOpen(false), 150)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-navy"
                            placeholder="Rechercher ou sélectionner..."
                          />
                          {valueOpen && valueOptions.length > 0 && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              {valueOptions.map(v => (
                                <div
                                  key={v}
                                  onMouseDown={(e) => { e.preventDefault(); setFilterValue(v); setValueOpen(false); }}
                                  className="px-3 py-2 text-[13px] text-gray-700 cursor-pointer hover:bg-gray-50"
                                >
                                  {v}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={handleAddFilter}
                      disabled={!filterValue.trim() && !['status', 'type'].includes(filterKey)}
                      className="w-full mt-2 py-2 bg-navy text-white rounded-lg text-[13px] font-medium disabled:opacity-50 hover:bg-[#1a2b4b]"
                    >
                      Appliquer le filtre
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => { setIsColumnsOpen(!isColumnsOpen); setIsFilterOpen(false); }}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Columns className="w-4 h-4" />
                Colonnes
              </button>

              {isColumnsOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4 max-h-[300px] overflow-y-auto">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-[13px] font-bold text-gray-900">Affichage des colonnes</h3>
                    <button onClick={() => setIsColumnsOpen(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {columnsPickerList.map(col => (
                      <label key={col.key} className="flex items-center gap-3 cursor-pointer group" onClick={(e) => { e.preventDefault(); toggleColumn(col.key); }}>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${visibleColumns.includes(col.key) ? 'bg-navy border-navy' : 'border-gray-300 bg-white group-hover:border-gray-400'}`}>
                          {visibleColumns.includes(col.key) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="text-[13px] text-gray-700 font-medium select-none">{col.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
        {/* Active Filters Display */}
        {(Object.keys(activeFilters).length > 0 || statusFilter !== 'ALL' || selectedClients.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <span className="text-[12px] font-medium text-gray-600">Filtres actifs:</span>

            {selectedClients.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-[12px] font-medium text-gray-700">
                {selectedClients.length} client{selectedClients.length > 1 ? 's' : ''} sélectionné{selectedClients.length > 1 ? 's' : ''}
                <button onClick={() => setSelectedClients([])} className="text-gray-400 hover:text-gray-600">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {statusFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-[12px] font-medium text-gray-700">
                Statut: {statusFilter === 'Active' ? 'Actif' : 'Inactif'}
                <button onClick={() => setStatusFilter('ALL')} className="text-gray-400 hover:text-gray-600">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {Object.entries(activeFilters).map(([key, val]) => {
              const label = allFilterableFields.find(f => f.key === key)?.label || key;
              return (
                <span key={key} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-[12px] font-medium text-gray-700">
                  {label}: {val}
                  <button onClick={() => removeFilter(key)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}

            <button 
              onClick={clearAllFilters}
              className="text-[12px] text-red-600 hover:text-red-700 font-medium ml-2"
            >
              Réinitialiser les filtres
            </button>
          </div>
        )}
      </div>
      {/* List */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex-1 flex flex-col min-h-0">
        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap min-w-max">
                {/* Bloc en-tête figé: column labels + "Total Général" both stay
                    pinned while the body scrolls, so neither the titles nor
                    the running totals ever get lost off the top of the view. */}
                <thead>
                  <tr className="bg-[#F9FAFB] border-b border-gray-200">
                    {allTableColumns.filter(c => visibleColumns.includes(c.key)).map(col => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        // The name column is pinned left (Actions is pinned
                        // right) so the row stays identifiable while scrolling
                        // a wide sheet sideways. z-40 beats the z-30 of the
                        // right-pinned Actions cell it can slide under.
                        className={`h-11 sticky top-0 bg-[#F9FAFB] px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors group select-none ${
                          col.key === 'name' ? 'left-0 z-40 shadow-[1px_0_0_0_theme(colors.gray.200)]' : 'z-20'
                        } ${FINANCIAL_KEYS.includes(col.key) ? 'bg-emerald-50/60' : ''}`}
                      >
                        <div className={`flex items-center gap-1 ${FINANCIAL_KEYS.includes(col.key) ? 'justify-end' : ''}`}>
                          {col.label}
                          <div className={`flex flex-col opacity-0 group-hover:opacity-100 transition-opacity ${sortField === col.key ? '!opacity-100' : ''}`}>
                            <ChevronRight className={`w-3 h-3 -rotate-90 -mb-1.5 ${sortField === col.key && sortDir === 'asc' ? 'text-gray-900' : 'text-gray-400'}`} />
                            <ChevronRight className={`w-3 h-3 rotate-90 ${sortField === col.key && sortDir === 'desc' ? 'text-gray-900' : 'text-gray-400'}`} />
                          </div>
                        </div>
                      </th>
                    ))}
                    <th className="h-11 px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right sticky top-0 right-0 bg-[#F9FAFB] z-30">
                      Actions
                    </th>
                  </tr>
                  {hasPermission('VIEW_CLIENT_FINANCIALS') && (
                    <tr className="bg-gray-100 border-b border-gray-200">
                      {allTableColumns.filter(c => visibleColumns.includes(c.key)).map((col, i) => {
                        const isFinancial = FINANCIAL_KEYS.includes(col.key);
                        return (
                          <td
                            key={col.key}
                            className={`h-11 sticky top-11 bg-gray-100 px-5 py-2.5 text-[12px] ${
                              col.key === 'name' ? 'left-0 z-40 shadow-[1px_0_0_0_theme(colors.gray.200)]' : 'z-20'
                            }`}
                          >
                            {i === 0 ? (
                              <span className="font-bold text-gray-800">Total Général</span>
                            ) : isFinancial ? (
                              <span className="block text-right font-mono font-bold text-gray-900">
                                {formatCostTND((totals as any)[col.key] || 0)}
                              </span>
                            ) : null}
                          </td>
                        );
                      })}
                      <td className="h-11 sticky top-11 right-0 bg-gray-100 z-30 px-5 py-2.5" />
                    </tr>
                  )}
                </thead>
                <tbody className="text-[12px] divide-y divide-gray-50">
                  {filteredClients.map(client => (
                    <tr 
                      key={client.id} 
                      onClick={() => setViewingClient(client)}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors group cursor-pointer"
                    >
                      {allTableColumns.filter(c => visibleColumns.includes(c.key)).map(col => {
                        if (col.key === 'name') {
                          return (
                            <td
                              key="name"
                              className="px-5 py-3 sticky left-0 z-10 bg-white group-hover:bg-gray-50 transition-colors shadow-[1px_0_0_0_theme(colors.gray.200)]"
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${client.type === 'Company' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                                  {client.type === 'Company' ? <Building2 className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                                </div>
                                <div>
                                  <div className="font-semibold text-gray-900">{client.name}</div>
                                  <div className="text-[11px] text-gray-500">{client.type === 'Company' ? 'Entreprise' : 'Particulier'}</div>
                                </div>
                              </div>
                            </td>
                          );
                        }
                        if (col.key === 'contact') {
                          return (
                            <td key="contact" className="px-5 py-4">
                              <div className="flex flex-col gap-1">
                                {client.email ? (
                                  <div className="flex items-center gap-1.5 text-gray-600">
                                    <Mail className="w-3 h-3 text-gray-400" />
                                    <span>{client.email}</span>
                                  </div>
                                ) : <span className="text-gray-400 italic text-[11px]">Pas d'email</span>}
                                {client.phone && (
                                  <div className="flex items-center gap-1.5 text-gray-600 text-[11px]">
                                    <Phone className="w-3 h-3 text-gray-400" />
                                    <span>{client.phone}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        }
                        if (col.key === 'encaissements') {
                          const entries = Array.isArray(client.encaissements) ? client.encaissements : [];
                          const journal = client.journalEncaissements || [];
                          const count = entries.length + journal.length;
                          // The displayed total must match the server's own
                          // resteAPayer, which counts both sources.
                          const total = sumEncaissements(client.encaissements) + sumEncaissements(journal);
                          // The cell shows the **total encaissé and nothing
                          // else** — not a count of versements, which said
                          // nothing about how much the client has actually
                          // paid and competed with the figure that does. It
                          // is read-only here: encaissements are recorded in
                          // Cash (Règlements clients), never typed into this
                          // table. Clicking opens the drawer, the one place
                          // the dated list is shown, each entry marked caisse
                          // or not — a fixed-height cell, so one client with
                          // fifty small versements can't stretch its row past
                          // every other.
                          return (
                            <td
                              key={col.key}
                              onClick={() => setViewingClient(client)}
                              title={count > 0 ? 'Voir le détail des encaissements' : undefined}
                              className={`px-5 py-3 text-right font-mono text-gray-700 bg-emerald-50/25 ${count > 0 ? 'cursor-pointer hover:bg-emerald-50/50' : ''}`}
                            >
                              {formatCostTND(total)}
                            </td>
                          );
                        }
                        if (col.key === 'soldeAnterieur' || col.key === 'montantFacture' || col.key === 'resteAPayer') {
                          const amount = Number(client[col.key as keyof Client]) || 0;
                          // Reste à payer is the figure that actually gets acted
                          // on, so it reads darker than its two inputs.
                          const isBalance = col.key === 'resteAPayer';
                          return (
                            <td
                              key={col.key}
                              className={`px-5 py-3 text-right font-mono bg-emerald-50/25 ${
                                isBalance ? 'font-semibold text-gray-900' : 'text-gray-700'
                              }`}
                            >
                              {formatCostTND(amount)}
                            </td>
                          );
                        }
                        if (col.key === 'status') {
                          return (
                            <td key="status" className="px-5 py-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                client.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {client.status === 'Active' ? 'Actif' : 'Inactif'}
                              </span>
                            </td>
                          );
                        }

                        let val = client[col.key as keyof Client];
                        if (col.isCustom) {
                          val = client.customFields?.[col.key];
                        }
                        
                        return (
                          <td key={col.key} className="px-5 py-4 text-gray-600">
                            {val ? val.toString() : <span className="text-gray-400 italic text-[11px]">-</span>}
                          </td>
                        );
                      })}
                      
                      <td className="px-5 py-4 text-right sticky right-0 bg-white group-hover:bg-gray-50 z-10 transition-colors">
                        <div className="flex justify-end gap-2">
                          {hasPermission('EDIT_CLIENTS') && (
                            <button
                              onClick={(e) => handleOpenEdit(client, e)}
                              title="Modifier"
                              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {hasPermission('DELETE_CLIENTS') && client.status !== 'Inactive' && (
                            <button
                              onClick={(e) => handleDelete(client.id, e)}
                              title="Supprimer"
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredClients.length === 0 && (
                    <tr>
                      <td colSpan={allTableColumns.filter(c => visibleColumns.includes(c.key)).length + 1} className="px-5 py-8 text-center text-gray-500 text-[13px]">
                        Aucun client trouvé.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
          </div>
        )}
        {/* Pagination */}
        {!isLoading && totalPages > 0 && (
          <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-[13px]">
            <div className="text-gray-500">
              Affichage de {((page - 1) * limit) + 1} à {Math.min(page * limit, totalCount)} sur {totalCount} clients
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border border-gray-200 rounded text-gray-600 disabled:opacity-50 hover:bg-gray-100 bg-white"
              >
                Précédent
              </button>
              
              <div className="flex items-center gap-1 px-2">
                <span className="font-medium text-gray-900">{page}</span>
                <span className="text-gray-500">/</span>
                <span className="text-gray-500">{totalPages}</span>
              </div>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 border border-gray-200 rounded text-gray-600 disabled:opacity-50 hover:bg-gray-100 bg-white"
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>

      {isImportOpen && (
        <ImportClientsModal
          onClose={() => setIsImportOpen(false)}
          onImported={() => {
            setPage(1);
            fetchClients();
            fetchAvailableFields();
          }}
        />
      )}

      {/* Form Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-[16px] font-bold text-gray-900">
                {editingClient ? 'Modifier le client' : 'Nouveau client'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              {formError && (
                <div className="mb-6 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
                  {formError}
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nom du client / Raison sociale <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={e => handleFormChange('name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    placeholder="Ex: Tech Corp SA"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Solde antérieur</label>
                  <input
                    type="number"
                    step="0.001"
                    value={formData.soldeAnterieur || ''}
                    onChange={e => handleFormChange('soldeAnterieur', e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                    placeholder="0.000"
                  />
                </div>

                {/* Encaissements are recorded in Cash (Règlements clients),
                    never typed in here: the movement lives in one place, and a
                    second entry point would mean two records of one payment.
                    This is the read-only total, which is all this form needs
                    to show. */}
                <div className="md:col-span-2">
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Encaissements</label>
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 border border-gray-200 bg-gray-50 rounded-lg">
                    <span className="text-[12px] text-gray-500">Total encaissé</span>
                    <span className="text-[13px] font-mono font-semibold text-gray-800">
                      {formatCostTND(totalEncaissements)}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-gray-500 mt-1.5">
                    Les encaissements se saisissent dans Cash → Règlements clients.
                  </p>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Type de client</label>
                  <select
                    value={formData.type}
                    onChange={e => handleFormChange('type', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                  >
                    <option value="Company">Entreprise (B2B)</option>
                    <option value="Individual">Particulier (B2C)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Matricule Fiscal / CIN</label>
                  <input
                    type="text"
                    value={formData.taxId}
                    onChange={e => handleFormChange('taxId', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                    placeholder="Ex: 1234567M/A/M/000"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => handleFormChange('email', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                    placeholder="contact@exemple.com"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Téléphone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={e => handleFormChange('phone', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                    placeholder="+216 20 000 000"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Adresse postale</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={e => handleFormChange('address', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                    placeholder="123 rue de la République"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Ville</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={e => handleFormChange('city', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                    placeholder="Tunis"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Pays</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={e => handleFormChange('country', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                    placeholder="Tunisie"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Statut</label>
                  <select
                    value={formData.status}
                    onChange={e => handleFormChange('status', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy"
                  >
                    <option value="Active">Actif</option>
                    <option value="Inactive">Inactif</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">Notes internes</label>
                  <textarea
                    rows={3}
                    value={formData.notes}
                    onChange={e => handleFormChange('notes', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent resize-none"
                    placeholder="Informations supplémentaires..."
                  />
                </div>
                {/* Custom Fields */}
                <div className="md:col-span-2 pt-4 border-t border-gray-100 mt-2">
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-[13px] font-bold text-gray-900">Champs personnalisés</label>
                  </div>
                  
                  {hasPermission('MANAGE_CLIENT_FIELDS') && (
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      value={newFieldName}
                      onChange={e => setNewFieldName(e.target.value)}
                      placeholder="Nom du nouveau champ..."
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-[12px] focus:ring-1 focus:ring-navy"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (newFieldName.trim()) {
                            setFormData({
                              ...formData,
                              customFields: {
                                ...(formData.customFields || {}),
                                [newFieldName.trim()]: ''
                              }
                            });
                            setNewFieldName('');
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newFieldName.trim() !== '') {
                          setFormData({
                            ...formData,
                            customFields: {
                              ...(formData.customFields || {}),
                              [newFieldName.trim()]: ''
                            }
                          });
                          setNewFieldName('');
                        }
                      }}
                      disabled={!newFieldName.trim()}
                      className="text-[12px] font-medium text-navy bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter
                    </button>
                  </div>
                  )}
                  
                  {Object.keys(formData.customFields || {}).length === 0 ? (
                    <div className="text-[12px] text-gray-500 italic py-2">
                      Aucun champ personnalisé défini pour ce client.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(formData.customFields || {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-3">
                          <div className="w-1/3">
                            <input
                              type="text"
                              value={key}
                              disabled
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-[13px] bg-gray-50 text-gray-700 font-medium"
                            />
                          </div>
                          <div className="w-2/3 flex items-center gap-2">
                            <input
                              type="text"
                              value={value as string}
                              onChange={e => {
                                setFormData({
                                  ...formData,
                                  customFields: {
                                    ...(formData.customFields || {}),
                                    [key]: e.target.value
                                  }
                                });
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-navy focus:border-transparent"
                              placeholder={"Valeur pour " + key}
                            />
                            {hasPermission('MANAGE_CLIENT_FIELDS') && (
                            <button
                              type="button"
                              onClick={() => {
                                const newCustomFields = { ...formData.customFields };
                                delete newCustomFields[key];
                                setFormData({
                                  ...formData,
                                  customFields: newCustomFields
                                });
                              }}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Supprimer ce champ"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover flex items-center gap-2"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingClient ? 'Enregistrer les modifications' : 'Créer le client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Drawer */}
      {viewingClient && (
        <div className="fixed inset-0 z-50 flex justify-end bg-gray-900/40 backdrop-blur-sm" onClick={() => setViewingClient(null)}>
          <div 
            className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-100 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${viewingClient.type === 'Company' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                  {viewingClient.type === 'Company' ? <Building2 className="w-5 h-5" /> : <UserIcon className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-[18px] font-bold text-gray-900 leading-tight">{viewingClient.name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[12px] text-gray-500">{viewingClient.type === 'Company' ? 'Entreprise' : 'Particulier'}</span>
                    <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      viewingClient.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {viewingClient.status}
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={() => setViewingClient(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Contact Info */}
              <section>
                <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-4">Informations de contact</h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Mail className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div>
                      <div className="text-[11px] text-gray-500 font-medium">Email</div>
                      <div className="text-[13px] text-gray-900">{viewingClient.email || '-'}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div>
                      <div className="text-[11px] text-gray-500 font-medium">Téléphone</div>
                      <div className="text-[13px] text-gray-900">{viewingClient.phone || '-'}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div>
                      <div className="text-[11px] text-gray-500 font-medium">Adresse</div>
                      <div className="text-[13px] text-gray-900">
                        {viewingClient.address ? (
                          <>
                            {viewingClient.address}<br/>
                            {viewingClient.city} {viewingClient.country}
                          </>
                        ) : '-'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Briefcase className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div>
                      <div className="text-[11px] text-gray-500 font-medium">Matricule Fiscal / CIN</div>
                      <div className="text-[13px] text-gray-900">{viewingClient.taxId || '-'}</div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Encaissements — every dated entry, both the manually typed
                  ones and those merged in from the Brouillard de caisse. This
                  is the only place the full list is shown; the table cell
                  only ever gives the total, so one client with many small
                  versements can't stretch that row past every other. */}
              {(() => {
                const manual = Array.isArray(viewingClient.encaissements) ? viewingClient.encaissements : [];
                const journal = viewingClient.journalEncaissements || [];
                const all = [...manual.map(e => ({ ...e, source: undefined as string | undefined })), ...journal]
                  .slice()
                  .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
                if (all.length === 0) return null;
                return (
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                        Encaissements ({all.length})
                      </h3>
                      <span className="text-[12px] font-mono font-semibold text-gray-700">
                        {formatCostTND(sumEncaissements(manual) + sumEncaissements(journal))}
                      </span>
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                      {all.map(entry => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 text-[12px]"
                        >
                          <div className="flex items-center gap-2 text-gray-500">
                            <span>{entry.date ? new Date(entry.date).toLocaleDateString('fr-FR') : '—'}</span>
                            {entry.note && <span className="text-gray-400 italic truncate max-w-[140px]">{entry.note}</span>}
                            {/* Says whether this encaissement went through
                                the caisse or not — a virement is recorded in
                                Cash exactly like an espèce but never reaches
                                the till, so badging every Cash-sourced entry
                                "caisse" would have mislabelled it. */}
                            {entry.source === 'BROUILLARD' && (
                              entry.isCaisse === false ? (
                                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[9px] font-semibold uppercase tracking-wide shrink-0">
                                  {paymentModeLabel(entry.paymentMethod) || 'hors caisse'}
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-turquoise/10 text-turquoise text-[9px] font-semibold uppercase tracking-wide shrink-0">
                                  caisse
                                </span>
                              )
                            )}
                          </div>
                          <span className="font-mono font-semibold text-gray-800 shrink-0">
                            {formatCostTND(Number(entry.amount) || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })()}

              {/* Notes */}
              {viewingClient.notes && (
                <section>
                  <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Notes</h3>
                  <div className="bg-yellow-50/50 border border-yellow-100 p-4 rounded-lg text-[13px] text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {viewingClient.notes}
                  </div>
                </section>
              )}

              {/* Custom Fields */}
              {viewingClient.customFields && Object.keys(viewingClient.customFields).length > 0 && (
                <section>
                  <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Champs personnalisés</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50/50 p-4 rounded-lg border border-gray-100">
                    {Object.entries(viewingClient.customFields).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => (
                      <div key={key}>
                        <div className="text-[11px] text-gray-500 mb-0.5">{key}</div>
                        <div className="text-[13px] font-medium text-gray-900">{value as string || '-'}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Activity / Relations placeholders */}
              <section>
                <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Activité</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-gray-400" />
                      <span className="text-[13px] font-medium text-gray-700">Missions</span>
                    </div>
                    <span className="text-[11px] text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-200">À venir</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-gray-400" />
                      <span className="text-[13px] font-medium text-gray-700">Suivi du temps</span>
                    </div>
                    <span className="text-[11px] text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-200">À venir</span>
                  </div>
                </div>
              </section>

            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center text-[11px] text-gray-400">
              <span>Créé le {new Date(viewingClient.createdAt).toLocaleDateString()}</span>
              {hasPermission('EDIT_CLIENTS') && (
                <button
                  onClick={(e) => {
                    setViewingClient(null);
                    handleOpenEdit(viewingClient, e);
                  }}
                  className="font-medium text-navy hover:underline"
                >
                  Modifier les informations
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
