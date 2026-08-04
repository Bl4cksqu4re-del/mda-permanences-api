require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors({
  origin: ['https://mda-permanences-app.onrender.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.options('*', cors());
app.use(express.json({ limit: '20mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.API_SECRET;
const WEBEX_CLIENT_ID =
  process.env.WEBEX_CLIENT_ID;

const WEBEX_CLIENT_SECRET =
  process.env.WEBEX_CLIENT_SECRET;

const WEBEX_REDIRECT_URI =
  process.env.WEBEX_REDIRECT_URI;

const WEBEX_SCOPES =
  process.env.WEBEX_SCOPES || 'spark:all';

let webexToken = null;
let webexTokenExpiry = null;

if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET ou API_SECRET manquant'
  );
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}
function legacyHashPassword(password) {
  return crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');
}
function auth(req, res, next) {
  const token = req.headers['authorization'] || req.query.token;
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

  if (!username || !password) {
    return res.status(400).json({
      error: 'Identifiants manquants'
    });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username=$1',
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        error: 'Identifiant ou mot de passe incorrect'
      });
    }

    let validPassword = false;

if (user.password_hash.startsWith('$2')) {
  validPassword = await bcrypt.compare(
    password,
    user.password_hash
  );
} else {
  validPassword =
    user.password_hash ===
    legacyHashPassword(password);

  if (validPassword) {
    const newHash = await hashPassword(
      password
    );

    await pool.query(
      'UPDATE users SET password_hash=$1 WHERE id=$2',
      [newHash, user.id]
    );
  }
}

if (!validPassword) {
  return res.status(401).json({
    error: 'Identifiant ou mot de passe incorrect'
  });
}
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        initiales: user.initiales,
        is_admin: user.is_admin
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        initiales: user.initiales,
        is_admin: user.is_admin
      }
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

/* Changer son mot de passe */
app.post('/change-password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({
      error: 'Champs manquants'
    });
  }

  if (new_password.length < 6) {
    return res.status(400).json({
      error: 'Mot de passe trop court (6 caractères minimum)'
    });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE id=$1',
      [req.user.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        error: 'Mot de passe actuel incorrect'
      });
    }

    const validPassword = await bcrypt.compare(
      current_password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        error: 'Mot de passe actuel incorrect'
      });
    }

    const hashedPassword = await hashPassword(
      new_password
    );

    await pool.query(
      'UPDATE users SET password_hash=$1 WHERE id=$2',
      [hashedPassword, req.user.id]
    );

    res.json({
      ok: true
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
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
[
  username,
  await hashPassword(password),
  display_name,
  initiales.toUpperCase(),
  !!is_admin
]
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
const hashedPassword = await hashPassword(
  new_password
);

await pool.query(
  'UPDATE users SET password_hash=$1 WHERE id=$2',
  [hashedPassword, req.params.id]
);
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

/* Route publique checkin tablette - avant le middleware auth */
app.post('/checkin', async (req, res) => {
  const c = req.body;
  if (!c.prenom && !c.nom) return res.status(400).json({ error: 'Prénom ou nom obligatoire' });
  try {
    const result = await pool.query(`
      INSERT INTO contacts (
        date, type,
        id_adherent, id_non_adherent, id_structure, id_autres,
        motif_declaration, motif_adjonction, motif_juridique, motif_social,
        motif_comptable_fiscal, motif_communication, motif_adhesion,
        motif_activite_artistique, motif_autres,
        mail, telephone, prenom, nom, activite_type, numero_adherent,
        remarques
      ) VALUES (
        $1, 'PRES',
        $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20,
        $21
      ) RETURNING id`,
      [
        new Date().toISOString().slice(0, 10),
        !!c.id_adherent, !!c.id_non_adherent, !!c.id_structure, !!c.id_autres,
        !!c.motif_declaration, !!c.motif_adjonction, !!c.motif_juridique,
        !!c.motif_social, !!c.motif_comptable_fiscal, !!c.motif_communication,
        !!c.motif_adhesion, !!c.motif_activite_artistique, !!c.motif_autres,
        c.mail || null, c.telephone || null,
        c.prenom || null, c.nom || null,
        c.activite_type || null, c.numero_adherent || null,
        '[Enregistrement tablette accueil]'
      ]
    );
    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/webex/auth', (req, res) => {
  const url = `https://webexapis.com/v1/authorize?client_id=${WEBEX_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(WEBEX_REDIRECT_URI)}&scope=${encodeURIComponent(WEBEX_SCOPES)}&state=mda`;
  res.redirect(url);
});

app.get('/webex/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Code manquant');
  try {
    const response = await fetch('https://webexapis.com/v1/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     WEBEX_CLIENT_ID,
        client_secret: WEBEX_CLIENT_SECRET,
        redirect_uri:  WEBEX_REDIRECT_URI,
        code
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Erreur OAuth');
    webexToken = data.access_token;
    webexTokenExpiry = Date.now() + (data.expires_in * 1000);
    res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>✅ Webex connecté avec succès</h2><p>Vous pouvez fermer cette page.</p></body></html>`);
  } catch (err) {
    res.status(500).send(`Erreur: ${err.message}`);
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
        prenom, nom, motifs_custom, a_rappeler, numero_adherent
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
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
        !!c.a_rappeler, c.numero_adherent || null
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
        prenom=$28, nom=$29, motifs_custom=$30, a_rappeler=$31, numero_adherent=$32
      WHERE id=$33 RETURNING *`,
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
        !!c.a_rappeler, c.numero_adherent || null,
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

app.put('/contacts/:id/pris-en-charge', async (req, res) => {
  try {
    const result = await pool.query('UPDATE contacts SET pris_en_charge=TRUE WHERE id=$1 RETURNING *', [req.params.id]);
    res.json(result.rows[0]);
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

/* Appels téléphoniques - import CSV Orange Business */
const EQUIPE_MDA = ['VICTORIA CORDA', 'KIM REED', 'CHARLOTTE KENT', 'LOIC VOLAT', 'ANTOINE STORCK'];

function isTeamMember(name) {
  if (!name) return false;
  const upper = name.toUpperCase();
  return EQUIPE_MDA.some(e => upper.includes(e));
}

function parseDuree(dureeStr) {
  if (!dureeStr) return 0;
  const parts = dureeStr.split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  return 0;
}

function parseDureeToDatetime(str) {
  // Format attendu : "YYYY-MM-DD HH:MM:SS"
  if (!str) return null;
  const d = new Date(str.trim().replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

// Parseur CSV correct (gère les champs vides et les valeurs entre guillemets),
// contrairement à un simple split(',') / regex qui décale les colonnes dès qu'un champ est vide.
function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { result.push(cur.trim()); cur = ''; }
      else cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

app.post('/calls/import', auth, async (req, res) => {
  const { csv, filename } = req.body;
  if (!csv) return res.status(400).json({ error: 'CSV manquant' });

  try {
    const lines = csv.split('\n').filter(l => l.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const clean = parseCsvLine(lines[i]);
      if (clean.length < 9) continue;
      const [numTel, appelant, appele, interlocuteur, dateStr, heureStr, debutStr, , dureeStr] = clean;
      if (!dateStr || !appelant) continue;
      const dp = dateStr.split('/');
      if (dp.length !== 3) continue;
      const dateISO = `${dp[2]}-${dp[1].padStart(2,'0')}-${dp[0].padStart(2,'0')}`;
      const ts = new Date(dateISO + 'T' + heureStr + ':00');
      rows.push({ appelant, appele, numTel, dateISO, heureStr, interlocuteur, dureeStr, debutStr, ts });
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Aucune ligne exploitable dans ce CSV (format inattendu ?)' });
    }

    // Regroupement en appels réels : la ligne "file d'appel" (Numéro appelé = numéro principal)
    // et les lignes "poste sonné" (Charlotte/Kim/Loïc/Victoria...) du même appel ne partagent pas
    // toujours la même minute exacte dans l'export Orange Business — on fusionne donc par appelant,
    // en regroupant les lignes consécutives séparées de moins de 2 min 30.
    rows.sort((a, b) => a.appelant === b.appelant ? a.ts - b.ts : (a.appelant < b.appelant ? -1 : 1));
    const FENETRE_MS = 150 * 1000;
    const groups = [];
    let current = null;
    for (const r of rows) {
      if (current && current.appelant === r.appelant && (r.ts - current.lastTs) <= FENETRE_MS) {
        current.rows.push(r);
        current.lastTs = r.ts;
      } else {
        current = { appelant: r.appelant, lastTs: r.ts, rows: [r] };
        groups.push(current);
      }
    }

    let inserted = 0, updated = 0;
    const BATCH = 200;

    for (let i = 0; i < groups.length; i += BATCH) {
      const batch = groups.slice(i, i + BATCH);
      const values = [];
      const placeholders = [];
      batch.forEach((g, idx) => {
        const first = g.rows[0]; // ligne la plus ancienne du groupe : sert de clé stable (date/heure canoniques)
        let decroche = false, repondant = null, dureeSec = 0, attenteSec = null;

        const ligneDecroche = g.rows.find(l => isTeamMember(l.interlocuteur) && l.dureeStr);
        const ligneFile = g.rows.find(l => l.appele === l.numTel); // ligne "file d'appel" (numéro appelé = numéro principal)

        if (ligneDecroche) {
          decroche = true;
          repondant = ligneDecroche.interlocuteur;
          dureeSec = parseDuree(ligneDecroche.dureeStr);
          const debutFile = ligneFile ? parseDureeToDatetime(ligneFile.debutStr) : null;
          const debutDecroche = parseDureeToDatetime(ligneDecroche.debutStr);
          if (debutFile && debutDecroche) {
            attenteSec = Math.max(0, Math.round((debutDecroche - debutFile) / 1000));
          }
        }

        const base = idx * 7;
        placeholders.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7})`);
        values.push(g.appelant, first.dateISO, first.heureStr, decroche, repondant, dureeSec, attenteSec);
      });

      const result = await pool.query(`
        INSERT INTO calls (numero_appelant, date_appel, heure_appel, decroche, repondant, duree_sec, attente_sec)
        VALUES ${placeholders.join(',')}
        ON CONFLICT (numero_appelant, date_appel, heure_appel)
        DO UPDATE SET decroche=EXCLUDED.decroche, repondant=EXCLUDED.repondant, duree_sec=EXCLUDED.duree_sec, attente_sec=EXCLUDED.attente_sec
        RETURNING (xmax = 0) AS inserted`,
        values
      );
      result.rows.forEach(r => { if (r.inserted) inserted++; else updated++; });
    }

    const dateMin = rows.reduce((m, r) => !m || r.dateISO < m ? r.dateISO : m, null);
    const dateMax = rows.reduce((m, r) => !m || r.dateISO > m ? r.dateISO : m, null);

    const logResult = await pool.query(`
      INSERT INTO import_log (imported_by, filename, total, inserted, updated, date_min, date_max)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, imported_at`,
      [req.user.display_name || req.user.username, filename || null, groups.length, inserted, updated, dateMin, dateMax]
    );

    res.json({
      ok: true, total: groups.length, inserted, updated,
      importId: logResult.rows[0].id, importedAt: logResult.rows[0].imported_at
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Historique des imports CSV
app.get('/calls/imports', auth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, imported_by, filename, total, inserted, updated, date_min, date_max, imported_at FROM import_log ORDER BY imported_at DESC LIMIT 100`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/calls/stats', auth, async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const values = [];
  if (from) { values.push(from); conditions.push(`date_appel >= $${values.length}`); }
  if (to)   { values.push(to);   conditions.push(`date_appel <= $${values.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const [totals, parRepondant, parJour, parHeure, bounds, appelantsUniques] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total, SUM(decroche::int) AS decroches, SUM(duree_sec) AS duree_total, AVG(CASE WHEN decroche THEN duree_sec END) AS duree_moy, AVG(attente_sec) AS attente_moy FROM calls ${where}`, values),
      pool.query(`SELECT repondant, COUNT(*) AS appels, SUM(duree_sec) AS duree FROM calls ${where} ${where ? 'AND' : 'WHERE'} decroche=TRUE GROUP BY repondant ORDER BY appels DESC`, values),
      pool.query(`SELECT date_appel, COUNT(*) AS total, SUM(decroche::int) AS decroches, SUM(CASE WHEN decroche THEN duree_sec ELSE 0 END) AS duree FROM calls ${where} GROUP BY date_appel ORDER BY date_appel DESC`, values),
      pool.query(`SELECT heure_appel, COUNT(*) AS total FROM calls ${where} GROUP BY heure_appel`, values),
      pool.query(`SELECT MIN(date_appel) AS min_date, MAX(date_appel) AS max_date, MAX(imported_at) AS last_import FROM calls`),
      pool.query(`SELECT COUNT(DISTINCT numero_appelant) AS n FROM calls ${where}`, values)
    ]);

    const t = totals.rows[0];
    const total = parseInt(t.total) || 0;
    const decroches = parseInt(t.decroches) || 0;

    // Regrouper par heure (0-23)
    const heuresMap = {};
    parHeure.rows.forEach(r => {
      const h = (r.heure_appel || '').slice(0,2);
      if (!h) return;
      heuresMap[h] = (heuresMap[h] || 0) + parseInt(r.total);
    });

    res.json({
      periode: { from: from || bounds.rows[0].min_date, to: to || bounds.rows[0].max_date },
      total, decroches, nonDecroches: total - decroches,
      dureeTotal: parseInt(t.duree_total) || 0,
      dureeMoy: Math.round(parseFloat(t.duree_moy)) || 0,
      attenteMoy: t.attente_moy != null ? Math.round(parseFloat(t.attente_moy)) : null,
      appelantsUniques: parseInt(appelantsUniques.rows[0].n) || 0,
      parRepondant: parRepondant.rows.map(r => ({ nom: r.repondant, appels: parseInt(r.appels), duree: parseInt(r.duree) })),
      parJour: parJour.rows.map(r => ({ date: r.date_appel.toISOString().slice(0,10), total: parseInt(r.total), decroches: parseInt(r.decroches), duree: parseInt(r.duree) })),
      parHeure: Object.entries(heuresMap).sort(([a],[b]) => a.localeCompare(b)).map(([h,v]) => ({ heure: h, total: v })),
      lastImport: bounds.rows[0].last_import,
      dataRange: { min: bounds.rows[0].min_date, max: bounds.rows[0].max_date }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* Feuille de temps */

// Jours fériés français (fixes + mobiles calculés)
function getJoursFeries(year) {
  // Calcul de Pâques (algorithme de Gauss)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l) / 451);
  const month = Math.floor((h + l - 7*m + 114) / 31);
  const day = ((h + l - 7*m + 114) % 31) + 1;
  const paques = new Date(year, month - 1, day);

  const addDays = (date, days) => { const d2 = new Date(date); d2.setDate(d2.getDate() + days); return d2; };
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  return new Set([
    `${year}-01-01`, // Jour de l'an
    fmt(addDays(paques, 1)),  // Lundi de Pâques
    `${year}-05-01`, // Fête du travail
    `${year}-05-08`, // Victoire 1945
    fmt(addDays(paques, 39)), // Ascension
    fmt(addDays(paques, 50)), // Lundi de Pentecôte
    `${year}-07-14`, // Fête nationale
    `${year}-08-15`, // Assomption
    `${year}-11-01`, // Toussaint
    `${year}-11-11`, // Armistice
    `${year}-12-25`, // Noël
  ]);
}

app.get('/timesheet/holidays', auth, (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  res.json([...getJoursFeries(year), ...getJoursFeries(year-1), ...getJoursFeries(year+1)]);
});

// Récupérer les entrées d'un mois pour l'utilisateur connecté (ou un autre si admin)
app.get('/timesheet/entries', auth, async (req, res) => {
  const { mois, user_id } = req.query; // mois = YYYY-MM
  if (!mois) return res.status(400).json({ error: 'Mois requis (format YYYY-MM)' });
  let targetUserId = req.user.id;
  if (user_id && parseInt(user_id) !== req.user.id) {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
    targetUserId = parseInt(user_id);
  }
  try {
    const [entries, lock, user] = await Promise.all([
      pool.query(`SELECT * FROM timesheet_entries WHERE user_id=$1 AND date >= $2::date AND date < ($2::date + INTERVAL '1 month') ORDER BY date`, [targetUserId, `${mois}-01`]),
      pool.query(`SELECT locked FROM timesheet_locks WHERE user_id=$1 AND mois=$2`, [targetUserId, mois]),
      pool.query(`SELECT id, display_name, initiales, heures_contrat_mois, heures_semaine_base, jours_semaine_base FROM users WHERE id=$1`, [targetUserId])
    ]);
    res.json({
      entries: entries.rows,
      locked: lock.rows.length > 0 ? lock.rows[0].locked : false,
      user: user.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enregistrer/mettre à jour une entrée
app.post('/timesheet/entries', auth, async (req, res) => {
  const { date, heure_debut, heure_fin, pause_minutes, motif, precision, user_id } = req.body;
  if (!date) return res.status(400).json({ error: 'Date requise' });

  let targetUserId = req.user.id;
  if (user_id && parseInt(user_id) !== req.user.id) {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
    targetUserId = parseInt(user_id);
  }

  const mois = date.slice(0, 7);
  try {
    // Vérifier verrouillage (sauf admin)
    if (!req.user.is_admin) {
      const lock = await pool.query(`SELECT locked FROM timesheet_locks WHERE user_id=$1 AND mois=$2`, [targetUserId, mois]);
      if (lock.rows.length > 0 && lock.rows[0].locked) {
        return res.status(403).json({ error: 'Ce mois est verrouillé. Contactez votre administrateur pour le modifier.' });
      }
    }

    // Seuil quotidien = horaire de base du salarié (heures/semaine ÷ jours/semaine), 35h/5j = 7h par défaut
    const baseRes = await pool.query(`SELECT heures_semaine_base, jours_semaine_base FROM users WHERE id=$1`, [targetUserId]);
    const base = baseRes.rows[0] || {};
    const heuresSemaineBase = parseFloat(base.heures_semaine_base) || 35;
    const joursSemaineBase = parseFloat(base.jours_semaine_base) || 5;
    const seuilJour = Math.round((heuresSemaineBase / joursSemaineBase) * 100) / 100;

    // Calcul des heures
    let heuresReg = 0, heuresSup = 0, heuresTotal = 0;
    if (heure_debut && heure_fin && !motif) {
      const [hd, md] = heure_debut.split(':').map(Number);
      const [hf, mf] = heure_fin.split(':').map(Number);
      let totalMin = (hf*60 + mf) - (hd*60 + md) - (pause_minutes || 0);
      if (totalMin < 0) totalMin += 24*60;
      heuresTotal = Math.round((totalMin / 60) * 100) / 100;
      // Heures sup au-delà du seuil quotidien propre au salarié
      if (heuresTotal > seuilJour) {
        heuresReg = seuilJour;
        heuresSup = Math.round((heuresTotal - seuilJour) * 100) / 100;
      } else {
        heuresReg = heuresTotal;
        heuresSup = 0;
      }
    }

    const result = await pool.query(`
      INSERT INTO timesheet_entries (user_id, date, heure_debut, heure_fin, pause_minutes, motif, precision, heures_reg, heures_sup, heures_total, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      ON CONFLICT (user_id, date)
      DO UPDATE SET heure_debut=$3, heure_fin=$4, pause_minutes=$5, motif=$6, precision=$7, heures_reg=$8, heures_sup=$9, heures_total=$10, updated_at=NOW()
      RETURNING *`,
      [targetUserId, date, heure_debut || null, heure_fin || null, pause_minutes || 0, motif || null, precision || null, heuresReg, heuresSup, heuresTotal]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/timesheet/entries/:date', auth, async (req, res) => {
  const { user_id } = req.query;
  let targetUserId = req.user.id;
  if (user_id && parseInt(user_id) !== req.user.id) {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
    targetUserId = parseInt(user_id);
  }
  try {
    await pool.query(`DELETE FROM timesheet_entries WHERE user_id=$1 AND date=$2`, [targetUserId, req.params.date]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verrouiller / déverrouiller un mois
app.post('/timesheet/lock', auth, async (req, res) => {
  const { mois, locked, user_id } = req.body;
  if (!mois) return res.status(400).json({ error: 'Mois requis' });

  let targetUserId = req.user.id;
  if (user_id && parseInt(user_id) !== req.user.id) {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
    targetUserId = parseInt(user_id);
  }
  // Si on veut déverrouiller, seul l'admin peut
  if (locked === false && !req.user.is_admin) {
    return res.status(403).json({ error: 'Seul l\'administrateur peut déverrouiller un mois' });
  }
  try {
    await pool.query(`
      INSERT INTO timesheet_locks (user_id, mois, locked, locked_at)
      VALUES ($1,$2,$3,NOW())
      ON CONFLICT (user_id, mois) DO UPDATE SET locked=$3, locked_at=NOW()`,
      [targetUserId, mois, !!locked]
    );
    res.json({ ok: true, locked: !!locked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vue admin : liste de tous les salariés avec résumé du mois
app.get('/timesheet/admin/summary', auth, adminOnly, async (req, res) => {
  const { mois } = req.query;
  if (!mois) return res.status(400).json({ error: 'Mois requis' });
  try {
    const users = await pool.query(`SELECT id, display_name, initiales, heures_contrat_mois, heures_semaine_base, jours_semaine_base FROM users ORDER BY display_name`);
    const results = [];
    for (const u of users.rows) {
      const [entries, lock] = await Promise.all([
        pool.query(`SELECT * FROM timesheet_entries WHERE user_id=$1 AND date >= $2::date AND date < ($2::date + INTERVAL '1 month')`, [u.id, `${mois}-01`]),
        pool.query(`SELECT locked FROM timesheet_locks WHERE user_id=$1 AND mois=$2`, [u.id, mois])
      ]);
      const totalReg = entries.rows.reduce((s,e) => s + parseFloat(e.heures_reg||0), 0);
      const totalSup = entries.rows.reduce((s,e) => s + parseFloat(e.heures_sup||0), 0);
      const totalSaisi = entries.rows.length;
      const motifsCount = {};
      entries.rows.forEach(e => { if (e.motif) motifsCount[e.motif] = (motifsCount[e.motif]||0) + 1; });
      results.push({
        user_id: u.id, display_name: u.display_name, initiales: u.initiales,
        heures_contrat_mois: parseFloat(u.heures_contrat_mois),
        heures_semaine_base: parseFloat(u.heures_semaine_base) || 35,
        jours_semaine_base: parseFloat(u.jours_semaine_base) || 5,
        total_reg: Math.round(totalReg*100)/100, total_sup: Math.round(totalSup*100)/100,
        jours_saisis: totalSaisi, locked: lock.rows.length > 0 ? lock.rows[0].locked : false,
        motifs: motifsCount
      });
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Récap annuel par utilisateur
app.get('/timesheet/annual', auth, async (req, res) => {
  const { year, user_id } = req.query;
  if (!year) return res.status(400).json({ error: 'Année requise' });
  let targetUserId = req.user.id;
  if (user_id && parseInt(user_id) !== req.user.id) {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
    targetUserId = parseInt(user_id);
  }
  try {
    const entries = await pool.query(
      `SELECT * FROM timesheet_entries WHERE user_id=$1 AND date >= $2::date AND date < $3::date ORDER BY date`,
      [targetUserId, `${year}-01-01`, `${parseInt(year)+1}-01-01`]
    );
    const motifsCount = {};
    let totalReg = 0, totalSup = 0;
    entries.rows.forEach(e => {
      if (e.motif) motifsCount[e.motif] = (motifsCount[e.motif]||0) + 1;
      totalReg += parseFloat(e.heures_reg||0);
      totalSup += parseFloat(e.heures_sup||0);
    });
    res.json({
      year: parseInt(year),
      total_reg: Math.round(totalReg*100)/100,
      total_sup: Math.round(totalSup*100)/100,
      jours_saisis: entries.rows.length,
      motifs: motifsCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mettre à jour l'horaire de base d'un utilisateur (admin) : heures/semaine, jours/semaine, contrat mensuel
app.put('/timesheet/users/:id/contrat', auth, adminOnly, async (req, res) => {
  const { heures_contrat_mois, heures_semaine_base, jours_semaine_base } = req.body;
  if (heures_contrat_mois == null && heures_semaine_base == null && jours_semaine_base == null) {
    return res.status(400).json({ error: 'Valeur requise' });
  }
  const sets = [];
  const values = [];
  if (heures_contrat_mois != null) { values.push(heures_contrat_mois); sets.push(`heures_contrat_mois=$${values.length}`); }
  if (heures_semaine_base != null) { values.push(heures_semaine_base); sets.push(`heures_semaine_base=$${values.length}`); }
  if (jours_semaine_base != null) { values.push(jours_semaine_base); sets.push(`jours_semaine_base=$${values.length}`); }
  values.push(req.params.id);
  try {
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${values.length}`, values);
    const result = await pool.query(`SELECT id, display_name, initiales, heures_contrat_mois, heures_semaine_base, jours_semaine_base FROM users WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const MOTIF_LABELS_TS = {
  CP: 'Congé payé', RTT: 'RTT / Récupération', MALADIE: 'Maladie',
  FERIE: 'Jour férié', MEDICAL: 'Médical', AUTRE: 'Autre'
};

app.get('/timesheet/export', auth, async (req, res) => {
  const { mois, user_id } = req.query;
  if (!mois) return res.status(400).json({ error: 'Mois requis' });

  let targetUserId = req.user.id;
  if (user_id && parseInt(user_id) !== req.user.id) {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Accès réservé' });
    targetUserId = parseInt(user_id);
  }

  try {
    const [entriesRes, userRes] = await Promise.all([
      pool.query(`SELECT * FROM timesheet_entries WHERE user_id=$1 AND date >= $2::date AND date < ($2::date + INTERVAL '1 month') ORDER BY date`, [targetUserId, `${mois}-01`]),
      pool.query(`SELECT display_name, initiales, heures_contrat_mois, heures_semaine_base, jours_semaine_base FROM users WHERE id=$1`, [targetUserId])
    ]);
    const user = userRes.rows[0];
    const entriesMap = {};
    entriesRes.rows.forEach(e => { entriesMap[e.date.toISOString().slice(0,10)] = e; });

    const [year, month] = mois.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Feuille de temps');

    sheet.columns = [
      { width: 4 }, { width: 22 }, { width: 12 }, { width: 12 }, { width: 12 },
      { width: 14 }, { width: 14 }, { width: 14 }, { width: 24 }
    ];

    sheet.mergeCells('B1:H1');
    sheet.getCell('B1').value = 'FEUILLE DE TEMPS MENSUEL';
    sheet.getCell('B1').font = { bold: true, size: 14 };
    sheet.getCell('B1').alignment = { horizontal: 'center' };

    sheet.getCell('B3').value = 'Période';
    sheet.getCell('C3').value = new Date(year, month-1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    sheet.getCell('B4').value = "Nom de l'employé";
    sheet.getCell('C4').value = user.display_name;
    sheet.getCell('F4').value = 'HEURES CONTRAT/MOIS';
    sheet.getCell('H4').value = parseFloat(user.heures_contrat_mois);
    sheet.getCell('B5').value = 'Horaire de base';
    sheet.getCell('C5').value = `${parseFloat(user.heures_semaine_base) || 35}h / semaine sur ${parseFloat(user.jours_semaine_base) || 5} j`;
    sheet.getCell('B5').font = { bold: true };
    [3,4].forEach(r => { sheet.getCell(`B${r}`).font = { bold: true }; sheet.getCell(`F${r}`).font = { bold: true }; });

    const headerRow = 6;
    const headers = ['Date', 'Jour', 'Début', 'Fin', 'Pause', 'H. régulières', 'H. sup', 'H. totales', 'Motif / Précision'];
    headers.forEach((h, i) => {
      const cell = sheet.getCell(headerRow, i+1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1F2C' } };
      cell.alignment = { horizontal: 'center' };
    });

    let totalReg = 0, totalSup = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const date = new Date(year, month-1, d);
      const e = entriesMap[dateStr];
      const row = headerRow + d;

      sheet.getCell(row, 1).value = date.toLocaleDateString('fr-FR');
      sheet.getCell(row, 2).value = date.toLocaleDateString('fr-FR', { weekday: 'long' });

      if (e) {
        sheet.getCell(row, 3).value = e.heure_debut ? e.heure_debut.slice(0,5) : '';
        sheet.getCell(row, 4).value = e.heure_fin ? e.heure_fin.slice(0,5) : '';
        sheet.getCell(row, 5).value = e.pause_minutes ? `${e.pause_minutes} min` : '';
        sheet.getCell(row, 6).value = parseFloat(e.heures_reg) || '';
        sheet.getCell(row, 7).value = parseFloat(e.heures_sup) || '';
        sheet.getCell(row, 8).value = parseFloat(e.heures_total) || '';
        const motifLabel = e.motif ? (MOTIF_LABELS_TS[e.motif] || e.motif) : '';
        sheet.getCell(row, 9).value = [motifLabel, e.precision].filter(Boolean).join(' — ');
        totalReg += parseFloat(e.heures_reg) || 0;
        totalSup += parseFloat(e.heures_sup) || 0;
      }

      if (date.getDay() === 0 || date.getDay() === 6) {
        for (let c = 1; c <= 9; c++) sheet.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5FA' } };
      }
    }

    const totalRow = headerRow + lastDay + 2;
    sheet.getCell(totalRow, 5).value = 'TOTAL';
    sheet.getCell(totalRow, 5).font = { bold: true };
    sheet.getCell(totalRow, 6).value = Math.round(totalReg*100)/100;
    sheet.getCell(totalRow, 6).font = { bold: true };
    sheet.getCell(totalRow, 7).value = Math.round(totalSup*100)/100;
    sheet.getCell(totalRow, 7).font = { bold: true };
    sheet.getCell(totalRow, 8).value = Math.round((totalReg+totalSup)*100)/100;
    sheet.getCell(totalRow, 8).font = { bold: true };

    sheet.getCell(totalRow+1, 5).value = 'Contrat';
    sheet.getCell(totalRow+1, 6).value = parseFloat(user.heures_contrat_mois);
    sheet.getCell(totalRow+2, 5).value = 'Écart';
    sheet.getCell(totalRow+2, 6).value = Math.round((totalReg - parseFloat(user.heures_contrat_mois))*100)/100;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="feuille_temps_${user.initiales}_${mois}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`MDA API running on port ${PORT}`));
