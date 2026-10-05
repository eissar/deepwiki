import ora from "ora";

const isTTY = process.stderr.isTTY;

export async function withSpinner<T>(
  label: string,
  quiet: boolean,
  fn: (progress: (msg: string) => void) => Promise<T>,
): Promise<T> {
  if (quiet || !isTTY) {
    return fn(() => {});
  }

  const spinner = ora({ text: label, stream: process.stderr }).start();
  try {
    const result = await fn((msg) => {
      spinner.text = `${label} ${msg}`;
    });
    spinner.stop();
    return result;
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
