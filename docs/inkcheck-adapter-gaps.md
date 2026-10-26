# InkCheck adapter measurement boundary

InkBench invokes the real InkCheck CLI and preserves its native `inkcheck-states` unit. The adapter does not infer choice-transition equivalents or change search policy.

## Available on the current adapter branch

The bounded NDJSON evidence stream retains globally elapsed discovery timestamps. Full-JSON fallback remains supported, but its portfolio discovery positions are pass-local and remain `final-only`; it does not enter work-unit survival curves. Ending/signal witnesses are replayed against the pinned private compiled fixture without exposing planted oracle state to the searcher.

InkCheck's optional `resources.longRunTelemetry` schema-v1 receipt is validated and retained by the [cost/phase bridge](inkcheck-cost-phase-ledger.md). Present malformed terminal receipts fail as explicit adapter errors. Absent legacy receipts remain unavailable, not zero. Durable summary/audit loading validates the receipt again.

Native compilation and search-active duration populate their corresponding timing fields when available. Whole-child wall time is separate at `timing.externalProcessWallMs`; adapter scoring/replay/finalization are still adapter-scoped. The complete native phase vector remains in the receipt because setup/finalization are inclusive, overlap components, and exclude final terminal JSON/stdout work. It must not be summed.

Per-pass retained logical-byte and sampled process-RSS byte-time integrals retain their exact decimal numerator, divisor, observation endpoints, and six separate useful-yield categories. Their first-to-last-sample scope is not a whole-run total. Pass identities may overlap and are not pooled into one yield score. Empty passes and zero-duration intervals do not establish cost efficiency. Existing heap caps and sampled peak heap remain separate resource facts.

## Still unavailable or partial

- Child CPU remains `timing.cpuMs: null`; parent CPU and wall time are not substitutes.
- A sampled RSS byte-time integral is not peak RSS. `resources.process.peak.rssBytes` remains null without a compatible peak observation contract.
- Missing or unobserved cost intervals cannot support retained-GiB-minute comparisons. Current default portfolio runs can expose phases with no shared-pass cost intervals; explicitly named shared-search profiles must not be silently substituted for the scientific portfolio baseline.
- InkCheck does not expose InkBench's full empirical item-level edge/semantic-state sets. Those coverage fields remain null.
- The synchronous adapter does not translate CLI progress into live InkBench progress events.
- Complete exclusive-owner attribution, checkpoint/epoch/pressure boundaries, resource policies, and resumable-epoch improvements remain InkCheck product work. Connecting a measurement receipt does not complete those gates or demonstrate a search improvement.

Old artifacts are not rewritten. The external adapter fingerprint is versioned to distinguish the new timing semantics, and mixed-build resume/pooling remains rejected.
