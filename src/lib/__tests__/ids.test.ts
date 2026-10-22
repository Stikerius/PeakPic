import { describe, expect, it } from "@jest/globals";

import { randomUuid } from "@/lib/ids";

describe("randomUuid", () => {
  it("makes valid, different v4 uuids", () => {
    const a = randomUuid();
    const b = randomUuid();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(randomUuid(() => 0.999)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
