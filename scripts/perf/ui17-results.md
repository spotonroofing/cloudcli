# UI17 Job 0 performance results

Measured on the authenticated dev instance at 1440×1000 with Chrome CPU throttled 4x. Both runs held 169 job rows and five visible chat rows. The baseline had 238 task descendants mounted behind closed drawers and a 55-row live transcript; the after run had zero closed-drawer task descendants and a 36-row live transcript. Raw traces and JSON are in `/Users/spoton-worker/forge-logs/ui17/perf-baseline-clean/` and `/Users/spoton-worker/forge-logs/ui17/perf-after-final/`.

| Scenario | Baseline longest task | After longest task | Baseline main thread | After main thread | Baseline profiler renders | After profiler renders |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5s idle | 115ms | 50ms | 1,124.9ms | 1,830.1ms | 455,249 | 338,433 |
| Three chat switches | 197ms | 79ms | 1,830.9ms | 1,139.4ms | 105,863 | 92,963 |
| 5s jobs sweep | 138ms | 0ms | 4,921.9ms | 4,087.1ms | 230,255 | 276,576 |
| 5s sidebar sweep | 137ms | 0ms | 3,720.9ms | 3,593.0ms | 494,888 | 258,700 |

The React Profiler pass repeats each interaction separately so profiler instrumentation does not inflate the Chrome timing trace. Production component names are minified; the five busiest component names and rerender observations were:

| Scenario | Baseline top components | After top components |
| --- | --- | --- |
| Idle | `Ws` 51,191; `Ep` 42,127; `ChevronDown` 25,132; `ha` 24,829; `SK` 18,540 | `ChevronDown` 30,487; `Ws` 30,446; `_K` 26,578; `RK` 26,578; `AK` 26,578 |
| Chat switches | `Ws` 11,928; `Ep` 9,816; `ChevronDown` 5,790; `ha` 5,728; `SK` 4,289 | `ChevronDown` 8,528; `Ws` 8,400; `_K` 7,413; `RK` 7,413; `AK` 7,413 |
| Jobs sweep | `Ws` 25,844; `Ep` 21,268; `ChevronDown` 12,428; `ha` 12,317; `SK` 9,360 | `ChevronDown` 26,499; `Ws` 25,410; `_K` 22,264; `Ep` 20,207; `RK` 19,331 |
| Sidebar sweep | `Ws` 55,664; `Ep` 45,808; `ChevronDown` 26,808; `ha` 26,476; `SK` 20,163 | `ChevronDown` 25,404; `Ws` 24,360; `_K` 21,344; `Ep` 19,372; `RK` 17,284 |

| Budget evidence | Baseline | After | Limit |
| --- | ---: | ---: | ---: |
| Slowest chat transcript paint | 385.8ms | 148.2ms | <150ms |
| Jobs script time | 3,827.5ms | 976.7ms | no task >50ms |
| Heap start | 59.90MB | 41.18MB | — |
| Heap growth after 30 switches | 1.4% | 5.9% | ≤20% |
| Minimum distinct dot transforms per hop | 1 | 12 | ≥3 |
| Offscreen animations still running | 1 | 0 | 0 |
| Hidden-tab animations still running | 4 | 0 | 0 |
| Layout-affecting keyframes | 0 | 0 | 0 |

The largest measured cause was the jobs tree: unmounting 238 hidden task descendants and avoiding list-wide hover state cut jobs script work 74.5% and its longest task from 138ms to zero. Session-scoped websocket handling, identity-preserving polls, shared clocks, and stable worker/jobs inputs cut chat-switch main-thread work 37.8%; the slowest first paint fell 61.6%. A live 69KB worker-runs response initially produced a 65ms sidebar-sweep task after the other fixes; concurrent reconciliation removed it on the final run. The dot's mutation observer now preserves an in-flight spring, and the app animation budget reduced both hidden and offscreen running-animation counts to zero.
