export function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Falha ao compilar shader:\n${log}`);
  }
  return shader;
}

export function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Falha ao linkar programa:\n${log}`);
  }
  const block = gl.getUniformBlockIndex(program, 'Globals');
  if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, block, 0);
  return program;
}

export function setSampler(gl, program, name, unit) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) {
    gl.useProgram(program);
    gl.uniform1i(location, unit);
  }
}

// Resolve vários uniforms de uma vez (pós-processamento/luzes/partículas
// têm parâmetros próprios fora do UBO compartilhado).
export function uniformLocations(gl, program, names) {
  const locations = {};
  for (let i = 0; i < names.length; i++) {
    locations[names[i]] = gl.getUniformLocation(program, names[i]);
  }
  return locations;
}

export class RenderTarget {
  constructor(gl, width, height, descriptors, label = 'RenderTarget') {
    this.gl = gl;
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.descriptors = descriptors;
    this.label = label;
    this.textures = new Array(descriptors.length);
    this.drawBuffers = new Array(descriptors.length);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    for (let i = 0; i < descriptors.length; i++) {
      const descriptor = descriptors[i];
      const texture = gl.createTexture();
      this.textures[i] = texture;
      this.drawBuffers[i] = gl.COLOR_ATTACHMENT0 + i;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, descriptor.filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, descriptor.filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        descriptor.internalFormat,
        this.width,
        this.height,
        0,
        descriptor.format,
        descriptor.type,
        null
      );
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0 + i,
        gl.TEXTURE_2D,
        texture,
        0
      );
    }
    gl.drawBuffers(this.drawBuffers);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`${label}: framebuffer incompleto (0x${status.toString(16)})`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.drawBuffers(this.drawBuffers);
    gl.viewport(0, 0, this.width, this.height);
  }

  dispose() {
    const gl = this.gl;
    for (let i = 0; i < this.textures.length; i++) gl.deleteTexture(this.textures[i]);
    gl.deleteFramebuffer(this.fbo);
  }
}

export function bindTexture(gl, unit, texture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
}

export function getFormatDescriptors(gl) {
  const floatColor = gl.getExtension('EXT_color_buffer_float');
  const floatLinear = gl.getExtension('OES_texture_float_linear');
  const dataFormat = floatColor
    ? { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
    : { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
  const dataFilter = floatColor && !floatLinear ? gl.NEAREST : gl.LINEAR;
  return {
    floatColor: Boolean(floatColor),
    albedo: { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR },
    data: { ...dataFormat, filter: gl.NEAREST },
    lighting: { ...dataFormat, filter: dataFilter }
  };
}
