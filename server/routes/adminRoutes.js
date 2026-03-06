const express = require('express');
const { getPendingApprovals, approveUser, rejectUser } = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(authorize(['admin']));

router.get('/pending-approvals', getPendingApprovals);
router.post('/approve/:userId', approveUser);
router.post('/reject/:userId', rejectUser);

module.exports = router;
