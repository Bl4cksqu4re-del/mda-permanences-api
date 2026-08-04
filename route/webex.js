const express = require('express');
const pool = require('../db');
const { auth } = require('../auth');

const router = express.Router();

console.log('WEBEX ROUTES LOADED');

function parseCsvLine(line, delimiteur = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += char;
    } else {
      if (char === '"') inQuotes = true;
      else if (char === delimiteur) { result.push(current.trim()); current = ''; }
      else current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Les exports Webex en français utilisent parfois le point-virgule comme séparateur
// (habitude Excel FR) — on détecte le bon délimiteur plutôt que de le supposer.
function detecterDelimiteur(headerLine) {
  const nbVirgules = (headerLine.match(/,/g) || []).length;
  const nbPointVirgules = (headerLine.match(/;/g) || []).length;
  return nbPointVirgules > nbVirgules ? ';' : ',';
}

const MOIS_FR = {
  janv: 1, jan: 1, fevr: 2, fev: 2, mars: 3, avr: 4, mai: 5, juin: 6,
  juil: 7, aout: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12
};

function normaliserMois(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '').toLowerCase();
}

// Format attendu : "13 janv. 2026 10:00:00"
function parseHorodatageFr(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2})\s+([^\s]+)\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, jour, moisStr, annee, hh] = m;
  const mois = MOIS_FR[normaliserMois(moisStr)];
  if (!mois) return null;
  return {
    dateISO: `${annee}-${String(mois).padStart(2, '0')}-${jour.padStart(2, '0')}`,
    heure: parseInt(hh, 10)
  };
}

// Format attendu : "00:04:17" (HH:MM:SS) ou "04:17" (MM:SS)
function dureeVersSecondes(str) {
  if (!str) return null;
  const p = str.trim().split(':').map(Number);
  if (p.some(isNaN)) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return null;
}

// Gère les nombres à la française ("2,5") comme à l'anglaise ("2.5")
function parseNombre(str) {
  if (str == null || str.trim() === '') return null;
  const n = parseFloat(str.trim().replace(',', '.'));
  return isNaN(n) ? null : n;
}

// agent_statistics.csv n'a pas de colonne date : Webex exporte un fichier par jour,
// la date est uniquement portée par le nom de fichier ("20260113_000000_agent_statistics.csv").
function dateDepuisNomFichier(filename) {
  if (!filename) return null;
  const m = filename.match(/^(\d{4})(\d{2})(\d{2})_/);
  if (!m) return null;
  const [, annee, mois, jour] = m;
  return `${annee}-${mois}-${jour}`;
}

/*
 * TEST / STATS
 */
router.get('/webex/stats', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) AS total
      FROM webex_group_stats
    `);

    res.json({
      ok: true,
      total: parseInt(result.rows[0].total)
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

router.get('/webex/test', (req, res) => {
  res.json({
    ok: true,
    message: 'Webex fonctionne'
  });
});

/*
 * IMPORTS
 */
router.post('/webex/import/group', auth, async (req, res) => {
  try {

    const { csv, filename } = req.body;

    if (!csv) {
      return res.status(400).json({
        error: 'CSV manquant'
      });
    }

    const lines = csv
      .split('\n')
      .filter(l => l.trim());

    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV vide ou illisible' });
    }

    const delimiteur = detecterDelimiteur(lines[0]);
    const stats = [];
    const erreurs = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i], delimiteur);
      if (cols.length < 10) {
        erreurs.push(`Ligne ${i + 1} : ${cols.length} colonne(s) au lieu de 10 attendues`);
        continue;
      }
      const [
        horodatage, debordements, repondus, abandonnes, transferes, temporises,
        agentsConv, agentsPresents, attenteMoy, abandonMoy
      ] = cols;

      const dt = parseHorodatageFr(horodatage);
      if (!dt) {
        erreurs.push(`Ligne ${i + 1} : horodatage illisible ("${horodatage}")`);
        continue;
      }

      stats.push({
        dateISO: dt.dateISO,
        heure: dt.heure,
        debordements: parseNombre(debordements) ?? 0,
        repondus: parseNombre(repondus) ?? 0,
        abandonnes: parseNombre(abandonnes) ?? 0,
        transferes: parseNombre(transferes) ?? 0,
        temporises: parseNombre(temporises) ?? 0,
        agentsConv: parseNombre(agentsConv),
        agentsPresents: parseNombre(agentsPresents),
        attenteSec: dureeVersSecondes(attenteMoy),
        abandonSec: dureeVersSecondes(abandonMoy)
      });
    }

    if (stats.length === 0) {
      return res.status(400).json({
        error: 'Aucune ligne exploitable dans ce CSV',
        erreurs: erreurs.slice(0, 10)
      });
    }

    let inserted = 0, updated = 0;
    for (const s of stats) {
      const result = await pool.query(`
        INSERT INTO webex_group_stats
          (stat_date, stat_hour, overflow_calls, answered, abandoned, transferred_calls, timed_calls,
           avg_agents_talking, avg_agents_present, avg_wait_sec, avg_abandon_sec)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (stat_date, stat_hour) DO UPDATE SET
          overflow_calls=EXCLUDED.overflow_calls,
          answered=EXCLUDED.answered,
          abandoned=EXCLUDED.abandoned,
          transferred_calls=EXCLUDED.transferred_calls,
          timed_calls=EXCLUDED.timed_calls,
          avg_agents_talking=EXCLUDED.avg_agents_talking,
          avg_agents_present=EXCLUDED.avg_agents_present,
          avg_wait_sec=EXCLUDED.avg_wait_sec,
          avg_abandon_sec=EXCLUDED.avg_abandon_sec
        RETURNING (xmax = 0) AS inserted`,
        [
          s.dateISO, s.heure, s.debordements, s.repondus, s.abandonnes, s.transferes, s.temporises,
          s.agentsConv, s.agentsPresents, s.attenteSec, s.abandonSec
        ]
      );
      if (result.rows[0].inserted) inserted++; else updated++;
    }

    const dateMin = stats.reduce((m, s) => !m || s.dateISO < m ? s.dateISO : m, null);
    const dateMax = stats.reduce((m, s) => !m || s.dateISO > m ? s.dateISO : m, null);

    await pool.query(`
      INSERT INTO import_log (imported_by, filename, total, inserted, updated, date_min, date_max)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user.display_name || req.user.username, filename || null, stats.length, inserted, updated, dateMin, dateMax]
    );

    res.json({
      ok: true,
      total: stats.length,
      inserted,
      updated,
      erreurs: erreurs.length ? erreurs.slice(0, 10) : undefined
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});
router.post('/webex/import/agents', auth, async (req, res) => {
  try {
    const { csv, filename, date } = req.body;

    if (!csv) {
      return res.status(400).json({ error: 'CSV manquant' });
    }

    // La date vient du nom de fichier (convention Webex), ou peut être fournie explicitement
    // si jamais le nom de fichier ne suit pas cette convention.
    const dateISO = date || dateDepuisNomFichier(filename);
    if (!dateISO) {
      return res.status(400).json({
        error: "Impossible de déterminer la date de ce fichier : agent_statistics.csv n'a pas de colonne date. " +
          "Le nom de fichier doit commencer par AAAAMMJJ_ (ex: 20260113_000000_agent_statistics.csv), " +
          "ou précisez le champ 'date' (AAAA-MM-JJ)."
      });
    }

    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV vide ou illisible' });
    }

    const delimiteur = detecterDelimiteur(lines[0]);
    const stats = [];
    const erreurs = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i], delimiteur);
      if (cols.length < 6) {
        erreurs.push(`Ligne ${i + 1} : ${cols.length} colonne(s) au lieu de 6 attendues`);
        continue;
      }
      const [nomAgent, traites, sansReponse, dureeMoy, tempsConvTotal, tempsPresenceTotal] = cols;
      if (!nomAgent) {
        erreurs.push(`Ligne ${i + 1} : nom d'agent manquant`);
        continue;
      }

      stats.push({
        nomAgent,
        traites: parseNombre(traites) ?? 0,
        sansReponse: parseNombre(sansReponse) ?? 0,
        dureeMoySec: dureeVersSecondes(dureeMoy),
        tempsConvTotalSec: dureeVersSecondes(tempsConvTotal),
        tempsPresenceTotalSec: dureeVersSecondes(tempsPresenceTotal)
      });
    }

    if (stats.length === 0) {
      return res.status(400).json({
        error: 'Aucune ligne exploitable dans ce CSV',
        erreurs: erreurs.slice(0, 10)
      });
    }

    let inserted = 0, updated = 0;
    for (const s of stats) {
      const result = await pool.query(`
        INSERT INTO webex_agent_stats
          (stat_date, agent_name, calls_answered, calls_unanswered, avg_call_sec, talk_time_sec, presence_time_sec)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (stat_date, agent_name) DO UPDATE SET
          calls_answered=EXCLUDED.calls_answered,
          calls_unanswered=EXCLUDED.calls_unanswered,
          avg_call_sec=EXCLUDED.avg_call_sec,
          talk_time_sec=EXCLUDED.talk_time_sec,
          presence_time_sec=EXCLUDED.presence_time_sec
        RETURNING (xmax = 0) AS inserted`,
        [dateISO, s.nomAgent, s.traites, s.sansReponse, s.dureeMoySec, s.tempsConvTotalSec, s.tempsPresenceTotalSec]
      );
      if (result.rows[0].inserted) inserted++; else updated++;
    }

    await pool.query(`
      INSERT INTO import_log (imported_by, filename, total, inserted, updated, date_min, date_max)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user.display_name || req.user.username, filename || null, stats.length, inserted, updated, dateISO, dateISO]
    );

    res.json({
      ok: true,
      total: stats.length,
      inserted,
      updated,
      date: dateISO,
      erreurs: erreurs.length ? erreurs.slice(0, 10) : undefined
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webex/import/calls', auth, (req, res) => {
  res.json({
    ok: true,
    message: 'Import appels'
  });
});

module.exports = router;
