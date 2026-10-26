# InkCheck cost and phase ledger bridge

This is an unreleased measurement bridge for InkCheck's schema-v1 long-run receipt, merged upstream through [InkCheck #230](https://github.com/chaoz23/inkcheck/pull/230) at `66b19005abca91fbfed2d02002fc13051f5c42f1`. It adds no search, allocation, stopping, ranking, or default policy. It is not itself an InkBench proof point.

## Receipt contract

Both terminal bounded NDJSON and legacy full-JSON transports can carry `resources.longRunTelemetry`. A valid receipt is copied into the run report with `external-adapter` provenance. No dependency on an installed InkCheck package is needed for parsing. The public `validateLongRunTelemetryV1` function returns a detached typed value and rejects malformed shapes, unsupported versions, unknown/private fields, proxies, accessors, sparse arrays, invalid bounds, duplicate pass labels, and inconsistent interval/rate relationships. Validation diagnostics do not echo field values or raw CLI stderr. A stream has exactly one start and one final terminal record; a later event cannot erase a receipt or append witnesses after termination.

The additive report remains schema v4. Old v4 reports with absent fields remain readable; absent telemetry is not synthesized. A present null or invalid receipt fails evidence ingestion rather than being dropped. All generated, authored-project, and authored-planted summaries validate present durable receipts again; generated matrix audit records malformed telemetry as an error. Missing/empty observations are explicit informational findings, not proof that a cost endpoint was measured.

Limits match the producer: at most 32 unique opaque pass labels of 1–128 permitted characters; nonnegative safe-integer counts, endpoints, and phase durations; exact unsigned decimal byte-time numerators of at most 33 digits; divisor 2; six separate nonnegative finite-or-null rates. Canonical strings cannot hide a trailing line terminator. Runtime validation additionally checks arithmetic relations that JSON Schema cannot express.

## Timing boundaries

| Observation | Run-report location | Meaning |
| --- | --- | --- |
| InkCheck compilation duration | `timing.phases.compileLoadMs` | Native `phases.compilationMs`, or null when unavailable |
| InkCheck active search duration | `timing.phases.searchMs` | Native `phases.searchActiveMs`, never whole-process duration |
| Whole child process duration | `timing.externalProcessWallMs` | Adapter-observed process envelope, including startup and other child work |
| Full native phase vector | `resources.longRunTelemetry.phases` | Source-native inclusive parents and components, retained without summing |
| Wrapper replay/scoring/finalization | Existing `timing.phases` fields | Adapter-side work, not overwritten with native zeros or child durations |

When native telemetry is absent, compilation/search-active timing is null. It is not guessed from the process envelope. `timing.wallMs` still measures the overall adapter call. Native setup and finalization can overlap their components; terminal object construction, JSON serialization, and stdout occur after the native finalization timing ends. Neither summing native phases nor combining native and wrapper vectors produces an honest end-to-end duration.

The external adapter identity is `external-adapter-v6`, distinct from both public adapter-v4 and an unpublished adapter-v5 identity experiment. Harness/adapter artifact hashes and run IDs change with this implementation. Existing schema-v2 matrix schedule/fingerprint checks reject mixed resume, and summary checks reject mixed-build duplicates. Do not migrate historical IDs or reinterpret an old whole-child `searchMs` as a new native measurement. Legacy adapter-v4/v5 fingerprints retain their recorded values; receipt-free reports from adapter-v6 must not retain unsupported non-null native phase labels. The report schema remains v4.

This bridge does not upgrade the existing execution fingerprint's entrypoint-only external command hash into complete package identity. A proof manifest must separately bind every runnable external module, lock/dependency installation, compiler/runtime and explicit invocation profile, with before/after drift checks. Omitted `inkcheckOptions` and `{}` have different effective adapter defaults but currently collapse in the native run-ID options projection; do not use either implicit form in a proof. Record the full explicit profile and its own manifest digest until a focused identity correction is reviewed. A known unpublished package-identity/evaluation experiment is not silently incorporated here and is not, by itself, a complete environment/profile guard.

## Cost and useful-yield boundaries

Each pass keeps its sample count, first/last elapsed endpoints, covered duration and transitions, and two distinct integrals:

- `logicalRetained`: deterministic logical accounted bytes, not exclusive observed heap ownership;
- `processRss`: sampled process RSS, not peak RSS or process-tree RSS.

The exact byte-millisecond integral is the rational pair `{ numerator: BigInt(byteMillisecondsTimesTwo), denominator: 2n }`. Retain that pair: integer division would discard a half-byte-millisecond when the numerator is odd, and converting a large numerator to Number loses precision. To express retained GiB-minutes, additionally divide the rational by `1024^3 * 60000`. This covers only adjacent live samples within that pass. Do not extrapolate the unobserved prefix/suffix, checkpoint/finalization work, or another pass.

Critical, intent, authored coverage, visible outcomes, semantic transitions, and terminal variants remain separate. First-to-last-sample identity deltas share the same covered interval as the cost; pass-local identities can overlap and cannot be summed into a campaign-new total. Visible outcomes remain a fallback identity, and terminal multiplicity alone cannot establish useful improvement. Zero/one-sample receipts have no measured interval; a zero denominator has null rates. Empty passes are not a zero-cost run.

CPU, peak RSS, missing logical owners, and unavailable coverage remain null or absent with a reason. The bridge never infers them from integrals or substitutes another process's metrics. It does not create new cost aggregates or change existing competence, survival, coverage, or complementarity estimates.

## Ready the next proof point

1. Pin the reviewed bridge artifact, complete runnable InkCheck baseline/candidate distributions (not just CLI entrypoint bytes), locks/dependency installations, runtime/compiler, fixture hashes, full explicit invocation profiles, machine posture, serial order, and endpoints. Bind a manifest digest and verify all inputs before/after execution. Use a fresh artifact directory; never resume or rewrite the historical stopped 60-minute matrix.
2. Run transport/validation, witness, identity/resume, and real-CLI smoke gates before timing evidence. Include an explicit missing/empty-ledger compatibility case. A bounded engineering smoke is not held-out comparative evidence.
3. A cost-efficiency endpoint requires compatible measured intervals in both arms. The historical baseline or default portfolio may lack them. Record that endpoint as unavailable or preregister a matched supported observational metric; never use missing as zero, infer peak RSS, or silently switch the baseline to shared search.
4. For the long-run promotion gate, finish InkCheck's remaining #216 accounting, #190 reopenable windows, #217 retention/pressure, and #218 exact epochs. #230 only measures a partial cost contract; it does not improve long-run exploration by itself.
5. Reuse the validity infrastructure already implemented for InkBench #2–#9. Freeze at least six distinct held-out structural fixtures by five paired search seeds where required by InkCheck #219, rather than relying on the smaller default. Do not fit or change thresholds after seeing held-out outcomes.
6. Freeze supported estimands. Current bounded-probability/common-horizon analyses and descriptive survival do not automatically satisfy every proposed survival uncertainty/per-bug estimator. Implement the missing estimators or restrict claims in the preregistration.
7. Run fresh serial 20-minute evidence first. Audit witness integrity, exact fingerprints, all launched-cell/partial-stop outcomes, observation availability, resources, and timing before considering fresh 60-minute cells. Publish negative results and outliers; terminal variants alone cannot pass.

InkBench remains open after the unsupported InkSwarm research line was closed. Neither this bridge nor a small integration smoke closes InkCheck #215/#156/#190/#216–#219 or InkBench's held-out evidence gates. No release or comparative matrix is implied.
