#!/usr/local/bin/python3
"""Unified sync script: authenticates to Garmin once, then runs scale + BP syncs."""

import json
import os
import time

import garth
from getpass import getpass

IS_CI = os.environ.get("CI") == "true"

GARMIN_USERNAME = os.environ.get("Garmin_username")
GARMIN_PASSWORD = os.environ.get("Garmin_password")
GARTH_OAUTH1 = os.environ.get("OAUTH1")
GARTH_OAUTH2 = os.environ.get("OAUTH2")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKENS_DIR = os.path.join(SCRIPT_DIR, "tokens")


def _write_secure_json(path, data):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)


def write_tokens_from_env():
    if not (GARTH_OAUTH1 or GARTH_OAUTH2):
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


def _garmin_resume_with_retry(max_retries=3):
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
    """Authenticate with Garmin Connect once for all syncs."""
    write_tokens_from_env()
    try:
        _garmin_resume_with_retry()
        print("Garmin session resumed successfully.")
        return True
    except Exception:
        if IS_CI:
            print(
                "Garmin auth failed in CI (token resume failed). "
                "Update OAUTH1/OAUTH2 secrets."
            )
            return False
        try:
            os.makedirs(TOKENS_DIR, mode=0o700, exist_ok=True)
            garth.login(GARMIN_USERNAME, GARMIN_PASSWORD)
            garth.save(TOKENS_DIR)
            return True
        except Exception:
            email = input("Enter Garmin email address: ")
            password = getpass("Enter Garmin password: ")
            try:
                os.makedirs(TOKENS_DIR, mode=0o700, exist_ok=True)
                garth.login(email, password)
                garth.save(TOKENS_DIR)
                return True
            except Exception as exc:
                print(repr(exc))
                return False


def main():
    # Authenticate to Garmin once
    print("=== Garmin Authentication ===")
    garmin_ok = login_to_garmin()
    if not garmin_ok:
        print("Garmin authentication failed. Exiting.")
        exit(1)

    # Run scale sync
    print("\n=== Scale Sync (Wyze -> Garmin) ===")
    try:
        from scale import run_sync as scale_sync

        scale_sync(garmin_authed=True)
    except Exception as e:
        print(f"Scale sync failed: {e}")

    # Run blood pressure sync
    print("\n=== Blood Pressure Sync (Omron -> Garmin) ===")
    try:
        from blood_pressure import run_sync as bp_sync

        bp_sync(garmin_authed=True)
    except Exception as e:
        print(f"Blood pressure sync failed: {e}")

    # Push sleep-study metrics (sleep, naps, HRV, RHR, stress, BP) to the sheet
    print("\n=== Sleep Study Metrics (Garmin -> Sheet) ===")
    try:
        from sleep_study import run_sync as sleep_sync

        sleep_sync(garmin_authed=True)
    except Exception as e:
        print(f"Sleep study sync failed: {e}")


if __name__ == "__main__":
    main()
