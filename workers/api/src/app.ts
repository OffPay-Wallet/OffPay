import 'reflect-metadata';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { authenticationMiddleware } from './lib/auth';
import { corsMiddleware, handlePreflight } from './lib/cors';
import { errorResponse, errorResponseFromAppError, toAppError } from './lib/errors';
import {
  requestContextMiddleware,
  requestLoggingMiddleware,
  writeOperationalLog,
} from './lib/logging';
import { getWorkerConfigStatus, toPublicWorkerConfigStatus } from './lib/config';
import bootstrapRoutes from './routes/bootstrap';
import capabilitiesRoutes from './routes/capabilities';
import marketRoutes from './routes/market';
import offlineRoutes from './routes/offline';
import pendingRoutes from './routes/pending';
import paymentRoutes from './routes/payment';
import privacyRoutes from './routes/privacy';
import rpcRoutes from './routes/rpc';
import riskRoutes from './routes/risk';
import streamRoutes from './routes/stream';
import swapRoutes from './routes/swap';
import umbraRoutes from './routes/umbra';
import walletRoutes from './routes/wallet';
import type { AppEnv } from './lib/types';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', requestContextMiddleware);
app.use('*', secureHeaders());
app.use('*', requestLoggingMiddleware);
app.use('*', corsMiddleware);
app.options('*', handlePreflight);
app.use('*', authenticationMiddleware);

app.get('/health', (context) => {
  const configStatus = getWorkerConfigStatus(context.env);
  const publicConfigStatus = toPublicWorkerConfigStatus(configStatus);
  const status = !configStatus.ready ? 'misconfigured' : configStatus.degraded ? 'degraded' : 'ok';

  if (!configStatus.ready || configStatus.degraded) {
    writeOperationalLog(configStatus.ready ? 'warn' : 'error', {
      event: 'worker_config_health_check',
      ...(context.get('requestId') ? { requestId: context.get('requestId') } : {}),
      details: {
        features: configStatus.features,
      },
    });
  }

  return context.json(
    {
      status,
      timestamp: new Date().toISOString(),
      config: publicConfigStatus,
    },
    configStatus.ready ? 200 : 503,
  );
});

app.route('/capabilities', capabilitiesRoutes);
app.route('/bootstrap', bootstrapRoutes);
app.route('/market', marketRoutes);
app.route('/offline', offlineRoutes);
app.route('/pending', pendingRoutes);
app.route('/payment', paymentRoutes);
app.route('/privacy', privacyRoutes);
app.route('/rpc', rpcRoutes);
app.route('/risk', riskRoutes);
app.route('/stream', streamRoutes);
app.route('/swap', swapRoutes);
app.route('/umbra', umbraRoutes);
app.route('/wallet', walletRoutes);

app.notFound(() => {
  return errorResponse(404, 'NOT_FOUND', 'The requested API route does not exist.');
});

app.onError((err, context) => {
  const appError = toAppError(err);
  writeOperationalLog('error', {
    event: 'unhandled_application_error',
    ...(context.get('requestId') ? { requestId: context.get('requestId') } : {}),
    ...(context.get('network') ? { network: context.get('network') } : {}),
    details: {
      method: context.req.method,
      path: context.req.path,
      wallet: context.get('wallet'),
      errorCode: appError.code,
      status: appError.status,
      error: err,
    },
  });

  return errorResponseFromAppError(appError);
});

export { app };
export default app;
