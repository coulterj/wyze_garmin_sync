# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wyze Garmin Sync pulls health data from Wyze (scale) and Omron (blood pressure) and uploads it to Garmin Connect. It runs on a daily cron via GitHub Actions (`.github/workflows/sync.yml`) and can also run locally or in Docker.

## Running

```bash
# Install dependencies
pip install -r requirements.txt

# Run scale sync (Wyze -> Garmin)
python scale.py

# Run blood pressure sync (Omron -> Garmin)
python blood_pressure.py
```

There is no test suite, linter, or build step configured.

## Required Environment Variables

**Wyze (scale.py):** `WYZE_EMAIL`, `WYZE_PASSWORD`, `WYZE_KEY_ID`, `WYZE_API_KEY`
**Omron (blood_pressure.py):** `OMRON_EMAIL`, `OMRON_PASSWORD`, `OMRON_COUNTRY_CODE` (default: US)
**Garmin (both scripts):** `Garmin_username`, `Garmin_password`
**CI token auth:** `OAUTH1`, `OAUTH2` (JSON-serialized garth OAuth tokens)
**CI detection:** `CI=true` disables interactive login prompts

Note: Garmin env vars use mixed case (`Garmin_username` not `GARMIN_USERNAME`).

## Architecture

### Two independent sync scripts

- **`scale.py`** - Logs into Wyze SDK, finds WyzeScale devices, generates a `.fit` file from the latest measurement, uploads to Garmin via garth. Uses SHA-256 checksum (`cksum.txt`) to skip duplicate uploads.
- **`blood_pressure.py`** - Async (aiohttp) login to Omron Connect API, fetches BP readings, uploads the latest to Garmin's blood pressure REST endpoint via `garth.client.connectapi()`. Uses checksum (`bp_cksum.txt`) for dedup.

### FIT file generation (`fit.py`)

Custom binary FIT protocol encoder (`FitEncoder_Weight`) that constructs Garmin-compatible `.fit` files from scratch using struct packing. Handles CRC calculation, FIT headers, and weight scale message types. This is not a library wrapper -- it implements the FIT protocol directly per the Garmin FIT SDK specification.

### Garmin authentication flow

Both scripts share the same pattern: try resuming saved tokens from `tokens/` dir -> if that fails and not CI, try `garth.login()` with env creds -> if that fails, prompt interactively. 429 rate limits are retried with 30s/60s backoff. Tokens are saved/refreshed to `tokens/` on successful auth.

### Other files

- **`mac_address_devices.py`** - Standalone utility to list Wyze devices (uses older TOTP auth, not part of sync pipeline)
- **`Docker files/`** - Docker deployment variant with its own copies of `scale.py` and `fit.py`, plus a cron scheduler
