import { describe, expect, it, jest } from "@jest/globals";

import { clampBurstCenter, doubleTapLike } from "@/lib/doubleTapLike";

function setup(liked: boolean, send: (postId: string) => Promise<void>) {
  const state = { liked };
  const pending = new Set<string>();
  const apply = jest.fn((value: boolean) => {
    state.liked = value;
  });
  const onFailed = jest.fn();
  const tap = () =>
    doubleTapLike({ postId: "p1", liked: state.liked, pending, apply, send, onFailed });
  return { state, pending, apply, onFailed, tap };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("doubleTapLike", () => {
  it("only animates on a post that is already liked: no request, never unlikes", () => {
    const send = jest.fn(() => Promise.resolve());
    const { tap, apply, state } = setup(true, send);
    expect(tap()).toBe("already");
    expect(send).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(state.liked).toBe(true);
  });

  it("likes optimistically and sends one request", async () => {
    const send = jest.fn(() => Promise.resolve());
    const { tap, state, pending } = setup(false, send);
    expect(tap()).toBe("liked");
    expect(state.liked).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    await flush();
    expect(pending.size).toBe(0);
  });

  it("sends at most one request for several quick double taps", async () => {
    let resolve: () => void = () => undefined;
    const send = jest.fn(() => new Promise<void>((r) => (resolve = r)));
    const pending = new Set<string>();
    const apply = jest.fn();
    // The screen hasn't re-rendered yet: it still says "not liked" for the second and third tap.
    const input = { postId: "p1", liked: false, pending, apply, send, onFailed: jest.fn() };
    expect(doubleTapLike(input)).toBe("liked");
    expect(doubleTapLike(input)).toBe("already");
    expect(doubleTapLike(input)).toBe("already");
    expect(send).toHaveBeenCalledTimes(1);
    resolve();
    await flush();
    // Afterwards the post is liked: another double tap still sends nothing.
    expect(doubleTapLike({ ...input, liked: true })).toBe("already");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("takes the like back and reports when the server refuses", async () => {
    const send = jest.fn(() => Promise.reject(new Error("new row violates row-level security policy")));
    const { tap, state, onFailed, pending } = setup(false, send);
    expect(tap()).toBe("liked");
    expect(state.liked).toBe(true);
    await flush();
    expect(state.liked).toBe(false);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
  });
});

describe("clampBurstCenter", () => {
  it("keeps the heart inside the photo", () => {
    expect(clampBurstCenter(5, 5, 400, 500, 100)).toEqual({ x: 50, y: 50 });
    expect(clampBurstCenter(399, 499, 400, 500, 100)).toEqual({ x: 350, y: 450 });
    expect(clampBurstCenter(200, 250, 400, 500, 100)).toEqual({ x: 200, y: 250 });
    expect(clampBurstCenter(10, 10, 80, 80, 100)).toEqual({ x: 40, y: 40 });
  });
});
