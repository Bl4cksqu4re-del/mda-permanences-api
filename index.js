require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

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

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.API_SECRET) {
    res.json({ token: process.env.API_SECRET });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

function auth(req, res, next) {
  const token = req.headers['authorization'];
  if (!token || token !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

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
  if (!label || !label.trim()) {
    return res.status(400).json({ error: 'Le label est obligatoire' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO motifs_custom (label) VALUES ($1) RETURNING id, label',
      [label.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ error: 'Ce motif existe déjà' });
    } else {
      res.status(500).json({ error: err.message });
    }
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
  const { type, from, to } = req.query;
  const conditions = [];
  const values = [];
  if (type) { values.push(type); conditions.push(`type = $${values.length}`); }
  if (from) { values.push(from); conditions.push(`date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`date <= $${values.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const result = await pool.query(
      `SELECT * FROM contacts ${where} ORDER BY date DESC, id DESC`, values
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
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
        mail, telephone, qui_ck, qui_kr, qui_lv,
        remarques, suivi, newsletter, comment_connu,
        prenom, nom, motifs_custom
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
      ) RETURNING *`,
      [
        c.date, c.type,
        !!c.id_adherent, !!c.id_non_adherent, !!c.id_ancien_adherent,
        !!c.id_structure, !!c.id_autres,
        !!c.motif_declaration, !!c.motif_adjonction, !!c.motif_juridique,
        !!c.motif_social, !!c.motif_comptable_fiscal, !!c.motif_communication,
        !!c.motif_adhesion, !!c.motif_activite_artistique, !!c.motif_autres,
        c.mail || null, c.telephone || null,
        !!c.qui_ck, !!c.qui_kr, !!c.qui_lv,
        c.remarques || null, c.suivi || null,
        !!c.newsletter, c.comment_connu || null,
        c.prenom || null, c.nom || null,
        c.motifs_custom && c.motifs_custom.length ? c.motifs_custom : null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
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
        mail=$17, telephone=$18, qui_ck=$19, qui_kr=$20, qui_lv=$21,
        remarques=$22, suivi=$23, newsletter=$24, comment_connu=$25,
        prenom=$26, nom=$27, motifs_custom=$28
      WHERE id=$29 RETURNING *`,
      [
        c.date, c.type,
        !!c.id_adherent, !!c.id_non_adherent, !!c.id_ancien_adherent,
        !!c.id_structure, !!c.id_autres,
        !!c.motif_declaration, !!c.motif_adjonction, !!c.motif_juridique,
        !!c.motif_social, !!c.motif_comptable_fiscal, !!c.motif_communication,
        !!c.motif_adhesion, !!c.motif_activite_artistique, !!c.motif_autres,
        c.mail || null, c.telephone || null,
        !!c.qui_ck, !!c.qui_kr, !!c.qui_lv,
        c.remarques || null, c.suivi || null,
        !!c.newsletter, c.comment_connu || null,
        c.prenom || null, c.nom || null,
        c.motifs_custom && c.motifs_custom.length ? c.motifs_custom : null,
        req.params.id
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
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
      pool.query(`SELECT SUM(qui_ck::int) AS ck, SUM(qui_kr::int) AS kr, SUM(qui_lv::int) AS lv FROM contacts ${where}`, values)
    ]);
    res.json({ totals: totals.rows, byType: byType.rows, byDate: byDate.rows, byMotif: byMotif.rows[0], byQui: byQui.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/export/csv', async (req, res) => {
  const { from, to, type } = req.query;
  const conditions = [];
  const values = [];
  if (type) { values.push(type); conditions.push(`type = $${values.length}`); }
  if (from) { values.push(from); conditions.push(`date >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`date <= $${values.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const result = await pool.query(`SELECT * FROM contacts ${where} ORDER BY date, id`, values);
    const headers = ['id','date','type','prénom','nom','adhérent','non-adhérent','ancien adhérent','structure','autres (ID)','déclaration','adjonction','juridique','social','comptable/fiscal','communication','adhésion','activité artistique','autres (motif)','mail','téléphone','CK','KR','LV','remarques/thèmes','suivi','newsletter','comment connu','créé le'];
    const rows = result.rows.map(r => [
      r.id, r.date, r.type, r.prenom||'', r.nom||'',
      r.id_adherent?1:'', r.id_non_adherent?1:'', r.id_ancien_adherent?1:'',
      r.id_structure?1:'', r.id_autres?1:'',
      r.motif_declaration?1:'', r.motif_adjonction?1:'', r.motif_juridique?1:'',
      r.motif_social?1:'', r.motif_comptable_fiscal?1:'', r.motif_communication?1:'',
      r.motif_adhesion?1:'', r.motif_activite_artistique?1:'', r.motif_autres?1:'',
      r.mail||'', r.telephone||'',
      r.qui_ck?1:'', r.qui_kr?1:'', r.qui_lv?1:'',
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
