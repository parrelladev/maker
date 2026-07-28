# Deploy do Maker

O Maker é um servidor Express convencional. A geração do PNG acontece no navegador do usuário, portanto o servidor não precisa de Chromium, Puppeteer ou bibliotecas gráficas.

## Instalação

```bash
npm ci --omit=dev
PORT=3000 npm start
```

No Windows PowerShell:

```powershell
$env:PORT = 3000
npm start
```

Também é possível criar `config.js` com:

```bash
npm run deploy
```

## Proxy reverso

O proxy deve encaminhar a aplicação inteira, incluindo:

- `/api/templates/*`
- `/api/news/*`
- `/templates/*`
- `/input/*`
- `/vendor/*`

Exemplo de Nginx:

```nginx
server {
    listen 80;
    server_name maker.exemplo.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Observações de produção

- Não é necessário persistir uma pasta de saída: o PNG é baixado diretamente pelo navegador.
- O servidor precisa de acesso HTTP às páginas de notícia e às imagens extraídas.
- Configure limites de requisição e timeout no proxy considerando que a imagem incorporada pode ter até 12 MB.
- Sirva a aplicação por HTTPS para evitar bloqueios de conteúdo misto ao usar fontes ou imagens externas.
- Monitore CPU e memória do processo Node; não devem existir processos Chromium filhos.
