import { Notice, requestUrl } from "obsidian";
import * as semver from "semver";

interface GitHubRelease {
	tag_name?: string;
	prerelease?: boolean;
	draft?: boolean;
}

function normalizeVersion(versionInput: string): string | null {
	return semver.clean(versionInput) ?? semver.valid(versionInput) ?? null;
}

export function pickLatestReleaseVersion(
	releases: GitHubRelease[],
	target: "stable" | "prerelease",
): string | null {
	const versions = releases
		.filter((release) => !release.draft)
		.filter((release) =>
			target === "stable" ? !release.prerelease : release.prerelease,
		)
		.map((release) => normalizeVersion(release.tag_name ?? ""))
		.filter((version): version is string => version !== null)
		.sort((a, b) => semver.rcompare(a, b));

	return versions[0] ?? null;
}

export function hasUpdateAvailable(
	currentVersionInput: string,
	latestStable: string | null,
	latestPrerelease: string | null,
): { hasUpdate: boolean; newestVersion: string | null } {
	const currentVersion = normalizeVersion(currentVersionInput);
	if (!currentVersion) {
		return { hasUpdate: false, newestVersion: null };
	}

	const isCurrentPrerelease = semver.prerelease(currentVersion) !== null;
	const hasNewerStable =
		latestStable !== null && semver.gt(latestStable, currentVersion);
	const hasNewerPrerelease =
		isCurrentPrerelease &&
		latestPrerelease !== null &&
		semver.gt(latestPrerelease, currentVersion);

	if (hasNewerStable || hasNewerPrerelease) {
		return {
			hasUpdate: true,
			newestVersion: hasNewerStable ? latestStable : latestPrerelease,
		};
	}

	return { hasUpdate: false, newestVersion: null };
}

async function fetchLatestStable(): Promise<string | null> {
	const response = await requestUrl({
		url: "https://api.github.com/repos/shuuul/obsius/releases/latest",
	});
	const data = response.json as { tag_name?: string };
	return normalizeVersion(data.tag_name ?? "");
}

async function fetchLatestPrerelease(): Promise<string | null> {
	const response = await requestUrl({
		url: "https://api.github.com/repos/shuuul/obsius/releases",
	});
	const releases = response.json as GitHubRelease[];
	return pickLatestReleaseVersion(releases, "prerelease");
}

export async function checkForUpdates(
	currentVersionInput: string,
): Promise<boolean> {
	const currentVersion = normalizeVersion(currentVersionInput);
	if (!currentVersion) {
		return false;
	}

	const isCurrentPrerelease = semver.prerelease(currentVersion) !== null;
	const [latestStable, latestPrerelease] = isCurrentPrerelease
		? await Promise.all([fetchLatestStable(), fetchLatestPrerelease()])
		: [await fetchLatestStable(), null];
	const updateState = hasUpdateAvailable(
		currentVersion,
		latestStable,
		latestPrerelease,
	);

	if (updateState.hasUpdate && updateState.newestVersion) {
		new Notice(`[Obsius] Update available: v${updateState.newestVersion}`);
		return true;
	}

	return false;
}
