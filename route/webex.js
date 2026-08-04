const express = require('express');

const router = express.Router();

console.log('WEBEX ROUTES LOADED');

/*
 * TEST
 */
router.get('/webex/test', (req, res) => {
  res.json({
    ok: true,
    message: 'Stat Webex'
  });
});

/*
 * IMPORTS
 */
router.post('/webex/import/group', (req, res) => {
  res.json({
    ok: true,
    message: 'Import groupe'
  });
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

/*
 * STATS
 */
router.get('/webex/stats', (req, res) => {
  res.json({
    ok: true,
    message: 'Stats Webex'
  });
});

module.exports = router;
