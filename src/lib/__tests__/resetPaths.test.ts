import { describe, expect, it } from "@jest/globals";

import { filesForUser, isUuid, resetErrorCode } from "../../../supabase/functions/_shared/resetPaths";

const ME = "d0000000-0000-0000-0000-00000000000a";
const OTHER = "d0000000-0000-0000-0000-00000000000b";

describe("filesForUser (run_data_reset)", () => {
  it("accepts paths in the person's own folder and removes duplicates", () => {
    expect(filesForUser(ME, [`${ME}/posts/1.jpg`, `${ME}/stories/2.jpg`, `${ME}/posts/1.jpg`])).toEqual([
      `${ME}/posts/1.jpg`,
      `${ME}/stories/2.jpg`,
    ]);
    expect(filesForUser(ME, [])).toEqual([]);
  });

  it("refuses anything outside the own folder", () => {
    expect(() => filesForUser(ME, [`${OTHER}/posts/1.jpg`])).toThrow("invalid_files");
    expect(() => filesForUser(ME, [`${ME}/../${OTHER}/posts/1.jpg`])).toThrow("invalid_files");
    expect(() => filesForUser(ME, [`${ME}/`])).toThrow("invalid_files");
    expect(() => filesForUser(ME, [`${ME}//x.jpg`])).toThrow("invalid_files");
    expect(() => filesForUser(ME, [`/${ME}/x.jpg`])).toThrow("invalid_files");
    expect(() => filesForUser(ME, [`${ME}x/posts/1.jpg`])).toThrow("invalid_files");
  });

  it("refuses answers that are not a list of strings", () => {
    expect(() => filesForUser(ME, null)).toThrow("invalid_files");
    expect(() => filesForUser(ME, `${ME}/posts/1.jpg`)).toThrow("invalid_files");
    expect(() => filesForUser(ME, [42])).toThrow("invalid_files");
    expect(() => filesForUser("not-a-uuid", [])).toThrow("invalid_user");
  });
});

describe("helpers", () => {
  it("checks uuids", () => {
    expect(isUuid(ME)).toBe(true);
    expect(isUuid("x")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it("passes only known error codes through", () => {
    expect(resetErrorCode("other_job_active")).toBe("other_job_active");
    expect(resetErrorCode("duplicate key value violates unique constraint")).toBe("failed");
    expect(resetErrorCode(undefined)).toBe("failed");
  });
});
