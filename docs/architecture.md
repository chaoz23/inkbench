# InkBench architecture

## Decision record for v0.1

InkBench is a benchmark harness, not an InkSwarm showcase. It owns fixture generation, compilation, the Ink runtime, observation construction, planted-bug oracles, budgets, instrumentation, repetition, and reports. Search strategies decide only where to launch and which legal choice to take.

The v0.1 runtime uses `inkjs` 2.4.0 in process. It compiles deterministic generated Ink source once per fixture, seeds the Ink runtime separately from the search strategy, and serializes save states through Ink's public save/load API. Authored projects instead load digest-verified JSON compiled by official `inklecate` 1.2.1 with count-all-visits; this supports valid Ink syntax that the `inkjs` compiler does not fully accept while keeping one identical runtime and artifact per compared in-process strategy. A later cross-runtime validation tier should replay generated witnesses in the C# runtime too.

## Neutral strategy boundary

```text
fixture seed -> generated Ink + manifest -> compiler -> instrumented controller
                                                        |
               identical Observation + opaque snapshots + transition budget
                                                        |
                   random / systematic / coverage / swarm
                                                        |
                     oracle + coverage + replay evidence

pinned authored sources + licenses -> verified inklecate artifact -> same controller
                                                                    |
                                                coverage + runtime-finding evidence
```

Every in-process strategy can:

- launch at the root or any checkpoint it previously observed;
- see the current location, output, tags, legal choices, globals, visit counts, depth, and observable runtime events;
- choose one legal choice; and
- receive the resulting observation and coverage delta.

No strategy receives generator parameters, target choices, oracle definitions, undiscovered graph structure, or a raw Ink save document. Snapshot IDs are opaque handles. InkSwarm's colonies therefore test resource allocation over saved states; they are not a hidden capability denied to baselines.

## Budget contract

The primary budget unit is a **choice transition**: one call that selects one legal Ink choice and runs until the next stable choice or terminal state. Launching/restoring a checkpoint does not consume transition budget, but its wall and CPU cost is measured. Reports also count launches and completed root-to-terminal episodes.

This contract makes causal work comparable while retaining compute-cost evidence. External tools may use a different native work unit. Adapters must declare that unit and the translation explicitly; missing metrics remain `null`, never zero.

## Observation and coverage

Semantic novelty is intentionally factored rather than reduced to a raw save hash:

- location/knot;
- available-choice configuration;
- global variable values;
- global variable transitions;
- visit counts; and
- terminal, warning, error, and planted-oracle events.

InkBench records raw save-state diversity separately. Coverage-guided and InkSwarm may compute their own weights from the shared semantic fields. The oracle evaluates after instrumentation and does not influence choice selection.

## Fixture contract

Each generator returns:

- compilable `.ink` source;
- a versioned JSON manifest;
- one or more planted bug IDs and machine-readable oracles;
- difficulty coordinates (depth, width, state dimensionality, rarity, delay, revisit, deception, and order); and
- generation parameters and seed.

Training, validation, and evaluation partitions should use disjoint fixture-seed ranges. The default presets are development-sized; publishable claims require a preregistered matrix with frozen package/runtime versions.

## Authored-project corpus contract

Authored stories are a second, non-oracle tier. Each entry records upstream repository and commit, author, license/attribution file, entrypoint, every source digest, official compiled-artifact digest, compiler version/arguments, and structural measures. InkBench verifies all digests before a run. Reports have `benchmarkTier: authored-project` and no planted bugs.

Authored reports may compare empirical coverage, runtime findings, terminal episodes, wall/CPU cost, and item-level coverage complementarity. They must not produce planted-bug discovery probabilities or survival curves, and their empirical counts are not coverage percentages without a proven denominator.

## Strategy set

- **Random**: seeded uniform legal choices from root-started episodes.
- **Systematic**: deterministic depth-first expansion over saved states; a calibration baseline, not branded as InkCheck.
- **Coverage**: a small priority-frontier explorer using semantic coverage and saturation.
- **InkSwarm**: minimal colonies, semantic novelty, saturation, deep checkpoints, short local walks, pruning, and a fixed rogue fraction.
- **InkCheck adapter**: invokes the actual `inkcheck` CLI and scores its terminal-state evidence. It is intentionally an external adapter so InkBench does not silently reimplement or freeze InkCheck behavior.

## Known v0.1 limits

- Generated fixtures use one explicit oracle variable per planted defect; later versions should add runtime failures, assertions, missing/impossible content, and nonproductive-loop oracles.
- In-process strategies use free checkpoint restore in the transition budget. Wall/CPU measurements expose the cost, but a second `root_replay` budget regime is needed for hosts that cannot restore cheaply.
- State/edge counts are empirical discoveries, not proof-relative percentages unless a fixture is exhaustively enumerated.
- The InkCheck adapter cannot recover every internal edge metric and currently reports those fields as unavailable.
- No aggregate leaderboard is authoritative in v0.1. Family curves and paired complementarity are the primary outputs.
- The first authored corpus has only three consent-safe public projects. It tests transfer, not representativeness of all Ink projects.
