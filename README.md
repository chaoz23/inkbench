# InkBench

InkBench is a neutral, reproducible benchmarking harness for measuring how effectively different search algorithms discover planted bugs and explore real [Ink](https://github.com/inkle/ink) interactive stories.

It does not exist to make InkSwarm win. It exists to discover whether InkSwarm—or any future searcher—improves bug yield per fixed compute budget or reliably finds classes of failures that simpler strategies miss.

Version 0.1.0 is a working research vertical slice: it generates Ink fixtures, runs a pinned and licensed three-project authored corpus, enforces transition budgets, runs four internal strategies, invokes the real InkCheck CLI when configured, records exact repro paths, and emits raw datasets plus competence, survival, coverage, and complementarity summaries.

The current unreleased work adds the resource-bounded execution layer needed for mature InkSwarm experiments: explicit checkpoint ownership, heap/time guards, isolated workers, streamed progress, atomic partial evidence, and resumable experiment matrices.

## What ships in 0.1.0

- Deterministic procedural generators for all eleven initial bug families.
- Separate fixture, search, and Ink-runtime seeds.
- One shared instrumented runtime and opaque checkpoint API for internal strategies.
- Random, deterministic systematic, simple coverage-guided, and minimal InkSwarm explorers.
- An optional adapter for the actual [InkCheck](https://github.com/chaoz23/inkcheck) CLI—not a favorable reimplementation.
- A separate authored-project tier containing Dog Ink Adventure, The Intercept, and Heresy II with pinned upstream commits, licenses, source/artifact hashes, and official `inklecate` 1.2.1 compiled artifacts.
- Transition, launch, wall-time, CPU-time, empirical coverage, first-discovery, and replay evidence.
- NDJSON, CSV, JSON, Markdown, generated `.ink`, and manifest outputs.
- Detection-probability cells, right-censored survival points, family competence maps, and paired exclusive/union discoveries.

## Quick start

Requires Node.js 20 or newer.

```sh
npm install
npm test

# See the fixture families
node dist/cli.js families

# Run one matched cell
node dist/cli.js run \
  --family combination-lock \
  --algorithm swarm \
  --fixture-seed 3 \
  --search-seed 7 \
  --difficulty 2 \
  --budget 500

# Produce a small repeated experiment
npm run experiment:quick

# Verify and smoke-test the authored corpus
node dist/cli.js corpus verify
npm run corpus:smoke
```

The package binary is also named `inkbench` after installation.

## Benchmark families

| Family | Primary stress |
| --- | --- |
| `shallow-obvious` | Control: an obvious shallow failure |
| `deep-corridor` | Long, low-yield-looking progress with tempting exits |
| `rare-prefix` | Several specific early choices |
| `combination-lock` | Independent variable settings combined later |
| `loop-count` | Exact revisit count before exit |
| `revisit-after-mutation` | Old territory changed by distant state mutation |
| `novelty-honeypot` | A high-branching “casino” away from the bug |
| `false-novelty` | An irrelevant, constantly changing variable |
| `delayed-consequence` | Long delay between cause and failure |
| `order-dependent` | Common locations whose visit order alone matters |
| `compound-needle` | Prefix, state, order, and loop conditions combined |

Each generated fixture has a machine-readable manifest with difficulty coordinates for depth, width, state dimensionality, rarity, delay, revisit, deception, and order. Searchers never receive the manifest or generator targets.

## Two benchmark tiers

| Tier | Question | Primary evidence |
| --- | --- | --- |
| `generated-planted` | Does a strategy find a known defect within budget? | discovery probability, time-to-discovery, survival, bug-family competence, exclusive bugs |
| `authored-project` | Does behavior transfer to realistic Ink structure? | empirical state/edge/location coverage, runtime findings, compute cost, paired exclusive coverage |

The tiers are deliberately not pooled. Real stories have no planted-bug oracle, so a higher coverage count is neither a bug discovery nor proof-relative coverage. They provide ecological-validity and complementarity evidence around the causal planted-bug experiments.

The authored corpus is inherited from InkCheck's promotion corpus and includes:

- **Dog Ink Adventure** by Earok (MIT), a small function- and loop-heavy multi-file project;
- **The Intercept** by inkle Ltd. (MIT), a choice-dense medium story; and
- **Heresy II** by Randall Frank (CC BY 4.0), a larger stitch-heavy project with seeded runtime randomness.

See [the corpus provenance record](corpus/authored-v1/README.md), machine-readable [manifest](corpus/authored-v1/manifest.json), and [third-party notices](THIRD_PARTY_NOTICES.md). Every load verifies source, license, and compiled-artifact digests. Authored projects use official `inklecate` 1.2.1 `-c` output in the same `inkjs` runtime used by the internal searchers; this cleanly separates compiler compatibility from search behavior.

## Strategy contract

InkBench owns the story and measurement. Internal strategies receive the same observation:

- current location, output, tags, and legal choices;
- global variables and declared-location visit counts;
- terminal, warning, error, and already-observable bug events;
- semantic coverage deltas; and
- opaque handles for checkpoints they have already reached.

Every strategy may explicitly retain and later restore any checkpoint it observed, then release it when no longer needed. Retained Ink save states are measured and charged to that strategy. Root and the active state are runtime infrastructure; the controller no longer keeps every historical transition forever. InkSwarm's saved colonies are therefore an allocation policy, not privileged access. Generator parameters, planted-oracle definitions, undiscovered graph structure, and raw save JSON remain hidden.

The primary in-process budget is one **choice transition**. Checkpoint restore is not a transition, but its CPU and wall cost is measured. See [the architecture decision record](docs/architecture.md) for the full boundary and limitations.

## Resource-bounded and mature runs

Long runs should use isolated workers so one strategy cannot take down the matrix process:

```sh
inkbench run \
  --family compound-needle \
  --algorithm swarm \
  --difficulty 3 \
  --budget 1000000 \
  --isolated \
  --max-memory-mb 1536 \
  --max-time-seconds 1800 \
  --progress ndjson \
  --json
```

The worker stops cleanly before its heap watermark and returns `status: "resource-stopped"` with partial coverage, findings, witnesses, peak heap/RSS, and retained-checkpoint evidence. `--worker-heap-mb` optionally sets the child V8 ceiling; otherwise InkBench places an explicit memory guard below a derived worker ceiling.

The deliberately large mature matrices use held-out seeds, 30 paired repetitions, logarithmic budgets from 1,000 through 10,000,000 native work units, a 1,536 MiB heap guard, and a 30-minute per-cell time guard:

```sh
inkbench experiment --preset mature --out artifacts/mature --resume
inkbench corpus experiment --preset mature --out artifacts/corpus-mature --resume
```

`mature` implies isolated execution. Each cell writes an atomic `cells/<run-id>.json` and a replace-in-place `progress/<run-id>.json`; `matrix-state.json` and the durable append-only `runs.partial.ndjson` journal survive interruption. Per-cell files are authoritative if the journal's last line is interrupted. `--resume` skips exact completed run IDs. It does **not** claim to resume a search frontier inside an interrupted cell; exact cross-process policy continuation remains future work.

Resource-stopped cells remain in raw/resource summaries but are excluded from fixed-transition discovery probability because they did not receive the full requested work. Compare cross-tool runs through wall time, CPU, peak memory, and findings while retaining each tool's native budget unit.

## Algorithms

| ID | Purpose |
| --- | --- |
| `random` | Seeded uniform choices in root-started episodes; calibration baseline |
| `systematic` | Deterministic DFS with semantic-state deduplication; not called InkCheck |
| `coverage` | Small semantic coverage/yield priority frontier; the critical simple control |
| `swarm` | Minimal novelty, behavioral saturation, saved colonies, pruning, short local walks, and 15% rogues |
| `inkcheck` | Optional subprocess adapter to the real InkCheck CLI |

To use InkCheck:

```sh
inkbench run \
  --family rare-prefix \
  --algorithm inkcheck \
  --inkcheck-command /absolute/path/to/inkcheck/dist/cli.js \
  --budget 10000
```

InkCheck's current local CLI default is **10,000,000 states** (with a 100,000,000 ceiling); small exhaustive stories still exit early. That is an important calibration point: InkBench's 100/500-transition cells are cold-start checks, not evidence about mature search behavior. The adapter always passes the matrix's explicit `--max-states`, memory, and time limits, so it never relies silently on InkCheck's defaults.

InkCheck's native “states explored” unit is close to, but not identical with, InkBench's choice-transition unit. Reports preserve that distinction and leave unavailable edge/state metrics as `null`. Do not erase the unit label in comparisons. InkCheck exposes its own internal progress stream and detailed memory telemetry; the current synchronous adapter consumes its final report and does not yet translate that stream or every telemetry field into InkBench events.

## Experiment outputs

`inkbench experiment --preset quick --out artifacts/quick` writes:

```text
artifacts/quick/
├── config.json
├── fixtures/
│   ├── *.ink
│   └── *.manifest.json
├── runs.ndjson
├── runs.csv
├── summary.json
└── summary.md
```

`runs.ndjson` is the authoritative cell-level dataset. `summary.json` includes probability and Kaplan–Meier-style survival points. `summary.md` renders family competence and complementarity tables. Timings naturally vary; choices, discoveries, budgets, coverage counts, and witnesses are deterministic for pinned versions and seeds.

Run reports use schema v2 and include a `resources` section. Versioned progress events and resumable matrix-state schemas live beside the other contracts in [`schemas/`](schemas).

The versioned JSON schemas live in [`schemas/`](schemas), and the contribution path for another strategy or external tool is documented in [adding a searcher](docs/adding-a-searcher.md).

You can also use a checked configuration:

```sh
inkbench experiment --config examples/quick-experiment.json --out artifacts/configured
```

Authored-project experiments use a separate command and report format:

```sh
inkbench corpus list
inkbench corpus run --story the-intercept --algorithm coverage --budget 1000
inkbench corpus experiment --preset smoke --out artifacts/corpus-smoke
inkbench corpus experiment --config examples/authored-smoke.json --out artifacts/corpus-configured
```

The authored summary reports empirical coverage and paired exclusive locations/edges. Its raw runs carry `benchmarkTier: "authored-project"`, an empty `plantedBugIds` array, item-level coverage hashes, and reproducible runtime-warning/error paths. Add `--inkcheck-command` to either corpus command to exercise the real InkCheck adapter; InkCheck retains its native state unit and unavailable item-level metrics remain `null`.

## Reading results honestly

- Compare planted-bug probability at a fixed budget, not only aggregate state counts.
- Publish family-level regressions and exclusive discoveries alongside any overall result.
- Treat undiscovered runs as right-censored, not as infinite discovery times.
- Call empirical counts “states observed,” not percentage coverage, unless the reachable denominator is proven.
- Separate transition efficiency from wall/CPU efficiency.
- Treat memory/time-stopped cells as partial resource evidence, not completed fixed-budget misses.
- Freeze held-out fixture seeds before tuning an algorithm.
- Keep failed/unavailable cells in the raw dataset.
- Never convert authored-project coverage into planted-bug yield or survival data.

The v0.1 generated-fixture oracle is an explicit global set only when the planted defect is reached. Authored projects already use pinned official `inklecate` artifacts; the next measurement-validity milestone adds official replay of generated witnesses, several defect classes, exhaustive denominators for small fixtures, root-replay budget regimes, and stronger statistical intervals. See [methodology](docs/methodology.md) and [milestones](docs/milestones.md).

The checked [v0.1 development matrix](docs/v0.1-development-results.md) is deliberately candid: the current minimal swarm produced no exclusive discovery in 792 small development cells and was weaker than the simple controls in several families. It is a forcing function for the next experiments, not a promotional benchmark result.

The separate [v0.1 authored-project smoke](docs/v0.1-authored-smoke-results.md) verifies all three real stories across the four internal strategies and records initial coverage complementarity, with an explicit one-seed/no-claims caveat.

The [v0.2 resource-bounded smoke](docs/v0.2-resource-smoke-results.md) verifies guarded isolated workers, explicit checkpoint cost, partial memory-stop evidence, and matrix resume on one logarithmic-budget cell. It is infrastructure evidence, not a leaderboard.

## Why InkBench and InkSwarm are separate

[InkCheck](https://github.com/chaoz23/inkcheck) already offers bounded, deterministic mechanical QA with a mature search portfolio and exact replay. InkSwarm should not pretend that work is merely naïve graph traversal. Its hypothesis is narrower: a finite population that allocates work toward unusual, deep, underexplored narrative states may improve rare-state yield or provide complementary discoveries.

InkBench is designed to falsify that hypothesis. The casino, false-novelty, boring-corridor, loop, delay, and shallow controls are intentionally hostile to plausible InkSwarm failure modes. New biological mechanisms belong in InkSwarm only after a benchmark demonstrates the failure they solve.

## Development

```sh
npm run check
npm test
npm run smoke
```

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md); benchmark neutrality, deterministic replay, raw evidence, and measured regressions are part of the product contract.

InkBench code is MIT licensed. Authored corpus works retain the licenses recorded in [third-party notices](THIRD_PARTY_NOTICES.md).
