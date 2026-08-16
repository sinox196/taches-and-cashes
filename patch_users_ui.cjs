const fs = require('fs');
const content = fs.readFileSync('src/components/UsersManagement.tsx', 'utf8');
const lines = content.split('\n');

const startIndex = lines.findIndex(l => l.includes('<h3 className="text-[13px] font-bold text-gray-800 mb-3">Paramètres du coût employeur</h3>'));
const endIndex = lines.findIndex((l, idx) => idx > startIndex && l.includes('</div>')) + 4; // To cover the whole block till closing of the last div block.
// Wait, looking at the previous grep, the structure is:
// 393-                <div className="pt-4 border-t border-gray-200 mt-4">
// 394:                  <h3 className="text-[13px] font-bold text-gray-800 mb-3">Paramètres du coût employeur</h3>
// 395-                  
// 396-                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
// ...
// 470-                  </div>
// 471-
// 472-                  <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5">
// ...
// 493-                  </div>
// 494-                </div>

const startLine = lines.findIndex(l => l.includes('Paramètres du coût employeur</h3>'));
let endLine = startLine;
while (!lines[endLine].includes('coutHoraireEmployeur.toFixed(3)')) {
  endLine++;
}
endLine += 3; // Go past </div></div>

const newBlock = `                  <h3 className="text-[13px] font-bold text-gray-800 mb-4">Coût employeur</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Salaire brut mensuel (DT)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formSalaireBrut}
                        onChange={e => setFormSalaireBrut(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent"
                        placeholder="Ex: 2000.00"
                      />
                    </div>

                    <div className="flex justify-between items-center text-[13px] text-gray-700 max-w-sm">
                      <span>Charges patronales ({totalChargesPct.toFixed(2)}%)</span>
                      <span className="font-medium text-gray-900">+{montantsCharges.toFixed(2)} DT</span>
                    </div>

                    <div className="flex justify-between items-center text-[13px] text-gray-700 max-w-sm">
                      <span>Sous-total</span>
                      <span className="font-medium text-gray-900">{(simSalaire + montantsCharges).toFixed(2)} DT</span>
                    </div>

                    <div>
                      <label className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-700 mb-1">
                        Primes & frais non cotisables (DT)
                        <div className="group relative flex items-center">
                          <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-gray-900 text-white text-[11.5px] leading-relaxed rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-center pointer-events-none">
                            Saisissez ici les frais professionnels et indemnités exonérés de charges patronales (ex: remboursement de frais de déplacement sur justificatifs). Ces montants s'ajoutent directement au coût total sans appliquer les charges patronales.
                          </div>
                        </div>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formPrimesFraisNonCotisables}
                        onChange={e => setFormPrimesFraisNonCotisables(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent"
                        placeholder="Ex: 100.00"
                      />
                    </div>

                    <div className="pt-4 border-t border-gray-200 max-w-sm">
                      <div className="flex justify-between items-center text-[14px] font-bold text-gray-900">
                        <span>COÛT TOTAL EMPLOYEUR</span>
                        <span>{coutTotalEmployeur.toFixed(2)} DT</span>
                      </div>
                    </div>
                  </div>

                  <h3 className="text-[13px] font-bold text-gray-800 mt-8 mb-4">Configuration des charges & Heures</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Régime horaire (Heures)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={formRegimeHoraire}
                        onChange={e => setFormRegimeHoraire(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent"
                        placeholder="Ex: 48"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">CNSS patronale (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formCnss}
                        onChange={e => setFormCnss(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">TFP (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formTfp}
                        onChange={e => setFormTfp(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">FOPROLOS (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formFoprolos}
                        onChange={e => setFormFoprolos(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1">Accident du travail (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formAccidentTravail}
                        onChange={e => setFormAccidentTravail(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] focus:ring-2 focus:ring-[#101828] focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5 max-w-sm">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-gray-600">Heures mensuelles:</span>
                      <span className="font-semibold text-gray-800">{heuresMensuelles.toFixed(2)} h</span>
                    </div>
                    <div className="flex justify-between text-[12px]">
                      <span className="text-gray-600">Coût horaire employeur:</span>
                      <span className="font-bold text-blue-600">{coutHoraireEmployeur.toFixed(3)} DT/h</span>
                    </div>`;

lines.splice(startLine, endLine - startLine + 1, newBlock);

fs.writeFileSync('src/components/UsersManagement.tsx', lines.join('\n'));
