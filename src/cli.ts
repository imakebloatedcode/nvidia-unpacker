import { cac } from "cac";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  getManifest,
  MODULE_GROUP_TO_ITEMS,
  NvidiaInstaller,
} from "./installer";
import { once } from "node:events";
import { DOCUMENTATION_FILE_TYPES } from "./classifications";

const cli = cac();

cli
  .command(
    "unpack <installer> [...modules]",
    `Unpack an nvidia installer. The allowed modules are: ${Object.keys(MODULE_GROUP_TO_ITEMS).join(", ")}`,
  )
  .option("--output <output directory>", "Output directory")
  .option(
    "--virtual-output <virtual output>",
    "The directory that the installation will actually be ran from",
  )
  // Documentation handling
  .option("--no-docs", "Disable documentation (documentation is on by default)")
  .option(
    "--only-docs",
    "Only include documentation for these modules, nothing else",
    { default: false },
  )
  .option(
    "--include-installer",
    "Include the nvidia installer (disabled by default, requires the core module to be enabled)",
    { default: false },
  )
  // Platform data
  .option("--lib32 [lib32]", "The directory for the 32 bit libraries")
  .option("--lib64 [lib64]", "The directory for the 64 bit libraries")
  .option(
    "--native-arch <native architecture>",
    "The native system architecture (32 or 64)",
  )
  .option("--enable-systemd", "Enable systemd scripts", { default: false })
  .option(
    "--firmware-directory [firmware-directory]",
    "The path of the firmware directory",
    { default: "/lib/firmware" },
  )
  .option(
    "--usr-lib-path [usr-lib-path]",
    "The path of the user lib directory",
    {
      default: "/usr/lib",
    },
  )
  .option(
    "--usr-share-path [usr-share-path]",
    "The path of the user share directory",
    {
      default: "/usr/share",
    },
  )
  .option(
    "--usr-bin-path [usr-bin-path]",
    "The path of the user bin directory",
    {
      default: "/usr/bin",
    },
  )
  .option("--etc-path [etc-path]", "The path of the etc directory", {
    default: "/etc",
  })
  .action(async (installerPath, modules, options) => {
    console.log(options);
    // Validation
    const {
      output,
      virtualOutput,
      lib32,
      lib64,
      nativeArch,
      enableSystemd,
      firmwareDirectory,
      usrLibPath,
      usrSharePath,
      usrBinPath,
      etcPath,
      includeInstaller,
    } = options;
    let includeNonDocs: boolean = true;
    let includeDocs: boolean = true;
    {
      if (!["32", "64"].includes(nativeArch.toString())) {
        throw new Error(`Unknown system architecture ${nativeArch}`);
      }
      if (!(modules as string[]).every((v) => v in MODULE_GROUP_TO_ITEMS)) {
        throw new Error(
          `Unknown modules ${(modules as string[]).filter((v) => !(v in MODULE_GROUP_TO_ITEMS)).join(", ")}`,
        );
      }
      if (options.docs === false) {
        includeDocs = false;
      }
      if (options.onlyDocs === true) {
        includeNonDocs = false;
      }
      if (includeDocs === false && includeNonDocs === false) {
        throw new Error("Nothing is enabled!");
      }
    }
    const temporaryDirectory = join(
      tmpdir(),
      "nvidia-unpack-" + Math.random().toString(36).slice(2),
    );
    try {
      // Extract
      {
        console.log(resolve(installerPath));
        const processInstance = spawn(
          "sh",
          [
            resolve(installerPath),
            "--extract-only",
            "--target",
            temporaryDirectory,
          ],
          { stdio: "inherit" },
        );
        const [code] = await once(processInstance, "close");
        if (code !== 0) {
          throw new Error(
            `Aborting as process exited with non-0 exit code ${code}`,
          );
        } else {
          console.log("Command exited successfully");
        }
      }
      // Unpack
      {
        const manifest = await getManifest(temporaryDirectory);
        const architectureLibPaths = {
          ...(lib32 === undefined ? {} : { "32": lib32 as string }),
          ...(lib64 === undefined ? {} : { "64": lib64 as string }),
        } as Record<"32" | "64", string>; // SAFE-ish
        const instance = new NvidiaInstaller({
          architectureLibPaths,
          includeArchitectures: Object.keys(
            architectureLibPaths,
          ) as (keyof typeof architectureLibPaths)[],
          nativeArchitecture: nativeArch.toString(),
          firmwareDirectory: firmwareDirectory as string,
          usrLibPath: usrLibPath as string,
          usrSharePath: usrSharePath as string,
          usrBinDirectory: usrBinPath as string,
          etcDirectory: etcPath as string,
          hasSystemd: enableSystemd as boolean,
        });
        console.log(`Installing into ${resolve(output)} ...`);
        let includeType: "docs" | "nondocs" | "all";
        if (includeDocs && !includeNonDocs) {
          includeType = "docs";
        } else if (includeNonDocs && !includeDocs) {
          includeType = "nondocs";
        } else {
          includeType = "all";
        }
        const disallowlistBase = includeInstaller ? [] : ["INSTALLER_BINARY"];
        await instance.install(
          manifest,
          temporaryDirectory,
          output,
          (modules as (keyof typeof MODULE_GROUP_TO_ITEMS)[]).flatMap(
            (v) => MODULE_GROUP_TO_ITEMS[v],
          ),
          virtualOutput ?? output,
          (
            {
              all: { type: "disallowlist", items: disallowlistBase },
              docs: { type: "allowlist", items: DOCUMENTATION_FILE_TYPES },
              nondocs: {
                type: "disallowlist",
                items: [...disallowlistBase, ...DOCUMENTATION_FILE_TYPES],
              },
            } as const
          )[includeType],
        );
        console.log("Installation finished.");
      }
    } finally {
      console.log("Cleaning up...");
      await rm(temporaryDirectory, { recursive: true, force: true });
      console.log("Cleaned up. Exiting...");
    }
  });

cli.help();

cli.parse();
