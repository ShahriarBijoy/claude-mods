# claude-mods

Claude Code mods by Shahriar.

## Install

Add the marketplace once:

```
/plugin marketplace add ShahriarBijoy/claude-mods
```

Then install the mods you want, and reload:

```
/plugin install stack@shahriar-mods
/plugin install wartezeit@shahriar-mods
/reload-plugins
```

To update installed mods later, run `/plugin marketplace update shahriar-mods`, then `/reload-plugins`.

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

## wartezeit

A Duolingo-style German vocabulary game in the band above the prompt. It only shows while Claude is working; answer with 1–4 from the empty prompt.

- **Words from your session:** once your prompt, the files Claude touches and the commands it runs make the topic clear, a background `claude -p` run on Sonnet 5.5 writes a deck of about 22 words for it, using your Claude login. Until then, and when a run fails, you get a bundled deck of everyday words. A topic seen before reuses its saved deck without a new run.
- **Checked articles:** every noun's article is checked against a bundled list of German noun genders, and cards that disagree are dropped.
- **Card types:** English → German, German → English, der/die/das, and fill-the-gap sentences. In a gap for a noun, the other options all have a different gender, so only one fits.
- **Spaced repetition:** each word moves through five Leitner boxes. Three of every five questions are new words from the session and two are due reviews from earlier sessions.
- **Goal and streak:** 20 right answers a day, a streak for every day with a right answer, and 10 XP per right answer.

Commands:

- `/wartezeit`: the current deck and mode
- `/wartezeit mode <mixed|vocab|meaning|article|sentence>`
- `/wartezeit stats`: streak, accuracy per card type, your 10 weakest words, and words learned per topic

**Note:** each new topic costs one Sonnet 5.5 run against your Claude subscription usage (about $0.04, 25 seconds). The run is started with `WARTEZEIT_CHILD=1`, which makes the mod inside it do nothing.
