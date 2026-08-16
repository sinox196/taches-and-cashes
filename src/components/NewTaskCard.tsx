import React, { useState, useEffect, useRef } from 'react';
import { Play, Plus, X, Settings2, Check, ChevronDown, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface NewTaskCardProps {
  clients: any[];
  services: any[];
  onStartNewTask: (client: string, service: string, description: string, clientId?: number, serviceId?: number) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  refreshServices: () => void;
}

export const NewTaskCard: React.FC<NewTaskCardProps> = ({
  clients,
  services,
  onStartNewTask,
  isOpen,
  onToggleOpen,
  refreshServices
}) => {
  const { hasPermission, token } = useAuth();
  
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);

  const [managingMode, setManagingMode] = useState<'add' | 'edit' | false>(false);
  const [serviceInputName, setServiceInputName] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsClientDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const availableServices = selectedClientId
    ? services.filter(s => String(s.clientId) === String(selectedClientId) || s.clientId === null)
    : services;

  const filteredClients = clientSearch.length >= 2 
    ? clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
    : [];

  const handleClientSelect = (clientId: string, clientName: string) => {
    setSelectedClientId(clientId);
    setClientSearch(clientName);
    setIsClientDropdownOpen(false);
    setSelectedServiceId('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    const client = clients.find(c => String(c.id) === selectedClientId);
    const service = services.find(s => String(s.id) === selectedServiceId);
    
    const finalClientName = client ? client.name : clientSearch;
    const finalServiceName = service ? service.name : 'Unknown Service';
    const finalDescription = description.trim();
    
    onStartNewTask(
      finalClientName, 
      finalServiceName, 
      finalDescription, 
      client ? Number(client.id) : undefined,
      service ? Number(service.id) : undefined
    );
  };

  const handleSaveService = async () => {
    if (!serviceInputName.trim()) return;
    try {
      const isEdit = managingMode === 'edit' && selectedServiceId;
      const url = isEdit ? `/api/services/${selectedServiceId}` : '/api/services';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: serviceInputName,
          clientId: selectedClientId ? Number(selectedClientId) : null
        })
      });
      if (res.ok) {
        const savedService = await res.json();
        setServiceInputName('');
        setManagingMode(false);
        refreshServices();
        setSelectedServiceId(String(savedService.id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const startEditService = () => {
    const currentService = services.find(s => String(s.id) === selectedServiceId);
    if (currentService) {
      setServiceInputName(currentService.name);
      setManagingMode('edit');
    }
  };

  const startAddService = () => {
    setServiceInputName('');
    setManagingMode('add');
  };

  return (
    <div className="relative">
      <div className="flex justify-end mb-2">
        <button
          onClick={onToggleOpen}
          className="w-10 h-10 md:w-12 md:h-12 bg-[#101828] text-white rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-all cursor-pointer"
          title={isOpen ? 'Fermer le panneau' : 'Démarrer nouvelle tâche'}
        >
          {isOpen ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5 stroke-[2.5]" />}
        </button>
      </div>

      {isOpen && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-xl p-5 w-full sm:w-[320px] ml-auto transition-all animate-fadeIn">
          <h3 className="text-[11px] font-bold text-gray-800 mb-4 tracking-wider uppercase">
            DÉMARRER NOUVELLE TÂCHE
          </h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Field: Client */}
            <div ref={dropdownRef}>
              <label className="text-[10px] font-semibold text-gray-400 block mb-1">
                Client
              </label>
              <div className="relative">
                <div className="flex items-center border border-gray-200 rounded-md bg-white focus-within:border-gray-400 transition-colors">
                  <Search className="w-3.5 h-3.5 text-gray-400 ml-2" />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setIsClientDropdownOpen(true);
                      if (selectedClientId && e.target.value !== clients.find(c => String(c.id) === selectedClientId)?.name) {
                         setSelectedClientId('');
                      }
                    }}
                    onFocus={() => setIsClientDropdownOpen(true)}
                    placeholder="Rechercher un client..."
                    className="w-full px-2 py-1.5 text-[12px] font-medium text-gray-800 focus:outline-none bg-transparent"
                  />
                </div>
                
                {isClientDropdownOpen && clientSearch.length >= 2 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {filteredClients.length > 0 ? (
                      filteredClients.map(c => (
                        <div
                          key={c.id}
                          onClick={() => handleClientSelect(String(c.id), c.name)}
                          className="px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 cursor-pointer"
                        >
                          {c.name}
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-[12px] text-gray-500 italic">
                        Aucun client trouvé.
                      </div>
                    )}
                  </div>
                )}
                {isClientDropdownOpen && clientSearch.length > 0 && clientSearch.length < 2 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-100 rounded-md shadow-lg p-2 text-[11px] text-gray-500 text-center">
                    Tapez au moins 2 caractères...
                  </div>
                )}
              </div>
            </div>

            {/* Field: Mission */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-semibold text-gray-400 block">
                  Mission
                </label>
                {hasPermission('MANAGE_SERVICES') && (
                  <div className="flex items-center gap-2">
                    <button 
                      type="button" 
                      onClick={startAddService}
                      className="text-[9px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Ajouter
                    </button>
                    {selectedServiceId && (
                      <button 
                        type="button" 
                        onClick={startEditService}
                        className="text-[9px] text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1"
                      >
                        <Settings2 className="w-3 h-3" />
                        Modifier
                      </button>
                    )}
                  </div>
                )}
              </div>
              
              {managingMode ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={serviceInputName}
                    onChange={(e) => setServiceInputName(e.target.value)}
                    placeholder={managingMode === 'add' ? "Nouvelle mission..." : "Modifier mission..."}
                    className="flex-1 border border-gray-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleSaveService}
                    className="bg-blue-50 text-blue-600 px-2 rounded-md hover:bg-blue-100"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setManagingMode(false)}
                    className="bg-gray-50 text-gray-500 px-2 rounded-md hover:bg-gray-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={selectedServiceId}
                    onChange={(e) => setSelectedServiceId(e.target.value)}
                    className="w-full appearance-none bg-white border border-gray-200 rounded-md px-3 py-1.5 pr-8 text-[12px] font-medium text-gray-800 focus:outline-none focus:border-gray-400 transition-colors"
                  >
                    <option value="" disabled hidden>Sélectionner une mission</option>
                    {availableServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Field: Description de l'activité */}
            <div>
              <label className="text-[10px] font-semibold text-gray-400 block mb-1">
                Description de l'activité <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Préparation Bilan"
                className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-[12px] text-gray-800 focus:outline-none focus:border-gray-400 placeholder-gray-300 transition-colors"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!selectedClientId || (!selectedServiceId && !managingMode) || !description.trim()}
              className="w-full mt-2 bg-[#101828] hover:bg-[#1d2939] disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold text-[12px] py-2 px-3 rounded-md transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              title={(!selectedClientId || !selectedServiceId || !description.trim()) ? "Veuillez remplir tous les champs obligatoires" : ""}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>DÉMARRER</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
