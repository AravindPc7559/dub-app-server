const jwt = require('jsonwebtoken');
const config = require('../config/config');

const generateToken = (userId) => {
  return jwt.sign({ userId }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
};

const verifyToken = (token) => {
  return jwt.verify(token, config.jwt.secret);
};

module.exports = {
  generateToken,
  verifyToken,
};

