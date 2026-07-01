import { join, resolve } from "node:path";
import { Manifest, ManifestEntry, parseManifest } from "./manifest";
import { chmod, copyFile, mkdir, readFile, symlink } from "node:fs/promises";

// For backwards compatibility. TODO: remove on next major release
export { MODULE_GROUP_TO_ITEMS } from "./classifications";

export async function getManifest(root: string) {
  const manifestData = new TextDecoder().decode(
    await readFile(join(root, ".manifest")),
  );
  const manifest = parseManifest(manifestData);
  return manifest;
}

export interface NvidiaInstallerOptions<T extends "32" | "64"> {
  hasSystemd: boolean;
  includeArchitectures: T[];
  nativeArchitecture: T;
  architectureLibPaths: Record<T, string>; // Absolute paths
  usrLibPath: string; // Usually /usr/lib
  usrSharePath: string; // Usually /usr/share
  usrBinDirectory: string; // Usually /usr/bin
  etcDirectory: string; // Usually /etc/systemd
  firmwareDirectory: string; // Usually /lib/firmware
}

export type FileHandling =
  | { type: "flatDirectoryOutput"; directory: string }
  | { type: "unflatDirectoryOutput"; directory: string } // VERY rare
  | { type: "symlink"; from: string; toDirectory: string };
export class NvidiaInstaller<T extends "32" | "64"> {
  options: NvidiaInstallerOptions<T>;
  constructor(options: NvidiaInstallerOptions<T>) {
    this.options = options;
  }
  private getItemArch(entry: ManifestEntry) {
    const mapping = { NATIVE: "32", COMPAT32: "64" } as const;
    const arch = entry.properties[0];
    if (arch) {
      if (arch in mapping) {
        return mapping[arch as keyof typeof mapping];
      } else {
        throw new Error(
          `Unknown architecture ${arch} (known: ${Object.keys(mapping).join(", ")})`,
        );
      }
    } else {
      console.log(entry);
      throw new Error(
        "Item does not have a properties entry that we were trying to interpret as a cpu architecture",
      );
    }
  }
  private shouldIncludeArchedEntry(
    entry: ManifestEntry,
    nativeOnly: boolean = false,
  ) {
    return nativeOnly
      ? this.options.nativeArchitecture === this.getItemArch(entry)
      : // SAFE
        this.options.includeArchitectures.includes(
          this.getItemArch(entry) as any,
        );
  }
  private getArchedUsrLibPath(entry: ManifestEntry) {
    const architecture = this.getItemArch(entry);
    if (architecture in this.options.architectureLibPaths) {
      return this.options.architectureLibPaths[
        architecture as keyof typeof this.options.architectureLibPaths
      ];
    } else {
      throw new Error(
        `Architecture lib paths missing included architecture ${architecture}`,
      );
    }
  }
  // Shared libraries
  // Handles user lib entries both with and without the subpath entry
  private userLibHandler(entry: ManifestEntry): FileHandling | undefined {
    if (this.shouldIncludeArchedEntry(entry)) {
      const libPath = this.getArchedUsrLibPath(entry);
      if (entry.properties.length === 1) {
        return {
          type: "flatDirectoryOutput",
          directory: libPath,
        };
      } else if (entry.properties.length === 2) {
        return {
          type: "flatDirectoryOutput",
          directory: `${libPath}/${entry.properties[1]!}`, // SAFE
        };
      } else {
        throw new Error(
          `Unknown not enough or too many properties (1-2 expected): "${entry.properties.join(" ")}"`,
        );
      }
    } else {
      return undefined;
    }
  }
  // Handles user lib symlinks both with and without the subpath entry
  private userLibSymlinkHandler(
    entry: ManifestEntry,
  ): FileHandling | undefined {
    if (this.shouldIncludeArchedEntry(entry)) {
      const libPath = this.getArchedUsrLibPath(entry);
      if (entry.properties.length === 2) {
        return {
          type: "symlink",
          from: `${libPath}/${entry.properties[1]!}`, // SAFE
          toDirectory: `${libPath}`,
        };
      } else if (entry.properties.length === 3) {
        return {
          type: "symlink",
          from: `${libPath}/${entry.properties[2]!}`, // SAFE
          toDirectory: `${libPath}/${entry.properties[1]!}`, // SAFE
        };
      } else {
        throw new Error(
          `Unknown not enough or too many properties (2-3 expected): "${entry.properties.join(" ")}"`,
        );
      }
    } else {
      return undefined;
    }
  }

  // Private
  private internalUtilityHandler(entry: ManifestEntry) {
    if (!entry.properties[0] || this.shouldIncludeArchedEntry(entry, true)) {
      return {
        type: "flatDirectoryOutput",
        directory: `${this.options.usrLibPath}/nvidia`,
      } as const;
    }
  }
  // Commands
  private publicBinaryHandler(entry: ManifestEntry): FileHandling {
    return {
      type: "flatDirectoryOutput",
      directory: this.options.usrBinDirectory,
    };
  }
  private publicBinarySymlinkHandler(entry: ManifestEntry): FileHandling {
    return {
      type: "symlink",
      from: `${this.options.usrBinDirectory}/${entry.properties[0]!}`, // UNSAFE
      toDirectory: this.options.usrBinDirectory,
    };
  }
  // Documentation
  private manpageHandler(entry: ManifestEntry): FileHandling {
    return {
      type: "flatDirectoryOutput",
      directory: `${this.options.usrSharePath}/man/${entry.properties[0]!}`,
    };
  }
  // Xorg
  private xorgModule(entry: ManifestEntry): FileHandling {
    return {
      type: "flatDirectoryOutput",
      directory: `${this.options.usrSharePath}/xorg/modules/${entry.properties[0]!}`, // UNSAFE
    };
  }
  private xorgModuleSymlink(entry: ManifestEntry): FileHandling {
    const base = `${this.options.usrSharePath}/xorg/modules/${entry.properties[0]!}`; // UNSAFE
    return {
      type: "symlink",
      from: `${base}/${entry.properties[1]!}`,
      toDirectory: base,
    };
  }
  private xorgConfig(entry: ManifestEntry): FileHandling {
    return {
      type: "flatDirectoryOutput",
      directory: `${this.options.usrSharePath}/X11/xorg.conf.d`,
    };
  }
  // Bypasses
  private directPathHandler(entry: ManifestEntry): FileHandling {
    return {
      type: "flatDirectoryOutput", // Definitely should be flat
      directory: entry.properties[0]!, // UNSAFE
    };
  }
  private getHandlerMapping(
    version: string,
  ): Record<string, (entry: ManifestEntry) => FileHandling | undefined> {
    return {
      SANDBOXUTILS_FILELIST_JSON: () => ({
        type: "flatDirectoryOutput",
        directory: `${this.options.usrSharePath}/nvidia/files.d`,
      }),
      OPENGL_DATA: this.directPathHandler,
      // Libraries
      OPENGL_LIB: this.userLibHandler,
      OPENGL_SYMLINK: this.userLibSymlinkHandler,
      GLX_CLIENT_LIB: this.userLibHandler,
      GLX_CLIENT_SYMLINK: this.userLibSymlinkHandler,
      UTILITY_LIB: this.userLibHandler,
      UTILITY_LIB_SYMLINK: this.userLibSymlinkHandler,
      GLVND_LIB: this.userLibHandler,
      GLVND_SYMLINK: this.userLibSymlinkHandler,
      EGL_CLIENT_LIB: this.userLibHandler,
      EGL_CLIENT_SYMLINK: this.userLibSymlinkHandler,
      NVCUVID_LIB: this.userLibHandler,
      NVCUVID_LIB_SYMLINK: this.userLibSymlinkHandler,
      ENCODEAPI_LIB: this.userLibHandler,
      ENCODEAPI_LIB_SYMLINK: this.userLibSymlinkHandler,
      CUDA_LIB: this.userLibHandler,
      CUDA_SYMLINK: this.userLibSymlinkHandler,
      OPENCL_LIB: this.userLibHandler,
      OPENCL_LIB_SYMLINK: this.userLibSymlinkHandler,
      OPENCL_WRAPPER_LIB: this.userLibHandler,
      OPENCL_WRAPPER_SYMLINK: this.userLibSymlinkHandler,
      VDPAU_LIB: this.userLibHandler,
      VDPAU_SYMLINK: this.userLibSymlinkHandler,
      // Libraries missing either a complementing symlink or a complementing main handler
      TLS_LIB: this.userLibHandler,
      GBM_BACKEND_LIB_SYMLINK: this.userLibSymlinkHandler,
      // Internal
      INTERNAL_UTILITY_LIB: this.internalUtilityHandler,
      INTERNAL_UTILITY_BINARY: this.internalUtilityHandler,
      INTERNAL_UTILITY_DATA: this.internalUtilityHandler,
      // Utility binaries
      UTILITY_BINARY: this.publicBinaryHandler,
      UTILITY_BIN_SYMLINK: this.publicBinarySymlinkHandler,
      INSTALLER_BINARY: this.publicBinaryHandler,
      // Modprobe entries
      NVIDIA_MODPROBE: this.directPathHandler,
      NVIDIA_MODPROBE_MANPAGE: this.manpageHandler,
      // Firmware
      FIRMWARE: () => ({
        type: "flatDirectoryOutput", // Definitely should be flat
        directory: `${this.options.firmwareDirectory}/nvidia/${version}`,
      }),
      // Manual
      MANPAGE: this.manpageHandler,
      // Documentation
      DOCUMENTATION: (entry) => ({
        type: "flatDirectoryOutput", // Unsure if this should be flat or not
        directory: `/usr/share/doc/${entry.properties[0]!}`, // UNSAFE
      }),
      // Json external tool configuration files (i.e ICD files)
      CUDA_ICD: () => ({
        type: "flatDirectoryOutput", // Unsure if this should be flat or not
        directory: "/etc/OpenCL/vendors",
      }),
      VULKAN_ICD_JSON: (entry) => ({
        type: "flatDirectoryOutput",
        directory: `/etc/vulkan/${entry.properties[0]!}`, // UNSAFE
      }),
      VULKANSC_ICD_JSON: (entry) => ({
        type: "flatDirectoryOutput",
        directory: `/etc/vulkansc/${entry.properties[0]!}`, // UNSAFE
      }),
      GLVND_EGL_ICD_JSON: () => ({
        type: "flatDirectoryOutput",
        directory: `${this.options.usrSharePath}/glvnd/egl_vendor.d`,
      }),
      EGL_EXTERNAL_PLATFORM_JSON: () => ({
        type: "flatDirectoryOutput",
        directory: `${this.options.usrSharePath}/egl/egl_external_platform.d`,
      }),
      // Profiles
      APPLICATION_PROFILE: (entry) => ({
        type: "flatDirectoryOutput",
        directory: `${this.options.usrSharePath}/nvidia/${entry.properties[0]!}`, // UNSAFE
      }),
      // Xorg
      GLX_MODULE_SHARED_LIB: this.xorgModule,
      GLX_MODULE_SYMLINK: this.xorgModuleSymlink,
      XMODULE_SHARED_LIB: this.xorgModule,
      XORG_OUTPUTCLASS_CONFIG: this.xorgConfig,
      // Desktop shortcuts/icon
      ICON: (entry) => ({
        type: "flatDirectoryOutput",
        directory: `${this.options.usrSharePath}/icons/hicolor/${entry.properties[0]!}`, // UNSAFE
      }),
      DOT_DESKTOP: () => ({
        type: "flatDirectoryOutput",
        directory: `${this.options.usrSharePath}/applications`,
      }), // The entry weirdly has a property even though it never gets used to my knowledge
      // Wine
      WINE_LIB: (entry) => {
        if (this.shouldIncludeArchedEntry(entry)) {
          return {
            type: "flatDirectoryOutput",
            directory: `${this.getArchedUsrLibPath(entry)}/nvidia/wine`,
          };
        }
      },
      // Systemd
      SYSTEMD_UNIT: () => {
        if (this.options.hasSystemd) {
          return {
            type: "unflatDirectoryOutput",
            directory: this.options.usrLibPath,
          };
        }
      },
      SYSTEMD_UNIT_SYMLINK: (entry) => {
        if (this.options.hasSystemd) {
          return {
            type: "symlink",
            from: `${this.options.usrLibPath}/systemd/system/${entry.path}`,
            toDirectory: `${this.options.etcDirectory}/systemd/system/${entry.properties[0]!}`, // UNSAFE
          };
        }
      },
      SYSTEMD_SLEEP_SCRIPT: () => {
        if (this.options.hasSystemd) {
          return {
            type: "unflatDirectoryOutput",
            directory: this.options.usrLibPath,
          };
        }
      },
    };
  }
  private normalizedSplitPath(path: string) {
    return path.split("/").filter(Boolean);
  }
  private lastItem<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error("Can not get the last item of an empty array");
    } else {
      return array[array.length - 1]!; // SAFE
    }
  }
  private joinAbsPath(path: string[]) {
    return ["", ...path].join("/");
  }
  private async makeDirectoryForFileAbs(path: string[]) {
    await mkdir(this.joinAbsPath(path.slice(0, -1)), { recursive: true });
  }
  async install(
    parsedFile: Manifest,
    installationBase: string,
    unpackedInstallerBase: string,
    includesModules: string[],
    symlinkBase: string = unpackedInstallerBase,
    fileTypeFiltering:
      | { type: "allowlist"; items: string[] | readonly string[] }
      | { type: "disallowlist"; items: string[] | readonly string[] } = {
      type: "disallowlist",
      items: [],
    },
  ) {
    // Generate handlers
    const handlers: { handler: FileHandling; entry: ManifestEntry }[] = [];
    {
      const handlerMapping = this.getHandlerMapping(parsedFile.version);
      for (const entry of parsedFile.entries) {
        const entryType = entry.type;
        if (includesModules.includes(entry.moduleName)) {
          if (fileTypeFiltering.type === "allowlist") {
            if (!fileTypeFiltering.items.includes(entryType)) {
              // Skip item
              continue;
            }
          } else if (fileTypeFiltering.type === "disallowlist") {
            if (fileTypeFiltering.items.includes(entryType)) {
              // Skip item
              continue;
            }
          } else {
            throw new Error(
              `Unsupported file type filtering type ${(fileTypeFiltering as any).type}`,
            );
          }
          if (entryType in handlerMapping) {
            const handler = handlerMapping[entryType]!.call(this, entry); // SAFE
            if (handler) {
              handlers.push({ handler, entry });
            }
          } else {
            throw new Error(`Unhandled entry type ${entryType}`);
          }
        }
      }
    }
    const splitInstallationBase = this.normalizedSplitPath(
      resolve(installationBase),
    );
    const splitUnpackedInstallerBase = this.normalizedSplitPath(
      resolve(unpackedInstallerBase),
    );
    const splitSymlinkBase = this.normalizedSplitPath(resolve(symlinkBase));
    // Extract files
    for (const { handler, entry } of handlers) {
      const splitEntryPath = this.normalizedSplitPath(entry.path);
      if (handler.type === "flatDirectoryOutput") {
        const fileName = this.lastItem(splitEntryPath);
        const inputPath = [...splitInstallationBase, ...splitEntryPath];
        const outputPath = [
          ...splitUnpackedInstallerBase,
          ...this.normalizedSplitPath(handler.directory),
          fileName,
        ];
        await this.makeDirectoryForFileAbs(outputPath);
        await copyFile(
          this.joinAbsPath(inputPath),
          this.joinAbsPath(outputPath),
        );
        await chmod(this.joinAbsPath(outputPath), entry.mode);
      } else if (handler.type === "unflatDirectoryOutput") {
        const inputPath = [...splitInstallationBase, ...splitEntryPath];
        const outputPath = [
          ...splitUnpackedInstallerBase,
          ...this.normalizedSplitPath(handler.directory),
          ...splitEntryPath,
        ];
        await this.makeDirectoryForFileAbs(outputPath);
        await copyFile(
          this.joinAbsPath(inputPath),
          this.joinAbsPath(outputPath),
        );
        await chmod(this.joinAbsPath(outputPath), entry.mode);
      } else if (handler.type === "symlink") {
        const fileName = this.lastItem(splitEntryPath);

        const linkPointerToPath = [
          ...splitSymlinkBase,
          ...this.normalizedSplitPath(handler.from),
        ];
        const outputPath = [
          ...splitUnpackedInstallerBase,
          ...this.normalizedSplitPath(handler.toDirectory),
          fileName,
        ];

        await this.makeDirectoryForFileAbs(outputPath);
        await symlink(
          this.joinAbsPath(linkPointerToPath),
          this.joinAbsPath(outputPath),
        );
        // The permissions of a symlink can not be changed
        // await chmod(this.joinAbsPath(outputPath), entry.mode);
      } else {
        throw new Error("Unknown handler type");
      }
    }
  }
}
