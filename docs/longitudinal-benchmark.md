# Longitudinal benchmark contract

InkBench's longitudinal tier measures an evolving project, not twelve unrelated cold races. Its unit of comparison is the cumulative creator-owned budget across a checksum-linked sequence of revisions.

## Revision stream

`generateRevisionSequence(seed, partition, revisions)` produces 1–30 deterministic revisions. The first twelve deliberately include baseline, text-only, side-branch, threshold, delayed-regression introduction, choice reorder, rare history, bug fix, revisit regression, local refactor, a broad-refactor negative control, and bug reintroduction. Longer streams repeat maintenance, change, introduction, fix, and invalidating-refactor cycles without changing the frozen generator policy.

Development seeds are 1–99, validation seeds 101–199, and evaluation seeds 201–999999. The generator rejects a seed outside its declared partition. Every revision records its parent ID, source hash, edit class, active private oracle IDs, and exact fixture identity.

## Arms and fairness

The version-1 runner supports:

- cold random, systematic, coverage, minimal swarm, and optional real InkCheck;
- warm persistent coverage;
- coverage with a preregistered periodic rebuild;
- `persistent-swarm-v0`; and
- a no-rogue persistent-swarm ablation.

Every arm receives the same transition grant on every revision. Replay, validation, rebasing, stale-route work, and exploration all consume that grant. Prior training is therefore present in cumulative cost rather than being given to a warm arm for free.

The persistent corpus stores replay recipes only: choice identity, fallback text hash, choice configuration hash, semantic anchors, productivity, replay history, and lifecycle status. A raw Ink save state is never carried across revision identity. Within one revision the controller may retain ordinary charged checkpoints after a route has been replay-validated.

Route allocation cannot observe planted bug IDs, oracle variables, future revisions, or private manifests. Reinforcement and pruning use semantic novelty, depth, yield, replay success, age, and storage limits. The ordinary swarm arm reserves 15% root-based rogue exploration by default; the explicit no-rogue arm measures that rule rather than silently removing it.

## Durable output

Each `(sequence, arm, revision)` cell has a deterministic ID and atomic JSON report containing its post-revision corpus. Matrix state binds the full config, ordered revision identities, and scheduled cell IDs. `--resume` accepts only the exact fingerprint and rejects mixed configurations. Authoritative cells make resumption independent of an interrupted NDJSON tail.

Reports include replay/exploration work, salvage and divergence, bug witnesses, empirical coverage, corpus count/bytes, pruning, retained byte-milliseconds, edit-class competence, complementarity, and break-even against cold coverage. Timing is measured but never influences deterministic policy decisions.

## Commands

```sh
npm run build

inkbench longitudinal generate --sequence-seed 1 --partition development --revisions 12
npm run longitudinal:smoke
inkbench longitudinal experiment --config my-30-revision-config.json --out artifacts/longitudinal-30 --resume
```

The included smoke preset is development evidence. It must not be used to tune a policy and then relabeled as blind evaluation. No longitudinal strategy should be promoted until repeated validation and held-out evaluation sequences show a creator-cost benefit, including negative-control refactors.
