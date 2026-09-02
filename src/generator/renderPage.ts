import type { EnrichedIncident, GeneratedSiteData, ServiceSummary } from "../types.js";
import { escapeHtml, renderPostmortem } from "./templates/escape.js";
import { formatDuration, formatPercent, formatTimestamp, statusLabel } from "./format.js";

function bannerMessage(status: string, siteName: string): string {
  switch (status) {
    case "up":
      return "All systems operational";
    case "degraded":
      return "Some systems experiencing degraded performance";
    case "down":
      return "Some systems are down";
    default:
      return `No check results yet for ${siteName}`;
  }
}

function renderUptimeBars(service: ServiceSummary): string {
  const bars = service.days
    .map((day) => {
      const title = `${day.date}: ${statusLabel(day.status)}${
        day.uptimeRatio !== null
          ? ` (${formatPercent(day.uptimeRatio)} uptime, ${day.totalChecks} checks)`
          : " (no data)"
      }`;
      return `<div class="bar status-${day.status}" title="${escapeHtml(title)}"></div>`;
    })
    .join("");
  const first = service.days[0]?.date ?? "";
  const last = service.days.at(-1)?.date ?? "";
  return `
    <div class="uptime-row" role="img" aria-label="Uptime history for ${escapeHtml(service.name)}">${bars}</div>
    <div class="uptime-meta"><span>${escapeHtml(first)}</span><span>${escapeHtml(last)}</span></div>
  `;
}

function renderService(service: ServiceSummary): string {
  return `
    <div class="service">
      <div class="service-head">
        <div>
          <span class="service-name">${escapeHtml(service.name)}</span>${
            service.group ? `<span class="service-group">${escapeHtml(service.group)}</span>` : ""
          }
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="uptime-pct">${formatPercent(service.windowUptimeRatio)}</span>
          <span class="badge status-${service.currentStatus}">${statusLabel(service.currentStatus)}</span>
        </div>
      </div>
      ${renderUptimeBars(service)}
    </div>
  `;
}

function renderIncident(incident: EnrichedIncident): string {
  const updatesHtml = incident.updates
    .map(
      (u) => `
      <li>
        <span class="tl-time">${formatTimestamp(u.timestamp)}</span>
        <span class="tl-state">${escapeHtml(u.state)}</span>${escapeHtml(u.message)}
      </li>`,
    )
    .join("");

  const postmortemHtml = incident.postmortem
    ? `<div class="postmortem"><h3>Postmortem</h3>${renderPostmortem(incident.postmortem)}</div>`
    : "";

  return `
    <div class="incident">
      <div class="incident-head">
        <span class="incident-title">${escapeHtml(incident.title)}</span>
        <span class="severity severity-${incident.severity}">${incident.severity}</span>
      </div>
      <div class="incident-meta">
        ${incident.resolvedAt ? "Resolved" : "Ongoing"} · started ${formatTimestamp(incident.startedAt)} ·
        duration ${formatDuration(incident.startedAt, incident.resolvedAt)} ·
        ${incident.affectedResultCount} affected check${incident.affectedResultCount === 1 ? "" : "s"}
      </div>
      <ul class="timeline">${updatesHtml}</ul>
      ${postmortemHtml}
    </div>
  `;
}

export function renderPage(data: GeneratedSiteData): string {
  const servicesHtml = data.services.length
    ? data.services.map(renderService).join("")
    : `<div class="empty">No checks configured yet.</div>`;

  const incidentsHtml = data.incidents.length
    ? data.incidents.map(renderIncident).join("")
    : `<div class="empty">No incidents recorded. This history is derived entirely from check results — nothing to show means nothing went wrong.</div>`;

  const siteName = escapeHtml(data.site.name);
  const description = data.site.description ? escapeHtml(data.site.description) : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${siteName} Status</title>
<meta name="description" content="${description || `${siteName} status page`}" />
<link rel="stylesheet" href="./assets/style.css" />
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div class="brand">
      <span class="brand-mark">${escapeHtml(data.site.logoText ?? data.site.name)}</span>
      ${description ? `<span class="brand-desc">${description}</span>` : ""}
    </div>
    <button id="theme-toggle" class="theme-toggle" aria-label="Toggle color theme">🌓 Theme</button>
  </div>

  <div class="banner status-${data.overallStatus}">
    <span class="dot status-${data.overallStatus}"></span>
    <span>${escapeHtml(bannerMessage(data.overallStatus, data.site.name))}</span>
  </div>

  <section>
    <h2>Services</h2>
    <div class="card">${servicesHtml}</div>
  </section>

  <section>
    <h2>Incident history (last ${data.uptimeWindowDays} days)</h2>
    <div class="card">${incidentsHtml}</div>
  </section>

  <footer>
    <span>Generated ${formatTimestamp(data.generatedAt)}</span>
    <span>Built with statuscraft — every status above is derived from real check results, never hand-edited.</span>
  </footer>
</div>
<script src="./assets/theme.js"></script>
</body>
</html>
`;
}
