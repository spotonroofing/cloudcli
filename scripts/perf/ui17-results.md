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

## Job 2 memory footprint

The authenticated baseline and final run used 1440×1000, a long real planner transcript, a live worker transcript, 172 jobs, and five visible chat rows. The baseline worker produced 2,346 transcript mutations; the final worker produced 4,340. The harness collected garbage before each snapshot and counted heap, DOM nodes, detached trees, listeners, live interval owners, and object URLs. Raw baseline evidence is in `/Users/spoton-worker/forge-logs/ui17/memory-baseline/`; the passing final JSON and traces are in `/Users/spoton-worker/forge-logs/ui17/memory-final-pass/`.

| Memory stage | Baseline heap | After heap | Baseline DOM | After DOM | Baseline listeners | After listeners |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 36.12MB | 23.00MB | 6,778 | 4,126 | 1,581 | 829 |
| After 30 chat switches | 45.83MB | 24.82MB | 7,699 | 4,070 | 1,451 | 786 |
| After 10 minutes streaming idle | 48.28MB | 28.26MB | 8,275 | 4,778 | 1,473 | 811 |
| After 20 jobs drawers and 20 Memory surfaces | 47.43MB | 28.16MB | 8,272 | 4,737 | 1,473 | 812 |

| Holder/budget | Baseline | After | Change or limit |
| --- | ---: | ---: | ---: |
| Whole-scenario heap growth | 31.3% | 22.4% | ≤25% |
| Heap added by 30 chat switches | 9.70MB | 1.82MB | −81.3% |
| Final absolute heap | 47.43MB | 28.16MB | −40.6% |
| Final mounted jobs / total history | 172 / 172 | 40 / 172 | −76.7% mounted |
| Final largest transcript pane | 55 rows | 52 rows | ≤120 rows |
| Detached-tree growth | 0 | 0 | 0 |
| Interval owners introduced by closed surfaces | 0 | 0 | 0 |
| Final object URLs | 0 | 0 | 0 |

The largest baseline DOM holder was the jobs subtree: 3,559 descendants, 49.5% of the confirming page count. Replace-in-place 40-row history paging cut the final page from 8,272 to 4,737 nodes while preserving access to all 172 jobs. The unbounded per-pane session map is now a three-slot LRU; switching away compacts a slot to its newest row, returning re-fetches a 20-message page, the mounted initial window is 30 messages, and a running session retains at most 80 realtime messages instead of 500. Attachments already used owned/revoked object URLs, and the measured detached-tree and closed-surface interval-owner growth were both zero, so no speculative disposal rewrite was made.

The original baseline used the React-enabled browser required for Job 0 profiler counts. Heap verification now uses a second clean browser showing the same workspace because a confirming heap snapshot found React DevTools' fiber maps as the largest remaining observer-owned arrays; the React-enabled browser continues to produce the interaction traces and render counts in the same command. The clean-session result is the tab footprint, while the single-process script still prints both Job 0 and Job 2 budgets together.
