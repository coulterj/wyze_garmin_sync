#!/usr/local/bin/python3
"""Pull Garmin sleep-study metrics and push them to the Tylenol/sleep Google Sheet.

For each date it collects the metrics a neurologist cares about (sleep score,
stages, naps, overnight HRV, resting HR, body battery, stress, respiration, and
any blood-pressure readings) and POSTs them to a Google Apps Script webhook that
upserts the row into the sheet's "Garmin" tab by date.

Runs daily inside sync_all.py (Garmin already authenticated), or standalone:

    python sleep_study.py                # yesterday
    python sleep_study.py --date 2026-07-18
    python sleep_study.py --backfill 30  # last 30 days (one-time history load)
"""

import argparse
import json
import os
import time
from datetime import date, timedelta

import garth
import requests

IS_CI = os.environ.get("CI") == "true"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKENS_DIR = os.path.join(SCRIPT_DIR, "tokens")

# Google Apps Script web-app webhook that writes rows into the sheet.
SHEET_WEBHOOK_URL = os.environ.get("SHEET_WEBHOOK_URL")
SHEET_WEBHOOK_TOKEN = os.environ.get("SHEET_WEBHOOK_TOKEN")

GARMIN_USERNAME = os.environ.get("Garmin_username")
GARMIN_PASSWORD = os.environ.get("Garmin_password")


def _min(seconds):
    """Seconds -> whole minutes, or None if missing."""
    return round(seconds / 60) if seconds is not None else None


def _collect_sleep(day):
    """Sleep score, stages, naps, respiration, SpO2, sleep-stress for a date."""
    out = {}
    try:
        s = garth.SleepData.get(day)
    except Exception as exc:
        print(f"    sleep fetch failed for {day}: {exc}")
        return out
    if s is None or s.daily_sleep_dto is None:
        return out
    dto = s.daily_sleep_dto
    scores = getattr(dto, "sleep_scores", None)
    overall = getattr(scores, "overall", None) if scores else None
    out.update(
        {
            "sleep_score": getattr(overall, "value", None) if overall else None,
            "total_sleep_min": _min(dto.sleep_time_seconds),
            "deep_min": _min(dto.deep_sleep_seconds),
            "light_min": _min(dto.light_sleep_seconds),
            "rem_min": _min(dto.rem_sleep_seconds),
            "awake_min": _min(dto.awake_sleep_seconds),
            "awake_count": dto.awake_count,
            "nap_min": _min(dto.nap_time_seconds),
            "resp_avg": dto.average_respiration_value,
            "spo2_avg": dto.average_sp_o2_value,
            "sleep_stress": dto.avg_sleep_stress,
        }
    )
    return out


def _collect_hrv(day):
    """Overnight HRV summary for a date."""
    try:
        hrv = garth.client.connectapi(f"/hrv-service/hrv/{day}")
    except Exception:
        return {}
    summ = (hrv or {}).get("hrvSummary") or {}
    return {
        "hrv_avg": summ.get("lastNightAvg"),
        "hrv_status": summ.get("status"),
    }


def _collect_daily_summary(day, display_name):
    """Resting/min/max HR, steps, body battery, and stress for a date."""
    try:
        summ = garth.client.connectapi(
            f"/usersummary-service/usersummary/daily/{display_name}?calendarDate={day}"
        )
    except Exception:
        return {}
    return {
        "resting_hr": summ.get("restingHeartRate"),
        "min_hr": summ.get("minHeartRate"),
        "max_hr": summ.get("maxHeartRate"),
        "steps": summ.get("totalSteps"),
        "body_battery_low": summ.get("bodyBatteryLowestValue"),
        "body_battery_high": summ.get("bodyBatteryHighestValue"),
        "stress_avg": summ.get("averageStressLevel"),
        "stress_max": summ.get("maxStressLevel"),
    }


def _collect_bp(day):
    """Latest blood-pressure reading recorded on a date, if any."""
    try:
        r = garth.client.connectapi(
            f"/bloodpressure-service/bloodpressure/range/{day}/{day}?includeAll=true"
        )
    except Exception:
        return {}
    measurements = []
    for summary in (r or {}).get("measurementSummaries", []):
        measurements.extend(summary.get("measurements", []))
    if not measurements:
        return {}
    latest = max(measurements, key=lambda m: m.get("measurementTimestampLocal", ""))
    return {
        "systolic": latest.get("systolic"),
        "diastolic": latest.get("diastolic"),
        "pulse": latest.get("pulse"),
    }


def collect_day(day, display_name):
    """Gather every metric for a single calendar date into one flat dict."""
    row = {"date": day}
    row.update(_collect_sleep(day))
    row.update(_collect_hrv(day))
    row.update(_collect_daily_summary(day, display_name))
    row.update(_collect_bp(day))
    return row


def post_rows(rows):
    """Send collected rows to the sheet webhook. Returns True on success."""
    if not SHEET_WEBHOOK_URL or not SHEET_WEBHOOK_TOKEN:
        print(
            "  SHEET_WEBHOOK_URL / SHEET_WEBHOOK_TOKEN not set - skipping sheet upload.\n"
            "  (Metrics were collected but not sent. See SLEEP_STUDY_SETUP.md.)"
        )
        return False
    payload = {"token": SHEET_WEBHOOK_TOKEN, "rows": rows}
    resp = requests.post(SHEET_WEBHOOK_URL, json=payload, timeout=30)
    resp.raise_for_status()
    body = resp.text.strip()
    if "error" in body.lower():
        raise RuntimeError(f"Sheet webhook rejected the data: {body}")
    print(f"  Sheet updated: {len(rows)} row(s) -> {body[:120]}")
    return True


def _resume_garmin(max_retries=3):
    """Resume a saved Garmin session (used when run standalone)."""
    for attempt in range(max_retries):
        try:
            garth.resume(TOKENS_DIR)
            garth.client.username
            return True
        except Exception as exc:
            if "429" in str(exc) and attempt < max_retries - 1:
                wait = 30 * (attempt + 1)
                print(f"  Rate limited by Garmin, retrying in {wait}s...")
                time.sleep(wait)
            elif IS_CI:
                raise RuntimeError(
                    "Garmin auth failed in CI (token resume failed). "
                    "Update OAUTH1/OAUTH2 secrets."
                )
            else:
                garth.login(GARMIN_USERNAME, GARMIN_PASSWORD)
                garth.save(TOKENS_DIR)
                return True
    return False


def run_sync(garmin_authed=False, days=None):
    """Collect metrics for the given dates and push them to the sheet.

    days: list of ISO date strings. Defaults to the last 2 days ending today.
    Garmin labels a night's sleep by the wake-up date, so "last night" is today's
    label - we pull today (last night) and yesterday (now finalized) every run.
    """
    if not garmin_authed:
        print("Logging in to Garmin Connect...")
        _resume_garmin()

    if days is None:
        days = _recent_window(2)

    display_name = garth.UserProfile.get().display_name

    rows = []
    for day in days:
        print(f"Collecting Garmin metrics for {day}...")
        row = collect_day(day, display_name)
        filled = {k: v for k, v in row.items() if k != "date" and v is not None}
        print(f"  {len(filled)} metrics: {json.dumps(filled, default=str)[:160]}")
        rows.append(row)

    try:
        post_rows(rows)
        return True
    except Exception as exc:
        print(f"  Sheet upload failed: {exc}")
        return False


def _recent_window(n):
    """Last n calendar dates ending today (today = last night's sleep label)."""
    end = date.today()
    return [(end - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def main():
    parser = argparse.ArgumentParser(
        description="Sync Garmin sleep-study metrics to the sheet."
    )
    parser.add_argument("--date", help="Single date YYYY-MM-DD (default: last 2 days).")
    parser.add_argument("--backfill", type=int, help="Load the last N days at once.")
    args = parser.parse_args()

    if args.backfill:
        days = _recent_window(args.backfill)
    elif args.date:
        days = [args.date]
    else:
        days = None

    run_sync(garmin_authed=False, days=days)


if __name__ == "__main__":
    main()
