const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');
const lines = content.split('\n');

const getIndex = lines.findIndex(l => l.includes('// GET /api/users'));
const getEnd = lines.findIndex((l, idx) => idx > getIndex && l.includes('// POST /api/users'));

for (let i = getIndex; i < getEnd; i++) {
  if (lines[i].includes('accidentTravail: u.accidentTravail')) {
    lines.splice(i + 1, 0, `        primesFraisNonCotisables: u.primesFraisNonCotisables,
        coutTotalEmployeur: u.coutTotalEmployeur,
        coutHoraireEmployeur: u.coutHoraireEmployeur`);
    break;
  }
}

const postIndex = lines.findIndex(l => l.includes('// POST /api/users'));
const postEnd = lines.findIndex((l, idx) => idx > postIndex && l.includes('// PUT /api/users/:id'));

const newPost = `  // POST /api/users
  app.post('/api/users', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const { username, password, role, permissions, salaireBrut, regimeHoraire, cnss, tfp, foprolos, accidentTravail, primesFraisNonCotisables } = req.body;
      
      const existing = await db.get('SELECT * FROM users WHERE username = ?', username);
      if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
      }
      
      const hashed = await bcrypt.hash(password, 10);

      const simSalaire = typeof salaireBrut === 'number' ? salaireBrut : 0;
      const simRegime = typeof regimeHoraire === 'number' ? regimeHoraire : 0;
      const totalChargesPct = (typeof cnss === 'number' ? cnss : 0) + 
                              (typeof tfp === 'number' ? tfp : 0) + 
                              (typeof foprolos === 'number' ? foprolos : 0) + 
                              (typeof accidentTravail === 'number' ? accidentTravail : 0);
      const montantsCharges = simSalaire * (totalChargesPct / 100);
      const simPrimes = typeof primesFraisNonCotisables === 'number' ? primesFraisNonCotisables : 0;
      const coutTotalEmployeur = simSalaire + montantsCharges + simPrimes;
      const heuresMensuelles = simRegime * 4.33;
      const coutHoraireEmployeur = heuresMensuelles > 0 ? coutTotalEmployeur / heuresMensuelles : 0;

      const newUser = await db.createUser({
        id: Date.now(),
        username,
        password: hashed,
        role,
        permissions: JSON.stringify(permissions || []),
        salaireBrut,
        regimeHoraire,
        cnss,
        tfp,
        foprolos,
        accidentTravail,
        primesFraisNonCotisables,
        coutTotalEmployeur,
        coutHoraireEmployeur
      });
      
      const { password: _, ...userWithoutPassword } = newUser;
      res.json(userWithoutPassword);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });`;

lines.splice(postIndex, postEnd - postIndex, newPost);

const putIndex = lines.findIndex(l => l.includes('// PUT /api/users/:id'));
const putEnd = lines.findIndex((l, idx) => idx > putIndex && l.includes('// DELETE /api/users/:id'));

const newPut = `  // PUT /api/users/:id
  app.put('/api/users/:id', authenticate, requirePermission('MANAGE_USERS'), async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { role, permissions, password, salaireBrut, regimeHoraire, cnss, tfp, foprolos, accidentTravail, primesFraisNonCotisables } = req.body;
      
      const simSalaire = typeof salaireBrut === 'number' ? salaireBrut : 0;
      const simRegime = typeof regimeHoraire === 'number' ? regimeHoraire : 0;
      const totalChargesPct = (typeof cnss === 'number' ? cnss : 0) + 
                              (typeof tfp === 'number' ? tfp : 0) + 
                              (typeof foprolos === 'number' ? foprolos : 0) + 
                              (typeof accidentTravail === 'number' ? accidentTravail : 0);
      const montantsCharges = simSalaire * (totalChargesPct / 100);
      const simPrimes = typeof primesFraisNonCotisables === 'number' ? primesFraisNonCotisables : 0;
      const coutTotalEmployeur = simSalaire + montantsCharges + simPrimes;
      const heuresMensuelles = simRegime * 4.33;
      const coutHoraireEmployeur = heuresMensuelles > 0 ? coutTotalEmployeur / heuresMensuelles : 0;

      const updates: any = { 
        role, 
        permissions: JSON.stringify(permissions || []), 
        salaireBrut, 
        regimeHoraire, 
        cnss, 
        tfp, 
        foprolos, 
        accidentTravail,
        primesFraisNonCotisables,
        coutTotalEmployeur,
        coutHoraireEmployeur
      };
      
      if (password) {
        updates.password = await bcrypt.hash(password, 10);
      }
      
      const updatedUser = await db.updateUser(id, updates);
      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const { password: _, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });`;

lines.splice(putIndex, putEnd - putIndex, newPut);

fs.writeFileSync('server.ts', lines.join('\n'));
