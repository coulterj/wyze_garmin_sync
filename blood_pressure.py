#!/usr/local/bin/python3
"""Sync Omron Connect blood pressure readings to Garmin Connect."""

import asyncio
import hashlib
import json
import os
import time
from datetime import datetime, timezone

import aiohttp
import garth
from getpass import getpass

IS_CI = os.environ.get("CI") == "true"

# Omron credentials
OMRON_EMAIL = os.environ.get("OMRON_EMAIL")
OMRON_PASSWORD = os.environ.get("OMRON_PASSWORD")
OMRON_COUNTRY_CODE = os.environ.get("OMRON_COUNTRY_CODE", "US")

# Garmin credentials (shared with scale.py)
GARMIN_USERNAME = os.environ.get("Garmin_username")
GARMIN_PASSWORD = os.environ.get("Garmin_password")
GARTH_OAUTH1 = os.environ.get("OAUTH1")
GARTH_OAUTH2 = os.environ.get("OAUTH2")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKENS_DIR = os.path.join(SCRIPT_DIR, "tokens")
BP_CKSUM_PATH = os.path.join(SCRIPT_DIR, "bp_cksum.txt")

OMRON_API_BASE = "https://oi-api.ohiomron.com"


def _write_secure_json(path, data):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)


def write_tokens_from_env():
    if not (GARTH_OAUTH1 or GARTH_OAUTH2):
        return
    oauth1_path = os.path.join(TOKENS_DIR, "oauth1_token.json")
    oauth2_path = os.path.join(TOKENS_DIR, "oauth2_token.json")
    if os.path.exists(oauth1_path) and os.path.exists(oauth2_path):
        return
    os.makedirs(TOKENS_DIR, mode=0o700, exist_ok=True)
    if GARTH_OAUTH1:
        try:
            _write_secure_json(
                os.path.join(TOKENS_DIR, "oauth1_token.json"),
                json.loads(GARTH_OAUTH1),
            )
        except Exception as exc:
            print(f"Failed to write oauth1_token.json: {exc}")
    if GARTH_OAUTH2:
        try:
            _write_secure_json(
                os.path.join(TOKENS_DIR, "oauth2_token.json"),
                json.loads(GARTH_OAUTH2),
            )
        except Exception as exc:
            print(f"Failed to write oauth2_token.json: {exc}")


async def omron_login(session):
    """Authenticate with Omron Connect API and return access token."""
    url = f"{OMRON_API_BASE}/app/login"
    payload = {
        "emailAddress": OMRON_EMAIL,
        "password": OMRON_PASSWORD,
        "country": OMRON_COUNTRY_CODE,
        "app": "OCM",
    }
    async with session.post(url, json=payload) as resp:
        data = await resp.json()
        if not data.get("success") and not data.get("accessToken"):
            raise RuntimeError(f"Omron login failed: {data}")
        return data["accessToken"]


async def fetch_bp_readings(session, token):
    """Fetch blood pressure readings from Omron Connect."""
    url = f"{OMRON_API_BASE}/app/v2/sync/bp"
    headers = {"Authorization": token}
    params = {
        "nextpaginationKey": "0",
        "lastSyncedTime": "0",
        "phoneIdentifier": "",
    }
    async with session.get(url, headers=headers, params=params) as resp:
        data = await resp.json()
        if not data.get("success") and "data" not in data:
            raise RuntimeError(f"Failed to fetch BP readings: {data}")
        return data.get("data", [])


def _garmin_resume_with_retry(max_retries=3):
    """Resume Garmin session, retrying on 429 rate limits."""
    for attempt in range(max_retries):
        try:
            garth.resume(TOKENS_DIR)
            garth.client.username
            garth.save(TOKENS_DIR)
            return True
        except Exception as exc:
            if "429" in str(exc) and attempt < max_retries - 1:
                wait = 30 * (attempt + 1)
                print(f"  Rate limited by Garmin, retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise
    return False


def login_to_garmin():
    """Authenticate with Garmin Connect using garth."""
    write_tokens_from_env()
    try:
        _garmin_resume_with_retry()
    except Exception:
        if IS_CI:
            raise RuntimeError(
                "Garmin auth failed in CI (token resume failed). Update OAUTH1/OAUTH2 secrets."
            )
        try:
            os.makedirs(TOKENS_DIR, mode=0o700, exist_ok=True)
            garth.login(GARMIN_USERNAME, GARMIN_PASSWORD)
            garth.save(TOKENS_DIR)
        except Exception:
            email = input("Enter Garmin email address: ")
            password = getpass("Enter Garmin password: ")
            try:
                os.makedirs(TOKENS_DIR, mode=0o700, exist_ok=True)
                garth.login(email, password)
                garth.save(TOKENS_DIR)
            except Exception as exc:
                print(repr(exc))
                exit()


def upload_bp_to_garmin(reading):
    """Upload a single blood pressure reading to Garmin Connect."""
    measurement_ts = int(reading["measurementDate"]) / 1000
    dt = datetime.fromtimestamp(measurement_ts, tz=timezone.utc)
    dt_local = dt.astimezone()

    local_str = dt_local.strftime("%Y-%m-%dT%H:%M:%S.000")
    gmt_str = dt.strftime("%Y-%m-%dT%H:%M:%S.000")

    payload = {
        "measurementTimestampLocal": local_str,
        "measurementTimestampGMT": gmt_str,
        "systolic": int(reading["systolic"]),
        "diastolic": int(reading["diastolic"]),
        "pulse": int(reading["pulse"]),
        "sourceType": "MANUAL",
    }

    notes_parts = []
    if reading.get("irregularHeartBeats", 0) > 0:
        notes_parts.append("Irregular heartbeat detected")
    if reading.get("movements", 0) > 0:
        notes_parts.append("Body movement detected")
    if notes_parts:
        payload["notes"] = "; ".join(notes_parts)

    garth.client.connectapi(
        "/bloodpressure-service/bloodpressure",
        method="POST",
        json=payload,
    )
    print(
        f"  Uploaded: {local_str} - {payload['systolic']}/{payload['diastolic']} "
        f"pulse {payload['pulse']}"
    )


def calculate_checksum(readings):
    """Generate checksum from reading data to detect new measurements."""
    digest = hashlib.sha256()
    for r in sorted(readings, key=lambda x: x.get("measurementDate", 0)):
        digest.update(json.dumps(r, sort_keys=True).encode())
    return digest.hexdigest()


async def fetch_omron_readings():
    """Fetch all BP readings from Omron Connect."""
    async with aiohttp.ClientSession() as session:
        print("Logging in to Omron Connect...")
        token = await omron_login(session)
        print("Fetching blood pressure readings...")
        readings = await fetch_bp_readings(session, token)
        print(f"Found {len(readings)} reading(s)")
        return readings


def main():
    # Fetch from Omron
    readings = asyncio.run(fetch_omron_readings())

    if not readings:
        print("No blood pressure readings found.")
        return

    # Check for new data
    cksum = calculate_checksum(readings)
    if os.path.exists(BP_CKSUM_PATH):
        with open(BP_CKSUM_PATH, "r") as f:
            stored = f.read().strip()
        if cksum == stored:
            print("No new blood pressure measurements.")
            return

    # Login to Garmin
    print("Logging in to Garmin Connect...")
    login_to_garmin()

    # Upload the most recent reading
    latest = max(readings, key=lambda r: r.get("measurementDate", 0))
    print("Uploading latest blood pressure reading to Garmin...")
    try:
        upload_bp_to_garmin(latest)
        with open(BP_CKSUM_PATH, "w") as f:
            f.write(cksum)
        print("Blood pressure sync complete.")
    except Exception as e:
        print(f"Upload failed: {e}")


if __name__ == "__main__":
    main()
