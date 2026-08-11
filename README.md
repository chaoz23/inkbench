# InkBench

InkBench is a neutral, reproducible benchmarking harness for measuring how effectively different search algorithms discover planted bugs in [Ink](https://github.com/inkle/ink) interactive stories.

It does not exist to make InkSwarm win. It exists to discover whether InkSwarm—or any future searcher—improves bug yield per fixed compute budget or reliably finds classes of failures that simpler strategies miss.

Version 0.1.0 is a working research vertical slice: it generates real Ink fixtures, compiles and executes them through pinned `inkjs`, enforces transition budgets, runs four internal strategies, invokes the real InkCheck CLI when configured, records exact repro paths, and emits raw datasets plus competence, survival, and complementarity summaries.

## What ships in 0.1.0

- Deterministic procedural generators for all eleven initial bug families.
- Separate fixture, search, and Ink-runtime seeds.
- One shared instrumented runtime and opaque checkpoint API for internal strategies.
- Random, deterministic systematic, simple coverage-guided, and minimal InkSwarm explorers.
- An optional adapter for the actual [InkCheck](https://github.com/chaoz23/inkcheck) CLI—not a favorable reimplementation.
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

## Strategy contract

InkBench owns the story and measurement. Internal strategies receive the same observation:

- current location, output, tags, and legal choices;
- global variables and generated-knot visit counts;
- terminal, warning, error, and already-observable bug events;
- semantic coverage deltas; and
- opaque handles for checkpoints they have already reached.

Every strategy may restore any checkpoint it observed. InkSwarm's saved colonies are therefore an allocation policy, not privileged access. Generator parameters, planted-oracle definitions, undiscovered graph structure, and raw save JSON remain hidden.

The primary in-process budget is one **choice transition**. Checkpoint restore is not a transition, but its CPU and wall cost is measured. See [the architecture decision record](docs/architecture.md) for the full boundary and limitations.

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

InkCheck's native “states explored” unit is close to, but not identical with, InkBench's choice-transition unit. Reports preserve that distinction and leave unavailable edge/state metrics as `null`. Do not erase the unit label in comparisons.

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

The versioned JSON schemas live in [`schemas/`](schemas), and the contribution path for another strategy or external tool is documented in [adding a searcher](docs/adding-a-searcher.md).

You can also use a checked configuration:

```sh
inkbench experiment --config examples/quick-experiment.json --out artifacts/configured
```

## Reading results honestly

- Compare planted-bug probability at a fixed budget, not only aggregate state counts.
- Publish family-level regressions and exclusive discoveries alongside any overall result.
- Treat undiscovered runs as right-censored, not as infinite discovery times.
- Call empirical counts “states observed,” not percentage coverage, unless the reachable denominator is proven.
- Separate transition efficiency from wall/CPU efficiency.
- Freeze held-out fixture seeds before tuning an algorithm.
- Keep failed/unavailable cells in the raw dataset.

The v0.1 oracle is an explicit generated global set only when the planted defect is reached. The next measurement-validity milestone adds several defect classes, official `inklecate` cross-runtime replay, exhaustive denominators for small fixtures, root-replay budget regimes, and stronger statistical intervals. See [methodology](docs/methodology.md) and [milestones](docs/milestones.md).

The checked [v0.1 development matrix](docs/v0.1-development-results.md) is deliberately candid: the current minimal swarm produced no exclusive discovery in 792 small development cells and was weaker than the simple controls in several families. It is a forcing function for the next experiments, not a promotional benchmark result.

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

MIT licensed.
