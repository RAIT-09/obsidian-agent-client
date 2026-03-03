import { describe, expect, it } from "vitest";
import {
	hasUpdateAvailable,
	pickLatestReleaseVersion,
} from "../src/plugin/update-check";

describe("pickLatestReleaseVersion", () => {
	it("returns highest stable version", () => {
		const version = pickLatestReleaseVersion(
			[
				{ tag_name: "v0.3.0", prerelease: false, draft: false },
				{ tag_name: "v0.3.1", prerelease: false, draft: false },
			],
			"stable",
		);

		expect(version).toBe("0.3.1");
	});

	it("ignores draft prereleases", () => {
		const version = pickLatestReleaseVersion(
			[
				{ tag_name: "v0.3.2-beta.1", prerelease: true, draft: true },
				{ tag_name: "v0.3.1-beta.3", prerelease: true, draft: false },
			],
			"prerelease",
		);

		expect(version).toBe("0.3.1-beta.3");
	});
});

describe("hasUpdateAvailable", () => {
	it("does not report update when versions are equal", () => {
		const state = hasUpdateAvailable("0.3.1", "0.3.1", "0.3.1-beta.1");

		expect(state).toEqual({ hasUpdate: false, newestVersion: null });
	});

	it("reports update when stable release is newer", () => {
		const state = hasUpdateAvailable("0.3.1", "0.3.2", null);

		expect(state).toEqual({ hasUpdate: true, newestVersion: "0.3.2" });
	});

	it("reports prerelease update for prerelease users", () => {
		const state = hasUpdateAvailable("0.3.1-beta.1", "0.3.1", "0.3.1-beta.2");

		expect(state).toEqual({ hasUpdate: true, newestVersion: "0.3.1" });
	});
});
