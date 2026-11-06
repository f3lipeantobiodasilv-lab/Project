# Hybrid Graphics Lab

Demonstração autocontida de um **overlay analítico híbrido**, para Roblox Studio. Não usa assets, plugins ou permissões de imagem.

## Abrir e jogar

1. Abra **`HybridGraphicsLab.rbxlx`** no Roblox Studio.
2. Clique em **Play** (F5). O personagem nasce na sala, voltado para as esferas; mova a câmera para observar os reflexos no piso.
3. Use **EFEITO: ON/OFF** para comparar com o rasterizador e **QUALIDADE: BAIXA/ALTA** para trocar a resolução e as amostras. O efeito começa ligado.

Use **Play**, não o botão **Run** isolado: Run simula apenas o servidor e não executa `LocalScripts` nem cria a interface de um jogador. A gravidade é 196,2 e `CharacterAutoLoads` está ligado.

## Como funciona

O Roblox renderiza a cena e a iluminação nativas. Um LocalScript em `StarterPlayerScripts` calcula raios a partir de `Workspace.CurrentCamera`, com interseções matemáticas raio/esfera e raio/plano; não há `Workspace:Raycast`. Um `ScreenGui` em `StarterGui` recebe uma grade de Frames transparentes. Só pixels com reflexão analítica, AO ou sombra recebem cor; o restante deixa a cena nativa visível. A imagem é atualizada no `RenderStepped`, limitada a 15 atualizações completas por segundo. A qualidade baixa usa 32×18 pixels, duas amostras e um salto; a alta usa 48×27, cinco amostras e dois saltos. Padrões fixos amostram uma luz de área virtual e o hemisfério de AO. Os parâmetros estão em `PipelineConfig`.

As geometrias são consultadas dinamicamente via tag `RayTraceTarget`. `Part` esférica precisa ter as três dimensões iguais; em `Part` bloco, somente a face superior retangular é tratada como plano. O modelo inclui um piso metálico e três esferas Neon marcados com a tag. Cor e posição são capturadas a cada atualização.

### Limitações importantes

- Não é um path tracer físico, nem um acesso ao color/depth buffer do Roblox: reflexos usam a cor aproximada dos objetos analíticos, sem materiais, texturas, luzes reais ou reflexo do ambiente rasterizado. A luz de área é virtual e independente das luzes da cena.
- Sem depth buffer, o overlay pode aparecer por cima de personagens, paredes ou outros objetos nativos não representados analiticamente. Sombras e AO só consideram os alvos selecionados; o restante da cena é invisível aos raios.
- A grade é propositalmente pixelada; o efeito é atualizado em blocos a 15 Hz e pode apresentar atraso durante movimento. A opção alta custa mais CPU/UI; não há garantia de desempenho em todos os dispositivos.

## Arquivos e reconstrução

- `default.project.json`: árvore Rojo; `src/Workspace/Sala.rbxmx` contém a sala e suas tags, `src/ReplicatedStorage/GraphicsShared` os módulos e `src/StarterPlayer/StarterPlayerScripts` o controlador.
- Com Rojo 7 instalado: `rojo build default.project.json -o HybridGraphicsLab.rbxlx`.
- Alternativa autocontida com Python 3: `python3 scripts/build_place.py`. Ela regenera **tanto** `src/Workspace/Sala.rbxmx` (a cena definida no script) **quanto** o `.rbxlx` a partir das mesmas fontes. Alterações feitas diretamente no XML da sala serão sobrescritas por esse comando; altere o script ou use Rojo para preservá-las.
- Testes estruturais: `python3 -m unittest discover -s tests -v`.
- Testes matemáticos com o CLI oficial Luau: `luau tests/RayMath.test.luau`. Compilação sintática: `luau-compile src/ReplicatedStorage/GraphicsShared/*.luau src/StarterPlayer/StarterPlayerScripts/*.luau tests/*.luau`.

Todos os fontes Luau usam `--!strict`. O analisador CLI independente não inclui as definições Roblox (`game`, `Vector3`, instâncias e resolução de módulos do DataModel); portanto a verificação de tipos completa deve ser feita no Roblox Studio com a árvore do projeto carregada. O compilador CLI verifica a sintaxe, não garante sozinho a ausência de erros de tipo. Studio/Play e build Rojo devem ser verificados no ambiente Roblox/Rojo.
