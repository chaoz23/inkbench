# Authored-corpus scale and representativeness

InkBench's redistributable authored corpus is a licensed convenience sample. It is not evidence that three projects represent Ink as a whole, commercial narrative games, or AAA production.

## Complexity coordinates

`inkbench corpus analyze` deterministically records a common static coordinate set for every story:

- source files, bytes, lines, and includes;
- knots, stitches, choices, diverts, tunnels, functions, lists, variables, and conditional expressions;
- compiled bytes and compiled-container count.

An optional bounded systematic runtime sample adds observed transitions, locations, edges, semantic states, depth, branching, revisits, repeated edges, variable dimensionality, and snapshot/checkpoint bytes. These are empirical observations at the named sampling grant, not proof-relative totals.

The checked-in corpus manifest carries the same static coordinates and analyzer version. Analysis fails if the deterministic coordinates drift. In the current public envelope:

- The Intercept is a choice/depth and state-heavy public proxy;
- Heresy II is an include-, choice/depth-, and state-heavy public proxy; and
- Dog Ink Adventure remains a smaller function/loop calibration project.

“Proxy” is intentional. None is presented as a proprietary production project or a statistically representative sample.

## Private/local projects

Commercial or private stories can be measured from a local config containing source file paths, an entrypoint, a compiled artifact, compiler version, and license classification (`proprietary` and `other` are supported). The emitted report contains aggregate numbers and content hashes only. It does not emit:

- local paths or filenames;
- source, runtime, or choice text;
- variable names or values; or
- raw save state.

```sh
inkbench corpus analyze \
  --local-config private-corpus.json \
  --runtime-budget 1000 \
  --out private-complexity-report.json
```

The config schema is `schemas/local-corpus-config.schema.json`; the output schema is `schemas/corpus-complexity-report.schema.json`. Before publishing even aggregate private-project evidence, the project owner must separately authorize disclosure.

## Generalization boundary

Reports publish their observed minimum/maximum envelope and an explicit gap list. Corpus growth must remain license-safe and version-pinned. Clean authored stories support ecological coverage/runtime transfer only. They do not become planted-bug causal estimates unless a disclosed reproducible mutation set and private replay oracle are added as a separate tier.
