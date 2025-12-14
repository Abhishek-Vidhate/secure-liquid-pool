import chalk from "chalk";

/**
 * Logger utility with immediate stdout flush for real-time output
 */

/**
 * Log a message immediately (no buffering)
 */
export function log(message: string): void {
  process.stdout.write(message + "\n");
}

/**
 * Log with color (immediate)
 */
export const logger = {
  info: (message: string) => process.stdout.write(chalk.gray(message) + "\n"),
  success: (message: string) => process.stdout.write(chalk.green(message) + "\n"),
  warn: (message: string) => process.stdout.write(chalk.yellow(message) + "\n"),
  error: (message: string) => process.stdout.write(chalk.red(message) + "\n"),
  blue: (message: string) => process.stdout.write(chalk.blue(message) + "\n"),
  cyan: (message: string) => process.stdout.write(chalk.cyan(message) + "\n"),
};

/**
 * Log progress on the same line (updates in place)
 */
export function logProgress(current: number, total: number, message: string): void {
  const percentage = Math.round((current / total) * 100);
  const progressBar = createProgressBar(percentage, 20);
  process.stdout.write(`\r  ${progressBar} ${current}/${total} ${message}`.padEnd(80));
}

/**
 * End progress line (move to next line)
 */
export function endProgress(): void {
  process.stdout.write("\n");
}

/**
 * Create a visual progress bar
 */
function createProgressBar(percentage: number, width: number): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty));
}

/**
 * Log with spinner animation (for long operations)
 */
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerIndex = 0;

export function logSpinner(message: string): void {
  const frame = spinnerFrames[spinnerIndex % spinnerFrames.length];
  process.stdout.write(`\r  ${chalk.cyan(frame)} ${message}`.padEnd(60));
  spinnerIndex++;
}

/**
 * Clear current line
 */
export function clearLine(): void {
  process.stdout.write("\r" + " ".repeat(80) + "\r");
}

/**
 * Log section header
 */
export function logSection(title: string): void {
  process.stdout.write("\n");
  process.stdout.write(chalk.blue("══════════════════════════════════════════════\n"));
  process.stdout.write(chalk.blue(`  ${title}\n`));
  process.stdout.write(chalk.blue("══════════════════════════════════════════════\n"));
  process.stdout.write("\n");
}

/**
 * Log a bullet point item
 */
export function logItem(message: string, indent: number = 0): void {
  const prefix = "  ".repeat(indent);
  process.stdout.write(`${prefix}${chalk.gray("•")} ${message}\n`);
}

/**
 * Log success with checkmark
 */
export function logOk(message: string): void {
  process.stdout.write(chalk.green(`  ✓ ${message}\n`));
}

/**
 * Log warning with icon
 */
export function logWarn(message: string): void {
  process.stdout.write(chalk.yellow(`  ⚠ ${message}\n`));
}

