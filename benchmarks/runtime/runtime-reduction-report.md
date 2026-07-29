# Measured runtime reduction report

## Scope and comparison rules

This report was collected at source commit `9e392cb` with:

```text
Node v24.12.0
darwin / arm64 / 14 CPUs
1 warm-up iteration
5 measured iterations
```

`pnpm bench:runtime:json` produced the complete current receipt in
`benchmarks/runtime/latest.json`. The immediately preceding checked-in receipt is recoverable
as `git show 9e392cb:benchmarks/runtime/latest.json`; its SHA-256 is
`d741eb88e8d0f2429df7d4f11f8068cea460d1b4eaf9c3e5010e4f4bc283e437`. The refreshed
receipt SHA-256 is
`a73711d3935358537b15a1edfe67a38502ac767e38763e019058fbe7bbf0b3c3`.

Timing values are compared only when the fixture digest, complete environment identity, and,
where present, workload digest match. Every fixture in the immediate before/after pair meets
those requirements. The visual paired workload digest is unchanged at
`sha256:015ad7ce7efe59cdf281cf9edafbbf2045c66d02700472a1e671a6cd3a95fd17`.
No timing sample was copied between receipts.

The older `benchmarks/runtime/baseline-v1.json` is not used for timing claims. Its three
workloads predate the real intake persistence/concurrency cycle, the cold/warm/change legacy
cycle, and the current visual cache/pool/memory workload:

| Historical fixture     | Classification            | Reason timing is withheld                                                                                  |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `mixed-intake`         | changed workload          | The historical counter surface has no measured source concurrency or Run saves.                            |
| `legacy`               | changed workload          | The historical counter surface has no cold/warm/change reads, parses, or rebuilds.                         |
| `visual`               | unmatched/changed fixture | The fixture digest changed and the current workload adds cache, pool, admission, and live-memory coverage. |
| `packet-evidence`      | new fixture               | No historical fixture.                                                                                     |
| `status-action`        | new fixture               | No historical fixture.                                                                                     |
| `mutating-action`      | new fixture               | No historical fixture.                                                                                     |
| `visual-paired-serial` | new fixture               | No historical fixture.                                                                                     |
| `visual-paired-pool`   | new fixture               | No historical fixture.                                                                                     |
| `visual-cold`          | new fixture               | No historical fixture.                                                                                     |
| `visual-warm`          | new fixture               | No historical fixture.                                                                                     |

## Compatible same-fixture before/after timings

Positive timing deltas are explicitly labeled **regression**, even when below the 10% host-noise
diagnostic threshold.

| Fixture              |   p50 before → after |             p50 delta |   p95 before → after |             p95 delta |
| -------------------- | -------------------: | --------------------: | -------------------: | --------------------: |
| mixed-intake         | 313.129 → 258.802 ms |               -17.35% | 331.021 → 281.367 ms |               -15.00% |
| legacy               | 174.850 → 183.392 ms | **+4.89% regression** | 189.014 → 196.639 ms | **+4.03% regression** |
| packet-evidence      | 126.859 → 109.329 ms |               -13.82% | 128.929 → 111.314 ms |               -13.66% |
| status-action        |     0.304 → 0.271 ms |               -11.01% |     0.386 → 0.338 ms |               -12.48% |
| mutating-action      |   98.022 → 98.180 ms | **+0.16% regression** | 103.444 → 112.348 ms | **+8.61% regression** |
| visual-paired-serial | 382.768 → 382.305 ms |                -0.12% | 391.131 → 388.859 ms |                -0.58% |
| visual-paired-pool   | 200.444 → 207.336 ms | **+3.44% regression** | 218.915 → 212.380 ms |                -2.99% |
| visual-cold          | 338.362 → 344.024 ms | **+1.67% regression** | 359.363 → 352.818 ms |                -1.82% |
| visual-warm          | 256.280 → 262.215 ms | **+2.32% regression** | 258.848 → 264.465 ms | **+2.17% regression** |
| visual total         | 597.210 → 608.395 ms | **+1.87% regression** | 611.324 → 609.192 ms |                -0.35% |

No compatible unchanged p95 regressed by more than 10%, so the paired host-noise diagnosis
trigger did not fire. The largest p95 regression is mutating-action at +8.61%.

## Counter outcomes and source receipts

All deterministic functional counters are unchanged between the compatible immediate receipts.
The current measured outcomes are:

| Optimization                         | Current outcome                                                                                                                                                                                                                                       | Source receipt                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Successful artifact blob writes      | A fresh successful 1 MiB write records `artifact.read_bytes = 0`; existing-content and existing-metadata paths still validate stored bytes/metadata.                                                                                                  | Commit `c5f999e`; `tests/unit/artifact-blob-store.test.ts`.                         |
| Intake batching and source loading   | 20 local documents, four parser-safe chunks, four OpenAPI sources, `maxSourceConcurrency = 4`, and `intakeRunSaves = 2`.                                                                                                                              | `latest.json` mixed-intake fixture; commits `2de37c0`, `9052f3d`, and `a3b8ce4`.    |
| Legacy cold/warm/change              | Cold: 250 reads / 250 parses. Unchanged warm: 250 reads / 0 parses / 0 rebuilds. One-byte change validation plus rebuild: 500 reads / 1 parse / 1 rebuild.                                                                                            | `latest.json` legacy fixture; commits `1c4125d` through `688b0f7`.                  |
| Compact status projection            | 250 legacy files, 0 artifact reads, 1,276 action bytes versus 41,897 detail bytes.                                                                                                                                                                    | `latest.json` status-action fixture; commit `4541937`.                              |
| Compact mutating responses           | 0 inventory reads; start 1,276 bytes, advance 1,276 bytes, submit 1,761 bytes.                                                                                                                                                                        | `latest.json` mutating-action fixture; commit `23f2953`.                            |
| Paired visual pool throughput        | Same six-comparison workload: serial 15.430 comparisons/s and p95 388.859 ms; reused pool 28.251 comparisons/s and p95 212.380 ms. Pool p95 is 45.38% lower and throughput is 83.10% higher than serial.                                              | `latest.json` visual-paired fixtures; commits `5342c05` through `0ab8490`.          |
| Visual cache and bounded live memory | Cold: 1 hit / 1 miss; warm: 4 hits / 0 misses. Peak workers 2, peak active pixels 1,318,320, peak admitted input 21,139,544 B, terminal admitted input 0 B, peak managed 35,663,745 B under 782,742,016 B, and same-iteration RSS delta 66,945,024 B. | `latest.json` visual cold/warm/total fixtures; commits `04aa49e` through `0ab8490`. |
| Packet-bound Git recapture           | Real path `implementation → functional-review → report`, two reuse hits, six Git commands, and zero binary-diff recaptures.                                                                                                                           | `latest.json` packet-evidence fixture; commits `7e41281`, `fa45060`, and `03f06c9`. |
| Reviewer scheduling                  | Retained current parallel scheduling. Controlled sample: 30 deliveries, 35 packet/fixture samples, five first failures, 100 ms invalidated of 1,390 ms reviewer wall (7.19%), below the 15% change gate. No scheduling speedup claim is made.         | `benchmarks/runtime/reviewer-scheduling-decision.json`; commit `b18c8c7`.           |

The following table is the complete mechanical diff of every per-fixture `metricCounters` pair
between `git show 9e392cb:benchmarks/runtime/latest.json` and the refreshed compatible receipt.
Exactly 15 pairs changed; every other per-fixture counter is unchanged. Positive allocation
deltas are labeled **regression** even though they remain far below the enforced memory budgets.

| Fixture              | Counter                          |      Before |       After | Absolute delta | Relative delta | Assessment                         |
| -------------------- | -------------------------------- | ----------: | ----------: | -------------: | -------------: | ---------------------------------- |
| visual-paired-serial | `throughputComparisonsPerSecond` |   15.340111 |   15.429774 |      +0.089663 |       +0.5845% | throughput improvement             |
| visual-paired-pool   | `throughputComparisonsPerSecond` |   27.407924 |   28.251231 |      +0.843307 |       +3.0769% | throughput improvement             |
| visual-cold          | `inFlightPeakRssBytes`           | 954,171,392 | 927,711,232 |    -26,460,160 |       -2.7731% | lower host RSS                     |
| visual-cold          | `inFlightRssDeltaBytes`          |  62,521,344 |  41,189,376 |    -21,331,968 |      -34.1195% | lower same-iteration RSS delta     |
| visual-cold          | `peakComparisonManagedBytes`     |  33,012,863 |  33,021,302 |         +8,439 |       +0.0256% | **positive allocation regression** |
| visual-cold          | `peakManagedBytes`               |  35,655,306 |  35,663,745 |         +8,439 |       +0.0237% | **positive allocation regression** |
| visual-cold          | `rssBaselineBytes`               | 891,650,048 | 886,521,856 |     -5,128,192 |       -0.5751% | lower host RSS baseline            |
| visual-warm          | `inFlightPeakRssBytes`           | 929,923,072 | 874,872,832 |    -55,050,240 |       -5.9199% | lower host RSS                     |
| visual-warm          | `inFlightRssDeltaBytes`          |  47,824,896 |  31,637,504 |    -16,187,392 |      -33.8472% | lower same-iteration RSS delta     |
| visual-warm          | `rssBaselineBytes`               | 882,098,176 | 843,235,328 |    -38,862,848 |       -4.4057% | lower host RSS baseline            |
| visual total         | `inFlightPeakRssBytes`           | 929,923,072 | 874,872,832 |    -55,050,240 |       -5.9199% | lower host RSS                     |
| visual total         | `inFlightRssDeltaBytes`          |  69,304,320 |  66,945,024 |     -2,359,296 |       -3.4043% | lower same-iteration RSS delta     |
| visual total         | `peakComparisonManagedBytes`     |  33,012,863 |  33,021,302 |         +8,439 |       +0.0256% | **positive allocation regression** |
| visual total         | `peakManagedBytes`               |  35,655,306 |  35,663,745 |         +8,439 |       +0.0237% | **positive allocation regression** |
| visual total         | `rssBaselineBytes`               | 860,618,752 | 807,927,808 |    -52,690,944 |       -6.1224% | lower host RSS baseline            |

## Evidence-surface preservation

The complete final-plan visual, Figma, and publication matrices passed on the refreshed source:

| Matrix               | Command/result                                                                                                                   | Preserved evidence                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual state machine | Final visual matrix: 7 files, 235 tests passed.                                                                                  | Fixed threshold, monotonic required validations, committed numeric attempt accounting, three-attempt cap, current-packet fencing, independent reviewers after pass, and blocked-draft reserve.                                            |
| Figma evidence       | Final Figma matrix: 7 files, 257 tests passed; `pnpm case4:check` also passed (134 unit tests plus 5 focused integration tests). | Exact geometry/state/fixture contracts, v2 capture receipts, full current-packet target coverage, baseline isolation, exact design-system mappings, focused geometry/UI/accessibility/action assertions, and malicious overlay rejection. |
| Blocked publication  | Final publication matrix: 9 files, 256 tests passed.                                                                             | Ready/blocked packet binding, GitHub/GitLab assets, equal-size baseline/current body, diff/overlay roles, packetless blockers, stale/crossed rejection before mutation, partial uploads, digest-only retry, and same-draft recovery.      |

Named workflow assertions additionally prove that:

- later authoritative statuses cannot shrink required validations;
- baseline isolation and renderer lineage retain full fresh target coverage across all three
  visual failures;
- functional and design reviews run independently after implementation passes;
- UI assertion reports bind packet, head, target, fixture, receipt, and exact state assertion IDs;
- a lineage stops after three valid comparisons and the next committed attempt is capped at
  three, so no fourth visual attempt is exposed.

No production evidence check, gate, assertion, reviewer, target, media role, or publication body
requirement was removed to obtain the runtime results.
