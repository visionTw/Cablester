import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const auditScript = fileURLToPath(new URL("../scripts/audit-game-assets.py", import.meta.url));

test("all registered game assets pass reproducible decode and pixel QA", { timeout: 30_000 }, () => {
  const result = spawnSync(process.env.PYTHON || "python3", [auditScript, "--format", "json"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `asset audit failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  const report = JSON.parse(result.stdout);

  assert.equal(report.status, "pass");
  assert.equal(report.summary.assetCount, 25);
  assert.equal(report.summary.expectedFileCount, 50);
  assert.equal(report.summary.auditedFileCount, 50);
  assert.equal(report.summary.passedAssets, 25);
  assert.equal(report.summary.failedAssets, 0);
  assert.equal(report.summary.errorCount, 0);
  assert.deepEqual(report.globalErrors, []);
  assert.deepEqual(report.unregisteredFiles, []);
  assert.deepEqual(report.missingRegisteredFiles, []);

  assert.equal(new Set(report.assets.map((asset) => asset.id)).size, 25);
  for (const asset of report.assets) {
    assert.equal(asset.status, "pass", `${asset.id}: ${JSON.stringify(asset.errors)}`);
    assert.equal(asset.main.format, "WEBP");
    assert.equal(asset.main.mode, "RGBA");
    assert.equal(asset.main.width, asset.metadata.width);
    assert.equal(asset.main.height, asset.metadata.height);
    assert.equal(asset.main.fileSizeBytes, asset.metadata.fileSizeBytes);
    assert.ok(asset.main.alpha.zeroPixels > 0, `${asset.id} main transparency`);
    assert.ok(asset.main.alpha.meaningfulPixels > 0, `${asset.id} main visible pixels`);
    assert.equal(asset.main.chroma.exactVisiblePixels, 0, `${asset.id} exact chroma residue`);
    assert.equal(asset.main.chroma.nearMeaningfulPixels, 0, `${asset.id} near chroma residue`);

    assert.equal(asset.thumbnail.format, "WEBP");
    assert.equal(asset.thumbnail.mode, "RGBA");
    assert.ok(asset.thumbnail.width <= report.thresholds.maxThumbnailWidth);
    assert.ok(asset.thumbnail.height <= report.thresholds.maxThumbnailHeight);
    assert.equal(asset.thumbnail.chroma.exactVisiblePixels, 0, `${asset.id} thumbnail exact chroma residue`);
    assert.equal(asset.thumbnail.chroma.nearMeaningfulPixels, 0, `${asset.id} thumbnail near chroma residue`);
    assert.ok(asset.thumbnailSimilarity.alphaMae <= report.thresholds.maxThumbnailAlphaMae);
    assert.ok(asset.thumbnailSimilarity.blackCompositeRgbMae <= report.thresholds.maxThumbnailCompositeRgbMae);
    assert.ok(asset.thumbnailSimilarity.whiteCompositeRgbMae <= report.thresholds.maxThumbnailCompositeRgbMae);
  }
});
