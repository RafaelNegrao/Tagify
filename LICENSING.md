# Licenciamento do Etiquetas

Sistema de licença **offline** com **teste de 2 dias** e **chave perpétua por máquina**.

- Sem servidor: o app valida a assinatura da chave localmente.
- A chave é uma assinatura **Ed25519** sobre `etiquetas-license-v1|<MACHINE-ID>`.
- O app só conhece a **chave pública** (embutida em `src-tauri/src/license.rs`).
- A **chave privada** (seed) fica só com você, em `tools/keygen/secret.key` (no `.gitignore`).

## Como funciona para o cliente

1. Cliente instala e usa por **2 dias** (trial). Um aviso aparece com os dias restantes.
2. Ao fim do trial, o app **bloqueia** numa tela de ativação que mostra o **ID do computador**.
3. O cliente te envia esse ID (+ comprovante de compra).
4. Você gera a chave para aquele ID (abaixo) e envia ao cliente.
5. Cliente cola a chave e ativa. Fica liberado para sempre **naquela máquina**.

> O trial e a chave ficam no registro do Windows em `HKCU\Software\Etiquetas`.

## Gerar uma chave para um cliente

Três formas (todas exigem `tools/keygen/secret.key` presente):

### 1. Janela (mais fácil) — `tools/keygen-app`
Dois cliques em **`tools/keygen-app/abrir-gerador.bat`** (ou rode o exe
`tools/keygen-app/target/release/etiquetas-keygen-app.exe`). Abre uma janela:
cole o Machine ID, clique **Gerar chave**, clique **Copiar chave**.

### 2. Console interativo — `tools/keygen`
Dois cliques em **`tools/keygen/gerar-chave.bat`**, cole o Machine ID e tecle Enter.

### 3. Linha de comando
```sh
cd tools/keygen
cargo run -- A1B2-C3D4-E5F6-0718    # use o MACHINE-ID que o cliente enviou
```

Saída:

```
Machine ID : A1B2-C3D4-E5F6-0718
Chave      : <chave base64 — envie isto ao cliente>
```

> ⚠️ O exe da janela (`keygen-app`) tem a **chave privada embutida**. É de uso
> exclusivo do vendedor — **nunca** distribua esse exe a clientes.

## Gerar o instalador (.exe)

```sh
npm run tauri build
```

O instalador/executável sai em `src-tauri/target/release/bundle/`.

## Trocar o par de chaves (se a chave privada vazar)

Gere um novo par com Node:

```sh
node -e '
const c=require("crypto");
const {publicKey,privateKey}=c.generateKeyPairSync("ed25519");
const pub=publicKey.export({type:"spki",format:"der"}).subarray(-32);
const seed=privateKey.export({type:"pkcs8",format:"der"}).subarray(-32);
console.log("PUBLIC_RUST=["+[...pub].join(", ")+"]");
console.log("SEED_HEX="+seed.toString("hex"));
'
```

- Cole `PUBLIC_RUST` em `LICENSE_PUBLIC_KEY` (`src-tauri/src/license.rs`).
- Salve `SEED_HEX` em `tools/keygen/secret.key`.
- Recompile o app. **Chaves antigas deixam de funcionar.**

## Limitações (licença offline)

- Sem servidor não há revogação remota nem proteção total contra usuários avançados
  (ex.: apagar o registro reinicia o trial). Isso é esperado em DRM offline e serve
  para incentivar a compra, não para ser inquebrável.
