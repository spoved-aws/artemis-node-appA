require('dotenv').config();
require('./tracing'); // keep if you already have OpenTelemetry setup

const express = require('express');
const axios = require('axios');
const promClient = require('prom-client');
const pino = require('pino');

const app = express();
const PORT = 3001;

// ----------------------
// Structured Logger (IMPORTANT)
// ----------------------
const logger = pino({
    level: 'info',
});

// ----------------------
// Prometheus Metrics
// ----------------------
const httpRequestCounter = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status_code'],
});

const requestDurationHistogram = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'path', 'status_code'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
});

const requestDurationSummary = new promClient.Summary({
    name: 'http_request_duration_summary_seconds',
    help: 'Summary of HTTP request durations',
    labelNames: ['method', 'path', 'status_code'],
    percentiles: [0.5, 0.9, 0.99],
});

// Gauge example
const gauge = new promClient.Gauge({
    name: 'node_gauge_example',
    help: 'Example gauge metric',
    labelNames: ['method', 'status'],
});

// ----------------------
// Helpers
// ----------------------
const simulateAsyncTask = async () => {
    const randomTime = Math.random() * 2;
    return new Promise((resolve) =>
        setTimeout(resolve, randomTime * 1000)
    );
};

app.use(express.json());

// ----------------------
// Observability Middleware
// ----------------------
app.use((req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;

        httpRequestCounter.labels({
            method: req.method,
            path: req.path,
            status_code: res.statusCode,
        }).inc();

        requestDurationHistogram.labels({
            method: req.method,
            path: req.path,
            status_code: res.statusCode,
        }).observe(duration);

        requestDurationSummary.labels({
            method: req.method,
            path: req.path,
            status_code: res.statusCode,
        }).observe(duration);

        logger.info({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration,
        }, 'http request completed');
    });

    next();
});

// ----------------------
// Routes
// ----------------------
app.get('/', (req, res) => {
    logger.info('home endpoint hit');
    res.status(200).json({ status: 'running 🚀' });
});

app.get('/healthy', (req, res) => {
    logger.info('health check');
    res.status(200).json({ status: 'healthy ✅' });
});

app.get('/logs', (req, res) => {
    logger.info({ event: 'log-test' }, 'info log generated');
    logger.warn({ event: 'log-test' }, 'warn log generated');
    logger.error({ event: 'log-test' }, 'error log generated');

    res.json({ message: 'logs generated' });
});

app.get('/serverError', (req, res) => {
    logger.error('intentional server error');
    res.status(500).json({ error: 'internal error' });
});

app.get('/notFound', (req, res) => {
    logger.warn('not found route hit');
    res.status(404).json({ error: 'not found' });
});

app.get('/example', async (req, res) => {
    const endGauge = gauge.startTimer({
        method: req.method,
        status: res.statusCode,
    });

    await simulateAsyncTask();

    endGauge();
    res.send('async task completed');
});

app.get('/call-service-b', async (req, res) => {
    try {
        const response = await axios.get(`${process.env.SERVICE_B_URI}/hello`);
        logger.info('service-b called successfully');

        res.send(`<h1>Service B says: ${response.data}</h1>`);
    } catch (err) {
        logger.error({ err }, 'error calling service-b');
        res.status(500).send('error calling service-b');
    }
});

app.get('/crash', () => {
    logger.error('crashing intentionally');
    process.exit(1);
});

// ----------------------
// Metrics Endpoint
// ----------------------
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

// ----------------------
// Start Server
// ----------------------
app.listen(PORT, () => {
    logger.info(`service running on port ${PORT}`);
});