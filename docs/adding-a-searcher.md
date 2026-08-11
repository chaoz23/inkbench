# Adding a search strategy or adapter

## In-process strategy

Implement `Searcher` from `src/searchers/types.ts`, add the ID to the `InProcessAlgorithmId` union, and register it in `src/searchers/index.ts`.

The strategy receives only an `InstrumentedController` and its search seed. Its allowed operations are:

1. `launch()` at the root or `launch(snapshotId)` at a previously observed checkpoint;
2. read the returned `Observation`;
3. call `step(choiceIndex)` for one legal choice; and
4. stop when `controller.exhausted` is true or no useful work remains.

Do not import fixture generators or read `controller.fixture.manifest` from strategy code. The controller exposes that field to orchestration and tests, not as strategy input. A future conformance wrapper will harden this boundary; code review and the searcher test suite enforce it in v0.1.

Every strategy must have a versioned policy ID and deterministic behavior for a fixed fixture, search seed, story seed, and dependency lockfile. Add budget, determinism, and adversarial-family tests.

## External adapter

External tools may not fit the step interface or may own their own compiler/runtime. Follow `src/adapters/inkcheck.ts`:

- invoke the real tool rather than reimplementing it;
- pass generated source through a temporary file;
- retain the tool's native work-unit label;
- score only evidence present in the tool's report;
- set unavailable metrics to `null`;
- capture the exact tool version and wall time; and
- return an unavailable/failed raw cell instead of dropping it.

If an external state unit is not demonstrably equal to an InkBench choice transition, do not merge them into a single transition-efficiency chart. Detection probability and wall time remain comparable with the caveat visible.

## Neutrality review

Before merging a strategy or adapter, ask:

- Does it receive any oracle or generator target unavailable to competitors?
- Does it silently receive extra transitions, root replays, checkpoint restores, or compiler work?
- Can all seeded decisions and discovered witnesses be reproduced?
- Are failure/unavailable cells retained?
- Does the report include family-level regressions and exclusives, not just gains?
