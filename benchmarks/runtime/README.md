# Runtime benchmark baseline

Run `pnpm bench:runtime:json` on a single machine. The fixture digest embedded in the output must match before comparing wall-time percentiles; Node version, platform, architecture, and CPU count are recorded as environment identity rather than performance targets.

The benchmark uses one warm-up and five measured iterations for three deterministic fixtures: mixed intake (20 documents, four parser-safe chunks, four OpenAPI sources), legacy discovery (250 deterministic JS/Vue files and 40 terminal API calls), and visual comparison (two 360×1831 targets across three valid comparisons).

`baseline-v1.json` was collected with the same command on Node `v24.12.0`, Darwin arm64, 14 CPUs, with fixture digest `sha256:2d6b23e2ff70952dabe62b219f14a62262cfc26a8d9767ce9d852a0f88a8b83c`. It contains no paths, URLs with query strings, or credentials. The p95 for each five-sample fixture is its highest measured sample.
