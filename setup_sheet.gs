/**
 * Tylenol Sleep Study - Google Sheet builder + Garmin webhook.
 *
 * ONE-TIME SETUP (see SLEEP_STUDY_SETUP.md for screenshots):
 *   1. Create a blank Google Sheet.
 *   2. Extensions -> Apps Script. Delete the sample code, paste this whole file.
 *   3. Run the `setUp` function once (approve the permissions prompt).
 *      -> It builds every tab, fills your randomized schedule, and shows you a
 *         secret token. Copy that token.
 *   4. Deploy -> New deployment -> type "Web app":
 *         Execute as: Me     Who has access: Anyone
 *      -> Copy the Web app URL.
 *   5. Add two GitHub repo secrets:
 *         SHEET_WEBHOOK_URL   = the Web app URL
 *         SHEET_WEBHOOK_TOKEN = the token from step 3
 *
 * After that, the daily job pushes Garmin metrics here automatically and the
 * Dashboard tab updates itself.
 */

// ---------------------------------------------------------------------------
// Randomized TAKE / SKIP schedule (37 take / 38 skip, runs of 1-4 nights).
// Generated once; follow it regardless of how you feel - that is what makes
// the result credible instead of placebo.
// ---------------------------------------------------------------------------
var SCHEDULE = [
  ["2026-07-20","SKIP"],["2026-07-21","SKIP"],["2026-07-22","SKIP"],["2026-07-23","SKIP"],
  ["2026-07-24","TAKE"],["2026-07-25","SKIP"],["2026-07-26","SKIP"],["2026-07-27","SKIP"],
  ["2026-07-28","TAKE"],["2026-07-29","TAKE"],["2026-07-30","TAKE"],["2026-07-31","TAKE"],
  ["2026-08-01","SKIP"],["2026-08-02","SKIP"],["2026-08-03","SKIP"],["2026-08-04","SKIP"],
  ["2026-08-05","TAKE"],["2026-08-06","TAKE"],["2026-08-07","TAKE"],["2026-08-08","SKIP"],
  ["2026-08-09","SKIP"],["2026-08-10","SKIP"],["2026-08-11","SKIP"],["2026-08-12","TAKE"],
  ["2026-08-13","TAKE"],["2026-08-14","TAKE"],["2026-08-15","SKIP"],["2026-08-16","SKIP"],
  ["2026-08-17","TAKE"],["2026-08-18","TAKE"],["2026-08-19","SKIP"],["2026-08-20","SKIP"],
  ["2026-08-21","SKIP"],["2026-08-22","TAKE"],["2026-08-23","TAKE"],["2026-08-24","SKIP"],
  ["2026-08-25","TAKE"],["2026-08-26","TAKE"],["2026-08-27","TAKE"],["2026-08-28","SKIP"],
  ["2026-08-29","SKIP"],["2026-08-30","TAKE"],["2026-08-31","TAKE"],["2026-09-01","TAKE"],
  ["2026-09-02","SKIP"],["2026-09-03","TAKE"],["2026-09-04","SKIP"],["2026-09-05","SKIP"],
  ["2026-09-06","SKIP"],["2026-09-07","TAKE"],["2026-09-08","TAKE"],["2026-09-09","TAKE"],
  ["2026-09-10","TAKE"],["2026-09-11","SKIP"],["2026-09-12","TAKE"],["2026-09-13","TAKE"],
  ["2026-09-14","TAKE"],["2026-09-15","SKIP"],["2026-09-16","SKIP"],["2026-09-17","SKIP"],
  ["2026-09-18","SKIP"],["2026-09-19","TAKE"],["2026-09-20","TAKE"],["2026-09-21","TAKE"],
  ["2026-09-22","SKIP"],["2026-09-23","SKIP"],["2026-09-24","TAKE"],["2026-09-25","TAKE"],
  ["2026-09-26","TAKE"],["2026-09-27","TAKE"],["2026-09-28","SKIP"],["2026-09-29","SKIP"],
  ["2026-09-30","SKIP"],["2026-10-01","SKIP"],["2026-10-02","TAKE"]
];

// Garmin tab columns, in order. `key` matches the JSON sent by sleep_study.py;
// `label` is the human header. Column 1 is always the date.
var GARMIN_COLS = [
  ["date", "Date"],
  ["sleep_score", "Sleep score"],
  ["total_sleep_min", "Total sleep (min)"],
  ["deep_min", "Deep (min)"],
  ["light_min", "Light (min)"],
  ["rem_min", "REM (min)"],
  ["awake_min", "Awake (min)"],
  ["awake_count", "Awakenings"],
  ["nap_min", "Nap (min)"],
  ["resp_avg", "Respiration avg"],
  ["spo2_avg", "SpO2 avg"],
  ["sleep_stress", "Sleep stress"],
  ["hrv_avg", "HRV (ms)"],
  ["hrv_status", "HRV status"],
  ["resting_hr", "Resting HR"],
  ["min_hr", "Min HR"],
  ["max_hr", "Max HR"],
  ["steps", "Steps"],
  ["body_battery_low", "Body Batt low"],
  ["body_battery_high", "Body Batt high"],
  ["stress_avg", "Stress avg"],
  ["stress_max", "Stress max"],
  ["systolic", "Systolic"],
  ["diastolic", "Diastolic"],
  ["pulse", "Pulse"]
];

var LOG_SHEET = "Log";
var GARMIN_SHEET = "Garmin";
var DASH_SHEET = "Dashboard";
var CALC_SHEET = "Calc";

// ===========================================================================
// SETUP - run this once.
// ===========================================================================
function setUp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var token = getOrCreateToken_();

  buildLogSheet_(ss);
  buildGarminSheet_(ss);
  buildCalcSheet_(ss);
  buildDashboardSheet_(ss, token);

  // Put the default tab (often "Sheet1") out of the way / remove it.
  var first = ss.getSheetByName("Sheet1");
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);

  ss.setActiveSheet(ss.getSheetByName(DASH_SHEET));

  // Log the token too (survives even if the alert dialog is missed).
  Logger.log("WEBHOOK TOKEN (SHEET_WEBHOOK_TOKEN): " + token);
  try {
    SpreadsheetApp.getUi().alert(
      "Sleep study sheet is ready.\n\n" +
      "YOUR WEBHOOK TOKEN (copy this into GitHub secret SHEET_WEBHOOK_TOKEN):\n\n" +
      token +
      "\n\nNext: Deploy -> New deployment -> Web app (Execute as Me, Access Anyone), " +
      "then copy the Web app URL into GitHub secret SHEET_WEBHOOK_URL."
    );
  } catch (e) {
    // No UI context (e.g. run headless) - the token is in the log and via showToken().
  }
}

/** Re-print the webhook token to the Execution log any time you need it. */
function showToken() {
  Logger.log("TOKEN: " + PropertiesService.getScriptProperties().getProperty("WEBHOOK_TOKEN"));
}

function getOrCreateToken_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("WEBHOOK_TOKEN");
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, "");
    props.setProperty("WEBHOOK_TOKEN", token);
  }
  return token;
}

// ---------------------------------------------------------------------------
// Log tab: the schedule + your daily manual entry.
// ---------------------------------------------------------------------------
function buildLogSheet_(ss) {
  var sh = resetSheet_(ss, LOG_SHEET);
  var headers = ["Date (night)", "Scheduled", "Took it? (Y/N)", "Dose (mg)", "Time taken",
                 "How rested (1-5)", "Note"];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold").setBackground("#37474f").setFontColor("#ffffff");

  // Notes so the night-vs-morning logging never gets mixed up.
  sh.getRange("A1").setNote(
    "Each row is ONE NIGHT, dated by the evening you go to sleep.\n" +
    "Follow the 'Scheduled' column: take Tylenol only on TAKE nights, " +
    "regardless of how you feel - that is what makes the study valid.");
  sh.getRange("C1").setNote("Fill in the EVENING: did you actually take it? Y or N.");
  sh.getRange("F1").setNote(
    "Fill the NEXT MORNING, on this same night's row: how rested did you feel? " +
    "1 (awful) to 5 (great).");

  var rows = SCHEDULE.map(function (r) {
    var p = r[0].split("-");
    return [new Date(+p[0], +p[1] - 1, +p[2]), r[1], "", "", "", "", ""];
  });
  sh.getRange(2, 1, rows.length, 7).setValues(rows);
  sh.getRange(2, 1, rows.length, 1).setNumberFormat("ddd  mmm d");

  // Data validation: Took it? = Y/N ; How rested = 1-5.
  var yn = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Y", "N"], true).setAllowInvalid(false).build();
  sh.getRange(2, 3, rows.length, 1).setDataValidation(yn);
  var oneToFive = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(1, 5).setAllowInvalid(false).build();
  sh.getRange(2, 6, rows.length, 1).setDataValidation(oneToFive);

  // Conditional formatting: colour tonight's plan, and highlight today's row.
  var lastRow = rows.length + 1;
  var schedRange = sh.getRange(2, 2, rows.length, 1);
  var takeRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("TAKE").setBackground("#bbdefb").setRanges([schedRange]).build();
  var skipRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("SKIP").setBackground("#eceff1").setRanges([schedRange]).build();
  var todayRange = sh.getRange(2, 1, rows.length, 7);
  var todayRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied("=$A2=TODAY()")
    .setBackground("#fff9c4").setBold(true).setRanges([todayRange]).build();
  sh.setConditionalFormatRules([todayRule, takeRule, skipRule]);

  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(7, 260);
}

// ---------------------------------------------------------------------------
// Garmin tab: written automatically by the daily job. Do not edit by hand.
// ---------------------------------------------------------------------------
function buildGarminSheet_(ss) {
  var sh = resetSheet_(ss, GARMIN_SHEET);
  var labels = GARMIN_COLS.map(function (c) { return c[1]; });
  sh.getRange(1, 1, 1, labels.length).setValues([labels])
    .setFontWeight("bold").setBackground("#1b5e20").setFontColor("#ffffff");
  sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setNumberFormat("ddd  mmm d");
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 130);
}

// ---------------------------------------------------------------------------
// Calc tab (hidden): joins Log + Garmin by date so the charts can compare arms.
// ---------------------------------------------------------------------------
function buildCalcSheet_(ss) {
  var sh = resetSheet_(ss, CALC_SHEET);
  var headers = ["Date", "Took", "Rested", "SleepScore",
                 "ScoreIfTake", "ScoreIfSkip", "RestedIfTake", "RestedIfSkip"];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");

  sh.getRange("A2").setFormula("=ARRAYFORMULA(IF(Garmin!A2:A=\"\",\"\",Garmin!A2:A))");
  // Garmin dates sleep by wake morning; the pill was taken the evening before,
  // so the Log row for a Garmin date D is D-1.
  sh.getRange("B2").setFormula(
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IFERROR(VLOOKUP(A2:A-1,Log!A:C,3,FALSE),\"\")))");
  sh.getRange("C2").setFormula(
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IFERROR(VLOOKUP(A2:A-1,Log!A:F,6,FALSE),\"\")))");
  sh.getRange("D2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",Garmin!B2:B))");
  sh.getRange("E2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(B2:B=\"Y\",D2:D,\"\")))");
  sh.getRange("F2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(B2:B=\"N\",D2:D,\"\")))");
  sh.getRange("G2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(B2:B=\"Y\",C2:C,\"\")))");
  sh.getRange("H2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(B2:B=\"N\",C2:C,\"\")))");
  sh.getRange("A2:A").setNumberFormat("ddd  mmm d");
  sh.hideSheet();
}

// ---------------------------------------------------------------------------
// Dashboard tab: the daily glance + the take-vs-skip hero visual.
// ---------------------------------------------------------------------------
function buildDashboardSheet_(ss, token) {
  var sh = resetSheet_(ss, DASH_SHEET);
  sh.setHiddenGridlines(true);

  // --- Title ---
  sh.getRange("B2").setValue("Tylenol Sleep Study").setFontSize(20).setFontWeight("bold");
  sh.getRange("B3").setValue("Does acetaminophen actually improve my sleep? A randomized self-test.")
    .setFontColor("#607d8b");

  // --- "Last night" card ---
  sh.getRange("B5").setValue("LAST NIGHT").setFontWeight("bold").setFontColor("#607d8b");
  sh.getRange("B6").setFormula("=IFERROR(MAX(Garmin!A2:A),\"(no data yet)\")")
    .setNumberFormat("dddd, mmm d").setFontSize(14).setFontWeight("bold");

  // Big Tylenol banner (merged).
  sh.getRange("B7:F7").merge();
  sh.getRange("B7").setFormula(
    "=IFERROR(IF(VLOOKUP(B6-1,Log!A:C,3,FALSE)=\"Y\",\"🔵  TOOK TYLENOL LAST NIGHT\"," +
    "IF(VLOOKUP(B6-1,Log!A:C,3,FALSE)=\"N\",\"○  No Tylenol last night\"," +
    "\"—  (log last night in the Log tab)\")),\"—  (log last night in the Log tab)\")")
    .setFontSize(16).setFontWeight("bold").setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sh.setRowHeight(7, 40);

  // Metric tiles for last night.
  var tiles = [
    ["Sleep score", "=IFERROR(VLOOKUP(B6,Garmin!A:B,2,FALSE),\"-\")"],
    ["Total sleep", "=IFERROR(TEXT(INT(VLOOKUP(B6,Garmin!A:C,3,FALSE)/60),\"0\")&\"h \"&TEXT(MOD(VLOOKUP(B6,Garmin!A:C,3,FALSE),60),\"0\")&\"m\",\"-\")"],
    ["How rested (1-5)", "=IFERROR(VLOOKUP(B6-1,Log!A:F,6,FALSE),\"-\")"],
    ["Nap", "=IFERROR(IF(VLOOKUP(B6,Garmin!A:I,9,FALSE)>0,VLOOKUP(B6,Garmin!A:I,9,FALSE)&\" min\",\"none\"),\"-\")"],
    ["Awakenings", "=IFERROR(VLOOKUP(B6,Garmin!A:H,8,FALSE),\"-\")"],
    ["HRV (ms)", "=IFERROR(VLOOKUP(B6,Garmin!A:M,13,FALSE),\"-\")"],
    ["Resting HR", "=IFERROR(VLOOKUP(B6,Garmin!A:O,15,FALSE),\"-\")"],
    ["Blood pressure", "=IF(IFERROR(VLOOKUP(B6,Garmin!A:W,23,FALSE),\"\")=\"\",\"none logged\",VLOOKUP(B6,Garmin!A:W,23,FALSE)&\"/\"&VLOOKUP(B6,Garmin!A:X,24,FALSE))"]
  ];
  var startRow = 9;
  for (var i = 0; i < tiles.length; i++) {
    var r = startRow + i;
    sh.getRange(r, 2).setValue(tiles[i][0]).setFontColor("#607d8b");
    sh.getRange(r, 3).setFormula(tiles[i][1]).setFontWeight("bold").setFontSize(12);
  }

  // --- Take vs Skip comparison table (drives the hero chart) ---
  sh.getRange("B19").setValue("DOES IT HELP?  Take-nights vs skip-nights (higher = better)")
    .setFontWeight("bold").setFontColor("#607d8b");
  sh.getRange("B20:D20").setValues([["", "Sleep score", "How rested"]]).setFontWeight("bold");
  sh.getRange("B21").setValue("Tylenol nights");
  sh.getRange("B22").setValue("No-Tylenol nights");
  sh.getRange("C21").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"Y\",Calc!D:D),1),\"-\")");
  sh.getRange("C22").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"N\",Calc!D:D),1),\"-\")");
  sh.getRange("D21").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"Y\",Calc!C:C),1),\"-\")");
  sh.getRange("D22").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"N\",Calc!C:C),1),\"-\")");

  // Sample sizes + difference (honest read-out, no significance claim).
  sh.getRange("B24").setValue("Nights measured").setFontColor("#607d8b");
  sh.getRange("C24").setFormula(
    "=\"Tylenol: \"&COUNTIFS(Calc!B:B,\"Y\",Calc!D:D,\">0\")&\"   |   No-Tylenol: \"&COUNTIFS(Calc!B:B,\"N\",Calc!D:D,\">0\")");
  sh.getRange("B25").setValue("Sleep-score difference").setFontColor("#607d8b");
  sh.getRange("C25").setFormula(
    "=IFERROR(IF(C21>C22,\"+\",\"\")&ROUND(C21-C22,1)&\" points on Tylenol nights\",\"(collecting data)\")")
    .setFontWeight("bold");

  // --- Charts ---
  var barChart = sh.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange("B20:D22"))
    .setNumHeaders(1)
    .setOption("title", "Sleep score & restedness: Tylenol vs no-Tylenol")
    .setOption("colors", ["#1e88e5", "#26a69a"])
    .setOption("series", { 0: { targetAxisIndex: 0 }, 1: { targetAxisIndex: 1 } })
    .setOption("vAxes", { 0: { title: "Sleep score (0-100)" }, 1: { title: "How rested (1-5)" } })
    .setOption("legend", { position: "bottom" })
    .setPosition(20, 6, 0, 0)
    .build();
  sh.insertChart(barChart);

  var trendChart = sh.newChart()
    .setChartType(Charts.ChartType.SCATTER)
    .addRange(ss.getSheetByName(CALC_SHEET).getRange("A2:A"))
    .addRange(ss.getSheetByName(CALC_SHEET).getRange("E2:F"))
    .setNumHeaders(0)
    .setOption("title", "Nightly sleep score over time  (blue = Tylenol, gray = no Tylenol)")
    .setOption("colors", ["#1e88e5", "#90a4ae"])
    .setOption("series", { 0: { labelInLegend: "Tylenol" }, 1: { labelInLegend: "No Tylenol" } })
    .setOption("pointSize", 7)
    .setOption("legend", { position: "bottom" })
    .setPosition(38, 6, 0, 0)
    .build();
  sh.insertChart(trendChart);

  sh.setColumnWidth(1, 20);
  sh.setColumnWidth(2, 170);
  sh.setColumnWidth(3, 150);

  // Conditional format: colour the "last night" banner by whether Tylenol was taken.
  var banner = sh.getRange("B7");
  var took = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains("TOOK").setBackground("#1e88e5").setFontColor("#ffffff").setRanges([banner]).build();
  var noTook = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains("No Tylenol").setBackground("#eceff1").setRanges([banner]).build();
  sh.setConditionalFormatRules([took, noTook]);
}

// ===========================================================================
// WEBHOOK - receives daily Garmin metrics from sleep_study.py.
// ===========================================================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty("WEBHOOK_TOKEN");
    if (!token || body.token !== token) {
      return jsonOut_({ error: "unauthorized" });
    }
    var n = upsertRows_(body.rows || []);
    return jsonOut_({ ok: true, updated: n });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function upsertRows_(rows) {
  if (!rows.length) return 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GARMIN_SHEET);
    var nCols = GARMIN_COLS.length;
    var last = sh.getLastRow();

    // Map existing date-key -> row number.
    var index = {};
    var appendRow = Math.max(last, 1); // last used row (1 = header only)
    if (last >= 2) {
      var dates = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < dates.length; i++) {
        var key = dateKey_(dates[i][0]);
        if (key) index[key] = i + 2;
      }
    }

    var updated = 0;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var key = row.date;
      var values = GARMIN_COLS.map(function (c) {
        if (c[0] === "date") return parseDate_(row.date);
        var v = row[c[0]];
        return (v === undefined || v === null) ? "" : v;
      });
      var target = index[key];
      if (!target) {
        appendRow += 1;
        target = appendRow;
        index[key] = target;
      }
      sh.getRange(target, 1, 1, nCols).setValues([values]);
      sh.getRange(target, 1).setNumberFormat("ddd  mmm d");
      updated++;
    }
    return updated;
  } finally {
    lock.releaseLock();
  }
}

// "YYYY-MM-DD" string -> Date; used so the Date column holds real dates.
function parseDate_(s) {
  var p = String(s).split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

// Normalize a cell (Date or string) to a "YYYY-MM-DD" key for matching.
function dateKey_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return v ? String(v) : "";
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Clear (or create) a sheet by name and return it.
function resetSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) {
    sh.clear();
    sh.getCharts().forEach(function (c) { sh.removeChart(c); });
    sh.clearConditionalFormatRules();
  } else {
    sh = ss.insertSheet(name);
  }
  return sh;
}
