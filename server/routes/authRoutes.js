const express = require('express');
const { register, login, verifyEmail, logout } = require('../controllers/authController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.post('/logout', logout);

module.exports = router;
