const express = require('express');
const pool = require('../db');

const router = express.Router();

console.log('WEBEX ROUTES LOADED');

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

    res.json({
      ok: true,
      lignes: lines.length
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
