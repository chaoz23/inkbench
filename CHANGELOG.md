# Changelog

## Unreleased

- Connect InkCheck schema-v1 cost/phase receipts to run reports for bounded NDJSON and full-JSON fallback. Preserve exact pass-local integrals, interval bounds and separate yield categories; reject malformed receipts during ingestion and durable summary/audit loading while leaving absent legacy telemetry unavailable. Separate whole-child wall time from native active-search/compilation phases, retain wrapper timing and null CPU/peak-RSS facts, and version the external adapter identity without changing report schema v4 or reinterpreting historical artifacts. This is a measurement bridge, not a search-policy change, comparative result, or release.
- **Close the InkSwarm research line as unsupported.** Across the measured fixture families and
  budgets the population approach produced no exclusive discovery and spent its budget less
  effectively than the simple baselines on most failure classes. Recorded in
  `docs/inkswarm-closeout.md` with the evidence trail; the README and milestone sequence now
  state the verdict instead of a forward plan.
- The `swarm` searcher is **retained** as a frozen comparison baseline (`minimal-colony-v1`).
  It is not dead code: deleting it would silently change what published v0.2.0/v0.3.0 results
  compared against and would break reproduction of historical matrices.
- InkBench itself is unaffected. It remains a neutral harness for any searcher, and its open
  measurement-validity work stands on its own.
- Add the `heresy2-30` authored-planted fixture: 30 disclosed mutations across 30 knots and
  14 fault types in Heresy II, with one exact replay witness each and a checksum-pinned
  `inklecate` 1.2.1 artifact. Doubles the authored-planted tier to 50 replay-verified bugs
  and adds a second, structurally different family (`stitch-heavy-random-authored-story`,
  21-file bundle, difficulty 10) alongside the choice-dense Intercept.
- Generalise the witness-replay test across every authored-planted story; it now asserts all
  50 witnesses reach their own oracle.
- Corpus manifest and schema now carry a per-case `difficulty`, and case `id`/`family`/
  `mutationSet` accept both stories. `loadAuthoredPlantedFixture` reads `difficulty` from the
  manifest instead of a hardcoded `5` (no change for `the-intercept-20`, which declares 5).
- The `swarm-novelty` and `swarm-colony` ablation searchers are intentionally NOT included:
  they alter the shipped `swarm` algorithm and would break longitudinal comparability. They
  stay pinned at tag `heresy2-30-fixture-2026-08`.

## 0.3.0 - 2026-08-20

- Add a persistent longitudinal benchmark with deterministic 1–30 revision streams, cold/warm/periodic/ablation arms, charged route replay and rebasing, bounded recipe-only corpora, atomic resume, revision-bound witnesses, and cumulative creator-cost analysis.
- Add deterministic public and aggregate-only local/private corpus complexity analysis with checked manifest coordinates and explicit generalization gaps.
- Add resource-stop probability sensitivity bounds, a common terminal taxonomy, explicit observability/source-privilege contracts, phase-aware timing, and paired instrumentation calibration.
- Add topology-equivalence, seed-partition, source-placebo, durable matrix, and preregistered staged-pilot audits.
- Require explicit `single` or `environment` classification when deterministic systematic cells are repeated across search seeds in generated, authored, and mutant matrices.

## 0.2.0 - 2026-08-14

- Upgrade run reports to schema v4 and matrix state to v2, binding every run to exact built harness, lockfile, algorithm, runtime/compiler, Node/V8/platform, and external CLI fingerprints; reject legacy or mismatched resume directories.
- Resolve PATH-based InkCheck commands to one exact executable before hashing and launch so resumable cells cannot silently follow a changed CLI.
- Remove generated-fixture oracle variables, marker/signal tags, semantic endpoint names, fixture IDs, and removal-site breadcrumbs from InkCheck search input; seed-permute target/control endpoint order and score ordinary neutral endings only through private replay.
- Add deterministic counterbalanced serial schedules, explicit development/validation/evaluation partition labels, and structural seed variation for previously static generated families.
- Separate observed-anytime evidence from fixed-grant completers, include resource-stopped prefixes without relabeling them complete, add Wilson intervals, label informative censoring, and compare complementarity at a common observed wall-time horizon.
- Normalize InkCheck phase/timing and native resource telemetry with explicit external provenance while retaining unavailable metrics as null and labeling its full-source information regime.

- Add a deterministic, separately licensed 20-bug derivative of The Intercept spanning four source files, 16 story locations, and 19 fault types, with official compiler provenance and exact witnesses for every oracle.
- Add an `authored-planted` benchmark tier, `inkbench mutants` CLI, multi-bug yield/per-bug competence/complementarity reports, and isolated resumable mature matrices.
- Add explicit reference-counted checkpoint ownership so strategies pay for the Ink states they retain instead of the harness retaining every transition forever.
- Add InkCheck-inspired heap/time guards, process and checkpoint memory accounting, graceful resource-stopped reports, and versioned NDJSON progress events.
- Add isolated worker execution with configurable V8 heap ceilings and hard-timeout containment.
- Atomically persist per-cell reports, latest partial progress, matrix state, and final datasets; completed experiment cells can be resumed without replay.
- Add deliberately large `mature` generated and authored presets with 30 paired repetitions and logarithmic budgets through ten million native work units, matching InkCheck's current local default budget.
- Forward matrix memory/time guards to the InkCheck CLI and preserve its graceful memory/time stop reason even when adapter-specific telemetry is unavailable.
- Keep planted-oracle discoveries out of InkSwarm's novelty score; the minimal policy allocates only from shared runtime/coverage observations.
- Add resource-envelope tables and peak heap/RSS/snapshot/checkpoint columns without pooling partial cells into fixed-budget discovery probability.

## 0.1.0 - 2026-08-11

- Establish the neutral InkBench experiment and searcher contracts.
- Generate deterministic planted-bug Ink fixtures across eleven adversarial families.
- Add random, systematic, simple coverage-guided, and minimal InkSwarm explorers.
- Add an optional real InkCheck CLI adapter.
- Add a separate, pinned authored-project corpus from InkCheck with three licensed stories, official `inklecate` artifacts, coverage competence maps, and paired coverage complementarity.
- Add a token-aware Ink JSON compatibility path for Node 20/22 parity when loading explicit floats.
- Emit replayable JSON/NDJSON/CSV datasets, summary tables, survival data, and complementarity metrics.
