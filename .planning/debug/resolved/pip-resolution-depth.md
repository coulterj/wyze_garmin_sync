---
status: resolved
trigger: "GitHub Actions daily workflow failing with pip dependency resolution error"
created: 2025-01-15T12:00:00Z
updated: 2025-01-15T12:15:00Z
resolution_time: 15 minutes
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: verified fix with actual requirements.txt
result: SUCCESS - garth 0.5.21 installed cleanly in <10s
next_action: commit and push fix

## Symptoms

expected: Daily sync workflow completes successfully, syncing data between Wyze and Garmin
actual: Workflow fails during pip install with "resolution-too-deep" error
errors: |
  error: resolution-too-deep
  × Dependency resolution exceeded maximum depth
  ╰─> Pip cannot resolve the current dependencies as the dependency graph is too complex for pip to solve efficiently.

  The error shows pip trying many versions of logfire (4.18.0 down to 3.5.1) and oauthlib (3.3.1 down to 3.0.0)
  garth depends on logfire<5.0,>=2.11 which pulls in opentelemetry and protobuf
reproduction: Run GitHub Actions daily workflow, or `pip install -r requirements.txt`
started: 2-3 days ago, was working before

## Eliminated

[none yet]

## Evidence

[2025-01-15 12:05] Checked requirements.txt
- Found: only `wyze_sdk` and `garth` pinned, no version constraints
- Implication: pip will always try latest versions

[2025-01-15 12:06] Checked garth version history
- Latest: 0.6.2 (released recently, within 2-3 days window)
- Previous stable: 0.5.21
- Implication: garth 0.6.x is new release

[2025-01-15 12:07] Compared garth 0.6.2 vs 0.5.21 dependencies
- garth 0.5.21: pydantic, requests-oauthlib, requests (simple deps)
- garth 0.6.2: **added logfire<5.0,>=2.11** + same other deps
- Implication: NEW logfire dependency is the culprit

[2025-01-15 12:08] Checked logfire dependency chain
- logfire requires opentelemetry-sdk, opentelemetry-api, protobuf
- These have complex interdependencies with many versions
- Combined with oauthlib constraints creates resolution-too-deep error
- Implication: adding logfire created the complex dependency graph causing pip resolution failure

[2025-01-15 12:10] HYPOTHESIS CONFIRMED - tested both scenarios
- Test 1: `pip install wyze_sdk garth<0.6` → SUCCESS in <10s, installed garth 0.5.21
- Test 2: `pip install wyze_sdk garth` → TIMEOUT after 45s (resolution-too-deep)
- Implication: constraining garth to <0.6 (pre-logfire versions) resolves the issue

[2025-01-15 12:12] FIX APPLIED - updated requirements.txt
- Changed: `garth` → `garth<0.6`
- File: /home/coulter/projects/wyze_garmin_sync/requirements.txt

[2025-01-15 12:13] FIX VERIFIED - clean environment test
- Fresh venv with updated requirements.txt
- Result: SUCCESS - all packages installed in <10s
- Installed garth 0.5.21 (last stable pre-logfire version)
- No resolution errors, workflow will now succeed

## Resolution

root_cause: |
  garth 0.6.0+ added logfire as a required dependency (logfire<5.0,>=2.11).
  Logfire brings in OpenTelemetry packages (opentelemetry-sdk, opentelemetry-api) and protobuf,
  which have complex interdependencies with many version combinations.
  When combined with the existing oauthlib and requests-oauthlib constraints from other packages,
  pip's dependency resolver cannot find a solution within reasonable depth limits.
  This started 2-3 days ago when garth 0.6.x was released.

fix: Pin garth to <0.6 in requirements.txt to use stable 0.5.x versions without logfire dependency

verification: Local test shows garth<0.6 installs successfully in <10s, while unrestricted fails

files_changed:
  - requirements.txt: add version constraint garth<0.6
