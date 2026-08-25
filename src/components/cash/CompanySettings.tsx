import React, { useEffect, useRef, useState } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { Building2, Check, Loader, Plus, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { CompanyBlock, BankAccount } from './invoicePdf';
import { friendlyError } from '../../utils/errors';

/**
 * The issuer identity printed at the foot of every document: company details,
 * bank details, signature.
 *
 * Lives inside Cash rather than in a global settings screen — it is invoicing
 * identity, and the project deliberately keeps one place per concern. Gated on
 * MANAGE_CASH for the same reason.
 */

const MAX_IMAGE_BYTES = 400_000;

/**
 * Downscales a picked image before it is stored. A phone photo is several
 * megabytes; the settings row is rewritten on every save and shipped with
 * every document, so it is resized to something a footer/header can actually
 * use. Shared by the logo and the signature — only the target box differs.
 */
const prepareImage = (file: File, maxW: number, maxH: number, tooLargeMessage: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Image illisible.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image illisible.'));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Traitement impossible.'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL('image/png');
        if (out.length > MAX_IMAGE_BYTES) {
          return reject(new Error(tooLargeMessage));
        }
        resolve(out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

const EMPTY: CompanyBlock = {
  company: { name: '', address: '', taxId: '', email: '', phone: '' },
  banks: [],
  defaultBankId: '',
  logo: '',
  signature: '',
  stamp: '',
  showSignature: true,
};

export const CompanySettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEscapeToClose(onClose);
  const { token } = useAuth();
  const [form, setForm] = useState<CompanyBlock>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const logoFileRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stampFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/cash/company', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(body => { if (body) setForm({ ...EMPTY, ...body }); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const setCompany = (k: keyof CompanyBlock['company'], v: string) =>
    setForm(f => ({ ...f, company: { ...f.company, [k]: v } }));

  const addBank = () =>
    setForm(f => {
      const id = `local-${Date.now()}`;
      return { ...f, banks: [...f.banks, { id, name: '', rib: '', iban: '', swift: '' }], defaultBankId: f.defaultBankId || id };
    });
  const updateBank = (id: string, k: keyof BankAccount, v: string) =>
    setForm(f => ({ ...f, banks: f.banks.map(b => (b.id === id ? { ...b, [k]: v } : b)) }));
  const removeBank = (id: string) =>
    setForm(f => {
      const banks = f.banks.filter(b => b.id !== id);
      return { ...f, banks, defaultBankId: f.defaultBankId === id ? (banks[0]?.id || '') : f.defaultBankId };
    });
  const setDefaultBank = (id: string) => setForm(f => ({ ...f, defaultBankId: id }));

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const logo = await prepareImage(file, 400, 200, 'Logo trop lourd même après réduction. Utilisez une image plus simple.');
      setForm(f => ({ ...f, logo }));
    } catch (e: any) {
      setError(friendlyError(e));
    }
  };

  const pickSignature = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const signature = await prepareImage(file, 600, 300, 'Signature trop lourde même après réduction. Utilisez une image plus simple.');
      setForm(f => ({ ...f, signature }));
    } catch (e: any) {
      setError(friendlyError(e));
    }
  };

  const pickStamp = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const stamp = await prepareImage(file, 600, 300, 'Cachet trop lourd même après réduction. Utilisez une image plus simple.');
      setForm(f => ({ ...f, stamp }));
    } catch (e: any) {
      setError(friendlyError(e));
    }
  };

  const save = async () => {
    setError(''); setSaving(true);
    try {
      const res = await fetch('/api/cash/company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Enregistrement impossible.');
      setForm({ ...EMPTY, ...body });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder = '', mono = false) => (
    <div>
      <label className="block text-[11px] font-semibold text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:outline-none focus:border-gray-400 placeholder-gray-300 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 bg-gray-900/40 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-4">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-gray-500" />
            <div>
              <h2 className="text-[14px] font-bold text-gray-900">Informations de facturation</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Affichées au bas de chaque document, à l'écran comme dans le PDF.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center"><Loader className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : (
          <div className="p-5 space-y-6">
            <section className="space-y-3">
              <h3 className="text-[11px] font-extrabold text-gray-800 uppercase tracking-[0.05em]">
                Informations de l'entreprise
              </h3>
              {field('Raison sociale', form.company.name, v => setCompany('name', v), 'Société XYZ')}
              {field('Adresse', form.company.address, v => setCompany('address', v), '9 rue exemple, Tunis')}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {field('Matricule fiscal', form.company.taxId, v => setCompany('taxId', v), '0000025')}
                {field('E-mail', form.company.email, v => setCompany('email', v), 'exemple@exemple.tn')}
                {field('Téléphone', form.company.phone, v => setCompany('phone', v), '+216 26 999 999')}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-extrabold text-gray-800 uppercase tracking-[0.05em]">
                  Informations bancaires
                </h3>
                <span className="text-[10.5px] text-gray-400">Réglement reçu sur la banque par défaut</span>
              </div>

              {form.banks.length === 0 && (
                <p className="text-[12px] text-gray-400 italic">Aucune banque configurée.</p>
              )}

              {form.banks.map((bank, i) => (
                <div key={bank.id} className="border border-gray-200 rounded-lg p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-[12px] font-bold text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="defaultBank"
                        checked={form.defaultBankId === bank.id}
                        onChange={() => setDefaultBank(bank.id)}
                        className="accent-navy"
                      />
                      Banque {i + 1}{form.defaultBankId === bank.id ? ' — par défaut' : ''}
                    </label>
                    <button
                      onClick={() => removeBank(bank.id)}
                      className="text-gray-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50"
                      title="Supprimer cette banque"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {field('Banque', bank.name, v => updateBank(bank.id, 'name', v), 'ATB, BIAT, BNA…')}
                    {field('RIB', bank.rib, v => updateBank(bank.id, 'rib', v), '00 000 0000000000000 00', true)}
                    {field('IBAN', bank.iban, v => updateBank(bank.id, 'iban', v), 'TN59 XXXX XXXX XXXX XXXX XXXX', true)}
                    {field('Code BIC (Swift)', bank.swift, v => updateBank(bank.id, 'swift', v), 'XXXXTNTT', true)}
                  </div>
                </div>
              ))}

              <button
                onClick={addBank}
                className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Ajouter Banque
              </button>
            </section>

            <section className="space-y-3">
              <h3 className="text-[11px] font-extrabold text-gray-800 uppercase tracking-[0.05em]">
                Logo
              </h3>
              <div className="flex items-center gap-4">
                <div className="w-40 h-20 border border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50 shrink-0">
                  {form.logo
                    ? <img src={form.logo} alt="Logo" className="max-h-16 max-w-36 object-contain" />
                    : <span className="text-[11px] text-gray-300">Aucun</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={e => { pickLogo(e.target.files?.[0]); e.target.value = ''; }}
                  />
                  <button
                    onClick={() => logoFileRef.current?.click()}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" /> Choisir une image
                  </button>
                  {form.logo && (
                    <button
                      onClick={() => setForm(f => ({ ...f, logo: '' }))}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Retirer
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                PNG, JPEG ou WEBP. Affiché en en-tête de chaque document, à l'écran comme dans le PDF.
              </p>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-extrabold text-gray-800 uppercase tracking-[0.05em]">
                  Signature et cachet
                </h3>
                <label className="flex items-center gap-2 text-[12px] font-medium text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.showSignature}
                    onChange={e => setForm(f => ({ ...f, showSignature: e.target.checked }))}
                    className="accent-navy w-4 h-4"
                  />
                  Afficher sur les documents
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-gray-500">Signature</p>
                  <div className="flex items-center gap-4">
                    <div className="w-32 h-20 border border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50 shrink-0">
                      {form.signature
                        ? <img src={form.signature} alt="Signature" className="max-h-16 max-w-28 object-contain" />
                        : <span className="text-[11px] text-gray-300">Aucune</span>}
                    </div>
                    <div className="flex flex-col gap-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={e => { pickSignature(e.target.files?.[0]); e.target.value = ''; }}
                      />
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" /> Choisir
                      </button>
                      {form.signature && (
                        <button
                          onClick={() => setForm(f => ({ ...f, signature: '' }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Retirer
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-gray-500">Cachet</p>
                  <div className="flex items-center gap-4">
                    <div className="w-32 h-20 border border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50 shrink-0">
                      {form.stamp
                        ? <img src={form.stamp} alt="Cachet" className="max-h-16 max-w-28 object-contain" />
                        : <span className="text-[11px] text-gray-300">Aucun</span>}
                    </div>
                    <div className="flex flex-col gap-2">
                      <input
                        ref={stampFileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={e => { pickStamp(e.target.files?.[0]); e.target.value = ''; }}
                      />
                      <button
                        onClick={() => stampFileRef.current?.click()}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" /> Choisir
                      </button>
                      {form.stamp && (
                        <button
                          onClick={() => setForm(f => ({ ...f, stamp: '' }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Retirer
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                PNG, JPEG ou WEBP. Les images sont réduites automatiquement avant enregistrement.
              </p>
            </section>
          </div>
        )}

        <div className="px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white rounded-b-xl">
          {error && (
            <div className="mb-3 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-[12px] font-medium rounded-r-md">
              {error}
            </div>
          )}
          <div className="flex justify-end items-center gap-3">
            {saved && (
              <span className="text-[12px] text-green-600 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Enregistré
              </span>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-100 bg-white"
            >
              Fermer
            </button>
            <button
              onClick={save}
              disabled={saving || loading}
              className="px-4 py-2 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-hover flex items-center gap-2 disabled:opacity-50"
            >
              {saving && <Loader className="w-4 h-4 animate-spin" />}
              Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
