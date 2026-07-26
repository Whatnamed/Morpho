import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const projectRoot = process.cwd();
const reportPath = resolve(projectRoot, "docs/operations/storage-footprint.generated.json");
const server = await createServer({
  appType: "custom",
  configFile: resolve(projectRoot, "vitest.config.ts"),
  server: { middlewareMode: true }
});

function formatBytes(value) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function padStart(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${" ".repeat(width - text.length)}${text}`;
}

try {
  const footprintModule = await server.ssrLoadModule("/src/infrastructure/persistence/storageFootprint.ts");
  const scenarioModule = await server.ssrLoadModule("/src/features/workspace/storageFootprintScenarios.ts");

  const scenarios = scenarioModule.buildFootprintScenarios();
  const measured = new Map();
  const report = { scenarios: [] };

  for (const scenario of scenarios) {
    const footprint = footprintModule.measureWorkspaceFootprint(scenario.workspace);
    measured.set(scenario.key, footprint);

    console.log("");
    console.log(`## ${scenario.label}  [${scenario.key}]`);
    console.log(
      `   UTF-16 ${footprint.utf16Length.toLocaleString("en-US")} 字符 · ` +
        `UTF-8 ${formatBytes(footprint.utf8Bytes)} · ` +
        `localStorage 配额占用 ${formatBytes(footprint.quotaBytes)}`
    );

    const topSegments = footprint.segments
      .filter((segment) => segment.utf16Length > 0)
      .sort((a, b) => b.utf16Length - a.utf16Length)
      .slice(0, 8);
    for (const segment of topSegments) {
      console.log(
        `     ${pad(segment.path, 42)} ${padStart(formatBytes(segment.utf16Length * 2), 11)}  ` +
          `${padStart(`${(segment.share * 100).toFixed(1)}%`, 6)}` +
          (segment.count === undefined ? "" : `  n=${segment.count}`)
      );
    }

    const hotFields = footprint.hotFields.filter((segment) => segment.utf16Length > 2);
    if (hotFields.length > 0) {
      console.log("     -- 其中（与上面重叠，不参与求和）--");
      for (const segment of hotFields.sort((a, b) => b.utf16Length - a.utf16Length)) {
        console.log(
          `     ${pad(segment.path, 42)} ${padStart(formatBytes(segment.utf16Length * 2), 11)}  ` +
            `${padStart(`${(segment.share * 100).toFixed(1)}%`, 6)}  n=${segment.count}`
        );
      }
    }

    const scenarioReport = {
      key: scenario.key,
      label: scenario.label,
      utf16Length: footprint.utf16Length,
      utf8Bytes: footprint.utf8Bytes,
      quotaBytes: footprint.quotaBytes,
      structuralOverheadUtf16: footprint.structuralOverheadUtf16,
      segments: footprint.segments.filter((segment) => segment.utf16Length > 2),
      hotFields: footprint.hotFields.filter((segment) => segment.utf16Length > 2)
    };

    if (scenario.growth) {
      const baseline = measured.get(scenario.growth.baselineKey);
      if (!baseline) {
        throw new Error(`Scenario ${scenario.key} references unknown baseline ${scenario.growth.baselineKey}.`);
      }
      const deltas = footprintModule.diffFootprints(baseline, footprint, scenario.growth.units);
      const perUnitQuota = ((footprint.quotaBytes - baseline.quotaBytes) / scenario.growth.units);
      console.log(
        `     增长：相对 ${scenario.growth.baselineKey}，每${scenario.growth.unitLabel.replace(/^\d+\s*/, "")} ` +
          `${formatBytes(Math.round(perUnitQuota))} 配额`
      );
      for (const delta of deltas.slice(0, 5)) {
        console.log(
          `       ${pad(delta.path, 40)} ${padStart(formatBytes(Math.round(delta.utf16PerUnit * 2)), 11)} / 单位`
        );
      }
      scenarioReport.growth = {
        baselineKey: scenario.growth.baselineKey,
        units: scenario.growth.units,
        unitLabel: scenario.growth.unitLabel,
        quotaBytesPerUnit: Math.round(perUnitQuota),
        topDeltas: deltas.slice(0, 8).map((delta) => ({
          path: delta.path,
          utf16Delta: delta.utf16Delta,
          quotaBytesPerUnit: Math.round(delta.utf16PerUnit * 2)
        }))
      };
    }

    report.scenarios.push(scenarioReport);
  }

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`报告已写入 ${reportPath}`);
} finally {
  await server.close();
}
