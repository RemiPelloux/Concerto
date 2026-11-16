import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test file gets its own config folder: usage, health and price files written by a test
// never reach the real ~/.config/concerto of the person running the suite.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "concerto-config-"));
