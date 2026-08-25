import React, { useEffect, useState } from 'react';
import { Plus, Loader2, Receipt, Search, Trash2, Pencil, FileText, AlertTriangle, Building2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { InvoiceEditor } from './InvoiceEditor';
import { InvoicePreview } from './InvoicePreview';
import { CompanySettings } from './CompanySettings';
import { friendlyError } from '../../utils/errors';

const money = (v: number) =>
  (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Payment dates are stored ISO; the Cash screen reads DD/MM/YYYY throughout. */
const frDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

const KIND_LABEL: Record<string, string> = {
  FACTURE_LEGALE: 'Facture légale',
  AUTRE: 'Autre document',
};
const REGIME_LABEL: Record<string, string> = {
  DROIT_COMMUN: 'Droit commun',
  SUSPENSION: 'Suspension de TVA',
  EXPORT: 'Vente à l’export',
};
const CURRENCY_SUFFIX: Record<string, string> = { TND: 'DT', USD: 'USD', EUR: 'EUR' };
const REGIME_BADGE: Record<string, string> = {
  SUSPENSION: 'bg-amber-50 text-amber-700',
  EXPORT: 'bg-purple-50 text-purple-700',
};

/**
 * Cash — the facturation view. Lists the documents issued and hosts the
 * creation workflow from the cahier des charges.
 */
export const CashManagement: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [invoices, setInvoices] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  /** false = closed, null = creating, object = editing that document. */
  const [editor, setEditor] = useState<false | { invoice: any | null }>(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);

  const canManage = hasPermission('MANAGE_CASH');

  const load = async (q = '') => {
    try {
      const res = await fetch(`/api/invoices?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Chargement impossible');
      const body = await res.json();
      setInvoices(body.data ?? []);
      setTotal(body.total ?? 0);
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Server-side search, debounced — the list is never fully loaded client-side.
  useEffect(() => {
    const h = setTimeout(() => load(search.trim()), 250);
    return () => clearTimeout(h);
  }, [search]);

  const remove = async (invoice: any) => {
    if (!confirm(`Supprimer le document ${invoice.number} — ${invoice.clientName} ?`)) return;
    const res = await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE', headers: authHeaders });
    if (res.ok) load(search.trim());
    else setError('Suppression impossible');
  };

  if (!hasPermission('VIEW_CASH')) {
    return (
      <div className="p-8 text-center text-gray-500">
        Vous n'avez pas l'autorisation d'accéder à cette page.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col space-y-6 max-w-[1200px] w-full mx-auto p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-gray-800 tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Cash
          </h1>
          <p className="text-[12px] text-gray-500 mt-1">
            Factures légales et autres documents émis aux clients.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="N°, client, titre…"
              className="pl-8 pr-3 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 w-56"
            />
          </div>
          {canManage && (
            <button
              onClick={() => setCompanyOpen(true)}
              title="Informations affichées au bas de chaque document"
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 shrink-0"
            >
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">Informations de facturation</span>
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setEditor({ invoice: null })}
              className="bg-navy hover:bg-navy-hover text-white px-4 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Nouveau document
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-[13px] text-gray-500">
              {search ? `Aucun document ne correspond à « ${search} ».` : 'Aucun document émis pour le moment.'}
            </p>
            {canManage && !search && (
              <button onClick={() => setEditor({ invoice: null })} className="mt-3 text-[13px] font-medium text-blue-600 hover:text-blue-800">
                Créer le premier document
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead>
                <tr className="bg-[#F9FAFB] border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">N°</th>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Régime</th>
                  <th className="px-4 py-3 text-right">Total HT</th>
                  <th className="px-4 py-3 text-right bg-emerald-50/40">Montant de facture</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="text-[12.5px] divide-y divide-gray-100">
                {invoices.map(inv => (
                  <tr
                    key={inv.id}
                    onClick={() => setPreview(inv)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3 font-mono font-bold text-gray-900">{inv.number}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{inv.title}</div>
                      <div className="text-[11px] text-gray-400">{KIND_LABEL[inv.documentKind] ?? inv.documentKind}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-800">{inv.clientName}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.issueDate}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                        REGIME_BADGE[inv.vatRegime] ?? 'bg-blue-50 text-blue-700'
                      }`}>
                        {REGIME_LABEL[inv.vatRegime] ?? inv.vatRegime}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{money(inv.totalHT)}</td>
                    <td className="px-4 py-3 text-right bg-emerald-50/20">
                      <span className="font-mono font-semibold text-emerald-900">{money(inv.totalNetToPay)} {CURRENCY_SUFFIX[inv.currency] || inv.currency || 'DT'}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {canManage && (
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={e => { e.stopPropagation(); setEditor({ invoice: inv }); }}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
                            title="Modifier"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); remove(inv); }}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total > invoices.length && (
              <div className="px-4 py-2 text-[11px] text-gray-500 bg-gray-50 border-t border-gray-100 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-gray-400" />
                {invoices.length} document(s) affiché(s) sur {total}.
              </div>
            )}
          </div>
        )}
      </div>

      {editor && (
        <InvoiceEditor
          invoice={editor.invoice}
          onClose={() => setEditor(false)}
          onSaved={() => { setEditor(false); setPreview(null); load(search.trim()); }}
        />
      )}

      {companyOpen && <CompanySettings onClose={() => setCompanyOpen(false)} />}

      {preview && (
        <InvoicePreview
          invoice={preview}
          onClose={() => setPreview(null)}
          onEdit={canManage ? (inv) => { setPreview(null); setEditor({ invoice: inv }); } : undefined}
          onDelete={canManage ? async (inv) => { await remove(inv); setPreview(null); } : undefined}
        />
      )}
    </div>
  );
};
