import { describe, expect, it } from "vitest";
import { typeDecimalKey } from "./decimalEntry";

describe("typeDecimalKey", () => {
  it("appends a decimal to the number on screen", () => {
    const dotted = typeDecimalKey("1", ".", true);
    expect(dotted).toEqual({ entry: "1.", replace: false });
    expect(typeDecimalKey(dotted.entry, "5", dotted.replace)).toEqual({
      entry: "1.5",
      replace: false,
    });
  });

  it("replaces a selected number with the next digit", () => {
    expect(typeDecimalKey("1", "5", true)).toEqual({ entry: "5", replace: false });
  });

  it("starts at 0. when nothing is shown", () => {
    expect(typeDecimalKey("", ".", true)).toEqual({ entry: "0.", replace: false });
  });
});
