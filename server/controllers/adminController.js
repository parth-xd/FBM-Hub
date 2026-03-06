const User = require('../models/User');
const { sendApprovalNotification, sendRejectionNotification } = require('../utils/emailService');

const getPendingApprovals = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get all users with emailVerified but not isApproved
    const pendingUsers = await User.find({
      emailVerified: true,
      isApproved: false,
    }).select('-password');

    res.json({
      message: 'Pending approvals retrieved',
      users: pendingUsers,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch pending approvals', error: error.message });
  }
};

const approveUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Find and update user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isApproved) {
      return res.status(400).json({ message: 'User is already approved' });
    }

    user.isApproved = true;
    await user.save();

    // Send approval email
    try {
      await sendApprovalNotification(user.email);
    } catch (emailError) {
      console.error('Error sending approval email:', emailError);
    }

    res.json({
      message: 'User approved successfully',
      user: {
        id: user._id,
        email: user.email,
        isApproved: user.isApproved,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to approve user', error: error.message });
  }
};

const rejectUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Find and delete user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Send rejection email
    try {
      await sendRejectionNotification(user.email);
    } catch (emailError) {
      console.error('Error sending rejection email:', emailError);
    }

    // Delete user
    await User.findByIdAndDelete(userId);

    res.json({
      message: 'User rejected and deleted',
      userId: userId,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to reject user', error: error.message });
  }
};

module.exports = {
  getPendingApprovals,
  approveUser,
  rejectUser,
};
