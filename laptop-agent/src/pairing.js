const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = { generateToken };
