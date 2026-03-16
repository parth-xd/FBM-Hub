import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../AuthContext';
import './Dashboard.css';

export const Dashboard = () => {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await axios.get('/api/sheets/data', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setData(response.data);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="dashboard">
      <nav className="dashboard-nav">
        <h1>FBM Operations Hub</h1>
        <button onClick={logout} className="logout-btn">Logout</button>
      </nav>

      <div className="dashboard-content">
        <div className="welcome-section">
          <h2>Welcome, {user?.email}</h2>
          <p>Role: <strong>{user?.role}</strong></p>
        </div>

        <div className="dashboard-grid">
          <div className="card">
            <h3>Operations Data</h3>
            {loading ? (
              <p>Loading data...</p>
            ) : data ? (
              <div className="data-display">
                <pre>{JSON.stringify(data, null, 2)}</pre>
              </div>
            ) : (
              <p>No data available</p>
            )}
          </div>

          <div className="card">
            <h3>Quick Stats</h3>
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Status</span>
                <span className="stat-value">Active</span>
              </div>
              <div className="stat">
                <span className="stat-label">Account</span>
                <span className="stat-value">Approved</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PendingApprovalPage = () => {
  const { logout } = useAuth();

  return (
    <div className="dashboard">
      <nav className="dashboard-nav">
        <h1>FBM Operations Hub</h1>
        <button onClick={logout} className="logout-btn">Logout</button>
      </nav>

      <div className="dashboard-content">
        <div className="pending-section">
          <h2>Account Pending Approval</h2>
          <p>Your account has been created successfully! An administrator will review and approve your request soon.</p>
          <p>You will receive an email notification once your account is approved.</p>
        </div>
      </div>
    </div>
  );
};
