import React, { useEffect, useMemo, useState } from 'react'
import type { TeamProposal, ProposedAgent, AgentConfig } from '../../shared/types'
import { CLI_PRESETS, CLI_MODELS, ROLE_PRESETS } from './AgentConfigForm'

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
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 10000
}

const dialogStyle: React.CSSProperties = {
  backgroundColor: '#1a1a1a', color: '#e0e0e0',
  border: '1px solid #3a3a3a', borderRadius: '8px',
  padding: '20px 24px',
  width: 'min(880px, 94vw)', maxHeight: '88vh',
  display: 'flex', flexDirection: 'column', gap: '14px',
  fontFamily: 'Consolas, "SFMono-Regular", Menlo, Monaco, monospace',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)'
}

const titleStyle: React.CSSProperties = { margin: 0, fontSize: '15px', color: '#fff', fontWeight: 600 }

const summaryStyle: React.CSSProperties = {
  padding: '10px 12px',
  backgroundColor: '#222',
  border: '1px solid #2e2e2e',
  borderRadius: '6px',
  fontSize: '12px', color: '#ccc', lineHeight: 1.5,
  whiteSpace: 'pre-wrap'
}

const tableWrapStyle: React.CSSProperties = {
  flex: 1, overflowY: 'auto',
  border: '1px solid #2e2e2e', borderRadius: '6px'
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '12px' }

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px',
  backgroundColor: '#252525', borderBottom: '1px solid #333',
  color: '#aaa', fontWeight: 500,
  position: 'sticky', top: 0
}

const tdStyle: React.CSSProperties = {
  padding: '6px 8px', borderBottom: '1px solid #2a2a2a',
  verticalAlign: 'middle'
}

const editableCellStyle: React.CSSProperties = {
  cursor: 'text',
  borderRadius: '3px',
  padding: '3px 6px',
  margin: '-3px -6px',
  display: 'inline-block',
  minHeight: '18px',
  minWidth: '40px'
}

const inputStyle: React.CSSProperties = {
  backgroundColor: '#1a1a1a', color: '#e0e0e0',
  border: '1px solid #4a7eb0', borderRadius: '3px',
  padding: '2px 6px', fontSize: '12px', fontFamily: 'inherit',
  outline: 'none', width: '100%', boxSizing: 'border-box'
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'auto'
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical', minHeight: '60px',
  fontFamily: 'inherit', lineHeight: 1.4
}

const buttonRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px',
  justifyContent: 'flex-end', paddingTop: '6px'
}

const btnBase: React.CSSProperties = {
  padding: '6px 14px', borderRadius: '4px',
  border: '1px solid #3a3a3a', fontSize: '12px',
  fontFamily: 'inherit', cursor: 'pointer'
}

const btnApprove: React.CSSProperties = {
  ...btnBase, backgroundColor: '#1f4d2e',
  borderColor: '#2e7045', color: '#a5e0b3'
}
const btnApproveDisabled: React.CSSProperties = {
  ...btnBase, backgroundColor: '#2a2a2a', color: '#555', cursor: 'not-allowed'
}
const btnReject: React.CSSProperties = {
  ...btnBase, backgroundColor: '#3d1a1a',
  borderColor: '#6e2c2c', color: '#ff8a8a'
}
const btnNeutral: React.CSSProperties = {
  ...btnBase, backgroundColor: '#2a2a2a', color: '#aaa'
}

const feedbackInputStyle: React.CSSProperties = {
  flex: 1,
  backgroundColor: '#1a1a1a', color: '#e0e0e0',
  border: '1px solid #3a3a3a', borderRadius: '4px',
  padding: '6px 8px', fontSize: '12px', fontFamily: 'inherit'
}

const WINDOWS_SHELLS: Array<AgentConfig['shell']> = ['powershell', 'cmd', 'wsl']
const POSIX_SHELLS: Array<AgentConfig['shell']> = ['bash', 'zsh', 'fish']
const ALL_SHELLS: Array<AgentConfig['shell']> = navigator.platform.toLowerCase().includes('win')
  ? [...WINDOWS_SHELLS, ...POSIX_SHELLS]
  : [...POSIX_SHELLS, ...WINDOWS_SHELLS]

// Known-bad model picks the orchestrator might choose. sonnet[1m] is billed
// against the paid Anthropic API (real money per token), NOT the Claude Max
// subscription — easy money sink to spawn by accident. Lowercase kimi names
// get rejected silently by kimi-cli.
const MODEL_WARNINGS: Record<string, string> = {
  'sonnet[1m]': 'WARNING: sonnet[1m] uses the paid Anthropic API ($$$ per token), NOT your Claude Max subscription. Use plain "sonnet" instead.',
  'kimi-k2': 'Not a valid kimi model. Use "Kimi-k2.6" (capital K). Kimi silently rejects unknown names.',
  'kimi-k2.5': 'Lowercase rejected by kimi-cli. Use "Kimi-k2.5" (capital K) or "Kimi-k2.6".',
}

export function TeamProposalDialog({ proposal, activeTabId, onClose, onApproved }: Props): React.ReactElement {
  // Keep a deep-cloneable local mirror of the proposed agents so user edits
  // don't mutate the prop. We index by position because the user may edit
  // names. `checked` is also indexed by position.
  const [editedAgents, setEditedAgents] = useState<ProposedAgent[]>(() => proposal.agents.map(a => ({ ...a })))
  const [checked, setChecked] = useState<boolean[]>(() => proposal.agents.map(() => true))
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state if the modal is recycled for a different proposal
  useEffect(() => {
    setEditedAgents(proposal.agents.map(a => ({ ...a })))
    setChecked(proposal.agents.map(() => true))
    setExpanded(new Set())
    setFeedback('')
    setError(null)
  }, [proposal.id, proposal.agents])

  const checkedCount = useMemo(() => checked.filter(Boolean).length, [checked])
  const isDirty = useMemo(() => {
    return editedAgents.some((a, i) => JSON.stringify(a) !== JSON.stringify(proposal.agents[i]))
  }, [editedAgents, proposal.agents])

  const updateAgent = (index: number, partial: Partial<ProposedAgent>) => {
    setEditedAgents(prev => {
      const next = [...prev]
      next[index] = { ...next[index], ...partial }
      // If cli changed and the model isn't valid for the new cli, blank it
      // so the user gets the new dropdown's default.
      if (partial.cli && partial.cli !== prev[index].cli) {
        const validModels = CLI_MODELS[partial.cli] || []
        const stillValid = validModels.some(m => m.value === next[index].model)
        if (!stillValid) next[index].model = ''
      }
      return next
    })
  }

  const toggleChecked = (index: number) => {
    setChecked(prev => prev.map((v, i) => i === index ? !v : v))
  }
  const toggleAll = () => {
    const allOn = checked.every(Boolean)
    setChecked(checked.map(() => !allOn))
  }
  const toggleExpanded = (index: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index); else next.add(index)
      return next
    })
  }
  const resetEdits = () => {
    setEditedAgents(proposal.agents.map(a => ({ ...a })))
  }

  const handleApprove = async () => {
    if (checkedCount === 0) return
    setSubmitting(true)
    setError(null)
    const toSpawn = editedAgents.filter((_, i) => checked[i])
    const result = await window.electronAPI.proposalsApprove(proposal.id, toSpawn, activeTabId)
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={titleStyle}>Team proposal from {proposal.proposedBy}</h2>
          <span style={{ color: '#666', fontSize: '11px' }}>
            {proposal.agents.length} agent{proposal.agents.length === 1 ? '' : 's'} · click any cell to edit
          </span>
          {isDirty && (
            <button onClick={resetEdits} style={{ ...btnNeutral, padding: '3px 8px', fontSize: '11px' }}>
              Reset edits
            </button>
          )}
        </div>

        <div style={summaryStyle}>{proposal.summary}</div>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '32px' }}>
                  <input
                    type="checkbox"
                    checked={checked.every(Boolean)}
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
                <th style={{ ...thStyle, width: '60px' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {editedAgents.map((agent, i) => (
                <AgentRow
                  key={i}
                  agent={agent}
                  checked={checked[i]}
                  expanded={expanded.has(i)}
                  onToggle={() => toggleChecked(i)}
                  onToggleExpanded={() => toggleExpanded(i)}
                  onChange={(partial) => updateAgent(i, partial)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {error && <div style={{ color: '#ff8a8a', fontSize: '12px' }}>{error}</div>}

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
            {submitting ? 'Spawning…' : `Approve & Spawn ${checkedCount}`}
          </button>
        </div>
      </div>
    </div>
  )
}

interface RowProps {
  agent: ProposedAgent
  checked: boolean
  expanded: boolean
  onToggle: () => void
  onToggleExpanded: () => void
  onChange: (partial: Partial<ProposedAgent>) => void
}

function AgentRow({ agent, checked, expanded, onToggle, onToggleExpanded, onChange }: RowProps) {
  const modelOptions = CLI_MODELS[agent.cli] || []
  const modelWarning = agent.model ? MODEL_WARNINGS[agent.model] : undefined

  return (
    <>
      <tr>
        <td style={tdStyle}>
          <input type="checkbox" checked={checked} onChange={onToggle} />
        </td>
        <td style={tdStyle}>
          <EditableText
            value={agent.name}
            onChange={(v) => onChange({ name: v })}
            placeholder="agent-name"
          />
        </td>
        <td style={tdStyle}>
          <EditableSelect
            value={agent.cli}
            options={CLI_PRESETS.filter(p => p.value).map(p => ({ label: p.label, value: p.value }))}
            onChange={(v) => onChange({ cli: v })}
          />
        </td>
        <td style={tdStyle}>
          <EditableSelect
            value={agent.model || ''}
            options={modelOptions}
            onChange={(v) => onChange({ model: v || undefined })}
            warning={modelWarning}
            allowEmpty
            emptyLabel="default"
          />
        </td>
        <td style={tdStyle}>
          <EditableSelect
            value={agent.role}
            options={ROLE_PRESETS.filter(r => r.value).map(r => ({ label: r.label, value: r.value }))}
            onChange={(v) => onChange({ role: v })}
            allowFreeform
            freeformPlaceholder="custom role"
          />
        </td>
        <td style={tdStyle}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={agent.autoMode}
              onChange={(e) => onChange({ autoMode: e.target.checked })}
            />
            <span style={{ fontSize: '11px', color: agent.autoMode ? '#f5a25a' : '#888' }}>
              {agent.autoMode ? 'auto' : 'manual'}
            </span>
          </label>
        </td>
        <td style={tdStyle}>
          <EditableSelect
            value={agent.shell || ''}
            options={ALL_SHELLS.map(s => ({ label: shellLabel(s!), value: s! }))}
            onChange={(v) => onChange({ shell: (v || undefined) as AgentConfig['shell'] | undefined })}
            allowEmpty
            emptyLabel="default"
          />
        </td>
        <td style={tdStyle}>
          <button
            onClick={onToggleExpanded}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: agent.ceoNotes ? '#8cc4ff' : '#666',
              fontSize: '11px', padding: '2px 6px'
            }}
            title={agent.ceoNotes ? 'Edit CEO notes' : 'Add CEO notes'}
          >
            {expanded ? 'hide' : (agent.ceoNotes ? 'edit' : 'add')}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td style={tdStyle}></td>
          <td colSpan={7} style={{ ...tdStyle, paddingBottom: '12px' }}>
            <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px' }}>
              CEO notes — what this agent should do:
            </div>
            <textarea
              value={agent.ceoNotes}
              onChange={(e) => onChange({ ceoNotes: e.target.value })}
              placeholder="e.g. Focus on the API layer. Coordinate with the orchestrator before merging."
              style={textareaStyle}
              rows={4}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Reusable editable cell components ─────────────────────────────────────────

function EditableText({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onChange(draft.trim() || value)
  }
  const cancel = () => {
    setEditing(false)
    setDraft(value)
  }

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') cancel()
        }}
        placeholder={placeholder}
        style={inputStyle}
      />
    )
  }
  return (
    <span
      style={{ ...editableCellStyle, color: '#ddd', fontWeight: 500 }}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || <span style={{ color: '#666' }}>{placeholder}</span>}
    </span>
  )
}

interface SelectOpt { label: string; value: string }

function EditableSelect({ value, options, onChange, allowEmpty, emptyLabel, allowFreeform, freeformPlaceholder, warning }: {
  value: string
  options: SelectOpt[]
  onChange: (v: string) => void
  allowEmpty?: boolean
  emptyLabel?: string
  allowFreeform?: boolean
  freeformPlaceholder?: string
  warning?: string
}) {
  const [editing, setEditing] = useState(false)
  const matched = options.find(o => o.value === value)
  const isFreeform = allowFreeform && value && !matched

  const commit = (v: string) => {
    setEditing(false)
    if (v !== value) onChange(v)
  }

  if (editing) {
    return (
      <select
        value={value}
        autoFocus
        onChange={(e) => {
          const v = e.target.value
          if (v === '__custom__') {
            // Switch to freeform: blank out so the FreeformInput shows below.
            // Setting to a sentinel triggers the inline text input render path.
            onChange('')
            setEditing(false)
            // Defer so the user can immediately re-click to type.
            setTimeout(() => setEditing(true), 0)
          } else {
            commit(v)
          }
        }}
        onBlur={() => setEditing(false)}
        style={selectStyle}
      >
        {allowEmpty && <option value="">{emptyLabel || '(default)'}</option>}
        {options.map(o => <option key={o.value || '__empty__'} value={o.value}>{o.label}</option>)}
        {isFreeform && <option value={value}>{value} (custom)</option>}
        {allowFreeform && <option value="__custom__">— Custom… —</option>}
      </select>
    )
  }

  if (allowFreeform && (value === '' || isFreeform)) {
    // Hybrid: when freeform is allowed and user is typing a custom value,
    // show a text input. They can still click "Custom" in the dropdown to
    // re-enter this mode after picking a preset.
    return (
      <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={freeformPlaceholder || 'value'}
          style={{ ...inputStyle, width: '110px' }}
        />
        <button
          onClick={() => setEditing(true)}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '11px' }}
          title="Pick from presets"
        >▼</button>
      </span>
    )
  }

  const display = value || (emptyLabel ? <span style={{ color: '#666' }}>{emptyLabel}</span> : '')
  const cellStyle: React.CSSProperties = warning
    ? { ...editableCellStyle, color: '#f5a25a', borderBottom: '1px dotted #f5a25a' }
    : { ...editableCellStyle, color: '#ddd' }
  return (
    <span style={cellStyle} onClick={() => setEditing(true)} title={warning || 'Click to edit'}>
      {display}{warning ? ' \u26A0' : ''}
    </span>
  )
}

function shellLabel(s: string): string {
  if (s === 'powershell') return 'PowerShell'
  if (s === 'cmd') return 'cmd'
  if (s === 'wsl') return 'WSL'
  if (s === 'bash') return 'Bash'
  if (s === 'zsh') return 'Zsh'
  if (s === 'fish') return 'Fish'
  return s
}
