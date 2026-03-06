const nodemailer = require('nodemailer');

// Create a transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
};

const sendVerificationEmail = async (email, verificationToken) => {
  const transporter = createTransporter();

  const verificationLink = `${process.env.REACT_APP_API_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Email Verification - Babaclick FBM Operations Hub',
    html: `
      <h2>Welcome to Babaclick FBM Operations Hub</h2>
      <p>Please verify your email address to activate your account:</p>
      <a href="${verificationLink}" style="background: #667eea; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">
        Verify Email
      </a>
      <p>Or copy and paste this link: ${verificationLink}</p>
      <p>This link will expire in 24 hours.</p>
      <p>If you didn't create this account, please ignore this email.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Verification email sent:', info.response);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw error;
  }
};

const sendApprovalNotification = async (email) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Account Approved - Babaclick FBM Operations Hub',
    html: `
      <h2>Your account has been approved!</h2>
      <p>Welcome to Babaclick FBM Operations Hub.</p>
      <p>You can now log in and access the dashboard.</p>
      <a href="${process.env.REACT_APP_API_URL || 'http://localhost:3000'}/login" style="background: #667eea; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">
        Login Now
      </a>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Approval notification email sent:', info.response);
    return true;
  } catch (error) {
    console.error('Error sending approval email:', error);
    throw error;
  }
};

const sendRejectionNotification = async (email) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Account Request Rejected - Babaclick FBM Operations Hub',
    html: `
      <h2>Account Request Status</h2>
      <p>Unfortunately, your account request has been rejected at this time.</p>
      <p>If you have questions, please contact: ${process.env.ADMIN_EMAIL}</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Rejection email sent:', info.response);
    return true;
  } catch (error) {
    console.error('Error sending rejection email:', error);
    throw error;
  }
};

const sendAdminNotification = async (newUserEmail) => {
  const transporter = createTransporter();

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.ADMIN_EMAIL,
    subject: 'New User Pending Approval - Babaclick FBM Operations Hub',
    html: `
      <h2>New User Registration</h2>
      <p>A new user has registered and is pending approval:</p>
      <p><strong>Email:</strong> ${newUserEmail}</p>
      <p>Please review and approve/reject this request in the admin panel.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Admin notification sent:', info.response);
    return true;
  } catch (error) {
    console.error('Error sending admin notification:', error);
    throw error;
  }
};

module.exports = {
  sendVerificationEmail,
  sendApprovalNotification,
  sendRejectionNotification,
  sendAdminNotification,
};
