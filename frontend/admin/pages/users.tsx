import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getUsers, inviteUser, activateUser, deactivateUser, deleteUser, type User } from '../lib/api';

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Invite user state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  // Confirmation state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete' | 'deactivate' | 'activate';
    userId: string;
    email: string;
  } | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      setError(null);
      const response = await getUsers();
      setUsers(response.users);
    } catch (e: any) {
      setError(`Failed to load users: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleInviteUser() {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    try {
      setInviting(true);
      setError(null);
      await inviteUser(inviteEmail);
      setSuccess('User invited successfully! They will receive an email with login instructions.');
      setInviteEmail('');
      setShowInviteModal(false);
      loadUsers(); // Refresh the list
    } catch (e: any) {
      if (e.message.includes('409')) {
        setError('User already exists');
      } else if (e.message.includes('403')) {
        setError('You do not have permission to invite users');
      } else {
        setError(`Failed to invite user: ${e.message}`);
      }
    } finally {
      setInviting(false);
    }
  }

  async function handleConfirmAction() {
    if (!confirmAction) return;

    try {
      setError(null);
      
      switch (confirmAction.type) {
        case 'activate':
          await activateUser(confirmAction.userId);
          setSuccess('User activated successfully');
          break;
        case 'deactivate':
          await deactivateUser(confirmAction.userId);
          setSuccess('User deactivated successfully');
          break;
        case 'delete':
          await deleteUser(confirmAction.userId);
          setSuccess('User deleted successfully');
          break;
      }
      
      setShowConfirmModal(false);
      setConfirmAction(null);
      loadUsers(); // Refresh the list
    } catch (e: any) {
      if (e.message.includes('403')) {
        setError('You do not have permission to perform this action');
      } else {
        setError(`Action failed: ${e.message}`);
      }
    }
  }

  function getStatusBadge(user: User) {
    const { displayStatus } = user;
    let color = '#666';
    let bgColor = '#f5f5f5';
    
    switch (displayStatus) {
      case 'Active':
        color = '#0f5132';
        bgColor = '#d1e7dd';
        break;
      case 'Invited':
        color = '#664d03';
        bgColor = '#fff3cd';
        break;
      case 'Pending':
        color = '#664d03';
        bgColor = '#fff3cd';
        break;
      case 'Inactive':
        color = '#721c24';
        bgColor = '#f8d7da';
        break;
      case 'Compromised':
        color = '#721c24';
        bgColor = '#f8d7da';
        break;
    }

    return (
      <span style={{
        padding: '4px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '500',
        color,
        backgroundColor: bgColor
      }}>
        {displayStatus}
      </span>
    );
  }

  function formatDate(dateString: string) {
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return 'N/A';
    }
  }

  // Clear messages after 5 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  return (
    <Layout>
      <div className="card">
        <div className="row" style={{ alignItems: 'center', marginBottom: 16 }}>
          <h3 className="card-title" style={{ margin: 0 }}>👥 User Management</h3>
          <button 
            className="btn" 
            onClick={() => setShowInviteModal(true)}
            style={{ marginLeft: 'auto' }}
          >
            ➕ Invite User
          </button>
        </div>

        {loading && <div className="muted">Loading users...</div>}
        
        {error && (
          <div className="chip" style={{ borderColor: '#dc3545', backgroundColor: '#f8d7da', color: '#721c24', marginBottom: 16 }}>
            {error}
          </div>
        )}

        {success && (
          <div className="chip" style={{ borderColor: '#198754', backgroundColor: '#d1e7dd', color: '#0f5132', marginBottom: 16 }}>
            {success}
          </div>
        )}

        {!loading && users.length === 0 ? (
          <div className="muted" style={{ textAlign: 'center', padding: 40 }}>
            No users found. Click "Invite User" to add the first user.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: '600' }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: '600' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: '600' }}>Created</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: '600' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.userId} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '12px 8px' }}>
                      <div>
                        <div style={{ fontWeight: '500' }}>{user.email}</div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {user.emailVerified ? '✓ Verified' : '⚠ Unverified'}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      {getStatusBadge(user)}
                    </td>
                    <td style={{ padding: '12px 8px', color: '#666' }}>
                      {formatDate(user.created)}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <div className="row" style={{ gap: 8 }}>
                        {user.displayStatus === 'Inactive' ? (
                          <button
                            className="btn ghost mini"
                            onClick={() => {
                              setConfirmAction({
                                type: 'activate',
                                userId: user.userId,
                                email: user.email
                              });
                              setShowConfirmModal(true);
                            }}
                          >
                            ▶️ Activate
                          </button>
                        ) : user.displayStatus !== 'Invited' && (
                          <button
                            className="btn ghost mini"
                            onClick={() => {
                              setConfirmAction({
                                type: 'deactivate',
                                userId: user.userId,
                                email: user.email
                              });
                              setShowConfirmModal(true);
                            }}
                          >
                            ⏸️ Deactivate
                          </button>
                        )}
                        
                        <button
                          className="btn ghost mini"
                          style={{ color: '#dc3545' }}
                          onClick={() => {
                            setConfirmAction({
                              type: 'delete',
                              userId: user.userId,
                              email: user.email
                            });
                            setShowConfirmModal(true);
                          }}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite User Modal */}
      {showInviteModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="card" style={{ width: 400, margin: 20 }}>
            <h4 style={{ margin: '0 0 16px 0' }}>📧 Invite New User</h4>
            <p className="muted" style={{ marginBottom: 16 }}>
              Enter an email address to invite a new user. They will receive an email with login instructions.
            </p>
            
            <label>Email Address</label>
            <input
              type="email"
              className="input"
              placeholder="user@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={inviting}
            />
            
            <div className="row" style={{ marginTop: 16, gap: 8 }}>
              <button
                className="btn ghost"
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteEmail('');
                  setError(null);
                }}
                disabled={inviting}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={handleInviteUser}
                disabled={inviting || !inviteEmail.trim()}
              >
                {inviting ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && confirmAction && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="card" style={{ width: 400, margin: 20 }}>
            <h4 style={{ margin: '0 0 16px 0' }}>
              {confirmAction.type === 'delete' ? '🗑️ Delete User' : 
               confirmAction.type === 'activate' ? '▶️ Activate User' : 
               '⏸️ Deactivate User'}
            </h4>
            
            <p>
              Are you sure you want to {confirmAction.type} <strong>{confirmAction.email}</strong>?
            </p>
            
            {confirmAction.type === 'delete' && (
              <p className="muted" style={{ color: '#dc3545' }}>
                This action cannot be undone. The user will be permanently removed.
              </p>
            )}
            
            <div className="row" style={{ marginTop: 16, gap: 8 }}>
              <button
                className="btn ghost"
                onClick={() => {
                  setShowConfirmModal(false);
                  setConfirmAction(null);
                }}
              >
                Cancel
              </button>
              <button
                className={`btn ${confirmAction.type === 'delete' ? 'danger' : ''}`}
                onClick={handleConfirmAction}
                style={confirmAction.type === 'delete' ? { backgroundColor: '#dc3545', color: 'white' } : {}}
              >
                {confirmAction.type === 'delete' ? 'Delete User' : 
                 confirmAction.type === 'activate' ? 'Activate User' : 
                 'Deactivate User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
