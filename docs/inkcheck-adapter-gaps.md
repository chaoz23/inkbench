# InkCheck adapter measurement boundary

InkBench invokes InkCheck 0.7.2 as an external process and preserves its native `inkcheck-states` unit. The adapter does not infer choice-transition equivalents.

## Available now

InkCheck's final machine report can expose `explore.execution.resources`. InkBench copies its state budget, heap envelope, parent reserve, per-worker and aggregate worker limits, peak tracked heap, aggregate memory-stop flag, and deadline into `adapterResources`. These values remain separate from InkBench's harness-owned process, snapshot, checkpoint, and coverage-index accounting because they observe different process boundaries.

The adapter streams large JSON reports to scratch storage, incrementally replays returned ending paths against the pinned instrumented artifact, and scores final bug yield without exposing planted oracle markers to InkCheck's search.

## Still unavailable

- Child-process CPU time is not present in InkCheck's final report. InkBench records `timing.cpuMs: null` rather than substituting parent CPU or wall time.
- An ending's `firstDiscoveredAtState` is pass-local inside the mature portfolio. It is not a portfolio-global work timestamp, so InkCheck findings use `discoveryTimingBasis: "final-only"` and are excluded from survival curves.
- InkCheck's live progress stream is not translated into InkBench progress events by the synchronous adapter.
- InkCheck does not expose the same empirical item-level edge and semantic-state sets as the in-process controller; those coverage fields remain `null`.

## Minimal upstream additions

The most valuable InkCheck contract extension would stamp every retained ending with a monotonically increasing portfolio-global state/work position at the moment the portfolio first records it. A final report field such as `firstDiscoveredAtGlobalState` would let InkBench construct honest InkCheck survival curves without parsing logs or guessing across passes.

A second useful addition would report total child user/system CPU time for the portfolio. Neither addition requires changing InkCheck's search policy.
