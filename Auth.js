const jwt = require('jsonwebtoken');

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.API_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET ou API_SECRET manquant');
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

module.exports = { auth, adminOnly, JWT_SECRET };
