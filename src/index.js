require('dotenv').config();
require('./tracing'); // MUST stay first for OTel instrumentation

const express = require('express');
const pino = require('pino');
const axios = require('axios');
const promClient = require('prom-client');

const app = express();
const PORT = 3001;

// -------------------- LOGGER --------------------
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: process.env.OTEL_SERVICE_NAME || 'nodejs-app-a'
  }
});

// -------------------- PROMETHEUS --------------------
const httpRequestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status_code']
});

const requestDurationHistogram = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Request duration',
  labelNames: ['method', 'path', 'status_code']
});

// -------------------- MIDDLEWARE --------------------
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;

    const logLevel =
      res.statusCode >= 500 ? 'error' :
      res.statusCode >= 400 ? 'warn' : 'info';

    logger[logLevel]({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      msg: 'http request completed'
    });

    httpRequestCounter.inc({
      method: req.method,
      path: req.path,
      status_code: res.statusCode
    });

    requestDurationHistogram.observe(
      {
        method: req.method,
        path: req.path,
        status_code: res.statusCode
      },
      duration
    );
  });

  next();
});

// -------------------- ROUTES --------------------
app.get('/', (req, res) => {
  logger.info({ msg: 'home endpoint hit' });
  res.json({ status: 'running' });
});

app.get('/healthy', (req, res) => {
  logger.info({ msg: 'health check' });
  res.json({ status: 'healthy' });
});

// -------------------- ERROR --------------------
app.get('/serverError', (req, res) => {
  logger.error({ msg: 'manual server error triggered' });
  res.status(500).json({ error: 'Internal Server Error' });
});

// -------------------- LOAD TEST --------------------
app.get('/load', (req, res) => {
  const load = Math.random();

  if (load > 0.7) {
    logger.warn({ msg: 'high load detected', load });
  } else {
    logger.info({ msg: 'normal load', load });
  }

  res.json({ load });
});

// -------------------- CRASH (IMPORTANT) --------------------
app.get('/crash', (req, res) => {
  logger.fatal({ msg: 'crashing intentionally', reason: 'test endpoint' });

  res.status(500).send('crashing...');

  setTimeout(() => {
    process.exit(1);
  }, 200);
});

// -------------------- SERVICE CALL --------------------
app.get('/call-service-b', async (req, res) => {
  try {
    const response = await axios.get(`${process.env.SERVICE_B_URI}/hello`);

    logger.info({ msg: 'service-b called successfully' });

    res.send(`<h1>Service B: ${response.data}</h1>`);
  } catch (err) {
    logger.error({ msg: 'service-b call failed', error: err.message });
    res.status(500).send('error calling service-b');
  }
});

// -------------------- METRICS --------------------
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

// -------------------- START --------------------
app.listen(PORT, () => {
  logger.info({ msg: `service running on port ${PORT}` });
});