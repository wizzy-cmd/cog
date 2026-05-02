import type Database from 'better-sqlite3'
import type { InboxMessage, InboxPriority } from '../../shared/types'

export class InboxStore {
  private insertStmt: Database.Statement
  private loadStmt: Database.Statement
  private markReadStmt: Database.Statement
  private deleteStmt: Database.Statement
  private clearReadStmt: Database.Statement

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(
      `INSERT INTO inbox_messages
         (id, agent_id, agent_name, message, priority, tags, created_at, read_at, tab_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    this.loadStmt = db.prepare(
      `SELECT id,
              agent_id  AS agentId,
              agent_name AS agentName,
              message,
              priority,
              tags,
              created_at AS createdAt,
              read_at    AS readAt,
              tab_id     AS tabId
       FROM inbox_messages
       ORDER BY created_at DESC`
    )
    this.markReadStmt = db.prepare(`UPDATE inbox_messages SET read_at = ? WHERE id = ?`)
    this.deleteStmt = db.prepare(`DELETE FROM inbox_messages WHERE id = ?`)
    this.clearReadStmt = db.prepare(`DELETE FROM inbox_messages WHERE read_at IS NOT NULL`)
  }

  saveMessage(msg: InboxMessage): void {
    this.insertStmt.run(
      msg.id,
      msg.agentId,
      msg.agentName,
      msg.message,
      msg.priority,
      JSON.stringify(msg.tags),
      msg.createdAt,
      msg.readAt ?? null,
      msg.tabId ?? null
    )
  }

  loadMessages(): InboxMessage[] {
    const rows = this.loadStmt.all() as Array<{
      id: string
      agentId: string
      agentName: string
      message: string
      priority: InboxPriority
      tags: string
      createdAt: string
      readAt: string | null
      tabId: string | null
    }>
    return rows.map(row => ({
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName,
      message: row.message,
      priority: row.priority,
      tags: JSON.parse(row.tags),
      createdAt: row.createdAt,
      readAt: row.readAt ?? undefined,
      tabId: row.tabId ?? undefined
    }))
  }

  markRead(id: string, readAt: string): boolean {
    const result = this.markReadStmt.run(readAt, id)
    return result.changes > 0
  }

  deleteMessage(id: string): boolean {
    const result = this.deleteStmt.run(id)
    return result.changes > 0
  }

  clearRead(): number {
    const result = this.clearReadStmt.run()
    return result.changes
  }
}
