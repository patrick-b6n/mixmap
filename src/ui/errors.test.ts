import { describe, expect, it } from "vitest";

import { ExchangeError, LinkError } from "@/business/errors";

import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("translates business errors by code", () => {
    expect(errorMessage(new ExchangeError("not_json"))).toBe(
      "Not a valid .mixmap.json file: the file is not JSON",
    );
    expect(errorMessage(new ExchangeError("not_list", { field: "links" }))).toBe(
      "Not a valid .mixmap.json file: links must be a list",
    );
    expect(errorMessage(new LinkError("self_link"))).toBe("A track can't link to itself.");
  });

  it("keeps the text of other errors", () => {
    expect(errorMessage(new Error("pair_confirm: 403 wrong code"))).toBe("wrong code");
    expect(errorMessage("plain")).toBe("plain");
  });
});
