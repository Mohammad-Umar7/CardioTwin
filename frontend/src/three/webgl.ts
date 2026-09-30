/** Capability probes for the render-tier decision (DESIGN_SYSTEM §7.7). */

export interface WebGLProbe {
  webgl2: boolean;
  halfFloat: boolean;
  /** Unmasked renderer string when the browser exposes it ('' otherwise). */
  renderer: string;
  /** Best guess that the GPU is integrated (shares memory and bandwidth with the CPU). */
  integrated: boolean;
}

let cached: WebGLProbe | null = null;

/**
 * Integrated GPUs by renderer string: Intel (UHD, Iris), AMD APUs ("Radeon(TM) Graphics", "Vega … Graphics"),
 * Apple silicon is NOT treated as integrated (its unified GPU handles the full-bleed stage comfortably), and
 * software rasterisers count as integrated (they need the lightest settings).
 */
export function isIntegratedGpu(renderer: string): boolean {
  const r = renderer.toLowerCase();
  if (!r) return false;
  if (/apple m\d|apple gpu/.test(r)) return false;
  if (/nvidia|geforce|quadro|rtx|radeon rx|radeon pro|arc a\d/.test(r)) return false;
  return /intel|uhd|iris|hd graphics|radeon\(tm\) graphics|vega \d+ graphics|swiftshader|llvmpipe|basic render|mali|adreno|powervr/.test(r);
}

export function probeWebGL(): WebGLProbe {
  if (cached) return cached;
  const none: WebGLProbe = { webgl2: false, halfFloat: false, renderer: '', integrated: false };
  if (typeof document === 'undefined') return (cached = none);
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return (cached = none);
    const halfFloat = !!gl.getExtension('EXT_color_buffer_half_float') || !!gl.getExtension('EXT_color_buffer_float');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return (cached = { webgl2: true, halfFloat, renderer, integrated: isIntegratedGpu(renderer) });
  } catch {
    return (cached = none);
  }
}
