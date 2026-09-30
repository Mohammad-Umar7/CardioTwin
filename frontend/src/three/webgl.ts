/** Capability probes for the render-tier decision (DESIGN_SYSTEM §7.7). */

let cached: { webgl2: boolean; halfFloat: boolean } | null = null;

export function probeWebGL(): { webgl2: boolean; halfFloat: boolean } {
  if (cached) return cached;
  if (typeof document === 'undefined') return (cached = { webgl2: false, halfFloat: false });
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return (cached = { webgl2: false, halfFloat: false });
    const halfFloat = !!gl.getExtension('EXT_color_buffer_half_float') || !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return (cached = { webgl2: true, halfFloat });
  } catch {
    return (cached = { webgl2: false, halfFloat: false });
  }
}
