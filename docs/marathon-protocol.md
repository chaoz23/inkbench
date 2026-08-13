# Marathon benchmark protocol

## Research question

The marathon tier asks whether InkSwarm or InkCheck improves planted-bug yield per fixed wall-time budget, or finds repeatable bug classes missed by simpler random, systematic, and coverage-guided controls. Aggregate empirical coverage is secondary evidence, not the verdict.

## Two-stage duration ladder

The 20-minute tier is a protocol-validation experiment. It must establish that cells terminate honestly, progress and atomic output survive interruption, memory remains controlled, seeds replay, work ceilings do not bind, and paired outcomes have enough variance to justify a longer run. It is not automatically a swarm-emergence claim.

The 60-minute tier is promoted from the same configuration. Only `budgets: [1200000]` changes to `budgets: [3600000]`. Fixture seeds, search seeds, algorithms, search options, story seed, memory watermark, scoring, and output contract stay fixed.

If important survival curves are still falling at 60 minutes, add longer tiers rather than extrapolating. All tiers write independent, resumable cells and may run for days.

## Controlled resources

- Primary budget: planned wall time.
- Native ceiling: 100,000,000 choice transitions or InkCheck states. It is a safety ceiling and must not bind a valid timed cell.
- Heap watermark: 4,096 MiB on the current 8 GiB machine.
- External Node envelope: InkCheck receives a 5,120 MiB V8 old-space limit around that 4,096 MiB cooperative watermark, matching InkBench's 80%-of-old-space worker posture. `--max-memory` alone does not enlarge V8 old space.
- Scheduling: one cell at a time. Do not co-schedule marathon matrices.
- Parallelism: each internal algorithm uses one core. The primary InkCheck arm fixes `--concurrency 1`; reports retain InkCheck's requested/effective execution telemetry.
- Planned time expiry: completed evidence.
- Memory stop, error, cancellation, or premature native work ceiling: incomplete/resource evidence, excluded from completed-cell yield estimates.
- Search exhaustion: completed evidence, with the smaller actual wall time retained. Repeating an exhausted frontier until the timer would add no information.

Wall time is directly comparable. CPU time is reported for in-process algorithms; the current InkCheck report does not expose child CPU time, so it remains `null` rather than being guessed.

## InkCheck arms

The scientific discovery arm explicitly selects portfolio search, fixes concurrency at one, disables repro minimization, and raises maximum depth to 1,000. This focuses the grant on discovery and compares one-core search policies.

A separate product-default sensitivity arm records an empty `inkcheckOptions` object. It retains InkCheck's automatic concurrency, default portfolio, repro minimization, and depth 100. Do not pool this arm with the primary comparison; judge it using actual wall time and recorded effective parallelism.

InkBench removes planted oracle declarations, assignments, and marker tags from InkCheck's search state. A triggering assignment becomes a reserved numeric runtime tag that InkCheck does not use for state identity, novelty, allocation, or ending identity. Only signaled paths are replayed against the pinned instrumented fixture to score bugs; ordinary ending paths are not streamed in this mode. Internal observations likewise omit bug events and bug IDs, and novelty keys exclude oracle globals.

InkCheck portfolio state positions remain pass-local rather than portfolio-global. The corrected bounded evidence stream adds a process-global elapsed timestamp to every first-retained replay path, so InkCheck enters wall-time survival curves while remaining excluded from transition/state-unit survival curves.

## Benchmark strata

1. Hard generated planted families at difficulty 10 measure controlled mechanisms and exact bug yield.
2. Heresy II is the current large authored transfer case. It measures empirical coverage, complementarity, throughput, memory, and runtime findings but has no planted-bug probability.
3. Intercept-20 measures multi-bug scoring and clustered territory effects. It is a sanity/stress fixture, not a sufficient marathon discriminator if it saturates early.

The next planted-story milestone is a large, non-saturating multi-bug story or Heresy-derived mutation corpus. Until then, do not turn Heresy coverage into bug-yield claims or treat Intercept saturation as evidence of long-run superiority.

## Promotion gate from 20 to 60 minutes

Promote when:

- all planned-time cells are labeled completed/time;
- no cell hits the 100,000,000 native ceiling;
- memory stops are either eliminated by a justified cap change or retained as an intentional strategy outcome;
- repeated seeds reproduce trajectories under fixed work budgets and produce plausible variance under timed runs;
- oracle-neutral replay agrees with direct instrumented scoring on calibration fixtures;
- InkCheck adapter failures and unavailable timing fields remain explicit;
- coverage-guided throughput is not dominated by an avoidable global frontier scan; and
- output can resume after interruption without duplicating completed run IDs.

If a gate fails, change methodology and rerun 20 minutes. Do not tune InkSwarm mechanisms against held-out 60-minute outcomes.

An InkCheck process that starts but does not finish its bounded evidence stream is recorded as `runtime-error`, not `adapter-unavailable` and not a zero-discovery result. The adapter uses InkCheck's opt-in `--json-stream` transport: replay paths are durable as they are retained, the terminal summary is bounded, and the CLI artifact SHA-256 is recorded. The wrapper enforces a five-second hard grace beyond the planned deadline; reaching that backstop is a failed cell, not clean time-budget evidence.
