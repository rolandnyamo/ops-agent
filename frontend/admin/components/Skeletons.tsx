import React from 'react';

export function AgentCardSkeleton() {
  return (
    <div className="card" style={{ 
      padding: '20px',
      background: 'var(--surface-elevated)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px'
    }}>
      <div className="loading-shimmer" style={{ 
        height: '20px', 
        width: '60%', 
        marginBottom: '12px',
        borderRadius: '4px'
      }} />
      <div className="loading-shimmer" style={{ 
        height: '14px', 
        width: '80%', 
        marginBottom: '16px',
        borderRadius: '4px'
      }} />
      <div className="loading-shimmer" style={{ 
        height: '32px', 
        width: '100px',
        borderRadius: '6px'
      }} />
    </div>
  );
}

export function AgentDetailsSkeleton() {
  return (
    <div className="card">
      <div className="loading-shimmer" style={{ 
        height: '24px', 
        width: '40%', 
        marginBottom: '16px',
        borderRadius: '4px'
      }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <div className="loading-shimmer" style={{ 
            height: '16px', 
            width: '20%', 
            marginBottom: '8px',
            borderRadius: '4px'
          }} />
          <div className="loading-shimmer" style={{ 
            height: '40px', 
            width: '100%',
            borderRadius: '4px'
          }} />
        </div>
        <div>
          <div className="loading-shimmer" style={{ 
            height: '16px', 
            width: '25%', 
            marginBottom: '8px',
            borderRadius: '4px'
          }} />
          <div className="loading-shimmer" style={{ 
            height: '40px', 
            width: '100%',
            borderRadius: '4px'
          }} />
        </div>
        <div>
          <div className="loading-shimmer" style={{ 
            height: '16px', 
            width: '30%', 
            marginBottom: '8px',
            borderRadius: '4px'
          }} />
          <div className="loading-shimmer" style={{ 
            height: '80px', 
            width: '100%',
            borderRadius: '4px'
          }} />
        </div>
      </div>
    </div>
  );
}

export function SourcesTableSkeleton() {
  return (
    <div className="table-container">
      <table className="modern-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Category</th>
            <th>Audience</th>
            <th>Version</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {[...Array(5)].map((_, i) => (
            <tr key={i}>
              <td>
                <div className="loading-shimmer" style={{ 
                  height: '16px', 
                  width: '70%',
                  marginBottom: '4px',
                  borderRadius: '4px'
                }} />
                <div className="loading-shimmer" style={{ 
                  height: '12px', 
                  width: '50%',
                  borderRadius: '4px'
                }} />
              </td>
              <td>
                <div className="loading-shimmer" style={{ 
                  height: '20px', 
                  width: '60px',
                  borderRadius: '10px'
                }} />
              </td>
              <td>
                <div className="loading-shimmer" style={{ 
                  height: '14px', 
                  width: '80%',
                  borderRadius: '4px'
                }} />
              </td>
              <td>
                <div className="loading-shimmer" style={{ 
                  height: '14px', 
                  width: '60%',
                  borderRadius: '4px'
                }} />
              </td>
              <td>
                <div className="loading-shimmer" style={{ 
                  height: '14px', 
                  width: '40%',
                  borderRadius: '4px'
                }} />
              </td>
              <td>
                <div className="loading-shimmer" style={{ 
                  height: '12px', 
                  width: '70%',
                  borderRadius: '4px'
                }} />
              </td>
              <td>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div className="loading-shimmer" style={{ 
                    height: '26px', 
                    width: '50px',
                    borderRadius: '4px'
                  }} />
                  <div className="loading-shimmer" style={{ 
                    height: '26px', 
                    width: '50px',
                    borderRadius: '4px'
                  }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourcesHeaderSkeleton() {
  return (
    <div className="row" style={{justifyContent:'space-between', alignItems:'center', marginBottom: 24}}>
      <div className="row" style={{alignItems: 'center', gap: 16}}>
        <div className="loading-shimmer" style={{ 
          height: '32px', 
          width: '80px',
          borderRadius: '6px'
        }} />
        <div>
          <div className="loading-shimmer" style={{ 
            height: '20px', 
            width: '100px', 
            marginBottom: '4px',
            borderRadius: '4px'
          }} />
          <div className="loading-shimmer" style={{ 
            height: '12px', 
            width: '60px',
            borderRadius: '4px'
          }} />
        </div>
      </div>
      <div className="loading-shimmer" style={{ 
        height: '32px', 
        width: '100px',
        borderRadius: '6px'
      }} />
    </div>
  );
}
