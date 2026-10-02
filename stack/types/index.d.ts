export type StackTaskStatus = 'pending' | 'in_progress' | 'completed'

// `activeForm` is how the todo tool phrases a task while it runs ("Writing tests").
export type StackTask = { id: string; subject: string; status: StackTaskStatus; activeForm?: string }

// `detail` is the current tool call in a few words ("Read register.tsx").
export type StackAgent = { label: string; tool: string; detail?: string; calls: number }

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
