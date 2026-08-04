const express = require('express');
const pool = require('../db');
const { auth } = require('../auth');

const router = express.Router();

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

// Format attendu : "YYYY-MM-DD HH:MM:SS" (colonne "Date/heure de début" de CallDetails.csv)
function parseDureeToDatetime(str) {
  if (!str) return null;
  const d = new Date(str.trim().replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
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

// Correspondance poste direct → personne, pour les appels sortants (rappels) repérés dans
// CallDetails.csv via numero_appelant == numero_tel. Uniquement les postes individuels connus
// (pas la ligne principale ni la file interne, qui ne représentent personne en particulier).
const POSTES_MDA = {
  '+33142256826': 'Charlotte KENT',
  '+33142256828': 'Kim REED',
  '+33185141391': 'Victoria CORDA',
  '+33185141390': 'Loic VOLAT',
  '+33142256829': 'Antoine STORCK'
};

/*
 * TEST / STATS
 */
router.get('/webex/stats', auth, async (req, res) => {
  try {
    const { from, to } = req.query;

    const bounds = await pool.query(`
      SELECT MIN(d) AS min_date, MAX(d) AS max_date FROM (
        SELECT stat_date AS d FROM webex_group_stats
        UNION ALL
        SELECT stat_date AS d FROM webex_agent_stats
      ) t
    `);
    const lastImportRes = await pool.query(`SELECT MAX(imported_at) AS last_import FROM import_log`);
    const { min_date, max_date } = bounds.rows[0];
    const { last_import } = lastImportRes.rows[0];

    const periodeFrom = from || min_date;
    const periodeTo = to || max_date;

    if (!periodeFrom || !periodeTo) {
      return res.json({
        periode: { from: null, to: null },
        total: 0, answered: 0, abandoned: 0,
        overflow: 0, transferred: 0, timed: 0,
        tauxDecroche: 0, attenteMoy: null, dureeMoy: null, appelantsUniques: null, rappelsSortants: [],
        parHeure: [], parJour: [], parAgent: [],
        lastImport: last_import, dataRange: { min: min_date, max: max_date },
        couverture: { joursDemandes: 0, joursGroupStats: 0, joursCallDetails: 0 }
      });
    }

    const [totaux, parHeure, parJour, parAgent, appelantsUniquesRes, rappelsRes, joursGroupRes, joursCallsRes] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(answered),0) AS answered,
          COALESCE(SUM(abandoned),0) AS abandoned,
          COALESCE(SUM(overflow_calls),0) AS overflow,
          COALESCE(SUM(transferred_calls),0) AS transferred,
          COALESCE(SUM(timed_calls),0) AS timed,
          SUM(avg_wait_sec * (answered+abandoned)) / NULLIF(SUM(answered+abandoned),0) AS attente_moy
        FROM webex_group_stats
        WHERE stat_date BETWEEN $1 AND $2
      `, [periodeFrom, periodeTo]),
      pool.query(`
        SELECT stat_hour,
          SUM(answered) AS answered, SUM(abandoned) AS abandoned,
          SUM(overflow_calls) AS overflow, SUM(transferred_calls) AS transferred, SUM(timed_calls) AS timed
        FROM webex_group_stats
        WHERE stat_date BETWEEN $1 AND $2
        GROUP BY stat_hour ORDER BY stat_hour
      `, [periodeFrom, periodeTo]),
      pool.query(`
        SELECT stat_date,
          SUM(answered) AS answered, SUM(abandoned) AS abandoned,
          SUM(overflow_calls) AS overflow, SUM(transferred_calls) AS transferred, SUM(timed_calls) AS timed,
          SUM(avg_wait_sec * (answered+abandoned)) / NULLIF(SUM(answered+abandoned),0) AS attente_moy
        FROM webex_group_stats
        WHERE stat_date BETWEEN $1 AND $2
        GROUP BY stat_date ORDER BY stat_date DESC
      `, [periodeFrom, periodeTo]),
      pool.query(`
        SELECT agent_name,
          SUM(calls_answered) AS calls_answered,
          SUM(calls_unanswered) AS calls_unanswered,
          SUM(avg_call_sec * calls_answered) / NULLIF(SUM(calls_answered),0) AS avg_call_sec,
          SUM(talk_time_sec) AS talk_time_sec,
          SUM(presence_time_sec) AS presence_time_sec
        FROM webex_agent_stats
        WHERE stat_date BETWEEN $1 AND $2
        GROUP BY agent_name ORDER BY calls_answered DESC
      `, [periodeFrom, periodeTo]),
      // webex_calls est optionnelle (Phase C) : si la table n'existe pas encore, on continue sans ce chiffre
      pool.query(`
        SELECT COUNT(DISTINCT numero_appelant) AS n FROM webex_calls WHERE date_appel BETWEEN $1 AND $2
      `, [periodeFrom, periodeTo]).catch(() => ({ rows: [{ n: null }] })),
      // Rappels sortants par personne (numero_appelant == numero_tel = c'est cette personne qui a appelé).
      // Uniquement disponible sur les CallDetails.csv scopés sur un poste individuel — pas dans les exports
      // par file d'attente, qui ne contiennent que de l'entrant.
      pool.query(`
        SELECT numero_tel,
          COUNT(*) AS sortants,
          COUNT(DISTINCT numero_appele) AS numeros_uniques,
          SUM(duree_sec) AS duree_totale
        FROM webex_calls
        WHERE numero_appelant = numero_tel AND date_appel BETWEEN $1 AND $2
        GROUP BY numero_tel
      `, [periodeFrom, periodeTo]).catch(() => ({ rows: [] })),
      // Couverture réelle de chaque source sur la période sélectionnée, pour repérer les
      // incohérences dues à des imports partiels (ex: CallDetails importé pour 5 jours
      // seulement alors que group_statistics couvre tout le mois).
      pool.query(`SELECT COUNT(DISTINCT stat_date) AS n FROM webex_group_stats WHERE stat_date BETWEEN $1 AND $2`, [periodeFrom, periodeTo]),
      pool.query(`SELECT COUNT(DISTINCT date_appel) AS n FROM webex_calls WHERE date_appel BETWEEN $1 AND $2`, [periodeFrom, periodeTo]).catch(() => ({ rows: [{ n: 0 }] }))
    ]);

    const t = totaux.rows[0];
    const answered = parseInt(t.answered) || 0;
    const abandoned = parseInt(t.abandoned) || 0;
    const overflow = parseInt(t.overflow) || 0;
    const transferred = parseInt(t.transferred) || 0;
    const timed = parseInt(t.timed) || 0;
    const total = answered + abandoned + overflow + transferred + timed;

    const talkTimeTotal = parAgent.rows.reduce((s, a) => s + (parseInt(a.talk_time_sec) || 0), 0);
    const callsAnsweredTotal = parAgent.rows.reduce((s, a) => s + (parseInt(a.calls_answered) || 0), 0);

    const joursDemandes = Math.round((new Date(periodeTo) - new Date(periodeFrom)) / 86400000) + 1;
    const joursGroupStats = parseInt(joursGroupRes.rows[0].n) || 0;
    const joursCallDetails = parseInt(joursCallsRes.rows[0].n) || 0;

    res.json({
      periode: { from: periodeFrom, to: periodeTo },
      total, answered, abandoned, overflow, transferred, timed,
      tauxDecroche: total > 0 ? Math.round((answered / total) * 100) : 0,
      attenteMoy: t.attente_moy != null ? Math.round(parseFloat(t.attente_moy)) : null,
      dureeMoy: callsAnsweredTotal > 0 ? Math.round(talkTimeTotal / callsAnsweredTotal) : null,
      appelantsUniques: appelantsUniquesRes.rows[0].n != null ? parseInt(appelantsUniquesRes.rows[0].n) : null,
      rappelsSortants: rappelsRes.rows
        .filter(r => POSTES_MDA[r.numero_tel])
        .map(r => ({
          nom: POSTES_MDA[r.numero_tel],
          sortants: parseInt(r.sortants) || 0,
          numerosUniques: parseInt(r.numeros_uniques) || 0,
          dureeTotale: parseInt(r.duree_totale) || 0
        }))
        .sort((a, b) => b.sortants - a.sortants),
      parHeure: parHeure.rows.map(r => ({
        heure: r.stat_hour,
        total: (parseInt(r.answered)||0) + (parseInt(r.abandoned)||0) + (parseInt(r.overflow)||0) + (parseInt(r.transferred)||0) + (parseInt(r.timed)||0),
        answered: parseInt(r.answered) || 0
      })),
      parJour: parJour.rows.map(r => {
        const jAnswered = parseInt(r.answered) || 0, jAbandoned = parseInt(r.abandoned) || 0;
        const jTotal = jAnswered + jAbandoned + (parseInt(r.overflow)||0) + (parseInt(r.transferred)||0) + (parseInt(r.timed)||0);
        return {
          date: r.stat_date.toISOString().slice(0, 10),
          total: jTotal, answered: jAnswered, abandoned: jAbandoned,
          attenteMoy: r.attente_moy != null ? Math.round(parseFloat(r.attente_moy)) : null
        };
      }),
      parAgent: parAgent.rows.map(a => ({
        nom: a.agent_name,
        appelsTraites: parseInt(a.calls_answered) || 0,
        appelsSansReponse: parseInt(a.calls_unanswered) || 0,
        dureeMoy: a.avg_call_sec != null ? Math.round(parseFloat(a.avg_call_sec)) : null,
        tempsConversation: parseInt(a.talk_time_sec) || 0,
        tempsPresence: parseInt(a.presence_time_sec) || 0
      })),
      lastImport: last_import,
      dataRange: { min: min_date, max: max_date },
      couverture: {
        joursDemandes,
        joursGroupStats,
        joursCallDetails
      }
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

router.post('/webex/import/calls', auth, async (req, res) => {
  try {
    const { csv, filename } = req.body;

    if (!csv) {
      return res.status(400).json({ error: 'CSV manquant' });
    }
    if (!filename) {
      return res.status(400).json({ error: "Nom de fichier requis (sert de clé pour un ré-import propre)" });
    }

    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV vide ou illisible' });
    }

    const delimiteur = detecterDelimiteur(lines[0]);
    const rows = [];
    const erreurs = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i], delimiteur);
      if (cols.length < 9) {
        erreurs.push(`Ligne ${i + 1} : ${cols.length} colonne(s) au lieu de 9 attendues`);
        continue;
      }
      const [numeroTel, appelant, appele, interlocuteur, dateStr, heureStr, debutStr, , dureeStr] = cols;
      if (!dateStr || !appelant) {
        erreurs.push(`Ligne ${i + 1} : appelant ou date manquant`);
        continue;
      }
      const dp = dateStr.split('/');
      if (dp.length !== 3) {
        erreurs.push(`Ligne ${i + 1} : date illisible ("${dateStr}")`);
        continue;
      }
      const dateISO = `${dp[2]}-${dp[1].padStart(2, '0')}-${dp[0].padStart(2, '0')}`;
      rows.push({
        numeroTel: numeroTel || null,
        appelant,
        appele: appele || null,
        interlocuteur: interlocuteur || null,
        dateISO,
        heureStr: heureStr || null,
        debut: parseDureeToDatetime(debutStr),
        dureeSec: dureeVersSecondes(dureeStr)
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'Aucune ligne exploitable dans ce CSV',
        erreurs: erreurs.slice(0, 10)
      });
    }

    const dateMin = rows.reduce((m, r) => !m || r.dateISO < m ? r.dateISO : m, null);
    const dateMax = rows.reduce((m, r) => !m || r.dateISO > m ? r.dateISO : m, null);

    // Stockage brut, sans fusion : une ligne CSV = une ligne en base.
    // Dédoublonnage par PÉRIODE COUVERTE (pas par nom de fichier) : Orange nomme ses exports
    // avec l'horodatage du téléchargement, pas la période — deux exports du même mois
    // téléchargés à des jours différents auraient donc des noms différents. On remplace
    // toutes les lignes déjà en base sur la période couverte par ce fichier, quel que soit
    // son nom, pour que le ré-import (même sous un autre nom) remplace au lieu de dupliquer.
    // Pas de déduplication au contenu ligne à ligne : vérifié sur données réelles, ~15-20%
    // de lignes distinctes partagent (appelant, appelé, date, heure, durée), donc peu fiable.
    const deleted = await pool.query(
      `DELETE FROM webex_calls WHERE date_appel BETWEEN $1 AND $2`,
      [dateMin, dateMax]
    );

    const BATCH = 300;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [];
      const placeholders = [];
      batch.forEach((r, idx) => {
        const base = idx * 9;
        placeholders.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9})`);
        values.push(filename, r.numeroTel, r.appelant, r.appele, r.interlocuteur, r.dateISO, r.heureStr, r.debut, r.dureeSec);
      });
      await pool.query(`
        INSERT INTO webex_calls
          (source_file, numero_tel, numero_appelant, numero_appele, interlocuteur, date_appel, heure_appel, debut, duree_sec)
        VALUES ${placeholders.join(',')}`,
        values
      );
    }


    await pool.query(`
      INSERT INTO import_log (imported_by, filename, total, inserted, updated, date_min, date_max)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user.display_name || req.user.username, filename, rows.length, rows.length, deleted.rowCount, dateMin, dateMax]
    );

    res.json({
      ok: true,
      total: rows.length,
      inserted: rows.length,
      updated: deleted.rowCount,
      erreurs: erreurs.length ? erreurs.slice(0, 10) : undefined
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
