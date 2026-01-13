import * as d3 from "d3";
import { registerEscapeHandler } from "./util";

interface CouncillorStats {
  councillor: string;
  slug: string;
  attendance: {
    attendanceRate: number;
    totalMeetings: number;
  };
  voting: {
    participationRate: number;
    yeaRate: number;
    totalVotes: number;
  };
}

interface StatsData {
  councillorStats: Record<string, CouncillorStats>;
}

interface ComparisonChartEvent extends CustomEvent {
  detail: {
    metric: string;
    councillorSlug: string;
  };
}

// Site color scheme
const COLORS = {
  background: "#161618",
  highlight: "#84b9ef",
  bar: "#393639",
  text: "#ebebec",
  textMuted: "#a0a0a0",
};

// Current council members (2022-2026 term)
const CURRENT_COUNCIL = new Set([
  "j-morgan",
  "h-mcalister",
  "s-lewis",
  "p-cuddy",
  "s-stevenson",
  "j-pribil",
  "s-trosow",
  "c-rahman",
  "s-lehman",
  "a-hopkins",
  "p-van-meerbergen",
  "s-franke",
  "e-peloza",
  "d-ferreira",
  "s-hillier",
]);

// Metric display configuration
const METRIC_CONFIG: Record<
  string,
  {
    label: string;
    getValue: (c: CouncillorStats) => number;
    isPercentage: boolean;
  }
> = {
  attendance: {
    label: "Attendance Rate",
    getValue: (c) => c.attendance.attendanceRate,
    isPercentage: true,
  },
  participation: {
    label: "Vote Participation",
    getValue: (c) => c.voting.participationRate,
    isPercentage: true,
  },
  yeaRate: {
    label: "Yea Rate",
    getValue: (c) => c.voting.yeaRate,
    isPercentage: true,
  },
  totalVotes: {
    label: "Total Votes",
    getValue: (c) => c.voting.totalVotes,
    isPercentage: false,
  },
};

let statsData: StatsData | null = null;

async function loadStatsData(): Promise<StatsData | null> {
  if (statsData) return statsData;

  try {
    const response = await fetch("/static/data/stats/councillor-stats.json");
    statsData = await response.json();
    return statsData;
  } catch (e) {
    console.error("Failed to load councillor stats:", e);
    return null;
  }
}

function closeModal(modal: HTMLElement) {
  modal.classList.remove("open");
}

function renderChartWithD3(
  container: HTMLElement,
  councillors: CouncillorStats[],
  metric: string,
  highlightSlug: string,
) {
  const config = METRIC_CONFIG[metric];
  if (!config) return;

  // Sort councillors by metric value (descending)
  const sortedCouncillors = [...councillors].sort(
    (a, b) => config.getValue(b) - config.getValue(a),
  );

  // Chart dimensions
  const margin = { top: 10, right: 60, bottom: 20, left: 130 };
  const barHeight = 24;
  const barGap = 4;
  const chartWidth = Math.min(540, window.innerWidth - 80);
  const chartHeight =
    sortedCouncillors.length * (barHeight + barGap) +
    margin.top +
    margin.bottom;

  // Clear container
  container.innerHTML = "";

  // Create SVG
  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", chartWidth)
    .attr("height", chartHeight)
    .attr("viewBox", `0 0 ${chartWidth} ${chartHeight}`)
    .style("overflow", "visible");

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Scales
  const maxValue = d3.max(sortedCouncillors, (d) => config.getValue(d)) || 100;
  const xScale = d3
    .scaleLinear()
    .domain([0, config.isPercentage ? 100 : maxValue * 1.1])
    .range([0, chartWidth - margin.left - margin.right]);

  // Draw bars with animation
  const barGroups = g
    .selectAll(".bar-group")
    .data(sortedCouncillors)
    .enter()
    .append("g")
    .attr("class", "bar-group")
    .attr("transform", (_, i) => `translate(0, ${i * (barHeight + barGap)})`);

  // Add rank numbers
  barGroups
    .append("text")
    .attr("x", -margin.left + 10)
    .attr("y", barHeight / 2)
    .attr("dominant-baseline", "middle")
    .attr("font-size", "12px")
    .attr("font-weight", "700")
    .attr("fill", (d) =>
      d.slug === highlightSlug ? COLORS.highlight : "#6b7280",
    )
    .text((_, i) => `#${i + 1}`);

  // Add councillor names
  barGroups
    .append("text")
    .attr("x", -8)
    .attr("y", barHeight / 2)
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "middle")
    .attr("font-size", "12px")
    .attr("font-weight", (d) => (d.slug === highlightSlug ? "600" : "400"))
    .attr("fill", (d) => (d.slug === highlightSlug ? "#fff" : "#d1d5db"))
    .text((d) => d.councillor)
    .style("cursor", "pointer")
    .on("click", (_, d) => {
      const path = CURRENT_COUNCIL.has(d.slug)
        ? `/councillors/current/${d.slug}`
        : `/councillors/former/${d.slug}`;
      window.location.href = path;
    });

  // Background bars
  barGroups
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", chartWidth - margin.left - margin.right)
    .attr("height", barHeight)
    .attr("fill", "rgba(255, 255, 255, 0.08)")
    .attr("rx", 4);

  // Foreground bars (animated)
  barGroups
    .append("rect")
    .attr("class", "bar-fill")
    .attr("x", 0)
    .attr("y", 0)
    .attr("height", barHeight)
    .attr("fill", (d) =>
      d.slug === highlightSlug ? COLORS.highlight : COLORS.bar,
    )
    .attr("rx", 4)
    .attr("width", 0) // Start at 0 for animation
    .transition()
    .duration(500)
    .delay((_, i) => i * 25)
    .ease(d3.easeCubicOut)
    .attr("width", (d) => xScale(config.getValue(d)));

  // Value labels (animated)
  barGroups
    .append("text")
    .attr("class", "value-label")
    .attr("x", (d) => xScale(config.getValue(d)) + 8)
    .attr("y", barHeight / 2)
    .attr("dominant-baseline", "middle")
    .attr("font-size", "12px")
    .attr("font-weight", "600")
    .attr("fill", (d) =>
      d.slug === highlightSlug ? COLORS.highlight : "#9ca3af",
    )
    .attr("opacity", 0)
    .text((d) => {
      const value = config.getValue(d);
      return config.isPercentage
        ? `${value.toFixed(1)}%`
        : value.toLocaleString();
    })
    .transition()
    .duration(300)
    .delay((_, i) => i * 25 + 300)
    .attr("opacity", 1);

  // Highlight row background for current councillor
  const highlightIndex = sortedCouncillors.findIndex(
    (c) => c.slug === highlightSlug,
  );
  if (highlightIndex >= 0) {
    g.insert("rect", ":first-child")
      .attr("x", -margin.left + 5)
      .attr("y", highlightIndex * (barHeight + barGap) - 4)
      .attr("width", chartWidth - 10)
      .attr("height", barHeight + 8)
      .attr("fill", "rgba(132, 185, 239, 0.1)")
      .attr("rx", 6);
  }
}

async function openComparisonChart(metric: string, councillorSlug: string) {
  const modal = document.getElementById("comparison-chart-modal");
  if (!modal) return;

  const data = await loadStatsData();
  if (!data) return;

  // Filter to current council members with meaningful data
  const councillors = Object.values(data.councillorStats).filter(
    (c) => CURRENT_COUNCIL.has(c.slug) && c.voting.totalVotes > 50,
  );

  if (councillors.length === 0) return;

  // Set title
  const config = METRIC_CONFIG[metric];
  const title = modal.querySelector(".comparison-modal-title");
  if (title && config) {
    title.textContent = `${config.label} - Current Council`;
  }

  // Open modal
  modal.classList.add("open");

  // Render chart with D3
  const chartContainer = modal.querySelector(
    "#comparison-chart-container",
  ) as HTMLElement;
  if (chartContainer) {
    // Small delay to allow modal animation to start
    requestAnimationFrame(() => {
      renderChartWithD3(chartContainer, councillors, metric, councillorSlug);
    });
  }
}

function setupComparisonChart() {
  const modal = document.getElementById("comparison-chart-modal");
  if (!modal) return;

  const councillorSlug = modal.dataset.councillorSlug;

  // Close button handler
  const closeBtn = modal.querySelector(".comparison-modal-close");
  closeBtn?.addEventListener("click", () => closeModal(modal));

  // Backdrop click handler
  const backdrop = modal.querySelector(".comparison-modal-backdrop");
  backdrop?.addEventListener("click", () => closeModal(modal));

  // Escape key handler
  registerEscapeHandler(modal, () => closeModal(modal));

  // Listen for custom event from Scorecard
  document.addEventListener("openComparisonChart", ((
    event: ComparisonChartEvent,
  ) => {
    const { metric, councillorSlug: eventSlug } = event.detail;
    openComparisonChart(metric, eventSlug || councillorSlug || "");
  }) as EventListener);

  // Make scorecard metrics clickable
  const scorecardMetrics = document.querySelectorAll(".scorecard-metric");
  const metricMap = ["attendance", "participation", "yeaRate", "totalVotes"];

  scorecardMetrics.forEach((metric, index) => {
    if (metricMap[index]) {
      metric.addEventListener("click", () => {
        const customEvent = new CustomEvent("openComparisonChart", {
          detail: {
            metric: metricMap[index],
            councillorSlug: councillorSlug || "",
          },
        });
        document.dispatchEvent(customEvent);
      });
    }
  });
}

document.addEventListener("nav", () => {
  // Reset stats data on navigation to ensure fresh data
  statsData = null;

  setupComparisonChart();
});
