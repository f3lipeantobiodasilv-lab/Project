# Super Mario Maker 2 Web Engine (1:1 Web Recreation)

Este repositório contém o projeto de recriação 1:1 do motor de física, renderização e editor de fases (Course Maker) de **Super Mario Maker 2 (SMM2)** rodando nativamente na web via TypeScript e WebGL/Three.js.

> **Regras Absolutas:**
> 1. ZERO conteúdo procedural. Todos os assets (modelos 3D, texturas, sons) devem ser extraídos do pacote de dados de laboratório fornecido via link externo (`https://pixeldrain.com/api/file/vXK1wWuM`).
> 2. O agente deve criar e executar todos os seus próprios scripts de extração/conversão via terminal na pasta `/tmp`.
> 3. O desenvolvimento deve seguir estritamente a execução ordenada por **Fases**.

---

## Roadmap de Execução (Fases)

### Módulo 1: Extração e Automação de Assets (Terminal)
- [ ] **Fase 1: Download e Setup do Workspace**
  - Fazer o download do pacote de assets comprimidos via terminal usando o link Pixeldrain fornecido (`https://pixeldrain.com/api/file/vXK1wWuM`).
  - Configurar e estruturar a pasta `/tmp` para os scripts de conversão temporários.
- [ ] **Fase 2: Descompressão de Contêineres (Yaz0 / SZS)**
  - Escrever script Python para varrer e descompactar arquivos de pacotes compactados.
- [ ] **Fase 3: Conversor de Superfícies Gráficas (BNTX)**
  - Escrever script para converter dados de texturas em imagens PNG limpas com canal alfa em `/src/assets/textures/`.
- [ ] **Fase 4: Conversor de Malhas 3D (BFRES)**
  - Escrever script para converter modelos e esqueletos tridimensionais para o formato aberto glTF/GLB em `/src/assets/models/`.
- [ ] **Fase 5: Processamento de Áudio**
  - Extrair e converter os streams de áudio dos bancos de dados binários em arquivos `.wav`/`.ogg` em `/src/assets/audio/`.

---

### Módulo 2: Core Engine Web & Render Pipeline
- [ ] **Fase 6: Setup do Projeto Web & Game Loop**
  - Inicializar `package.json`, TypeScript, Vite e Three.js/WebGL.
  - Criar um loop de tempo fixo (*fixed time step*) a 60 Hz determinístico.
- [ ] **Fase 7: Renderizador 2.5D & Câmera**
  - Configurar projeção de câmera ortográfica/perspectiva lateral.
  - Gerenciar camadas de renderização Z-index (Backdrop parallax, Tilemap, Entidades, UI).

---

### Módulo 3: Motores de Física (1:1 Multi-Style)
- [ ] **Fase 8: Sistema de Colisão por Grid & Slopes**
  - Colisão baseada em matriz com suporte a rampas/encostas e algoritmo Swept AABB.
- [ ] **Fase 9: Física de New Super Mario Bros. U (NSMBU)**
  - Implementar matemática sub-pixel, corrida, pulo variável, Wall-Slide, Wall-Jump e Ground Pound.
- [ ] **Fase 10: Física Retrô (SMB1, SMB3, SMW)**
  - **SMB1:** Física rígida e saltos fixos.
  - **SMB3:** P-Meter (corrida/voo) e deslize em rampas.
  - **SMW:** Momentos de inércia, Spin Jump e carregamento de itens.
- [ ] **Fase 11: Gerenciador de Alternância de Física**
  - Permitir troca em tempo real do perfil de física ao mudar o estilo do mapa.

---

### Módulo 4: Editor de Fases (Course Maker)
- [ ] **Fase 12: Interface & Grid Snapping**
  - Criar a grade de edição, fluxo de navegação e paleta de itens/ferramentas.
- [ ] **Fase 13: Lógica de Colocação & Modo Jogar/Editar**
  - Permitir drag-and-drop de blocos, moedas, canos e empilhamento de inimigos (*stacking*).
  - Alternância instantânea entre modo Editor (pausado) e modo Jogo.
- [ ] **Fase 14: Serialização (Save/Load)**
  - Exportar e importar os níveis criados em arquivos `.json` estruturados.

---

## Instruções de Comando para o Agente
Ao iniciar o trabalho em uma fase, execute apenas as tarefas marcadas naquela fase específica, verifique o funcionamento criando testes ou executando build, marque o checkbox correspondente no `README.md` e informe o progresso.
