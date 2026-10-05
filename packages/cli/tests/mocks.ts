import { mock } from "bun:test";

// Shared module mocks. bun's mock.module is process-global and modules that
// import the mocked module are cached once, so every test file must share the
// SAME mock instances. Import this file before any src module under test.

export const mockReadWikiStructure = mock(async (..._a: any[]): Promise<string> => "");
export const mockReadWikiContents = mock(async (..._a: any[]): Promise<string> => "");
export const mockAskQuestion = mock(async (..._a: any[]): Promise<string> => "");
export const spinnerState = { label: "" };

mock.module("../src/client.js", () => ({
  readWikiStructure: mockReadWikiStructure,
  readWikiContents: mockReadWikiContents,
  askQuestion: mockAskQuestion,
}));

mock.module("../src/spinner.js", () => ({
  withSpinner: async (label: string, _quiet: boolean, fn: (p: (m: string) => void) => Promise<string>) => {
    spinnerState.label = label;
    return fn(() => {});
  },
}));

/** Reset all mocks and install per-file default return values. */
export function resetMocks(defaults: { toc: string; wiki: string; ask: string }) {
  mockReadWikiStructure.mockReset();
  mockReadWikiContents.mockReset();
  mockAskQuestion.mockReset();
  mockReadWikiStructure.mockImplementation(async () => defaults.toc);
  mockReadWikiContents.mockImplementation(async () => defaults.wiki);
  mockAskQuestion.mockImplementation(async () => defaults.ask);
  spinnerState.label = "";
}
