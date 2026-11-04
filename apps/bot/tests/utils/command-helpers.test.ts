import { describe, it, expect, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import { replyAppErrorOrFail, replyServerOnly } from "../../src/utils/command-helpers.js";
import { AppError, ErrorCode } from "../../src/types/errors.js";

function fakeInteraction() {
  const editReply = vi.fn(async (_arg: unknown) => undefined);
  return { interaction: { editReply } as unknown as ChatInputCommandInteraction, editReply };
}

function sent(editReply: ReturnType<typeof vi.fn>) {
  expect(editReply).toHaveBeenCalledTimes(1);
  const arg = editReply.mock.calls[0]![0] as Record<string, unknown> & { embeds: { data: unknown }[] };
  expect(Object.keys(arg)).toEqual(["embeds"]);
  return arg.embeds.map((e) => e.data);
}

describe("replyServerOnly", () => {
  it("edits the reply with the server-only error embed and no flags", async () => {
    const { interaction, editReply } = fakeInteraction();
    await replyServerOnly(interaction);
    expect(sent(editReply)).toEqual([{ color: 0xff0000, description: "This command can only be used in a server." }]);
  });
});

describe("replyAppErrorOrFail", () => {
  it("shows an AppError's message without logging", async () => {
    const { interaction, editReply } = fakeInteraction();
    const log = vi.fn();
    await replyAppErrorOrFail(interaction, new AppError(ErrorCode.NOT_FOUND, "Gone."), log);
    expect(sent(editReply)).toEqual([{ color: 0xff0000, description: "Gone." }]);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs anything else first, then replies 'Something went wrong.'", async () => {
    const { interaction, editReply } = fakeInteraction();
    const order: string[] = [];
    editReply.mockImplementation(async () => {
      order.push("reply");
    });
    await replyAppErrorOrFail(interaction, "not even an Error", () => order.push("log"));
    expect(order).toEqual(["log", "reply"]);
    expect(sent(editReply)).toEqual([{ color: 0xff0000, description: "Something went wrong." }]);
  });
});
