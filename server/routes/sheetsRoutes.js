const express = require('express');
const { getSheetData, updateSheet } = require('../controllers/sheetsController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All sheet routes require authentication
router.use(authenticate);

router.get('/data', getSheetData);
router.post('/update', updateSheet);

module.exports = router;
