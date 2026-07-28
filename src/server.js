const express = require('express');
const config = require('./appConfig');

const templatesRouter = require('./routes/templates');
const newsRouter = require('./routes/news');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));
app.use('/input', express.static('input'));
// expリe templates (HTML/CSS/fonts) para o preview no navegador
app.use('/templates', express.static('templates'));

app.use('/api/templates', templatesRouter);
app.use('/api/news', newsRouter);

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Gerador de artes disponヴvel',
  });
});

app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('[server] erro inesperado:', err);
  res.status(500).json({
    error: 'Erro interno do servidor',
    detail: err.message,
  });
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor rodando em http://localhost:${config.port}`);
});

module.exports = app;
