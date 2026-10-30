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

- **Arrastar na cena:** reposiciona o sol e todas as luzes/sombras dependentes. Arraste-o para abaixo do horizonte (`y ≈ 0.245`) para entrar no crepúsculo/noite: luz direta, SSR, nuvens e fog apagam, e só o ambiente de luar e os emissivos (nave, lâmpadas, estrelas) permanecem.
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
  Cook–Torrance + 4 point lights + screen shadows + AO + SSR + fog + clouds
        │
        ▼
Denoise FBO · internal resolution
  5×5 bilateral filter guided by normals and depth
        │
        ▼
PostSource FBO · dust motes GPU + debris da física (aditivo, sem feedback)
        │
        ├─► Luminance chain (log) → 1×1 → adapted exposure ping-pong
        ├─► Bloom: prefilter → Kawase down ×4 → Kawase up ×4 (5 níveis)
        └─► God rays: raymarch radial pixel→sol ocluído pelo RT_Depth
        │
        ▼
Default framebuffer · native resolution
  Uber-post: chromatic aberration + bloom + god rays + auto-exposure
             + ACES + gamma + vignette + film grain
```

`EXT_color_buffer_float` habilita os targets de 16 bits. Sem a extensão, a engine usa `RGBA8` para manter o pipeline funcional; nesse fallback, profundidade e highlights têm menor precisão.

## Organização

```text
src/
  engine.js    Engine2D, game loop, UBO, cadeia de passes e sistemas
  gl.js        shaders, programas, FBOs, formatos e uniforms
  scene.js     batch instanciado, grid espacial, culling e cena
  shaders.js   GLSL de geometria, lighting, pós, poeira e debris
  post         (em engine.js/shaders.js) luminância, Kawase, god rays, Uber
  lights.js    DynamicLightBank: 4 luzes pontuais animadas
  particles.js DustMotes GPU + DebrisParticles CPU (pool sem alocação)
  spatial.js   SpatialGrid, interseção de bounds e política de LOD
  Physics.js   círculos × terreno/AABB, impulso, eventos de impacto
  assets.js    AssetManager assíncrono (fetch, ImageBitmap, WebAudio)
  audio.js     SpatialAudioEngine HRTF + convolver procedural
  main.js      integração dos controles e telemetria
```

### Pass 1 — Geometria / materiais

Todos os objetos compartilham um quad instanciado e um único draw call. SDFs no fragment shader recortam nave, rochas, painéis e cargas. Céu, serras e terreno são procedurais. O depth é uma camada linear 2D, não um depth buffer 3D de hardware.

### Pass 2 — Lighting / volumes

- **Ciclo dia/noite:** `SUN_CYCLE` (em `shaders.js`) deriva `sunElevation` de `uSun.y` relativo ao horizonte (`0.245`), `dayFactor = smoothstep(-0.15, 0.05, sunElevation)` para céu/fog/nuvens/ambiente e `directFactor = smoothstep(0.0, 0.08, sunElevation)` para a luz direta e o SSR — ambos chegam a zero à noite. O emissivo do G-Buffer é somado só depois de nuvens e fog, então luzes artificiais não apagam com o sol.
- **Oclusão do sol (screen-space):** `computeSunVisibility()` amostra a pegada do disco solar (17 taps) no RT de depth do G-Buffer — céu = `1.0`, sólidos ≤ `0.86` — e a fração visível atenua o glow aditivo do fog e o forward-scattering Mie. A radiância direta não usa esse fator (ela já tem sombra por-pixel via shadow march), e o bloom genérico do composite não é tocado: sem fonte solar no lighting target, não há bloom solar para espalhar, e o bloom dos emissivos permanece. Nuvens são procedurais no lighting pass e não escrevem no G-Buffer, portanto não ocluem o sol nesse teste.
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

### Pass 4 — Dust & debris

`DustMotes` é instanciado e 100% GPU: a posição deriva de seed + tempo no vertex shader e o fragment amostra o buffer de luz acumulada na posição da partícula, somando o glow analítico das luzes pontuais — poeira acende ao cruzar o farol/exaustão. `DebrisParticles` é um pool CPU pré-alocado (swap-with-last) alimentado pelos impactos da física. Ambos são desenhados aditivamente sobre uma cópia da cena, sem feedback loop de framebuffer.

### Pass 5 — Cadeia cinematográfica (Pillar 1)

- **Auto-exposição:** downsample em espaço log (média geométrica) de `internal/4` até `1×1`; um passe de adaptação ping-pong `1×1` aplica `Exposure += (Target − Exposure)·(1 − e^(−dt·speed))`, sem readback para a CPU.
- **Bloom:** prefilter high-pass com threshold + joelho suave e pirâmide Kawase de 5 níveis (4 downs + 4 ups aditivos).
- **God rays:** raymarch radial de cada pixel até o sol (16–32 passos por preset), acumulando apenas céu brilhante; o `RT_Depth` interrompe os feixes nas silhuetas — atrás das serras, os raios somem junto do glow (reusa a oclusão screen-space do sol).
- **Uber-post:** aberração cromática `offset = distortion·r²`, soma de bloom + god rays em HDR, exposição do usuário × exposição adaptada, ACES, gama, vinheta por `smoothstep` e grão procedural animado. As views de diagnóstico continuam lendo o G-Buffer cru.

### Luzes dinâmicas (Pillar 2)

Quatro luzes pontuais (farol com sweep, exaustão com flicker, beacon pulsante, work light) avaliadas por-pixel no lighting pass com o mesmo Cook–Torrance do sol: atenuação `1/(1 + 0.9d + 6d²) · (1 − (d/radius)⁴)²` e sombra por marcha curta pixel→luz sobre o `RT_Depth`. São independentes do ciclo dia/noite — à noite, são elas (e os emissivos) que iluminam a cena.

### Sistemas (Pillar 6)

- **Culling/LOD:** `SpatialGrid` (células de `0.125`) indexa os AABBs da cena; `SceneBatch.setViewport()` compacta só as instâncias visíveis no buffer instanciado, preservando a painter's order, e grava o LOD em `vColor.a` (o fragment suprime micro-detalhe em LOD 2). A telemetria mostra `visíveis/total` e a distribuição de LOD.
- **Física:** `PhysicsWorld` integra um corpo-sonda em queda contínua contra o heightfield (`terrainApprox`) e AABBs da nave/painéis/cargas, com restituição e atrito; impactos acima do limiar disparam debris, poeira e (se ligado) áudio de impacto espacializado. O corpo é visível como marcador incandescente com rastro.
- **Assets:** `AssetManager` carrega texturas (`fetch` → `createImageBitmap` → upload WebGL), áudio (`decodeAudioData`) e shaders/texto/JSON com progresso por item e por bytes; está exposto em `window.aether.assets` e pré-carrega `shaders.js` na boot como demonstração (`ASSETS · 100%` no rodapé do painel).
- **Áudio espacial:** `SpatialAudioEngine` (opt-in pelo toggle, por política de autoplay) com `PannerNode` HRTF por emissor, convolver com IR procedural de cânion (dry/wet), vento e hum da nave sintetizados e impactos posicionados no ponto da colisão.

## Decisões de performance

- UBO `Globals` em binding 0 (8× `vec4`), atualizado com um `Float32Array` persistente.
- Um batch instanciado para toda a geometria visível (grid + culling); fullscreen triangle via `gl_VertexID`, sem VBO.
- Resolução independente para geometry e passes pesados; bloom/god rays em meia resolução ou menos, adaptação em `1×1`.
- Pools de partículas pré-alocados; física com substeps fixos e sem alocação por frame.
- `break` por opacidade/transmitância e limites estritos de steps em todos os raymarches.
- Alvo DPR limitado a 1.5 para evitar custo desproporcional em telas HiDPI.
- Atualizações de DOM/telemetria fora do caminho quente, duas vezes por segundo.
- Draw calls reais por frame (todos os passes) exibidos na telemetria — a cadeia completa custa ~25 draws em vez dos 4 originais; desligue bloom/god rays/dust nos toggles para recuperar performance.

## Limites conscientes

Esta é uma engine **2D/2.5D screen-space**, não um path tracer 3D. SSR e god rays só recuperam informação presente na tela; o depth é uma camada 2D (não há oclusão 3D real entre luzes pontuais e geometria fora do plano). O denoiser é espacial, sem histórico temporal, evitando ghosting em uma cena com ruído e vento animados. A física usa uma aproximação JS do terreno (`terrainApprox`, sem o ruído fino do shader), então o contato pode diferir ~0.01 do relevo renderizado. O alvo de 60 FPS depende de GPU, resolução e preset; use **Performance**, os toggles de pós ou a resolução adaptativa em hardware integrado.
