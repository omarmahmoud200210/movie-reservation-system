#!/usr/bin/env node
/**
 * Artillery JSON → HTML Report Generator
 * Usage: node generate-report.js <input.json> [output.html]
 */

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node generate-report.js <input.json> [output.html]');
  process.exit(1);
}

const outputFile = process.argv[3] || inputFile.replace(/\.json$/, '.html');
const raw = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// Extract intermediate (per-period) stats
const intermediates = raw.intermediate || [];
const aggregate = raw.aggregate || {};

// Build timeline data
const timestamps = intermediates.map(function (i) {
  return new Date(i.period).toLocaleTimeString();
});

const p50 = intermediates.map(function (i) {
  var s = i.summaries && i.summaries['http.response_time'];
  return s ? (s.median || 0) : 0;
});
const p95 = intermediates.map(function (i) {
  var s = i.summaries && i.summaries['http.response_time'];
  return s ? (s.p95 || 0) : 0;
});
const p99 = intermediates.map(function (i) {
  var s = i.summaries && i.summaries['http.response_time'];
  return s ? (s.p99 || 0) : 0;
});
const rps = intermediates.map(function (i) {
  var r = i.rates && i.rates['http.request_rate'];
  return r || 0;
});
const errors = intermediates.map(function (i) {
  var counters = i.counters || {};
  var sum = 0;
  Object.keys(counters).forEach(function (k) {
    if (k.startsWith('http.codes.') && !k.startsWith('http.codes.2')) {
      sum += counters[k];
    }
  });
  return sum;
});
const successCodes = intermediates.map(function (i) {
  var counters = i.counters || {};
  var sum = 0;
  Object.keys(counters).forEach(function (k) {
    if (k.startsWith('http.codes.2')) {
      sum += counters[k];
    }
  });
  return sum;
});

// Aggregate summary
var agg = (aggregate.summaries && aggregate.summaries['http.response_time']) || {};
var aggCounters = aggregate.counters || {};

var totalRequests = aggCounters['http.requests'] || 0;
var totalResponses = aggCounters['http.responses'] || 0;
var total2xx = 0;
var totalErrors = 0;
Object.keys(aggCounters).forEach(function (k) {
  if (k.startsWith('http.codes.2')) total2xx += aggCounters[k];
  if (k.startsWith('http.codes.') && !k.startsWith('http.codes.2')) totalErrors += aggCounters[k];
});
var errorRate = totalResponses > 0 ? ((totalErrors / totalResponses) * 100).toFixed(2) : '0.00';

// Status code breakdown
var statusCodes = [];
Object.keys(aggCounters).forEach(function (k) {
  if (k.startsWith('http.codes.')) {
    statusCodes.push({ code: k.replace('http.codes.', ''), count: aggCounters[k] });
  }
});
statusCodes.sort(function (a, b) { return a.code.localeCompare(b.code); });

// Build status table rows
var statusRows = statusCodes.map(function (s) {
  var cls = s.code.startsWith('2') ? 'status-2xx' : s.code.startsWith('4') ? 'status-4xx' : 'status-5xx';
  var share = totalResponses > 0 ? ((s.count / totalResponses) * 100).toFixed(1) : '0';
  return '<tr><td><span class="status-badge ' + cls + '">' + s.code + '</span></td>' +
    '<td>' + s.count.toLocaleString() + '</td>' +
    '<td>' + share + '%</td></tr>';
}).join('\n');

var errorClass = parseFloat(errorRate) > 1 ? 'bad' : 'good';

var html = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '  <title>Artillery Load Test Report</title>',
  '  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>',
  '  <style>',
  '    * { margin: 0; padding: 0; box-sizing: border-box; }',
  '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }',
  '    h1 { font-size: 1.8rem; margin-bottom: 8px; color: #f8fafc; }',
  '    .subtitle { color: #94a3b8; margin-bottom: 32px; font-size: 0.9rem; }',
  '    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }',
  '    .card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }',
  '    .card .label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }',
  '    .card .value { font-size: 1.8rem; font-weight: 700; margin-top: 4px; }',
  '    .card .unit { font-size: 0.8rem; color: #64748b; }',
  '    .good { color: #4ade80; }',
  '    .warn { color: #fbbf24; }',
  '    .bad { color: #f87171; }',
  '    .chart-container { background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155; margin-bottom: 24px; }',
  '    .chart-container h2 { font-size: 1.1rem; margin-bottom: 16px; color: #f1f5f9; }',
  '    canvas { width: 100% !important; }',
  '    table { width: 100%; border-collapse: collapse; margin-top: 8px; }',
  '    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #334155; }',
  '    th { color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; }',
  '    td { color: #e2e8f0; }',
  '    .status-badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; }',
  '    .status-2xx { background: #166534; color: #4ade80; }',
  '    .status-4xx { background: #713f12; color: #fbbf24; }',
  '    .status-5xx { background: #7f1d1d; color: #f87171; }',
  '  </style>',
  '</head>',
  '<body>',
  '  <h1>&#128202; Artillery Load Test Report</h1>',
  '  <p class="subtitle">Generated at ' + new Date().toLocaleString() + ' &mdash; ' + intermediates.length + ' sample periods</p>',
  '',
  '  <div class="cards">',
  '    <div class="card"><div class="label">Total Requests</div><div class="value">' + totalRequests.toLocaleString() + '</div></div>',
  '    <div class="card"><div class="label">Median (p50)</div><div class="value good">' + (agg.median != null ? agg.median : '-') + '<span class="unit"> ms</span></div></div>',
  '    <div class="card"><div class="label">p95</div><div class="value warn">' + (agg.p95 != null ? agg.p95 : '-') + '<span class="unit"> ms</span></div></div>',
  '    <div class="card"><div class="label">p99</div><div class="value warn">' + (agg.p99 != null ? agg.p99 : '-') + '<span class="unit"> ms</span></div></div>',
  '    <div class="card"><div class="label">Max</div><div class="value bad">' + (agg.max != null ? agg.max : '-') + '<span class="unit"> ms</span></div></div>',
  '    <div class="card"><div class="label">Error Rate</div><div class="value ' + errorClass + '">' + errorRate + '<span class="unit"> %</span></div></div>',
  '  </div>',
  '',
  '  <div class="chart-container">',
  '    <h2>Response Time Over Time</h2>',
  '    <canvas id="latencyChart"></canvas>',
  '  </div>',
  '',
  '  <div class="chart-container">',
  '    <h2>Throughput &amp; Errors</h2>',
  '    <canvas id="rpsChart"></canvas>',
  '  </div>',
  '',
  '  <div class="chart-container">',
  '    <h2>HTTP Status Code Breakdown</h2>',
  '    <table>',
  '      <thead><tr><th>Status</th><th>Count</th><th>Share</th></tr></thead>',
  '      <tbody>' + statusRows + '</tbody>',
  '    </table>',
  '  </div>',
  '',
  '  <script>',
  '    var chartDefaults = {',
  '      responsive: true,',
  '      interaction: { mode: "index", intersect: false },',
  '      scales: {',
  '        x: { ticks: { color: "#64748b" }, grid: { color: "#1e293b" } },',
  '        y: { ticks: { color: "#64748b" }, grid: { color: "#334155" } }',
  '      },',
  '      plugins: { legend: { labels: { color: "#94a3b8" } } }',
  '    };',
  '',
  '    new Chart(document.getElementById("latencyChart"), {',
  '      type: "line",',
  '      data: {',
  '        labels: ' + JSON.stringify(timestamps) + ',',
  '        datasets: [',
  '          { label: "p50", data: ' + JSON.stringify(p50) + ', borderColor: "#4ade80", borderWidth: 2, fill: false, tension: 0.3 },',
  '          { label: "p95", data: ' + JSON.stringify(p95) + ', borderColor: "#fbbf24", borderWidth: 2, fill: false, tension: 0.3 },',
  '          { label: "p99", data: ' + JSON.stringify(p99) + ', borderColor: "#f87171", borderWidth: 2, fill: false, tension: 0.3 }',
  '        ]',
  '      },',
  '      options: Object.assign({}, chartDefaults, { scales: { x: chartDefaults.scales.x, y: Object.assign({}, chartDefaults.scales.y, { title: { display: true, text: "ms", color: "#94a3b8" } }) } })',
  '    });',
  '',
  '    new Chart(document.getElementById("rpsChart"), {',
  '      type: "bar",',
  '      data: {',
  '        labels: ' + JSON.stringify(timestamps) + ',',
  '        datasets: [',
  '          { label: "Successful (2xx)", data: ' + JSON.stringify(successCodes) + ', backgroundColor: "#166534", borderRadius: 4 },',
  '          { label: "Errors", data: ' + JSON.stringify(errors) + ', backgroundColor: "#7f1d1d", borderRadius: 4 }',
  '        ]',
  '      },',
  '      options: Object.assign({}, chartDefaults, { scales: { x: Object.assign({}, chartDefaults.scales.x, { stacked: true }), y: Object.assign({}, chartDefaults.scales.y, { stacked: true, title: { display: true, text: "requests", color: "#94a3b8" } }) } })',
  '    });',
  '  <\/script>',
  '</body>',
  '</html>'
].join('\n');

fs.writeFileSync(outputFile, html, 'utf8');
console.log('Report saved to ' + outputFile);
