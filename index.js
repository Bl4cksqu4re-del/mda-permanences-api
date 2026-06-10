require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

/* =========================================================
CONFIG
========================================================= */

const PORT = process.env.PORT || 3001;

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: {
rejectUnauthorized: false
}
});

/* =========================================================
MIDDLEWARES
========================================================= */

app.use(cors({
origin: [
'https://mda-permanences-app.onrender.com',
'http://localhost:3000'
],
credentials: true
}));

app.use(express.json());

/* =========================================================
HEALTH CHECK
========================================================= */

app.get('/health', async (req, res) => {
try {
await pool.query('SELECT 1');

res.status(200).json({
  status: 'ok',
  database: 'connected',
  timestamp: new Date().toISOString()
});

} catch (err) {
res.status(500).json({
status: 'error',
database: 'disconnected',
error: err.message
});
}
});

/* =========================================================
LOGIN
========================================================= */

app.post('/login', (req, res) => {
const { password } = req.body;

if (!password) {
return res.status(400).json({
success: false,
error: 'Mot de passe requis'
});
}

if (password === process.env.API_SECRET || password === process.env.key_api) {
return res.json({
success: true,
token: password
});
}

return res.status(401).json({
success: false,
error: 'Mot de passe incorrect'
});
});

/* =========================================================
AUTH
========================================================= */

function auth(req, res, next) {
const token = req.headers.authorization?.trim();

if (!token) {
return res.status(401).json({
error: 'Token manquant'
});
}

const validTokens = [process.env.API_SECRET, process.env.key_api].filter(Boolean);
if (!validTokens.includes(token)) {
return res.status(401).json({
error: 'Token invalide'
});
}

next();
}

// Appliquer l'auth à toutes les routes protégées (APRÈS les routes publiques)
app.use(auth);

/* =========================================================
CONTACTS - GET
========================================================= */

app.get('/contacts', async (req, res) => {
try {
const { type, from, to } = req.query;

const values = [];
const conditions = [];

if (type) {
  if (!['TEL', 'PRES'].includes(type)) {
    return res.status(400).json({ error: 'Type invalide' });
  }
  values.push(type);
  conditions.push(`type = $${values.length}`);
}

if (from) {
  values.push(from);
  conditions.push(`date >= $${values.length}`);
}

if (to) {
  values.push(to);
  conditions.push(`date <= $${values.length}`);
}

const whereClause =
  conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

const result = await pool.query(
  `
  SELECT *
  FROM contacts
  ${whereClause}
  ORDER BY date DESC, id DESC
  `,
  values
);

res.json(result.rows);

} catch (err) {
console.error(err);
res.status(500).json({
  error: 'Erreur lors de la récupération des contacts'
});
}
});

/* =========================================================
CONTACTS - CREATE
========================================================= */

app.post('/contacts', async (req, res) => {
try {

const c = req.body;

// Validation basique
if (!c.date || !c.type) {
  return res.status(400).json({
    error: 'Date et type sont obligatoires'
  });
}

if (!['TEL', 'PRES'].includes(c.type)) {
  return res.status(400).json({
    error: 'Type invalide'
  });
}

const result = await pool.query(
  `
  INSERT INTO contacts (
    date,
    type,
    nom,
    prenom,
    tags,
    id_adherent,
    id_non_adherent,
    id_ancien_adherent,
    id_structure,
    id_autres,
    motif_declaration,
    motif_adjonction,
    motif_juridique,
    motif_social,
    motif_comptable_fiscal,
    motif_communication,
    motif_adhesion,
    motif_activite_artistique,
    motif_autres,
    mail,
    telephone,
    qui_ck,
    qui_kr,
    qui_lv,
    remarques,
    suivi,
    newsletter,
    comment_connu
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
    $11,$12,$13,$14,$15,$16,$17,$18,
    $19,$20,$21,$22,$23,$24,$25,$26,
    $27,$28
  )
  RETURNING *
  `,
  [
    c.date,
    c.type,
    c.nom || null,
    c.prenom || null,
    (c.tags && Array.isArray(c.tags) && c.tags.length > 0) ? c.tags : null,
    !!c.id_adherent,
    !!c.id_non_adherent,
    !!c.id_ancien_adherent,
    !!c.id_structure,
    !!c.id_autres,
    !!c.motif_declaration,
    !!c.motif_adjonction,
    !!c.motif_juridique,
    !!c.motif_social,
    !!c.motif_comptable_fiscal,
    !!c.motif_communication,
    !!c.motif_adhesion,
    !!c.motif_activite_artistique,
    !!c.motif_autres,
    c.mail || null,
    c.telephone || null,
    !!c.qui_ck,
    !!c.qui_kr,
    !!c.qui_lv,
    c.remarques || null,
    c.suivi || null,
    !!c.newsletter,
    c.comment_connu || null
  ]
);

res.status(201).json(result.rows[0]);

} catch (err) {
console.error(err);
res.status(500).json({
  error: 'Erreur lors de la création du contact'
});
}
});

/* =========================================================
CONTACTS - UPDATE
========================================================= */

app.put('/contacts/:id', async (req, res) => {

const id = req.params.id;
const c = req.body;

// Validation
if (!id || isNaN(id)) {
  return res.status(400).json({ error: 'ID invalide' });
}

try {

const result = await pool.query(
  `
  UPDATE contacts
  SET
    date=$1,
    type=$2,
    nom=$3,
    prenom=$4,
    tags=$5,
    remarques=$6,
    suivi=$7
  WHERE id=$8
  RETURNING *
  `,
  [
    c.date,
    c.type,
    c.nom || null,
    c.prenom || null,
    (c.tags && Array.isArray(c.tags) && c.tags.length > 0) ? c.tags : null,
    c.remarques,
    c.suivi,
    id
  ]
);

if (result.rows.length === 0) {
  return res.status(404).json({ error: 'Contact non trouvé' });
}

res.json(result.rows[0]);

} catch (err) {

console.error(err);
res.status(500).json({
  error: 'Erreur lors de la mise à jour'
});

}
});

/* =========================================================
CONTACTS - DELETE
========================================================= */

app.delete('/contacts/:id', async (req, res) => {

const id = req.params.id;

if (!id || isNaN(id)) {
  return res.status(400).json({ error: 'ID invalide' });
}

try {

const result = await pool.query(
  'DELETE FROM contacts WHERE id=$1 RETURNING id',
  [id]
);

if (result.rows.length === 0) {
  return res.status(404).json({ error: 'Contact non trouvé' });
}

res.json({
  success: true
});

} catch (err) {

console.error(err);
res.status(500).json({
  error: 'Erreur lors de la suppression'
});

}
});

/* =========================================================
STATS
========================================================= */

app.get('/stats', async (req, res) => {

try {

const total = await pool.query(`
  SELECT COUNT(*) AS total
  FROM contacts
`);

const byType = await pool.query(`
  SELECT
    type,
    COUNT(*) AS n
  FROM contacts
  GROUP BY type
  ORDER BY n DESC
`);

const byMotif = await pool.query(`
  SELECT
    'declaration' as key, COUNT(*) as count FROM contacts WHERE motif_declaration = true
  UNION ALL
  SELECT 'adjonction', COUNT(*) FROM contacts WHERE motif_adjonction = true
  UNION ALL
  SELECT 'juridique', COUNT(*) FROM contacts WHERE motif_juridique = true
  UNION ALL
  SELECT 'social', COUNT(*) FROM contacts WHERE motif_social = true
  UNION ALL
  SELECT 'comptable_fiscal', COUNT(*) FROM contacts WHERE motif_comptable_fiscal = true
  UNION ALL
  SELECT 'communication', COUNT(*) FROM contacts WHERE motif_communication = true
  UNION ALL
  SELECT 'adhesion', COUNT(*) FROM contacts WHERE motif_adhesion = true
  UNION ALL
  SELECT 'activite_artistique', COUNT(*) FROM contacts WHERE motif_activite_artistique = true
  UNION ALL
  SELECT 'autres', COUNT(*) FROM contacts WHERE motif_autres = true
`);

const byQui = await pool.query(`
  SELECT
    'ck' as key, COUNT(*) as count FROM contacts WHERE qui_ck = true
  UNION ALL
  SELECT 'kr', COUNT(*) FROM contacts WHERE qui_kr = true
  UNION ALL
  SELECT 'lv', COUNT(*) FROM contacts WHERE qui_lv = true
`);

const motifObj = {};
byMotif.rows.forEach(r => { motifObj[r.key] = r.count; });

const quiObj = {};
byQui.rows.forEach(r => { quiObj[r.key] = r.count; });

res.json({
  total: parseInt(total.rows[0].total),
  byType: byType.rows,
  byMotif: motifObj,
  byQui: quiObj
});

} catch (err) {

console.error(err);
res.status(500).json({
  error: 'Erreur lors de la récupération des stats'
});

}
});

/* =========================================================
CSV EXPORT
========================================================= */

app.get('/export/csv', async (req, res) => {

try {

const result = await pool.query(`
  SELECT *
  FROM contacts
  ORDER BY date ASC
`);

// Convertir en CSV
const rows = result.rows;
if (rows.length === 0) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
  res.send('');
  return;
}

const headers = Object.keys(rows[0]);
const csvContent = [
  headers.join(','),
  ...rows.map(row => 
    headers.map(h => {
      const val = row[h];
      if (val === null) return '';
      if (Array.isArray(val)) return `"${val.join('; ')}"`;
      if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',')
  )
].join('\n');

res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
res.send(csvContent);

} catch (err) {

console.error(err);
res.status(500).json({
  error: 'Erreur lors de l\'export'
});

}
});

/* =========================================================
GLOBAL ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {

console.error(err);

res.status(500).json({
error: 'Erreur interne du serveur'
});
});

/* =========================================================
START SERVER
========================================================= */

app.listen(PORT, () => {

console.log('====================================');
console.log(`MDA API running on port ${PORT}`);
console.log('====================================');

});
