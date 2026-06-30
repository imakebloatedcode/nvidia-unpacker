const fileRegex =
  /^(?<item_name>[^\n]*)\s*(?<item_version>[^\n]*)\s*(?<provided_modules>[^\n]*)\s*(?<data>[\S\s]*)$/;
const dataRegex =
  /^(?<src_path>[^ ]+) (?<mode>[^ ]+) (?<type>[^ ]+) ((?<properties>.+) )?MODULE:(?<module_name>.*)$/;

export interface ManifestEntry {
  path: string;
  mode: number;
  type: string;
  properties: string[];
  moduleName: string;
}
export interface Manifest {
  name: string;
  version: string;
  providedKernelModules: string[];
  entries: ManifestEntry[];
}
export function parseManifest(manifest: string): Manifest {
  const fileMatches = fileRegex.exec(manifest);
  if (fileMatches === null) {
    throw new Error("Failed to parse file with regex");
  }
  const fileMatchGroups = fileMatches.groups as {
    item_name: string;
    item_version: string;
    provided_modules: string;
    data: string;
  };
  // Parse data
  const entries: ManifestEntry[] = [];
  for (const line of fileMatchGroups.data.split("\n")) {
    if (line === "") {
      continue;
    }
    const lineMatches = dataRegex.exec(line);
    if (lineMatches === null) {
      throw new Error("Failed to parse line with regex");
    }
    const groups = lineMatches.groups as {
      src_path: string;
      mode: string;
      type: string;
      properties: string;
      module_name: string;
    };
    entries.push({
      moduleName: groups.module_name,
      path: groups.src_path,
      mode: parseInt(groups.mode, 8),
      properties: groups.properties
        ? groups.properties.split(" ").filter(Boolean)
        : [],
      type: groups.type,
    });
  }
  return {
    name: fileMatchGroups.item_name,
    version: fileMatchGroups.item_version,
    providedKernelModules: fileMatchGroups.provided_modules
      .split(" ")
      .filter(Boolean),
    entries,
  };
}
