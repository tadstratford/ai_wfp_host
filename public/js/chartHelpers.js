/**
 * chartHelpers.js
 *
 * Standard pattern for Chart.js charts in this application:
 *
 *   1. Server renders a <canvas id="[chart-id]"> target.
 *   2. Server embeds chart data in <script type="application/json" id="[chart-id]-data">.
 *   3. This file reads that data tag and initializes the chart.
 *   4. Click events call htmx.ajax() to load drill-down content server-side.
 *
 * To add a new chart, follow the same pattern:
 *   - Add an initXxxChart() function below.
 *   - Call it from both event listeners at the bottom.
 */

// Register the datalabels plugin globally so all charts get counts on segments.
// Only runs once Chart.js is available (loaded before this script in layout).
if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
    Chart.register(ChartDataLabels);
}

// ---------------------------------------------------------------------------
// Department Status Chart
// ---------------------------------------------------------------------------

function initDeptStatusChart() {
    var dataEl = document.getElementById("dept-status-data");
    var canvasEl = document.getElementById("dept-status-chart");
    if (!dataEl || !canvasEl) return;

    // Destroy any existing instance before re-initializing (HTMX swap safe)
    var existing = Chart.getChart(canvasEl);
    if (existing) existing.destroy();

    var chartData = JSON.parse(dataEl.textContent || "{}");

    new Chart(canvasEl, {
        type: "bar",
        data: chartData,
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: "top",
                },
                tooltip: {
                    mode: "index",
                    intersect: false,
                },
                datalabels: {
                    // Only show a label when the segment has a non-zero value
                    display: function (context) {
                        return context.dataset.data[context.dataIndex] > 0;
                    },
                    color: "#ffffff",
                    font: { weight: "bold", size: 11 },
                    anchor: "center",
                    align: "center",
                    formatter: function (value) {
                        return value;
                    },
                },
            },
            scales: {
                x: { stacked: true },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { precision: 0 },
                },
            },
            onClick: function (event, elements) {
                if (!elements || elements.length === 0) return;
                var el = elements[0];
                var dept = chartData.labels[el.index];
                var status = chartData.datasets[el.datasetIndex].label;
                var params = new URLSearchParams({ department: dept, status: status });
                htmx.ajax(
                    "GET",
                    "/workflow-mgmt/reports/dept-status-drilldown?" + params.toString(),
                    { target: "#dept-status-drilldown", swap: "innerHTML" }
                );
                // Scroll drilldown into view
                var drilldown = document.getElementById("dept-status-drilldown");
                if (drilldown) {
                    setTimeout(function () {
                        drilldown.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 150);
                }
            },
        },
    });
}

// ---------------------------------------------------------------------------
// Report Builder Chart
// ---------------------------------------------------------------------------

function initReportBuilderChart() {
    var dataEl = document.getElementById("report-builder-chart-data");
    var canvasEl = document.getElementById("report-builder-chart");
    if (!dataEl || !canvasEl) return;

    // Destroy any existing instance before re-initializing (HTMX swap safe)
    var existing = Chart.getChart(canvasEl);
    if (existing) existing.destroy();

    var chartData = JSON.parse(dataEl.textContent || "{}");
    var isStacked = dataEl.getAttribute("data-stacked") === "true";

    new Chart(canvasEl, {
        type: "bar",
        data: chartData,
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: "top",
                },
                tooltip: {
                    mode: "index",
                    intersect: false,
                },
                datalabels: {
                    display: function (context) {
                        return context.dataset.data[context.dataIndex] > 0;
                    },
                    color: "#ffffff",
                    font: { weight: "bold", size: 11 },
                    anchor: "center",
                    align: "center",
                    formatter: function (value) {
                        return typeof value === "number" ? value.toLocaleString() : value;
                    },
                },
            },
            scales: {
                x: { stacked: isStacked },
                y: {
                    stacked: isStacked,
                    beginAtZero: true,
                    ticks: { precision: 0 },
                },
            },
        },
    });
}

// ---------------------------------------------------------------------------
// Boot: run on initial load and after every HTMX content swap
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", function () {
    initDeptStatusChart();
    initReportBuilderChart();
});

document.addEventListener("htmx:afterSettle", function () {
    initDeptStatusChart();
    initReportBuilderChart();
});
