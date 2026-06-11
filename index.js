require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors({
  origin: ['https://mda-permanences-app.onrender.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.options('*', cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || process.env.API_SECRET || 'mda-secret-2026';

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

function auth(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Non autorisé' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  next();
}

app.get('/health', (req, res) => res.json({ ok: true }));

/* Login */
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Identifiants manquants' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    const user = result.rows[0];
    if (!user || user.password_hash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, display_name: user.display_name, initiales: user.initiales, is_admin: user.is_admin },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, initiales: user.initiales, is_admin: user.is_admin } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Changer son mot de passe */
app.post('/change-password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Champs manquants' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum)' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = result.rows[0];
    if (!user || user.password_hash !== hashPassword(current_password)) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(new_password), req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Gestion users (admin) */
app.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, display_name, initiales, is_admin, created_at FROM users ORDER BY display_name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/users', auth, adminOnly, async (req, res) => {
  const { username, password, display_name, initiales, is_admin } = req.body;
  if (!username || !password || !display_name || !initiales) return res.status(400).json({ error: 'Champs manquants' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum)' });
  try {
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, display_name, initiales, is_admin) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, display_name, initiales, is_admin',
      [username, hashPassword(password), display_name, initiales.toUpperCase(), !!is_admin]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Cet identifiant existe déjà' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/users/:id/reset-password', auth, adminOnly, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court' });
  try {
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(new_password), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/users/:id', auth, adminOnly, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Impossible de supprimer son propre compte' });
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(auth);

/* Motifs personnalisés */
app.get('/motifs-custom', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, label FROM motifs_custom ORDER BY label');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/motifs-custom', async (req, res) => {
  const { label } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'Le label est obligatoire' });
  try {
    const result = await pool.query('INSERT INTO motifs_custom (label) VALUES ($1) RETURNING id, label', [label.trim()]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ce motif existe déjà' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/motifs-custom/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM motifs_custom WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Contacts */
app.get('/contacts', async (req, res) => {
  const { type, from, to, conseiller, a_rappeler } = req.query;
  const conditions = [];
  const values = [];
  if (type) { values.push(type); conditions.push(`type = $${values.length}`); }
  if (from) { values.push(from); conditions.push(`date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`date <= $${values.length}`); }
  if (conseiller) {
    const col = `qui_${conseiller.toLowerCase()}`;
    const allowed = ['qui_ck','qui_kr','qui_lv','qui_vc','qui_cc'];
    if (allowed.includes(col)) conditions.push(`${col} = TRUE`);
  }
  if (a_rappeler === '1') conditions.push(`a_rappeler = TRUE`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const result = await pool.query(`SELECT * FROM contacts ${where} ORDER BY date DESC, id DESC`, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/contacts', async (req, res) => {
  const c = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO contacts (
        date, type,
        id_adherent, id_non_adherent, id_ancien_adherent, id_structure, id_autres,
        motif_declaration, motif_adjonction, motif_juridique, motif_social,
        motif_comptable_fiscal, motif_communication, motif_adhesion,
        motif_activite_artistique, motif_autres,
        mail, telephone, qui_ck, qui_kr, qui_lv, qui_vc, qui_cc,
        remarques, suivi, newsletter, comment_connu,
        prenom, nom, motifs_custom, a_rappeler
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
      ) RETURNING *`,
      [
        c.date, c.type,
        !!c.id_adherent, !!c.id_non_adherent, !!c.id_ancien_adherent,
        !!c.id_structure, !!c.id_autres,
        !!c.motif_declaration, !!c.motif_adjonction, !!c.motif_juridique,
        !!c.motif_social, !!c.motif_comptable_fiscal, !!c.motif_communication,
        !!c.motif_adhesion, !!c.motif_activite_artistique, !!c.motif_autres,
        c.mail || null, c.telephone || null,
        !!c.qui_ck, !!c.qui_kr, !!c.qui_lv, !!c.qui_vc, !!c.qui_cc,
        c.remarques || null, c.suivi || null,
        !!c.newsletter, c.comment_connu || null,
        c.prenom || null, c.nom || null,
        c.motifs_custom && c.motifs_custom.length ? c.motifs_custom : null,
        !!c.a_rappeler
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/contacts/:id', async (req, res) => {
  const c = req.body;
  try {
    const result = await pool.query(`
      UPDATE contacts SET
        date=$1, type=$2,
        id_adherent=$3, id_non_adherent=$4, id_ancien_adherent=$5,
        id_structure=$6, id_autres=$7,
        motif_declaration=$8, motif_adjonction=$9, motif_juridique=$10,
        motif_social=$11, motif_comptable_fiscal=$12, motif_communication=$13,
        motif_adhesion=$14, motif_activite_artistique=$15, motif_autres=$16,
        mail=$17, telephone=$18, qui_ck=$19, qui_kr=$20, qui_lv=$21, qui_vc=$22, qui_cc=$23,
        remarques=$24, suivi=$25, newsletter=$26, comment_connu=$27,
        prenom=$28, nom=$29, motifs_custom=$30, a_rappeler=$31
      WHERE id=$32 RETURNING *`,
      [
        c.date, c.type,
        !!c.id_adherent, !!c.id_non_adherent, !!c.id_ancien_adherent,
        !!c.id_structure, !!c.id_autres,
        !!c.motif_declaration, !!c.motif_adjonction, !!c.motif_juridique,
        !!c.motif_social, !!c.motif_comptable_fiscal, !!c.motif_communication,
        !!c.motif_adhesion, !!c.motif_activite_artistique, !!c.motif_autres,
        c.mail || null, c.telephone || null,
        !!c.qui_ck, !!c.qui_kr, !!c.qui_lv, !!c.qui_vc, !!c.qui_cc,
        c.remarques || null, c.suivi || null,
        !!c.newsletter, c.comment_connu || null,
        c.prenom || null, c.nom || null,
        c.motifs_custom && c.motifs_custom.length ? c.motifs_custom : null,
        !!c.a_rappeler,
        req.params.id
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/contacts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM contacts WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/stats', async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const values = [];
  if (from) { values.push(from); conditions.push(`date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`date <= $${values.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const [totals, byType, byDate, byMotif, byQui] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, type FROM contacts ${where} GROUP BY type`, values),
      pool.query(`SELECT type, COUNT(*) as n FROM contacts ${where} GROUP BY type`, values),
      pool.query(`SELECT date, type, COUNT(*) as n FROM contacts ${where} GROUP BY date, type ORDER BY date`, values),
      pool.query(`SELECT SUM(motif_declaration::int) AS declaration, SUM(motif_adjonction::int) AS adjonction, SUM(motif_juridique::int) AS juridique, SUM(motif_social::int) AS social, SUM(motif_comptable_fiscal::int) AS comptable_fiscal, SUM(motif_communication::int) AS communication, SUM(motif_adhesion::int) AS adhesion, SUM(motif_activite_artistique::int) AS activite_artistique, SUM(motif_autres::int) AS autres FROM contacts ${where}`, values),
      pool.query(`SELECT SUM(qui_ck::int) AS ck, SUM(qui_kr::int) AS kr, SUM(qui_lv::int) AS lv, SUM(qui_vc::int) AS vc, SUM(qui_cc::int) AS cc FROM contacts ${where}`, values)
    ]);
    res.json({ totals: totals.rows, byType: byType.rows, byDate: byDate.rows, byMotif: byMotif.rows[0], byQui: byQui.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/export/csv', async (req, res) => {
  const { from, to, type, conseiller, a_rappeler } = req.query;
  const conditions = [];
  const values = [];
  if (type) { values.push(type); conditions.push(`type = $${values.length}`); }
  if (from) { values.push(from); conditions.push(`date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`date <= $${values.length}`); }
  if (conseiller) {
    const col = `qui_${conseiller.toLowerCase()}`;
    const allowed = ['qui_ck','qui_kr','qui_lv','qui_vc','qui_cc'];
    if (allowed.includes(col)) conditions.push(`${col} = TRUE`);
  }
  if (a_rappeler === '1') conditions.push(`a_rappeler = TRUE`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const result = await pool.query(`SELECT * FROM contacts ${where} ORDER BY date, id`, values);
    const headers = ['id','date','type','prénom','nom','adhérent','non-adhérent','ancien adhérent','structure','autres (ID)','déclaration','adjonction','juridique','social','comptable/fiscal','communication','adhésion','activité artistique','autres (motif)','mail','téléphone','CK','KR','LV','VC','CC','remarques/thèmes','suivi','newsletter','comment connu','créé le'];
    const rows = result.rows.map(r => [
      r.id, r.date, r.type, r.prenom||'', r.nom||'',
      r.id_adherent?1:'', r.id_non_adherent?1:'', r.id_ancien_adherent?1:'',
      r.id_structure?1:'', r.id_autres?1:'',
      r.motif_declaration?1:'', r.motif_adjonction?1:'', r.motif_juridique?1:'',
      r.motif_social?1:'', r.motif_comptable_fiscal?1:'', r.motif_communication?1:'',
      r.motif_adhesion?1:'', r.motif_activite_artistique?1:'', r.motif_autres?1:'',
      r.mail||'', r.telephone||'',
      r.qui_ck?1:'', r.qui_kr?1:'', r.qui_lv?1:'', r.qui_vc?1:'', r.qui_cc?1:'',
      (r.remarques||'').replace(/\n/g,' '),
      (r.suivi||'').replace(/\n/g,' '),
      r.newsletter?1:'', r.comment_connu||'', r.created_at
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mda-permanences.csv"');
    res.send('\uFEFF' + [headers.join(','), ...rows].join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`MDA API running on port ${PORT}`));
