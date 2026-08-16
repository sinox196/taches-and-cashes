import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Loader2, Settings as SettingsIcon, Save, Calculator } from 'lucide-react';

interface EmployerCharges {
  cnss: number;
  tfp: number;
  foprolos: number;
  accidentTravail: number;
}

export const SettingsPage: React.FC = () => {
  const { token, hasPermission } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [charges, setCharges] = useState<EmployerCharges>({
    cnss: 16.57,
    tfp: 1.0,
    foprolos: 1.0,
    accidentTravail: 0.5
  });

  const [simSalaire, setSimSalaire] = useState<number>(1000);
  const [simHeuresHebdo, setSimHeuresHebdo] = useState<number>(48);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.employerCharges) {
          setCharges(data.employerCharges);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ employerCharges: charges })
      });
      if (res.ok) {
        showToast('Les paramètres du coût employeur ont été mis à jour avec succès.');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleChargeChange = (field: keyof EmployerCharges, val: string) => {
    let num = parseFloat(val);
    if (isNaN(num) || num < 0) num = 0;
    setCharges(prev => ({ ...prev, [field]: num }));
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (!hasPermission('ADMIN')) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Vous n'avez pas l'autorisation d'accéder à cette page.
      </div>
    );
  }

  const totalChargesPct = charges.cnss + charges.tfp + charges.foprolos + charges.accidentTravail;
  const montantsCharges = simSalaire * (totalChargesPct / 100);
  const coutTotalEmployeur = simSalaire + montantsCharges;
  const heuresMensuelles = simHeuresHebdo * 4.33;
  
  const coutHoraireBase = heuresMensuelles > 0 ? simSalaire / heuresMensuelles : 0;
  const coutHoraireCharges = heuresMensuelles > 0 ? montantsCharges / heuresMensuelles : 0;
  const coutHoraireTotal = heuresMensuelles > 0 ? coutTotalEmployeur / heuresMensuelles : 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-[#F2F4F7]">
      <main className="p-6 lg:p-8 flex-1 flex flex-col space-y-6 max-w-[1000px] w-full mx-auto">
        <div>
          <h1 className="text-[20px] font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" />
            Paramètres Administration
          </h1>
          <p className="text-[13px] text-gray-500 mt-1">Configuration globale de l'application</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-800">Calcul du coût horaire global (Coût Employeur)</h2>
            <p className="text-sm text-gray-500 mt-1">
              Pour obtenir le coût réel complet pour l’entreprise, il faut ajouter au salaire brut les charges sociales patronales.
            </p>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CNSS patronale (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={charges.cnss}
                    onChange={(e) => handleChargeChange('cnss', e.target.value)}
                    className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">TFP (Taxe de Formation Professionnelle) (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={charges.tfp}
                    onChange={(e) => handleChargeChange('tfp', e.target.value)}
                    className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">FOPROLOS (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={charges.foprolos}
                    onChange={(e) => handleChargeChange('foprolos', e.target.value)}
                    className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Accident du travail (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={charges.accidentTravail}
                    onChange={(e) => handleChargeChange('accidentTravail', e.target.value)}
                    className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 text-blue-800 p-4 rounded-lg flex items-center justify-between">
              <span className="font-medium">Charges patronales totales:</span>
              <span className="text-lg font-bold">{totalChargesPct.toFixed(2)}%</span>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[#101828] text-white rounded-lg hover:bg-[#1D2939] transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Enregistrer
              </button>
            </div>
          </div>
        </div>

        {/* Simulation Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center gap-2">
            <Calculator className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-800">Simulation du coût horaire employeur</h2>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Salaire brut mensuel (DT)</label>
                <input
                  type="number"
                  min="0"
                  value={simSalaire}
                  onChange={(e) => setSimSalaire(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Régime horaire hebdomadaire (Heures)</label>
                <input
                  type="number"
                  min="0"
                  value={simHeuresHebdo}
                  onChange={(e) => setSimHeuresHebdo(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                />
                <p className="text-xs text-gray-500 mt-1">Heures mensuelles payées: {heuresMensuelles.toFixed(2)}h</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-500">
                    <th className="py-3 px-4">Élément</th>
                    <th className="py-3 px-4 text-right">Montant mensuel</th>
                    <th className="py-3 px-4 text-right">Coût horaire</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-100">
                  <tr>
                    <td className="py-3 px-4 text-gray-700">Salaire Brut de base</td>
                    <td className="py-3 px-4 text-right">{simSalaire.toFixed(2)} DT</td>
                    <td className="py-3 px-4 text-right">{coutHoraireBase.toFixed(3)} DT/h</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-gray-700">Charges Patronales ({totalChargesPct.toFixed(2)}%)</td>
                    <td className="py-3 px-4 text-right text-red-600">+{montantsCharges.toFixed(2)} DT</td>
                    <td className="py-3 px-4 text-right text-red-600">+{coutHoraireCharges.toFixed(3)} DT/h</td>
                  </tr>
                  <tr className="bg-gray-50 font-semibold">
                    <td className="py-3 px-4 text-gray-900">Coût Total Employeur</td>
                    <td className="py-3 px-4 text-right text-gray-900">{coutTotalEmployeur.toFixed(2)} DT</td>
                    <td className="py-3 px-4 text-right text-gray-900">{coutHoraireTotal.toFixed(3)} DT/h</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </main>

      {toastMessage && (
        <div className="fixed bottom-5 right-5 bg-[#101828] text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-xl z-50 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
