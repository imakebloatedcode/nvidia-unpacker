// These lists change between versions but are very useful
const KERNEL_BOTH = ["nvswitch", "nvlink", "resman", "uvm"];
export const MODULE_GROUP_TO_ITEMS = {
  kernel_module_open: [
    "open_nvkms",
    "open_nvidia_drm",
    "open_nvidia_peermem",
    ...KERNEL_BOTH,
  ],
  kernel_module_closed: [
    "nvkms",
    "nvidia_drm",
    "nvidia_peermem",
    ...KERNEL_BOTH,
  ],
  desktop_handling: ["xdriver", "xutils"],
  management: ["nvml", "nvpd", "nvtopps"],
  // Everything else
  core: [
    // Has some systemd scripts and documentation, so it is in core
    "installer",
    // Graphics api
    "opengl",
    "egl",
    "vulkansc",
    // Bunch more stuff
    "compiler",
    "nvgpucomp",
    "nvpresent",
    "encodeapi",
    "nvapi",
    "nvcuvid",
    "nvfbc",
    "vdpau",
    "pcc",
    "nvlibpkcs11",
    "nvalloc",
    "gpgpu",
    "gpgpucomp",
    "gpgpudbg",
    "nvsandboxutils",
    // AI
    "ngx",
    // Ray tracing
    "optix",
    "raytracing",
    // You can look this one up
    "opticalflow",
  ],
} as const;

export const DOCUMENTATION_FILE_TYPES = ["MANPAGE", "DOCUMENTATION"] as const;
