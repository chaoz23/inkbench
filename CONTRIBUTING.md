# Contributing

InkBench exists to make claims about Ink search strategies falsifiable. Contributions are welcome when they preserve that purpose.

Please include:

- deterministic seeds and a replay path for any new fixture or failure;
- the same observable runtime data and budget semantics for comparable strategies;
- a neutral hypothesis for algorithm changes, including likely regressions;
- tests for schemas, generators, and accounting; and
- raw result data rather than only aggregate claims.

Real-story corpus contributions must include the upstream repository and immutable commit, author and license/consent basis, required attribution text, entrypoint and include files, source and compiled-artifact digests, compiler version/arguments, and a clear statement of any modification. Keep authored coverage results separate from planted-bug scoring.

Do not tune a strategy against held-out evaluation seeds or add a mechanism solely because its metaphor is appealing. New InkSwarm mechanisms should address a measured benchmark failure.
