import { spawnSync } from "node:child_process";
import { packageRoot } from "#src/config/root.js";
import { isSea } from "node:sea";

const INSTALL_SH = "https://raw.githubusercontent.com/RemiPelloux/Concerto/main/scripts/install.sh";
const INSTALL_PS1 = "https://raw.githubusercontent.com/RemiPelloux/Concerto/main/scripts/install.ps1";

/** How this copy was installed, by where its executable lives: the command that updates it. */
export function updateCommand(exe: string, sea: boolean, platform: NodeJS.Platform = process.platform): { manager: string; command: string[] } {
  if (sea && /[/\\](Cellar|homebrew|linuxbrew)[/\\]/i.test(exe)) return { manager: "Homebrew", command: ["brew", "upgrade", "concerto"] };
  if (sea && /[/\\]scoop[/\\]/i.test(exe)) return { manager: "Scoop", command: ["scoop", "update", "concerto"] };
  if (sea && /[/\\]nix[/\\]store[/\\]/.test(exe)) return { manager: "Nix", command: ["nix", "profile", "upgrade", "concerto"] };
  if (sea && exe.startsWith("/usr/bin/")) return { manager: "apt", command: ["sh", "-c", "echo Download the new .deb from https://github.com/RemiPelloux/Concerto/releases/latest and run: sudo apt install ./concerto_*.deb"] };
  if (platform === "win32") return { manager: "the installer", command: ["powershell", "-NoProfile", "-Command", `irm ${INSTALL_PS1} | iex`] };
  return { manager: "the installer", command: ["sh", "-c", `curl -fsSL ${INSTALL_SH} | sh`] };
}

/** `concerto --update`: runs the update the way this copy was installed. */
export function runUpdate(): void {
  const sea = isSea();
  const { manager, command } = updateCommand(sea ? process.execPath : packageRoot(), sea);
  process.stdout.write(`Updating with ${manager}: ${command.join(" ")}\n`);
  const [bin = "", ...args] = command;
  const result = spawnSync(bin, args, { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
