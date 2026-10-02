# claude-mods

Claude Code mods by Shahriar.

## Install

```
/plugin marketplace add ShahriarBijoy/claude-mods
/plugin install stack@shahriar-mods
/reload-plugins
```

Mods are an early-access Claude Code feature, so you need a recent Claude Code build (developed on 2.1.286).

## stack

A progress band above the prompt with one row per tracked thing:

- **Tasks:** progress through the todo list, with a tick per task.
- **Subagents:** one row per running subagent, showing its current tool.
- **Session and weekly limits:** usage, and when each resets.
- **Monthly cost:** this month's spend so far against last month's.

It starts collapsed to one summary line. Focus the band with ctrl+x tab and press `e` to expand or collapse it, or use the commands:

- `/stack`: toggle
- `/stack expand` and `/stack collapse`
- `/stack hide <row>` and `/stack show <row|all>`

Rows are `tasks`, `subagents`, `session`, `weekly`, `limits` and `costs`.

**Note:** to backfill costs from before you installed it, `stack` runs `npx --yes ccusage claude monthly --json` on your machine at session start, at most every 12 hours. That downloads and runs the [ccusage](https://github.com/ryoppippi/ccusage) package. If the run fails, `/stack` reports why, and only months from the install onward are tracked.
