import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PermissionRequestSection } from "../src/components/chat/PermissionRequestSection";

vi.mock("../src/shared/logger", () => ({
	getLogger: () => ({
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

const pluginMock = {} as unknown as Parameters<
	typeof PermissionRequestSection
>[0]["plugin"];

describe("PermissionRequestSection", () => {
	it("shows only once options when both once and always kinds exist", () => {
		render(
			<PermissionRequestSection
				permissionRequest={{
					requestId: "req-1",
					options: [
						{
							optionId: "allow-always",
							name: "Allow always",
							kind: "allow_always",
						},
						{
							optionId: "allow-once",
							name: "Allow once",
							kind: "allow_once",
						},
						{
							optionId: "reject-always",
							name: "Reject always",
							kind: "reject_always",
						},
						{
							optionId: "reject-once",
							name: "Reject once",
							kind: "reject_once",
						},
					],
					isActive: true,
				}}
				toolCallId="tc-1"
				plugin={pluginMock}
			/>,
		);

		expect(screen.getByRole("button", { name: "Allow" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Deny" })).toBeDefined();
		expect(screen.queryByRole("button", { name: "Allow always" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Reject always" })).toBeNull();
	});

	it("keeps always options when once options are unavailable", () => {
		render(
			<PermissionRequestSection
				permissionRequest={{
					requestId: "req-2",
					options: [
						{
							optionId: "allow-always",
							name: "Allow always",
							kind: "allow_always",
						},
						{
							optionId: "reject-always",
							name: "Reject always",
							kind: "reject_always",
						},
					],
					isActive: true,
				}}
				toolCallId="tc-2"
				plugin={pluginMock}
			/>,
		);

		expect(screen.getByRole("button", { name: "Allow" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Deny" })).toBeDefined();
	});

	it("passes selected optionId unchanged", async () => {
		const onApprovePermission = vi.fn().mockResolvedValue(undefined);
		render(
			<PermissionRequestSection
				permissionRequest={{
					requestId: "req-3",
					options: [
						{
							optionId: "reject-always",
							name: "Reject always",
							kind: "reject_always",
						},
					],
					isActive: true,
				}}
				toolCallId="tc-3"
				plugin={pluginMock}
				onApprovePermission={onApprovePermission}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Deny" }));
		expect(onApprovePermission).toHaveBeenCalledWith("req-3", "reject-always");
	});

	it("renders Allowed and Denied labels for selected outcomes", () => {
		const { rerender } = render(
			<PermissionRequestSection
				permissionRequest={{
					requestId: "req-4",
					options: [
						{
							optionId: "allow-once",
							name: "Allow once",
							kind: "allow_once",
						},
						{
							optionId: "reject-once",
							name: "Reject once",
							kind: "reject_once",
						},
					],
					selectedOptionId: "allow-once",
					isActive: false,
				}}
				toolCallId="tc-4"
				plugin={pluginMock}
			/>,
		);

		expect(screen.getByText("Allowed")).toBeDefined();

		rerender(
			<PermissionRequestSection
				permissionRequest={{
					requestId: "req-4",
					options: [
						{
							optionId: "allow-once",
							name: "Allow once",
							kind: "allow_once",
						},
						{
							optionId: "reject-once",
							name: "Reject once",
							kind: "reject_once",
						},
					],
					selectedOptionId: "reject-once",
					isActive: false,
				}}
				toolCallId="tc-4"
				plugin={pluginMock}
			/>,
		);

		expect(screen.getByText("Denied")).toBeDefined();
	});
});
