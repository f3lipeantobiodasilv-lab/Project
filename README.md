# AETHER / 2D

Engine gráfica 2.5D em **WebGL2 + GLSL ES 3.00**, sem dependências de runtime. A cena de Elysium Planitia funciona como testbed para MRT, PBR, reflexos screen-space, raymarching atmosférico, nuvens procedurais e denoising edge-aware.

## Executar

Requisitos: Node.js 18+ e um navegador com WebGL2.

```bash
npm run dev
# abrir http://localhost:3000
```

Também é possível servir os arquivos com qualquer servidor HTTP estático. Como os módulos ES são carregados pelo navegador, não abra `index.html` diretamente via `file://`.

## Controles

- **Arrastar na cena:** reposiciona o sol e todas as luzes/sombras dependentes.
- **Espaço:** pausa/retoma o tempo da simulação.
- **R:** restaura os parâmetros iniciais.
- **1–4:** Final, Albedo, Normais e Depth.
- **Resolução interna:** ajusta somente lighting/denoise; o G-Buffer permanece nativo.
- **Resolução adaptativa:** reduz ou recupera a escala em passos de 5% para buscar 60 FPS.

## Pipeline

```text
SceneBatch (1 instanced draw)
        │
        ▼
┌────────────────────── G-Buffer FBO · native ──────────────────────┐
│ RT0 RGBA8    baseColor.rgb + emission                             │
│ RT1 RGBA16F  normal.xy + roughness + metallic                     │
│ RT2 RGBA16F  linearDepth                                          │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
Lighting FBO · internal resolution
  Cook–Torrance + screen shadows + AO + SSR + fog + clouds
        │
        ▼
Denoise FBO · internal resolution
  5×5 bilateral filter guided by normals and depth
        │
        ▼
Default framebuffer · native resolution
  bilinear upsample + bloom + ACES + gamma + vignette
```

`EXT_color_buffer_float` habilita os targets de 16 bits. Sem a extensão, a engine usa `RGBA8` para manter o pipeline funcional; nesse fallback, profundidade e highlights têm menor precisão.

## Organização

```text
src/
  engine.js    Engine2D, game loop, UBO, passes e resolução adaptativa
  gl.js        shaders, programas, FBOs e formatos
  scene.js     batch instanciado e definição da cena
  shaders.js   GLSL do G-Buffer, lighting, denoise e composite
  main.js      integração dos controles e telemetria
```

### Pass 1 — Geometria / materiais

Todos os objetos compartilham um quad instanciado e um único draw call. SDFs no fragment shader recortam nave, rochas, painéis e cargas. Céu, serras e terreno são procedurais. O depth é uma camada linear 2D, não um depth buffer 3D de hardware.

### Pass 2 — Lighting / volumes

- **PBR:** GGX + Smith–Schlick + Fresnel de Schlick em um Cook–Torrance simplificado.
- **SSR:** reflexão calculada da normal 2D, march linear, quatro iterações de refinamento binário, blur proporcional à rugosidade e fade nas bordas.
- **Fog:** raymarch com jitter espacial/temporal, densidade fBm, atenuação exponencial e early exit por transmitância.
- **Nuvens:** campo de ruído 3D animado pelo vento, slices volumétricas, dois taps de light march para self-shadow e projeção de densidade no solo.
- **Sombras:** shadow march sobre o depth linear do G-Buffer.

### Pass 3 — Denoiser

O kernel 5×5 combina quatro pesos:

1. distância espacial;
2. similaridade de profundidade;
3. alinhamento de normais;
4. diferença de luminância.

Vizinhos além dos limites de depth/normal são rejeitados. Isso evita bleeding entre objetos, ao custo de 25 taps por pixel interno.

### Pass 4 — Composite

Reamostragem para a resolução nativa, bloom de baixo custo, tone mapping ACES, gama, vinheta e grain. As views de diagnóstico leem diretamente os attachments do G-Buffer.

## Decisões de performance

- Nenhuma criação explícita de arrays, objetos ou closures no método `render()`.
- UBO `Globals` em binding 0, atualizado com um `Float32Array` persistente.
- Um batch instanciado para toda a geometria; três draws de tela cheia.
- Fullscreen triangle via `gl_VertexID`, sem VBO.
- Resolução independente para geometry e passes pesados.
- `break` por opacidade/transmitância e limites estritos de steps.
- Alvo DPR limitado a 1.5 para evitar custo desproporcional em telas HiDPI.
- Atualizações de DOM/telemetria fora do caminho quente, duas vezes por segundo.

## Limites conscientes

Esta é uma engine **2D/2.5D screen-space**, não um path tracer 3D. SSR só recupera superfícies presentes no G-Buffer e pode falhar em objetos fora da tela ou informações ocultas. O denoiser é espacial, sem histórico temporal, evitando ghosting em uma cena com ruído e vento animados. O alvo de 60 FPS depende de GPU, resolução e preset; use **Performance** ou a resolução adaptativa em hardware integrado.
