/**
 * V2 dashboard upgrade - paste this BELOW your existing script, save, then run
 * `upgradeToV2` once. It rebuilds only the Dashboard + Calc tabs (adds Body
 * Battery, a carryover panel, extra sleep tiles, a study-design header, and a
 * cleaner layout). Your Log and Garmin data are left untouched.
 */
function upgradeToV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  buildCalcV2_(ss);
  buildDashboardV2_(ss);
  ss.setActiveSheet(ss.getSheetByName(DASH_SHEET));
  try {
    SpreadsheetApp.getUi().alert(
      "Dashboard upgraded to v2: Body Battery, carryover panel, extra sleep tiles, " +
      "study-design header. Your Log and Garmin data were not touched."
    );
  } catch (e) {}
}

function buildCalcV2_(ss) {
  var sh = resetSheet_(ss, CALC_SHEET);
  var headers = ["Date", "Took", "Rested", "SleepScore", "ScoreIfTake", "ScoreIfSkip",
                 "RestedIfTake", "RestedIfSkip", "BodyBatt", "TookPrev",
                 "ScoreSkipAfterTake", "ScoreSkipAfterSkip"];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");

  sh.getRange("A2").setFormula("=ARRAYFORMULA(IF(Garmin!A2:A=\"\",\"\",Garmin!A2:A))");
  // Garmin dates sleep by wake morning; the pill was taken the evening before (D-1).
  sh.getRange("B2").setFormula(
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IFERROR(VLOOKUP(A2:A-1,Log!A:C,3,FALSE),\"\")))");
  sh.getRange("C2").setFormula(
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IFERROR(VLOOKUP(A2:A-1,Log!A:F,6,FALSE),\"\")))");
  sh.getRange("D2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",Garmin!B2:B))");
  sh.getRange("E2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(B2:B=\"Y\",D2:D,\"\")))");
  sh.getRange("F2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(B2:B=\"N\",D2:D,\"\")))");
  sh.getRange("G2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(B2:B=\"Y\",C2:C,\"\")))");
  sh.getRange("H2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF(B2:B=\"N\",C2:C,\"\")))");
  // Body Battery morning peak (Garmin col T = "Body Batt high").
  sh.getRange("I2").setFormula("=ARRAYFORMULA(IF(A2:A=\"\",\"\",Garmin!T2:T))");
  // Whether Tylenol was taken the night BEFORE this sleep's pill-night (D-2).
  sh.getRange("J2").setFormula(
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IFERROR(VLOOKUP(A2:A-2,Log!A:C,3,FALSE),\"\")))");
  // Carryover: sleep score on NO-pill nights, split by whether you took it the night before.
  sh.getRange("K2").setFormula(
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF((B2:B=\"N\")*(J2:J=\"Y\"),D2:D,\"\")))");
  sh.getRange("L2").setFormula(
    "=ARRAYFORMULA(IF(A2:A=\"\",\"\",IF((B2:B=\"N\")*(J2:J=\"N\"),D2:D,\"\")))");
  sh.getRange("A2:A").setNumberFormat("ddd  mmm d");
  sh.hideSheet();
}

function buildDashboardV2_(ss) {
  var sh = resetSheet_(ss, DASH_SHEET);
  sh.setHiddenGridlines(true);

  // --- Title + study design ---
  sh.getRange("B2").setValue("Tylenol Sleep Study").setFontSize(20).setFontWeight("bold");
  sh.getRange("B3").setValue("Does acetaminophen actually improve my sleep? A randomized self-test.")
    .setFontColor("#607d8b");
  sh.getRange("B4").setFormula(
    "=\"Randomized: \"&COUNTIF(Log!B:B,\"TAKE\")&\" Tylenol nights vs \"&COUNTIF(Log!B:B,\"SKIP\")" +
    "&\" no-Tylenol nights, Jul 20 - Oct 2 2026. Follow the schedule regardless of how you feel.\"")
    .setFontColor("#90a4ae").setFontStyle("italic");

  // --- "Last night" card ---
  sh.getRange("B6").setValue("LAST NIGHT").setFontWeight("bold").setFontColor("#607d8b");
  sh.getRange("B7").setFormula("=IF(COUNT(Garmin!A2:A)=0,\"(no data yet)\",MAX(Garmin!A2:A))")
    .setNumberFormat("dddd, mmm d").setFontSize(14).setFontWeight("bold");

  sh.getRange("B8:F8").merge();
  sh.getRange("B8").setFormula(
    "=IFERROR(IF(VLOOKUP(B7-1,Log!A:C,3,FALSE)=\"Y\",\"🔵  TOOK TYLENOL LAST NIGHT\"," +
    "IF(VLOOKUP(B7-1,Log!A:C,3,FALSE)=\"N\",\"○  No Tylenol last night\"," +
    "\"—  (log last night in the Log tab)\")),\"—  (log last night in the Log tab)\")")
    .setFontSize(16).setFontWeight("bold").setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sh.setRowHeight(8, 40);

  // --- Metric tiles for last night ---
  var tiles = [
    ["Sleep score", "=IFERROR(VLOOKUP(B7,Garmin!A:B,2,FALSE),\"-\")"],
    ["Total sleep", "=IFERROR(TEXT(INT(VLOOKUP(B7,Garmin!A:C,3,FALSE)/60),\"0\")&\"h \"&TEXT(MOD(VLOOKUP(B7,Garmin!A:C,3,FALSE),60),\"0\")&\"m\",\"-\")"],
    ["How rested (1-5)", "=IFERROR(VLOOKUP(B7-1,Log!A:F,6,FALSE),\"-\")"],
    ["Morning energy (Body Batt)", "=IFERROR(VLOOKUP(B7,Garmin!A:T,20,FALSE),\"-\")"],
    ["Deep + REM", "=IFERROR((VLOOKUP(B7,Garmin!A:D,4,FALSE)+VLOOKUP(B7,Garmin!A:F,6,FALSE))&\" min\",\"-\")"],
    ["Awakenings", "=IFERROR(VLOOKUP(B7,Garmin!A:H,8,FALSE),\"-\")"],
    ["HRV (ms)", "=IFERROR(VLOOKUP(B7,Garmin!A:M,13,FALSE),\"-\")"],
    ["Resting HR", "=IFERROR(VLOOKUP(B7,Garmin!A:O,15,FALSE),\"-\")"],
    ["Nap", "=IFERROR(IF(VLOOKUP(B7,Garmin!A:I,9,FALSE)>0,VLOOKUP(B7,Garmin!A:I,9,FALSE)&\" min\",\"none\"),\"-\")"],
    ["Blood pressure", "=IF(IFERROR(VLOOKUP(B7,Garmin!A:W,23,FALSE),\"\")=\"\",\"none logged\",VLOOKUP(B7,Garmin!A:W,23,FALSE)&\"/\"&VLOOKUP(B7,Garmin!A:X,24,FALSE))"]
  ];
  var startRow = 10;
  for (var i = 0; i < tiles.length; i++) {
    var r = startRow + i;
    sh.getRange(r, 2).setValue(tiles[i][0]).setFontColor("#607d8b");
    sh.getRange(r, 3).setFormula(tiles[i][1]).setFontWeight("bold").setFontSize(12);
  }

  // --- Take vs Skip comparison (drives the hero chart) ---
  sh.getRange("B22").setValue("DOES IT HELP?  Tylenol vs no-Tylenol nights (higher = better)")
    .setFontWeight("bold").setFontColor("#607d8b");
  sh.getRange("B23:E23").setValues([["", "Sleep score", "Body Battery", "How rested"]])
    .setFontWeight("bold");
  sh.getRange("B24").setValue("Tylenol nights");
  sh.getRange("B25").setValue("No-Tylenol nights");
  sh.getRange("C24").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"Y\",Calc!D:D),1),\"-\")");
  sh.getRange("C25").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"N\",Calc!D:D),1),\"-\")");
  sh.getRange("D24").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"Y\",Calc!I:I),1),\"-\")");
  sh.getRange("D25").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"N\",Calc!I:I),1),\"-\")");
  sh.getRange("E24").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"Y\",Calc!C:C),1),\"-\")");
  sh.getRange("E25").setFormula("=IFERROR(ROUND(AVERAGEIF(Calc!B:B,\"N\",Calc!C:C),1),\"-\")");

  sh.getRange("B27").setValue("Nights measured").setFontColor("#607d8b");
  sh.getRange("C27").setFormula(
    "=\"Tylenol: \"&COUNTIFS(Calc!B:B,\"Y\",Calc!D:D,\">0\")&\"   |   No-Tylenol: \"&COUNTIFS(Calc!B:B,\"N\",Calc!D:D,\">0\")");
  sh.getRange("B28").setValue("Sleep-score difference").setFontColor("#607d8b");
  sh.getRange("C28").setFormula(
    "=IFERROR(IF(C24>C25,\"+\",\"\")&ROUND(C24-C25,1)&\" points on Tylenol nights\",\"(collecting data)\")")
    .setFontWeight("bold");
  sh.getRange("B29").setValue("Body-Battery difference").setFontColor("#607d8b");
  sh.getRange("C29").setFormula(
    "=IFERROR(IF(D24>D25,\"+\",\"\")&ROUND(D24-D25,1)&\" Body Battery on Tylenol nights\",\"(collecting data)\")")
    .setFontWeight("bold");

  // --- Carryover / delayed-effect panel (exploratory) ---
  sh.getRange("B31").setValue("CARRYOVER (early / exploratory)")
    .setFontWeight("bold").setFontColor("#607d8b");
  sh.getRange("B32").setValue("On no-Tylenol nights, does taking it the night before still help your sleep score?")
    .setFontColor("#90a4ae").setFontStyle("italic");
  sh.getRange("B33").setValue("...the night after a Tylenol night");
  sh.getRange("C33").setFormula("=IFERROR(ROUND(AVERAGE(Calc!K2:K),1),\"-\")").setFontWeight("bold");
  sh.getRange("B34").setValue("...the night after a no-Tylenol night");
  sh.getRange("C34").setFormula("=IFERROR(ROUND(AVERAGE(Calc!L2:L),1),\"-\")").setFontWeight("bold");
  sh.getRange("B35").setValue("Nights measured").setFontColor("#607d8b");
  sh.getRange("C35").setFormula(
    "=\"after Tylenol: \"&COUNT(Calc!K2:K)&\"   |   after none: \"&COUNT(Calc!L2:L)");

  // --- Charts (placed to the right, cols G+) ---
  var barChart = sh.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange("B23:E25"))
    .setNumHeaders(1)
    .setOption("title", "Tylenol vs no-Tylenol: sleep score, Body Battery, restedness")
    .setOption("colors", ["#1e88e5", "#26a69a", "#ffb300"])
    .setOption("series", {
      0: { targetAxisIndex: 0 }, 1: { targetAxisIndex: 0 }, 2: { targetAxisIndex: 1 }
    })
    .setOption("vAxes", { 0: { title: "Score / Body Battery (0-100)" }, 1: { title: "How rested (1-5)" } })
    .setOption("legend", { position: "bottom" })
    .setPosition(6, 7, 0, 0)
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
    .setPosition(25, 7, 0, 0)
    .build();
  sh.insertChart(trendChart);

  sh.setColumnWidth(1, 20);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 150);

  // Colour the banner by whether Tylenol was taken.
  var banner = sh.getRange("B8");
  var took = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains("TOOK").setBackground("#1e88e5").setFontColor("#ffffff").setRanges([banner]).build();
  var noTook = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains("No Tylenol").setBackground("#eceff1").setRanges([banner]).build();
  sh.setConditionalFormatRules([took, noTook]);
}
