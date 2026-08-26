# DogSync

Extensão para **VS Code** e **Cursor** que sincroniza o workspace local com um servidor remoto via **SFTP (SSH)** ou **FTP/FTPS**.

**Requisitos:** VS Code / Cursor `^1.74.0` · Node.js **20+** (só para compilar o VSIX)

## Funcionalidades

- Upload ao guardar, envio/descarga manual, globs de ignore, mapeamento local → remoto
- Várias conexões nomeadas em `.vscode/sync.jsonc` (JSONC)
- Painel lateral: ligar, navegar ficheiros remotos, abrir cópia temporária, eliminar no servidor (com confirmação)
- Ficheiros remotos grandes (~45 MiB+): pré-visualização só dos últimos 8 MiB; esse temp **não** faz upload ao guardar
- Conexão padrão = **primeira chave** no `sync.jsonc` (reordenar na árvore)

## Instalação

Não está no Marketplace. Instale a partir de um ficheiro `.vsix`.

### Opção A — Release no GitHub (recomendado)

1. Abra [Releases](https://github.com/adrianogonca/sftp-dogsync/releases) e descarregue `sftp-sync-vps-x.y.z.vsix` (quando existir).
2. No Cursor ou VS Code: **Extensions** → menu `...` → **Install from VSIX…** → escolha o ficheiro.
3. Recarregue a janela: paleta → **Developer: Reload Window** (ou **DogSync: Recarregar janela do editor**).

### Opção B — Compilar a partir do código

```bash
git clone git@github.com:adrianogonca/sftp-dogsync.git
cd sftp-dogsync
npm install
npm run empacotar
```

Gera `sftp-sync-vps-<versão>.vsix` na raiz do projeto. Instale como na opção A, passo 2.

**CLI (Cursor):**

```bash
cursor --install-extension ./sftp-sync-vps-0.5.0.vsix --force
```

**CLI (VS Code):**

```bash
code --install-extension ./sftp-sync-vps-0.5.0.vsix --force
```

Substitua o nome do ficheiro pela versão gerada.

### Desenvolvimento

```bash
npm install
npm run compilar   # ou npm run vigiar
npm run testar     # testes unitários
```

Abra esta pasta no editor e prima **F5** (Run Extension). Após alterações em `src/`, recompile e recarregue a janela de desenvolvimento.

## Configuração

Copie [`.vscode/sync.jsonc.example`](.vscode/sync.jsonc.example) para `.vscode/sync.jsonc`.

```jsonc
{
  "Production": [
    {
      "protocol": "sftp",
      "host": "example.com",
      "port": 22,
      "username": "deploy",
      "sshPasswordAuthentication": false,
      "privateKeyPath": "C:\\Users\\YOUR_USER\\.ssh\\id_ed25519",
      "useSshAgent": false,
      "strictHostKeyChecking": false,
      "knownHostsPath": "",
      "remoteRoot": "/var/www/html/app",
      "uploadOnSave": true
    }
  ]
}
```

| Campo | Descrição |
|---|---|
| `protocol` | `sftp` (predefinição) ou `ftp` |
| `host` | Hostname ou IP (sem `sftp://` / `ftp://`) |
| `port` | SSH `22` ou FTP `21` |
| `username` | Utilizador remoto |
| `privateKeyPath` | Caminho absoluto da chave privada SSH |
| `sshPasswordAuthentication` | `true` = utilizador + senha no cofre (deixe `privateKeyPath` vazio) |
| `useSshAgent` | `true` = agente SSH (`SSH_AUTH_SOCK`) em vez de ficheiro de chave |
| `strictHostKeyChecking` | `true` = validar host key contra `knownHostsPath` (estilo OpenSSH) |
| `knownHostsPath` | Caminho para `known_hosts` quando `strictHostKeyChecking` é true |
| `remoteRoot` | Diretório base remoto (`/` assumido em FTP se vazio) |
| `localSubfolder` | Subpasta local opcional mapeada para `remoteRoot` |
| `uploadOnSave` | Enviar ao guardar (Ctrl+S) |
| `deleteRemoteOnLocalDelete` | Apagar no servidor ao apagar local no explorador (destrutivo; predefinição `false`) |
| `ignorePatterns` | Globs relativos à raiz local |
| `ftpSecurityMode` | Só FTP: `explicitFtps` (predefinição) ou `plainFtp` |
| `trustFtpSelfSignedCertificate` | FTPS: aceitar certificado TLS autoassinado |

Palavras-passe e passphrases de chave ficam no **Secret Storage** do editor, nunca no JSON.

| Comando (paleta) | Uso |
|---|---|
| DogSync: Definir palavra-passe da chave privada | Passphrase da chave SSH |
| DogSync: Definir palavra-passe SSH (utilizador+senha) | Senha SSH por conexão |
| DogSync: Definir palavra-passe FTP (conta FTP) | Senha FTP por conexão |
| DogSync: Testar ligação | Testa SFTP/FTP com a config atual |

### Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+Alt+U` / `Cmd+Alt+U` | Enviar ficheiro atual |
| `Ctrl+Alt+D` / `Cmd+Alt+D` | Descarregar caminho atual |

Menu do explorador: **DogSync: Enviar para o servidor** / **DogSync: Descarregar do servidor**.

### Definição do workspace

| Chave | Descrição |
|---|---|
| `sftpSync.enabled` | Liga/desliga a extensão neste workspace. Dados de conexão vão no `sync.jsonc`, não aqui. |

Na primeira ativação, definições legadas em `settings.json` (`sftpSync.host`, etc.) migram uma vez para `sync.jsonc` se o ficheiro de sync estiver vazio.

## Segurança

- **Não** commitar `.vscode/sync.jsonc` ou `.vscode/settings.json` com hosts ou utilizadores reais. Use só os ficheiros `*.example`.
- Nunca coloque senhas no JSON. Use os comandos do cofre.
- Mantenha `.env` e chaves privadas em `ignorePatterns`.
- Prefira SFTP ou `explicitFtps`; `plainFtp` envia credenciais em claro.

## Contribuir

```bash
npm run compilar
npm run testar
```

Reporte problemas em [Issues](https://github.com/adrianogonca/sftp-dogsync/issues).

## Licença

[MIT](LICENSE)
