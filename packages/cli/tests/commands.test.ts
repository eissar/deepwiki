import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";

import {
  mockReadWikiStructure,
  mockReadWikiContents,
  mockAskQuestion,
  spinnerState,
  resetMocks,
} from "./mocks.js";

import { toc } from "../src/commands/toc.js";
import { wiki } from "../src/commands/wiki.js";
import { ask } from "../src/commands/ask.js";

describe("toc command", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetMocks({ toc: "# Table of Contents\n- Intro\n- API", wiki: "# Full Wiki\nContent here.", ask: "The answer is 42." });
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test("calls readWikiStructure with repo", async () => {
    await toc("facebook/react", { json: false, quiet: false });
    expect(mockReadWikiStructure).toHaveBeenCalledWith("facebook/react", expect.any(Function));
  });

  test("outputs plain text by default", async () => {
    await toc("facebook/react", { json: false, quiet: false });
    expect(logSpy).toHaveBeenCalledWith("# Table of Contents\n- Intro\n- API");
  });

  test("outputs JSON when json=true", async () => {
    await toc("facebook/react", { json: true, quiet: false });
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.result).toBe("# Table of Contents\n- Intro\n- API");
  });
});

describe("wiki command", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetMocks({ toc: "# Table of Contents\n- Intro\n- API", wiki: "# Full Wiki\nContent here.", ask: "The answer is 42." });
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test("calls readWikiContents with repo", async () => {
    await wiki("oven-sh/bun", { json: false, quiet: false });
    expect(mockReadWikiContents).toHaveBeenCalledWith("oven-sh/bun", expect.any(Function));
  });

  test("outputs plain text by default", async () => {
    await wiki("oven-sh/bun", { json: false, quiet: false });
    expect(logSpy).toHaveBeenCalledWith("# Full Wiki\nContent here.");
  });

  test("outputs JSON when json=true", async () => {
    await wiki("oven-sh/bun", { json: true, quiet: false });
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.result).toBe("# Full Wiki\nContent here.");
  });
});

describe("ask command", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetMocks({ toc: "# Table of Contents\n- Intro\n- API", wiki: "# Full Wiki\nContent here.", ask: "The answer is 42." });
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test("calls askQuestion with repos and question", async () => {
    await ask(["facebook/react"], "What is JSX?", { json: false, quiet: false });
    expect(mockAskQuestion).toHaveBeenCalledWith(["facebook/react"], "What is JSX?", expect.any(Function));
  });

  test("single repo spinner label includes repo name", async () => {
    await ask(["facebook/react"], "question", { json: false, quiet: false });
    expect(spinnerState.label).toContain("facebook/react");
  });

  test("multi-repo spinner label includes count", async () => {
    await ask(["a/b", "c/d", "e/f"], "question", { json: false, quiet: false });
    expect(spinnerState.label).toContain("3 repos");
  });

  test("outputs plain text by default", async () => {
    await ask(["facebook/react"], "question", { json: false, quiet: false });
    expect(logSpy).toHaveBeenCalledWith("The answer is 42.");
  });

  test("outputs JSON when json=true", async () => {
    await ask(["facebook/react"], "question", { json: true, quiet: false });
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.result).toBe("The answer is 42.");
  });
});
