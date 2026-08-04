const express = require('express');

const router = express.Router();

router.get('/webex/test', (req, res) => {
  res.json({
    ok: true,
    message: 'Webex fonctionne'
  });
});

module.exports = router;
