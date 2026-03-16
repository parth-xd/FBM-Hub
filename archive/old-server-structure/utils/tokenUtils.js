const jwt = require('jsonwebtoken');

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const generateVerificationToken = () => {
  return jwt.sign({ random: Math.random() }, process.env.JWT_SECRET, {
    expiresIn: '24h',
  });
};

module.exports = {
  generateToken,
  verifyToken,
  generateVerificationToken,
};
