import crypto from 'crypto';

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export { generateToken };
