import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readNative = (name: string) =>
  readFileSync(resolve("modules/vroom-carplay/ios", name), "utf8");

describe("CarPlay navigation performance safeguards", () => {
  const coordinator = readNative("VroomCarPlayCoordinator.swift");
  const location = readNative("VroomCarPlayLocationEngine.swift");
  const map = readNative("VroomCarPlayMapViewController.swift");
  const live = readNative("VroomCarPlayLiveClient.swift");
  const models = readNative("VroomCarPlayModels.swift");
  const network = readNative("VroomCarPlayNetwork.swift");

  it("does not enqueue every display-link pose back onto the main queue", () => {
    expect(coordinator).toContain("self?.handle(pose: pose)");
    expect(coordinator).not.toContain(
      "engine.onPose = { [weak self] pose in\n      DispatchQueue.main.async",
    );
  });

  it("keeps GPS interpolation continuous at the prediction boundary", () => {
    expect(location).toContain(
      "Date().timeIntervalSince(location.timestamp) - segmentDuration",
    );
    expect(location).toContain("measuredInterval * 0.9");
    expect(location).toContain("lastProjectionSegmentIndex");
    expect(location).not.toContain(
      "meters: min(35, location.speed * extrapolationSeconds)",
    );
  });

  it("uses a cheap fixed driving marker and cancels route overview", () => {
    expect(map).toContain("private let selfMarkerImageView = UIImageView()");
    expect(map).toContain("mapView.viewport.idle()");
    expect(map).toContain(
      "padding: updatePolicy ? drivingCameraPadding() : nil",
    );
    expect(map).toContain("anchor: nil");
    expect(map).toContain("renderMapSelfMarker(pose, image: image)");
  });

  it("limits and sorts road markers around the vehicle", () => {
    expect(map).toContain("private func nearestMarkers(");
    expect(map).toContain("radiusMeters: navigating ? 15_000 : 30_000");
    expect(map).toContain("limit: navigating ? 18 : 24");
    expect(map).toContain(
      "let routePreviewVisible = previewRoutes != nil && !isActivelyNavigating",
    );
    expect(network).toContain("radius=30");
    expect(models).toContain('["null", "<null>", "nil", "undefined"]');
  });

  it("rate-limits Live publications even when the car moves quickly", () => {
    expect(live).toContain("guard elapsed >= minimumInterval");
    expect(live).toContain("moved >= 3 || elapsed >= 5");
    expect(live).not.toContain("now - lastPublishAt >= 0.8 || moved >= 4");
  });
});
