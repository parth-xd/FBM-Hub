import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../AuthContext';
import './AdminPanel.css';

export const AdminPanel = () => {
  const { user, logout } = useAuth();
  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);

  useEffect(() => {
    const fetchPendingUsers = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await axios.get('/api/admin/pending-approvals', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setPendingUsers(response.data.users);
      } catch (error) {
        console.error('Error fetching pending users:', error);
      } finally {
        setLoading(false);
      }
    };

    if (user?.role === 'admin') {
      fetchPendingUsers();
    }
  }, [user, action]);

  const handleApprove = async (userId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/admin/approve/${userId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAction('approved');
    } catch (error) {
      console.error('Error approving user:', error);
    }
  };

  const handleReject = async (userId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/admin/reject/${userId}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAction('rejected');
    } catch (error) {
      console.error('Error rejecting user:', error);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="admin-panel">
        <p>Access Denied: Admin only</p>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <nav className="admin-nav">
        <h1>Admin Panel</h1>
        <button onClick={logout} className="logout-btn">Logout</button>
      </nav>

      <div className="admin-content">
        <div className="admin-section">
          <h2>Pending User Approvals</h2>
          {loading ? (
            <p>Loading users...</p>
          ) : pendingUsers.length === 0 ? (
            <p>No pending approvals</p>
          ) : (
            <div className="users-list">
              {pendingUsers.map((user) => (
                <div key={user._id} className="user-card">
                  <div className="user-info">
                    <p className="user-email">{user.email}</p>
                    <p className="user-status">Status: Pending</p>
                  </div>
                  <div className="user-actions">
                    <button 
                      className="btn-approve"
                      onClick={() => handleApprove(user._id)}
                    >
                      Approve
                    </button>
                    <button 
                      className="btn-reject"
                      onClick={() => handleReject(user._id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
