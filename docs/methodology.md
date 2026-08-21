# Benchmark methodology

InkBench's question is not “which strategy reports the largest state count?” It asks whether a strategy improves planted-bug yield per fixed work/compute budget or makes repeatable discoveries that the other strategies miss.

## Required comparisons

Run matched cells over fixture family, structural fixture seed, search seed/repetition, budget, runtime seed, exact executable fingerprint, and tool version. Preserve the raw cell even when compilation or an adapter fails. Evaluation matrices freeze a counterbalanced serial cell order before execution so algorithm position is not confounded with machine drift.

Primary outcomes:

- probability of discovery by a fixed transition budget;
- transitions and elapsed/CPU time to first discovery;
- empirical location, choice, edge, semantic-state, variable-value, and transition coverage;
- family-level performance and difficulty coordinates;
- paired exclusive discoveries and union yield; and
- survival/time-to-discovery curves with undiscovered runs right-censored at budget.

Secondary outcomes include launches, episodes, raw save diversity, warnings/errors, and replay validity.

## Cold-start and mature resource regimes

InkSwarm has a warm-up cost: colonies must be created, selected again, and reinforced before population allocation can differ meaningfully from short random walks. Report two regimes instead of treating one small budget as universal:

- **cold-start:** 100–1,000 transitions, measuring immediate efficiency;
- **mature:** logarithmic budgets from 1,000 through 10,000,000 native work units, with memory/time stops retained as partial evidence. Ten million matches InkCheck's current local CLI default; it is a ceiling for a paired cell, not a requirement that an exhaustive story waste the entire grant.

Run mature cells in isolated processes under identical memory and time caps. Record requested versus consumed transitions, stop reason, peak process heap/RSS, peak runtime snapshot bytes, peak explicitly retained checkpoint bytes, and findings before the stop. Report two estimands: **observed-anytime yield**, which includes valid completed and resource-stopped prefixes at their actual horizons, and **fixed-grant completer yield**, which uses only runs that received the requested grant. Never silently discard discoveries from a resource-stopped run or present that prefix as if it completed the grant.

Resource stopping can depend on the explored trajectory, so it is potentially informative rather than ordinary independent censoring. Survival output labels resource-stop censoring and is descriptive unless a later estimator explicitly models that stopping process. Probability cells include Wilson 95% intervals and separate completed/resource-stopped counts; small samples should remain visibly uncertain.

Each probability cell also reports worst/best unresolved-stop sensitivity bounds: the lower endpoint treats every resource stop as a miss and the upper endpoint treats every resource stop as a discovery. Every tier uses the same terminal taxonomy (`budget`, `time`, `search-exhausted`, memory/native-ceiling resource stops, adapter/runtime failure, cancellation). Failures are never converted to misses.

Cross-tool work units remain distinct. Compare InkCheck states and InkBench choice transitions through separate native-work curves plus common wall-time, CPU, peak-memory, and finding outcomes; do not manufacture a state-to-transition conversion.

The large ladder is there to expose warm-up, crossover, diminishing-return, and resource-bound behavior. It does not make the biological metaphor evidence: the minimal swarm is promoted only through paired family-level results and ablations against random, systematic, and coverage-guided controls.

## Planned marathon wall time

Use a planned wall-time budget—not an emergency time guard—for marathon comparisons. Planned expiry is a completed observation. A memory stop or a high native work safety ceiling reached before the timer is incomplete evidence. Preserve both the primary `wall-ms` grant and native work consumed in every report.

The 20-minute tier validates the protocol and estimates early variance. The 60-minute tier keeps fixture seeds, search seeds, policies, depth settings, memory watermark, scoring, and serial schedule frozen; only duration changes. The v4 generated marathon uses three held-out structural seeds and three matched search seeds per family. Generated difficulty-10 families supply planted outcomes, Heresy II supplies large-story transfer evidence without planted-bug claims, and Intercept-20 remains a multi-bug sanity case that may saturate early. See [the preregistered promotion gates](marathon-protocol.md).

InkCheck's scientific arm uses one-core portfolio search, no repro-minimization work, and depth 1,000. A separate product-default arm retains InkCheck's automatic concurrency and other defaults and must not be pooled with the scientific arm. InkCheck's bounded stream supplies process-global elapsed discovery timestamps for wall-time survival; its pass-local state positions remain excluded from native-work survival.

InkCheck necessarily receives full Ink source while in-process strategies receive common runtime observations. Reports label this as a different information regime instead of claiming perfect cross-adapter parity. Generated source passed to InkCheck removes all oracle variables, assignments, marker/signal tags, fixture IDs, semantic endpoint names, and removal-site breadcrumbs; neutral endpoint position is seed-permuted. Every ending path is scored afterward by replay against the private instrumented artifact. Authored-planted signal transport is a separate, explicitly labeled instrumentation regime.

Run reports enumerate observable fields and source privileges, share one wall-time origin, and decompose setup, compile/load, adapter startup, search, scoring, replay scoring, evidence serialization, and finalization. Native resource fields carry provenance. External child CPU/RSS remains `null` when an adapter does not expose it, with the reason recorded. Use `inkbench calibrate` to counterbalance the same decisions with common instrumentation enabled and disabled before treating overhead as negligible.

## Authored-project tier

Run real stories as a separate ecological-validity analysis. Match story, search seed, runtime seed, transition budget, runtime/artifact version, and algorithm. Report empirical coverage counts, runtime findings, terminal episodes, CPU/wall cost, and paired exclusive locations/edges.

Authored stories do not have planted oracles. Do not put them in discovery-probability or survival curves, infer that coverage is bug yield, or combine their scores with the generated-fixture tier. A real-story runtime finding can become a bug result only after a story-specific oracle and expected-behavior review are added explicitly.

## Authored-planted tier

Run the disclosed real-story derivative as a third, separate analysis. Match story/mutation-set hash, search seed, runtime seed, budget, compiler artifact, resource limits, and algorithm. Primary outcomes are distinct bugs discovered per run, discovery fraction, per-bug probability/time-to-discovery, fault-type competence, and paired exclusive `(search seed, bug ID)` discoveries.

Every planted mutation must be compilable, have a concrete observable effect beyond its marker, and carry an exact replay witness. This tier may not be used to claim that the upstream authored story contains those bugs. It also should not be pooled with procedurally generated fixture families: one authored mutation set improves realism and within-story diversity but is not an independent sample of 20 stories.

## Longitudinal tier

Run checksum-linked revision sequences as a separate cumulative-cost analysis. Cold arms restart every revision; warm arms may carry only versioned route recipes and measured policy state. Replay, validation, rebase, stale-route failure, pruning, storage, and exploration all count toward creator-owned cost. Publish learning curves, edit-class competence, complementarity, and break-even against cold coverage, including broad-refactor negative controls and a no-rogue ablation. Development sequences are engineering evidence only; validation and evaluation seed partitions remain held out. See [the longitudinal contract](longitudinal-benchmark.md).

## Replication and stopping

Fixture seed count is not automatically structural sample size. `inkbench fixtures audit` publishes topology fingerprints and effective unique skeletons. Declared development (1–99), validation (101–199), and evaluation (201+) partitions fail closed. When a deterministic algorithm is scheduled with multiple search seeds, every generated, authored, and mutant config must declare whether those cells are a single logical trajectory (`single`) or environment/runtime replications (`environment`).

Pilot stopping uses a versioned stage plan with frozen seeds, minimum/maximum runs, stage size, and target Wilson half-width. Inspect only at stage boundaries. Do not continue or stop because an intermediate comparison looks favorable.

## Interpretation rules

- Do not pool families into a single score without also publishing the family table.
- Do not call empirical state counts “percent coverage” unless the denominator is proven.
- Do not treat a missing adapter metric as zero.
- Separate transition-budget efficiency from wall/CPU efficiency.
- Publish regressions and exclusive discoveries for every strategy.
- Freeze evaluation seeds before changing strategy parameters.
- Repeat randomized strategies; one lucky trajectory is a witness, not comparative evidence.
- Treat one-seed authored corpus smokes as plumbing checks, not comparative claims.
- Treat the 20 mutations as within-story bug opportunities, not 20 statistically independent projects.
- Do not compare runs whose executable fingerprints differ as if they were repetitions of one cell.
- Do not resume a legacy or mismatched matrix; preserve it and use a fresh output directory.
- Do not report repeated deterministic cells as independent search evidence unless their environment-replication purpose was declared in advance.
- Do not generalize beyond the published authored-corpus complexity envelope.

## Suggested research matrix

Development: 11 families × 5 fixture seeds × 3 search seeds × 3 strategies × budgets 100/500.

Candidate evaluation: at least 30 paired repetitions per family/difficulty at logarithmic budgets selected before the run. The `mature` preset supplies 30 held-out fixture/search pairs per generated family and 30 held-out search seeds per authored story. Keep the seed range frozen and report package version, git commit, Node version, platform, runtime/compiler version, resource caps, stop reasons, and full experiment configuration.

For the authored tier, repeat every randomized strategy across the same search seeds and story seed(s), retain source/compiler artifact hashes, and publish the per-story competence and complementarity tables. Expand the corpus before making community-wide generalization claims.
