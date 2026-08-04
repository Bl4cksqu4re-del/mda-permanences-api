const express = require('express');
const pool = require('../db');

const router = express.Router();

console.log('WEBEX ROUTES LOADED');

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  result.push(current.trim());

  return result;
}

/*
 * TEST / STATS
 */
router.get('/webex/stats', async (req, res) => {
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
router.post('/webex/import/group', async (req, res) => {
  try {

    const { csv } = req.body;

    if (!csv) {
      return res.status(400).json({
        error: 'CSV manquant'
      });
    }

   const lines = csv
  .split('\n')
  .filter(l => l.trim());

const preview = [];

for (let i = 1; i < Math.min(lines.length, 6); i++) {
  preview.push(parseCsvLine(lines[i]));
}

res.json({
  ok: true,
  lignes: lines.length,
  preview
});

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});
router.post('/webex/import/agents', (req, res) => {
  res.json({
    ok: true,
    message: 'Import agents'
  });
});

router.post('/webex/import/calls', (req, res) => {
  res.json({
    ok: true,
    message: 'Import appels'
  });
});

module.exports = router;
