#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const defaultPort = require('./config.example').port || 3000;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question(`Porta (${defaultPort}): `, (answer) => {
  const port = Number(answer || defaultPort);
  fs.writeFileSync(path.resolve('config.js'), `module.exports = { port: ${port} };\n`);
  console.log('Configuração salva em config.js. Use PORT para sobrescrever via ambiente.');
  rl.close();
});
