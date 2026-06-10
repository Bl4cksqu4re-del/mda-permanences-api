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

```
res.status(200).json({
  status: 'ok',
  database: 'connected',
  timestamp: new Date().toISOString()
});
```

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

if (password === process.env.API_SECRET) {
return res.json({
success: true,
token: process.env.API_SECRET
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
const token = req.headers.authorization;

if (!token) {
return res.status(401).json({
error: 'Token manquant'
});
}

if (token !== process.env.API_SECRET) {
return res.status(401).json({
error: 'Token invalide'
});
}

next();
}

app.use(auth);

/* =========================================================
CONTACTS - GET
========================================================= */

app.get('/contacts', async (req, res) => {
try {
const { type, from, to } = req.query;

```
const values = [];
const conditions = [];

if (type) {
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
```

} catch (err) {
console.error(err);

```
res.status(500).json({
  error: err.message
});
```

}
});

/* =========================================================
CONTACTS - CREATE
========================================================= */

app.post('/contacts', async (req, res) => {
try {

```
const c = req.body;

const result = await pool.query(
  `
  INSERT INTO contacts (
    date,
    type,
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
    $19,$20,$21,$22,$23,$24,$25
  )
  RETURNING *
  `,
  [
    c.date,
    c.type,
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
```

} catch (err) {
console.error(err);

```
res.status(500).json({
  error: err.message
});
```

}
});

/* =========================================================
CONTACTS - UPDATE
========================================================= */

app.put('/contacts/:id', async (req, res) => {

const id = req.params.id;
const c = req.body;

try {

```
const result = await pool.query(
  `
  UPDATE contacts
  SET
    date=$1,
    type=$2,
    remarques=$3,
    suivi=$4
  WHERE id=$5
  RETURNING *
  `,
  [
    c.date,
    c.type,
    c.remarques,
    c.suivi,
    id
  ]
);

res.json(result.rows[0]);
```

} catch (err) {

```
console.error(err);

res.status(500).json({
  error: err.message
});
```

}
});

/* =========================================================
CONTACTS - DELETE
========================================================= */

app.delete('/contacts/:id', async (req, res) => {

try {

```
await pool.query(
  'DELETE FROM contacts WHERE id=$1',
  [req.params.id]
);

res.json({
  success: true
});
```

} catch (err) {

```
console.error(err);

res.status(500).json({
  error: err.message
});
```

}
});

/* =========================================================
STATS
========================================================= */

app.get('/stats', async (req, res) => {

try {

```
const total = await pool.query(`
  SELECT COUNT(*) AS total
  FROM contacts
`);

const byType = await pool.query(`
  SELECT
    type,
    COUNT(*) AS total
  FROM contacts
  GROUP BY type
  ORDER BY total DESC
`);

res.json({
  total: total.rows[0],
  byType: byType.rows
});
```

} catch (err) {

```
console.error(err);

res.status(500).json({
  error: err.message
});
```

}
});

/* =========================================================
CSV EXPORT
========================================================= */

app.get('/export/csv', async (req, res) => {

try {

```
const result = await pool.query(`
  SELECT *
  FROM contacts
  ORDER BY date ASC
`);

res.json(result.rows);
```

} catch (err) {

```
console.error(err);

res.status(500).json({
  error: err.message
});
```

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
