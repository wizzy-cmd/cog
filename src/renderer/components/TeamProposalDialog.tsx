import React, { useEffect, useMemo, useState } from 'react'
import type { TeamProposal, ProposedAgent } from '../../shared/types'

interface Props {
  proposal: TeamProposal
  activeTabId: string
  onClose: () => void
  onApproved: (spawned: Array<{ agentId: string; name: string; gridIndex: number }>) => void
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000
}

const dialogStyle: React.CSSProperties = {
  backgroundColor: '#1a1a1a',
  color: '#e0e0e0',
  border: '1px solid #3a3a3a',
  borderRadius: '8px',
  padding: '20px 24px',
  width: 'min(720px, 90vw)',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  fontFamily: 'Consolas, "SFMono-Regular", Menlo, Monaco, monospace',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)'
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px'
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '15px',
  color: '#fff',
  fontWeight: 600
}

const summaryStyle: React.CSSProperties = {
  padding: '10px 12px',
  backgroundColor: '#222',
  border: '1px solid #2e2e2e',
  borderRadius: '6px',
  fontSize: '12px',
  color: '#ccc',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap'
}

const tableWrapStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  border: '1px solid #2e2e2e',
  borderRadius: '6px'
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '12px'
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  backgroundColor: '#252525',
  borderBottom: '1px solid #333',
  color: '#aaa',
  fontWeight: 500,
  position: 'sticky',
  top: 0
}

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #2a2a2a',
  verticalAlign: 'top'
}

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  justifyContent: 'flex-end',
  paddingTop: '6px'
}

const btnBase: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '4px',
  border: '1px solid #3a3a3a',
  fontSize: '12px',
  fontFamily: 'inherit',
  cursor: 'pointer'
}

const btnApprove: React.CSSProperties = {
  ...btnBase,
  backgroundColor: '#1f4d2e',
  borderColor: '#2e7045',
  color: '#a5e0b3'
}

const btnApproveDisabled: React.CSSProperties = {
  ...btnBase,
  backgroundColor: '#2a2a2a',
  color: '#555',
  cursor: 'not-allowed'
}

const btnReject: React.CSSProperties = {
  ...btnBase,
  backgroundColor: '#3d1a1a',
  borderColor: '#6e2c2c',
  color: '#ff8a8a'
}

const btnNeutral: React.CSSProperties = {
  ...btnBase,
  backgroundColor: '#2a2a2a',
  color: '#aaa'
}

const feedbackInputStyle: React.CSSProperties = {
  flex: 1,
  backgroundColor: '#1a1a1a',
  color: '#e0e0e0',
  border: '1px solid #3a3a3a',
  borderRadius: '4px',
  padding: '6px 8px',
  fontSize: '12px',
  fontFamily: 'inherit'
}

export function TeamProposalDialog({ proposal, activeTabId, onClose, onApproved }: Props): React.ReactElement {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const a of proposal.agents) init[a.name] = true
    return init
  })
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refresh checked state if a different proposal arrives while open (rare)
  useEffect(() => {
    const init: Record<string, boolean> = {}
    for (const a of proposal.agents) init[a.name] = true
    setChecked(init)
  }, [proposal.id])

  const checkedCount = useMemo(
    () => proposal.agents.filter(a => checked[a.name]).length,
    [proposal.agents, checked]
  )

  const toggle = (name: string) => {
    setChecked(prev => ({ ...prev, [name]: !prev[name] }))
  }

  const toggleAll = () => {
    const allChecked = proposal.agents.every(a => checked[a.name])
    const next: Record<string, boolean> = {}
    for (const a of proposal.agents) next[a.name] = !allChecked
    setChecked(next)
  }

  const handleApprove = async () => {
    if (checkedCount === 0) return
    setSubmitting(true)
    setError(null)
    const approvedNames = proposal.agents.filter(a => checked[a.name]).map(a => a.name)
    const result = await window.electronAPI.proposalsApprove(proposal.id, approvedNames, activeTabId)
    setSubmitting(false)
    if (!result.success) {
      setError(result.error || 'Spawn failed')
      return
    }
    onApproved(result.spawned || [])
    onClose()
  }

  const handleReject = async () => {
    setSubmitting(true)
    await window.electronAPI.proposalsReject(proposal.id, feedback.trim() || undefined)
    setSubmitting(false)
    onClose()
  }

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}>
      <div style={dialogStyle}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>Team proposal from {proposal.proposedBy}</h2>
          <span style={{ color: '#666', fontSize: '11px' }}>
            {proposal.agents.length} agent{proposal.agents.length === 1 ? '' : 's'}
          </span>
        </div>

        <div style={summaryStyle}>{proposal.summary}</div>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '32px' }}>
                  <input
                    type="checkbox"
                    checked={proposal.agents.every(a => checked[a.name])}
                    onChange={toggleAll}
                    title="Toggle all"
                  />
                </th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>CLI</th>
                <th style={thStyle}>Model</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Shell</th>
              </tr>
            </thead>
            <tbody>
              {proposal.agents.map(a => (
                <AgentRow
                  key={a.name}
                  agent={a}
                  checked={!!checked[a.name]}
                  onToggle={() => toggle(a.name)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <div style={{ color: '#ff8a8a', fontSize: '12px' }}>{error}</div>
        )}

        <div style={buttonRowStyle}>
          <input
            type="text"
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Optional reason if rejecting..."
            style={feedbackInputStyle}
            disabled={submitting}
          />
          <button onClick={onClose} style={btnNeutral} disabled={submitting}>Close</button>
          <button onClick={handleReject} style={btnReject} disabled={submitting}>Reject</button>
          <button
            onClick={handleApprove}
            style={checkedCount === 0 || submitting ? btnApproveDisabled : btnApprove}
            disabled={checkedCount === 0 || submitting}
          >
            {submitting ? 'Spawning...' : `Approve & Spawn ${checkedCount}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentRow({ agent, checked, onToggle }: { agent: ProposedAgent; checked: boolean; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(v => !v)}>
        <td style={tdStyle} onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggle} />
        </td>
        <td style={{ ...tdStyle, color: '#ddd', fontWeight: 500 }}>{agent.name}</td>
        <td style={tdStyle}>{agent.cli}</td>
        <td style={tdStyle}>{agent.model || <span style={{ color: '#666' }}>default</span>}</td>
        <td style={tdStyle}>{agent.role || <span style={{ color: '#666' }}>—</span>}</td>
        <td style={tdStyle}>{agent.autoMode ? <span style={{ color: '#f5a25a' }}>auto</span> : 'manual'}</td>
        <td style={tdStyle}>{agent.shell || <span style={{ color: '#666' }}>default</span>}</td>
      </tr>
      {expanded && agent.ceoNotes && (
        <tr>
          <td style={{ ...tdStyle, borderBottom: '1px solid #2a2a2a' }}></td>
          <td colSpan={6} style={{ ...tdStyle, color: '#aaa', whiteSpace: 'pre-wrap', fontSize: '11px' }}>
            <div style={{ color: '#666', marginBottom: '4px' }}>CEO notes:</div>
            {agent.ceoNotes}
          </td>
        </tr>
      )}
    </>
  )
}
