# Tagify

Aplicativo desktop para **criar e imprimir etiquetas em impressoras térmicas**, construído com **Tauri + React + TypeScript**.

Monte o layout da etiqueta visualmente, defina campos dinâmicos (compartilhados ou individuais) e imprima uma unidade ou um lote inteiro com precisão milimétrica em mídia térmica.

---

## ✨ Funcionalidades

- **Editor visual** (canvas Konva) com tamanhos padrão de etiqueta (de 100×150 a 34×23 mm) ou dimensões personalizadas.
- **Campos dinâmicos** de texto:
  - **Compartilhado** — mesmo valor para todas as etiquetas do template (ex.: logo, endereço, validade).
  - **Individual** — varia por item (ex.: nome do produto).
- **Códigos** de barras (JsBarcode) e **QR Code**.
- **Impressão individual** (1 etiqueta) ou **em lote** (várias linhas item + quantidade de uma só vez).
- **Importação de pedidos** a partir de planilhas (`xlsx`).
- **Armazenamento local** em SQLite, gerenciado pelo backend Rust.
- **Atualizações automáticas** e sistema de **licenciamento/ativação**.

---

## 🚀 Como rodar

Pré-requisitos: [Node.js](https://nodejs.org/), [Rust](https://www.rust-lang.org/tools/install) e as [dependências do Tauri](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # desenvolvimento (hot reload)
npm run tauri build    # gera o instalador para distribuição
```

---

## 🧩 Conceitos

- **Template**: o design de uma etiqueta (tamanho em mm + elementos). Cada elemento de texto pode ser um campo dinâmico marcado como **compartilhado** ou **individual**.
- **Label (item)**: uma instância de um template, guardando apenas os valores dos campos individuais.

### Abas

| Aba | O que faz |
|-----|-----------|
| **Canva** | Escolhe o tamanho, monta o layout com texto/imagem/códigos, marca campos como compartilhados/individuais e salva o template. |
| **Individual** | Cria/seleciona um item, preenche os campos individuais e imprime 1 etiqueta. |
| **Lote** | Adiciona quantas linhas quiser (item + quantidade) e imprime tudo de uma vez. |

---

## 🗄️ Armazenamento

SQLite em `appdata` (`etiquetas.db`), criado e migrado pelo backend Rust ([src-tauri/src/lib.rs](src-tauri/src/lib.rs)). Tabelas: `templates` e `labels`.

## 🖨️ Impressão

O canvas (Konva) é rasterizado em alta resolução (300 DPI) e impresso via uma página HTML com `@page` no tamanho exato em mm — cada cópia em uma página, ideal para mídia térmica.

---

## 📁 Estrutura

```
src/
  types.ts            modelos de dados
  constants.ts        tamanhos padrão de etiqueta, DPI
  db/index.ts         repositório SQLite (tauri-plugin-sql)
  store/useStore.ts   estado global (zustand)
  render.ts           resolução de valores compartilhado/individual
  print.ts            rasterização + impressão
  orderImport.ts      importação de pedidos via planilha
  license.ts          ativação/validação de licença
  components/
    LabelStage.tsx    canvas Konva (editor e preview)
    CanvasArea.tsx    área central do canvas
    SizeSelector.tsx  seletor de tamanho agrupado
    panels/           menus laterais por aba
src-tauri/            backend Rust + migrações SQLite
supabase/             edge functions de ativação/validação de licença
```

---

## 🛠️ Stack

- **Frontend**: React 19, TypeScript, Zustand, Konva / react-konva
- **Desktop**: Tauri 2 (Rust)
- **Dados**: SQLite (`@tauri-apps/plugin-sql`)
- **Códigos**: JsBarcode, qrcode
- **Build**: Vite

---

## 📄 Licença

Veja [LICENSING.md](LICENSING.md).
