const express = require('express');
const config = require('./appConfig');
const {
  getGlobalErrorResponse,
  logRequestError,
} = require('./lib/httpErrorResponse');

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

function globalErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const response = getGlobalErrorResponse(err);
  logRequestError('server', req, err, {
    status: response.status,
    code: response.body.code,
  });
  return res.status(response.status).json(response.body);
}

app.use(globalErrorHandler);

if (require.main === module) {
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Servidor rodando em http://localhost:${config.port}`);
  });
}

module.exports = app;
module.exports.globalErrorHandler = globalErrorHandler;
