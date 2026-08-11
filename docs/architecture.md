# InkBench architecture

## Decision record for v0.1

InkBench is a benchmark harness, not an InkSwarm showcase. It owns fixture generation, compilation, the Ink runtime, observation construction, planted-bug oracles, budgets, instrumentation, repetition, and reports. Search strategies decide only where to launch and which legal choice to take.

The v0.1 runtime uses `inkjs` 2.4.0 in process. It compiles deterministic generated Ink source once per fixture, seeds the Ink runtime separately from the search strategy, and serializes save states through Ink's public save/load API. Authored projects instead load digest-verified JSON compiled by official `inklecate` 1.2.1 with count-all-visits; this supports valid Ink syntax that the `inkjs` compiler does not fully accept while keeping one identical runtime and artifact per compared in-process strategy. A later cross-runtime validation tier should replay generated witnesses in the C# runtime too.

InkBench parses story and save-state JSON with a token-aware compatibility layer that matches Ink's explicit `123.0` float convention. This avoids an `inkjs` 2.4.0 Node 20 fallback-regex bug that can corrupt longer decimals beginning with `0.0`; Node 22's native reviver-source path and the portable path are regression-tested to agree.

## Neutral strategy boundary

```text
fixture seed -> generated Ink + manifest -> compiler -> instrumented controller
                                                        |
               identical Observation + opaque snapshots + transition budget
                                                        |
             random / systematic / coverage / swarm ablations
                                                        |
                     oracle + coverage + replay evidence

pinned authored sources + licenses -> verified inklecate artifact -> same controller
                                                                    |
                                                coverage + runtime-finding evidence

pinned clean Intercept/Heresy II -> deterministic 20/30-mutation transforms
                                                        -> verified artifacts
                                                                   |
                                  same controller -> per-bug oracle + replay evidence
```

Every in-process strategy can:

- launch at the root or any checkpoint it previously observed;
- see the current location, output, tags, legal choices, globals, visit counts, depth, and observable runtime events;
- choose one legal choice; and
- receive the resulting observation and coverage delta.

Checkpoint handles have explicit ownership. A searcher calls `retain(snapshotId)` when it places a state in a frontier or colony and `release(snapshotId)` when that reference is consumed or pruned. The controller keeps only the root, active state, and explicitly retained states. Reports separate total runtime snapshot bytes from the subset retained as policy checkpoints.

No strategy receives generator parameters, target choices, oracle definitions, oracle-marker globals, undiscovered graph structure, or a raw Ink save document. Oracle values are evaluated inside the controller and removed from the shared variable/semantic-coverage observation. Snapshot IDs are opaque handles. InkSwarm's colonies therefore test resource allocation over saved states; they are not a hidden capability denied to baselines.

## Budget contract

The primary budget unit is a **choice transition**: one call that selects one legal Ink choice and runs until the next stable choice or terminal state. Launching/restoring a checkpoint does not consume transition budget, but its wall and CPU cost is measured. Reports also count launches and completed root-to-terminal episodes.

This contract makes causal work comparable while retaining compute-cost evidence. External tools may use a different native work unit. Adapters must declare that unit and the translation explicitly; missing metrics remain `null`, never zero.

## Resource and worker contract

Resource-bounded runs adapt InkCheck's proven operational pattern without importing InkCheck's search policy:

```text
matrix parent
  -> isolated Node worker with declared V8 ceiling
       -> shared instrumented controller
            -> strategy-owned checkpoint references
            -> heap/time guard
            -> progress and discovery events
       -> atomic final report
  -> atomic per-cell + matrix-state datasets
```

The default memory watermark is 85% of the worker's V8 heap ceiling unless an explicit `maxMemoryMb` is supplied. The controller checks the guard periodically and returns partial evidence with `resource-stopped`, never a false completed-budget claim. Progress events are privacy-minimal and contain counters, coverage totals, discovered bug IDs, and memory accounting—not story prose or raw save states.

Process peak heap/RSS is measured independently from accounted Ink snapshot, policy-checkpoint, and coverage-index payload. Accounted bytes are deterministic UTF-8 payload measures; process memory includes runtime, compiler, object, allocator, and garbage-collector overhead and is therefore the authoritative safety boundary.

Experiment isolation persists the latest progress snapshot and one atomic report per completed cell. Matrix resume skips completed run IDs. Search-frontier continuation within a killed cell is deliberately not claimed until every compared search policy has a versioned exact checkpoint contract.

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

## Authored-planted corpus contract

The authored-planted tier is a mutation benchmark between generated micro-fixtures and clean ecological-validity stories. The clean upstream source stays checksum-pinned and untouched. A deterministic build script creates a separate multi-file derivative, records each transformation and source site, compiles one official `inklecate` artifact, and publishes a checksum-pinned exact witness for every oracle.

Each defect record adds a fault type, trigger, observable effect, source knot/upstream line, and its own difficulty coordinates to the ordinary planted-bug contract. Searchers do not receive this metadata. The same runtime/controller, observation, snapshot, budget, and resource rules apply to all in-process strategies; the InkCheck adapter receives the same mutated source bundle.

Multi-bug scoring counts distinct oracles per run and publishes per-bug discovery probabilities. Complementarity is paired over `(search seed, bug ID)`, preventing a strategy that repeatedly finds one shallow defect from receiving the same credit as one that expands the discovered bug set. Clean-authored coverage, generated-fixture survival, and authored-planted bug yield remain separate analyses.

## Strategy set

- **Random**: seeded uniform legal choices from root-started episodes.
- **Systematic**: deterministic depth-first expansion over saved states; a calibration baseline, not branded as InkCheck.
- **Coverage**: a small priority-frontier explorer using semantic coverage and saturation.
- **InkSwarm novelty ablation**: root-replayed short walks with inverse-visit choice saturation; no checkpoint colonies or rogues.
- **InkSwarm colony ablation**: adds saved semantic colonies, yield-weighted allocation, zero-yield retirement, a hard checkpoint cap, and semantic-frontier closure; no rogues.
- **InkSwarm full minimal policy**: adds a fixed 15% rogue population to the colony policy. Planted-oracle discoveries never enter any swarm novelty score.
- **InkCheck adapter**: invokes the actual `inkcheck` CLI and scores its terminal-state evidence. It is intentionally an external adapter so InkBench does not silently reimplement or freeze InkCheck behavior.

## Known v0.1 limits

- Generated fixtures use one explicit oracle variable per planted defect. The authored-planted tier now adds missing/impossible content, wrong-divert, loop, revisit, delayed, and state-corruption defects, but fatal runtime failures still need adapter-equivalent scoring before inclusion.
- In-process strategies use free checkpoint restore in the transition budget. Wall/CPU measurements expose the cost, but a second `root_replay` budget regime is needed for hosts that cannot restore cheaply.
- State/edge counts are empirical discoveries, not proof-relative percentages unless a fixture is exhaustively enumerated.
- The InkCheck adapter cannot recover every internal edge metric and currently reports those fields as unavailable.
- The synchronous InkCheck adapter forwards state, memory, and time limits, reads graceful memory/time stops, and records InkCheck's aggregate tracked-heap evidence in a separately labeled adapter block. It does not yet translate InkCheck's live progress stream, expose child CPU, or recover portfolio-global per-finding timestamps.
- No aggregate leaderboard is authoritative in v0.1. Family curves and paired complementarity are the primary outputs.
- The first authored corpus has only three consent-safe public projects. It tests transfer, not representativeness of all Ink projects.
