export type StackTaskStatus = 'pending' | 'in_progress' | 'completed'

export type StackTask = { id: string; subject: string; status: StackTaskStatus }

export type StackAgent = { label: string; tool: string; calls: number }

export type StackLimit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    stack: {
      tasks: StackTask[]
      agents: Record<string, StackAgent>
      limits: StackLimit[]
      tracked: Record<string, number>
      backfill: Record<string, number>
      backfillStatus: string
      lastCostUsd: number | null
      isExpanded: boolean
      hidden: string[]
    }
  }
}
